const { randomUUID } = require("crypto");
const { transporter, MAIL_FROM, SMTP_CONFIG } = require("../config/mailer");
const { renderTemplate } = require("./template");

// In-memory store for batches (batchId -> batchState)
const batches = new Map();

// Retention duration for completed batches (24 hours)
const RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Basic email syntax check (RFC 5322 standard regex simplification)
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(email) {
    return typeof email === "string" && EMAIL_REGEX.test(email.trim());
}

/**
 * Send a single transactional email directly using pooled transporter
 */
async function sendSingleEmail({ to, subject, html, text, from = MAIL_FROM, replyTo, headers }) {
    if (!isValidEmail(to)) {
        throw new Error(`Invalid recipient email address: "${to}"`);
    }

    const info = await transporter.sendMail({
        from,
        to: to.trim(),
        subject,
        html,
        text,
        replyTo,
        headers
    });

    return {
        success: true,
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected
    };
}

/**
 * Create and start a bulk email batch job
 */
function createBatch({
    subject,
    html,
    text,
    recipients,
    from = MAIL_FROM,
    replyTo,
    concurrency = SMTP_CONFIG.maxConnections || 10,
    deduplicate = true
}) {
    if (!Array.isArray(recipients) || recipients.length === 0) {
        throw new Error("Recipients array is required and cannot be empty.");
    }

    if (!subject) {
        throw new Error("Email subject is required.");
    }

    if (!html && !text) {
        throw new Error("Email body (html or text) is required.");
    }

    // Normalize and optionally deduplicate recipients
    const seen = new Set();
    const cleanRecipients = [];

    for (const r of recipients) {
        const email = typeof r === "string" ? r.trim().toLowerCase() : (r.to || r.email || "").trim().toLowerCase();
        if (!isValidEmail(email)) continue;

        if (deduplicate) {
            if (seen.has(email)) continue;
            seen.add(email);
        }

        const variables = typeof r === "object" && r.variables ? r.variables : (typeof r === "object" ? r : {});
        // Ensure email is always available in variables
        variables.email = email;

        cleanRecipients.push({
            to: email,
            variables
        });
    }

    if (cleanRecipients.length === 0) {
        throw new Error("No valid recipient email addresses found in the provided list.");
    }

    const batchId = randomUUID();
    const batchState = {
        batchId,
        from,
        subject,
        html,
        text,
        replyTo,
        total: cleanRecipients.length,
        sent: 0,
        failed: 0,
        cancelled: false,
        status: "queued", // 'queued' | 'processing' | 'completed' | 'cancelled' | 'failed'
        startedAt: null,
        finishedAt: null,
        durationSeconds: 0,
        speed: 0, // emails / sec
        etaSeconds: 0,
        errors: [], // Store sample errors up to 50
        recipients: cleanRecipients,
        concurrency: Math.max(1, Math.min(concurrency, 50)) // Cap concurrency safely between 1 and 50
    };

    batches.set(batchId, batchState);

    // Schedule background queue execution asynchronously on next tick
    setImmediate(() => {
        processBatch(batchId).catch((err) => {
            console.error(`[Batch ${batchId}] Unexpected processing failure:`, err);
            const batch = batches.get(batchId);
            if (batch) {
                batch.status = "failed";
                batch.finishedAt = new Date().toISOString();
            }
        });
    });

    return getBatchSummary(batchState);
}

/**
 * Worker pool processor for a batch
 */
