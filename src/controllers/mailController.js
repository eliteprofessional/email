const {
    sendSingleEmail,
    createBatch,
    getBatchStatus,
    cancelBatch,
    listAllBatches
} = require("../services/batchQueue");

/**
 * Handle transactional single email send
 * POST /api/mail/send
 */
async function sendSingle(req, res) {
    try {
        const { to, subject, html, text, from, replyTo, headers } = req.body;

        if (!to || !subject || (!html && !text)) {
            return res.status(400).json({
                error: "Missing required fields: 'to', 'subject', and either 'html' or 'text'."
            });
        }

        const result = await sendSingleEmail({ to, subject, html, text, from, replyTo, headers });
        return res.status(200).json({
            success: true,
            message: "Email sent successfully",
            ...result
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * Handle bulk batch dispatch (designed for 10k+ emails)
 * POST /api/mail/batch
 */
async function queueBatch(req, res) {
    try {
        const { subject, html, text, recipients, from, replyTo, concurrency, deduplicate } = req.body;

        if (!subject) {
            return res.status(400).json({ error: "Missing required field: 'subject'." });
        }

        if (!html && !text) {
            return res.status(400).json({ error: "Missing required field: either 'html' or 'text' must be provided." });
        }

        if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({ error: "'recipients' must be a non-empty array of email addresses or objects." });
        }

        const batch = createBatch({
            subject,
            html,
            text,
            recipients,
            from,
            replyTo,
            concurrency,
            deduplicate
        });

        // 202 Accepted: The request has been accepted for processing asynchronously
        return res.status(202).json({
            success: true,
            message: `Batch accepted and queued. Total valid recipients: ${batch.total}.`,
            batchId: batch.batchId,
            statusUrl: `/api/mail/batch/${batch.batchId}`,
            initialState: batch
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * Query real-time status of a batch
 * GET /api/mail/batch/:batchId
 */
async function getStatus(req, res) {
    const { batchId } = req.params;
    const status = getBatchStatus(batchId);

    if (!status) {
        return res.status(404).json({
            success: false,
            error: `Batch with ID "${batchId}" not found or expired.`
        });
    }

    return res.status(200).json({
        success: true,
        batch: status
    });
}

/**
 * Cancel an active or queued batch
 * POST /api/mail/batch/:batchId/cancel
 */
async function cancel(req, res) {
    const { batchId } = req.params;
    const result = cancelBatch(batchId);

    if (!result) {
        return res.status(404).json({
            success: false,
            error: `Batch with ID "${batchId}" not found.`
        });
    }

    return res.status(result.success ? 200 : 400).json(result);
}

/**
 * List all batches
 * GET /api/mail/batches
 */
async function listBatches(req, res) {
    const batches = listAllBatches();
    return res.status(200).json({
        success: true,
        count: batches.length,
        batches
    });
}

module.exports = {
    sendSingle,
    queueBatch,
    getStatus,
    cancel,
    listBatches
};
