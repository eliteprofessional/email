/**
 * Test script for Airepro Mail Engine
 * Usage:
 *   node test-batch.js [batchSize]
 * Examples:
 *   node test-batch.js 20      # Test with 20 emails
 *   node test-batch.js 100     # Test with 100 emails
 *   node test-batch.js 1000    # Test with 1000 emails
 */

const BASE_URL = process.env.API_URL || "http://localhost:3000";
const BATCH_SIZE = parseInt(process.argv[2], 10) || 50;

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
    console.log(`\n==============================================`);
    console.log(`🧪 Airepro Mail API Test Suite`);
    console.log(`Target: ${BASE_URL}`);
    console.log(`==============================================\n`);

    // 1. Health Check
    console.log(`[1/3] Testing GET /health ...`);
    try {
        const healthRes = await fetch(`${BASE_URL}/health`);
        const healthData = await healthRes.json();
        console.log(`  Status: ${healthRes.status} ${healthRes.statusText}`);
        console.log(`  SMTP Connected: ${healthData.smtp?.connected}`);
        console.log(`  Memory (Heap Used): ${healthData.memory?.heapUsedMb} MB`);
        if (!healthData.smtp?.connected) {
            console.error(`  ⚠️ SMTP not connected! Error:`, healthData.smtp?.error);
        }
    } catch (e) {
        console.error(`  ❌ Failed to connect to server at ${BASE_URL}. Is "npm start" running? Error: ${e.message}`);
        process.exit(1);
    }

    // 2. Single Transactional Email
    console.log(`\n[2/3] Testing POST /api/mail/send (Single Email) ...`);
    try {
        const singleRes = await fetch(`${BASE_URL}/api/mail/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                to: "test-single@airepro.in",
                subject: "Transactional Test Email",
                html: "<h3>Hello from Airepro Mail API</h3><p>Single email delivery verified.</p>"
            })
        });
        const singleData = await singleRes.json();
        console.log(`  Response:`, singleData);
    } catch (e) {
        console.error(`  ❌ Error sending single email:`, e.message);
    }

    // 3. Batch Email Dispatch
    console.log(`\n[3/3] Testing POST /api/mail/batch with ${BATCH_SIZE} recipients ...`);
    const recipients = [];
    for (let i = 1; i <= BATCH_SIZE; i++) {
        recipients.push({
            to: `user${i}@airepro.in`,
            variables: {
                name: `User ${i}`,
                id: i,
                company: "Airepro Client"
            }
        });
    }

    try {
        const batchStart = Date.now();
        const batchRes = await fetch(`${BASE_URL}/api/mail/batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                subject: "Welcome {{name}}! Airepro Bulk Test #{{id}}",
                html: "<h2>Hi {{name}},</h2><p>Your company <strong>{{company}}</strong> is set up.</p><p>Account: {{email}}</p>",
                text: "Hi {{name}}, your company {{company}} is set up.",
                recipients,
                concurrency: 15
            })
        });

        const batchAcceptData = await batchRes.json();
        console.log(`  HTTP Status: ${batchRes.status} (Accepted)`);
        console.log(`  Batch ID: ${batchAcceptData.batchId}`);
        console.log(`  Queue Message: ${batchAcceptData.message}`);

        const batchId = batchAcceptData.batchId;
        if (!batchId) return;

        // Poll batch status until completed or failed
        console.log(`\n  Tracking batch progress in real-time:`);
        let done = false;
        while (!done) {
            await sleep(400);
            const statusRes = await fetch(`${BASE_URL}/api/mail/batch/${batchId}`);
            const statusData = await statusRes.json();
            const b = statusData.batch;

            if (!b) break;

            process.stdout.write(
                `\r  Status: ${b.status} | Sent: ${b.sent}/${b.total} (${b.progress}) | Speed: ${b.speed} | ETA: ${b.etaSeconds}s   `
            );

            if (b.status === "completed" || b.status === "cancelled" || b.status === "failed") {
                done = true;
                console.log(`\n\n  ✅ Batch finished!`);
                console.log(`  Duration: ${b.durationSeconds}s`);
                console.log(`  Total Sent: ${b.sent}`);
                console.log(`  Total Failed: ${b.failed}`);
                console.log(`  Final Speed: ${b.speed}`);
                if (b.errorsCount > 0) {
                    console.log(`  Errors count: ${b.errorsCount}`);
                    console.log(`  Recent errors:`, b.recentErrors);
                }
            }
        }
    } catch (e) {
        console.error(`  ❌ Batch error:`, e.message);
    }

    console.log(`\n==============================================`);
    console.log(`🎉 Test Run Completed.`);
    console.log(`==============================================\n`);
}

runTests();