async function processBatch(batchId) {
    const batch = batches.get(batchId);
    if (!batch) return;

    batch.status = "processing";
    batch.startedAt = new Date().toISOString();
    const startTime = Date.now();

    const recipients = batch.recipients;
    const total = recipients.length;
    let nextIndex = 0;

    // Worker function: each worker pulls items iteratively until batch is done or cancelled
    async function worker(workerId) {
        while (nextIndex < total) {
            if (batch.cancelled) {
                break;
            }

            const currentIndex = nextIndex++;
            if (currentIndex >= total) break;

            const item = recipients[currentIndex];

            try {
                // Interpolate template with recipient-specific variables
                const personalizedSubject = renderTemplate(batch.subject, item.variables);
                const personalizedHtml = batch.html ? renderTemplate(batch.html, item.variables) : undefined;
                const personalizedText = batch.text ? renderTemplate(batch.text, item.variables) : undefined;

                await transporter.sendMail({
                    from: batch.from,
                    to: item.to,
                    subject: personalizedSubject,
                    html: personalizedHtml,
                    text: personalizedText,
                    replyTo: batch.replyTo
                });

                batch.sent++;
            } catch (err) {
                batch.failed++;
                if (batch.errors.length < 50) {
                    batch.errors.push({
                        to: item.to,
                        error: err.message || "Unknown error",
                        time: new Date().toISOString()
                    });
                }
            }

            // Update performance metrics
            const elapsedSeconds = (Date.now() - startTime) / 1000;
            const processed = batch.sent + batch.failed;
            if (elapsedSeconds > 0) {
                batch.speed = Number((processed / elapsedSeconds).toFixed(2));
                const remaining = total - processed;
                batch.etaSeconds = batch.speed > 0 ? Math.round(remaining / batch.speed) : 0;
            }
        }
    }

    // Spawn concurrent workers
    const activeWorkers = [];
    const concurrencyCount = Math.min(batch.concurrency, total);

    for (let i = 0; i < concurrencyCount; i++) {
        activeWorkers.push(worker(i + 1));
    }

    // Wait for all workers to finish
    await Promise.all(activeWorkers);

    batch.finishedAt = new Date().toISOString();
    batch.durationSeconds = Number(((Date.now() - startTime) / 1000).toFixed(2));
    batch.status = batch.cancelled ? "cancelled" : "completed";

    // Free recipients array to reduce memory for 10k+ items
    batch.recipients = null;

    console.log(
        `[Batch ${batchId}] Finished with status: ${batch.status}. Sent: ${batch.sent}, Failed: ${batch.failed}, Duration: ${batch.durationSeconds}s (${batch.speed} emails/sec)`
    );

    // Schedule cleanup after retention window
    setTimeout(() => {
        batches.delete(batchId);
    }, RETENTION_MS);
}

/**
 * Cancel an in-progress batch
 */
function cancelBatch(batchId) {
    const batch = batches.get(batchId);
    if (!batch) return null;

    if (batch.status === "processing" || batch.status === "queued") {
        batch.cancelled = true;
        batch.status = "cancelled";
        return { success: true, message: `Batch ${batchId} cancelled.` };
    }

    return {
        success: false,
        message: `Batch ${batchId} cannot be cancelled as it is already ${batch.status}.`
    };
}

/**
 * Get batch progress summary
 */
function getBatchStatus(batchId) {
    const batch = batches.get(batchId);
    if (!batch) return null;
    return getBatchSummary(batch);
}

function getBatchSummary(batch) {
    const processed = batch.sent + batch.failed;
    const remaining = Math.max(0, batch.total - processed);
    const progressPercent = batch.total > 0 ? Number(((processed / batch.total) * 100).toFixed(2)) : 0;

    return {
        batchId: batch.batchId,
        status: batch.status,
        progress: `${progressPercent}%`,
        progressPercent,
        total: batch.total,
        sent: batch.sent,
        failed: batch.failed,
        remaining,
        speed: `${batch.speed} emails/sec`,
        etaSeconds: batch.etaSeconds,
        startedAt: batch.startedAt,
        finishedAt: batch.finishedAt,
        durationSeconds: batch.durationSeconds,
        errorsCount: batch.errors.length,
        recentErrors: batch.errors.slice(-10)
    };
}

/**
 * List all recent batches
 */
function listAllBatches() {
    const result = [];
    for (const batch of batches.values()) {
        result.push(getBatchSummary(batch));
    }
    return result;
}

module.exports = {
    sendSingleEmail,
    createBatch,
    getBatchStatus,
    cancelBatch,
    listAllBatches
};
