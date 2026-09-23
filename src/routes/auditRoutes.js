const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const { transporter, SMTP_CONFIG, MAIL_FROM } = require("../config/mailer");

/**
 * Run a full system & configuration audit
 * Checks all settings needed by the backend
 */
router.get("/audit", async (req, res) => {
    const checks = [];
    const startTime = Date.now();

    // 1. Check .env file
    const envPath = path.resolve(__dirname, "../../.env");
    const envExists = fs.existsSync(envPath);
    checks.push({
        id: "env_file",
        category: "Environment",
        name: ".env Configuration File",
        status: envExists ? "ok" : "warning",
        value: envExists ? "Found at root" : "Missing (.env)",
        expected: "Present with required keys",
        details: envExists ? "Root .env file is present and loaded." : "No .env found; defaults or process environment are used.",
        remedy: envExists ? null : "Create a .env file from .env.example in the project root."
    });

    // 2. PORT Check
    const port = Number(process.env.PORT) || 3000;
    const isPortValid = port > 0 && port <= 65535;
    checks.push({
        id: "port",
        category: "Server",
        name: "Backend HTTP Port",
        status: isPortValid ? "ok" : "error",
        value: String(port),
        expected: "Valid port (1024 - 65535)",
        details: `Server configured on port ${port}`,
        remedy: isPortValid ? null : "Set PORT to a valid number between 1024 and 65535 in .env."
    });

    // 3. SMTP_HOST Check
    const host = SMTP_CONFIG.host;
    const isHostValid = Boolean(host && host.trim().length > 0);
    checks.push({
        id: "smtp_host",
        category: "SMTP",
        name: "SMTP Host Target",
        status: isHostValid ? "ok" : "error",
        value: host || "(not set)",
        expected: "IP address or domain (e.g. 127.0.0.1, mail.airepro.solutions)",
        details: `Outbound SMTP target is ${host}`,
        remedy: isHostValid ? null : "Define SMTP_HOST in .env with your Postfix IP or domain."
    });

    // 4. SMTP_PORT Check
    const smtpPort = Number(SMTP_CONFIG.port);
    const isSmtpPortValid = [25, 465, 587, 2525].includes(smtpPort) || (smtpPort > 0 && smtpPort <= 65535);
    checks.push({
        id: "smtp_port",
        category: "SMTP",
        name: "SMTP Port",
        status: isSmtpPortValid ? "ok" : "error",
        value: String(smtpPort),
        expected: "25, 2525 (Docker Postfix), 465 (SSL), or 587 (TLS)",
        details: `Nodemailer pool connects to port ${smtpPort}`,
        remedy: isSmtpPortValid ? null : "Set SMTP_PORT in .env (default Docker port is 2525)."
    });

    // 5. MAIL_FROM Check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isMailFromValid = Boolean(MAIL_FROM && emailRegex.test(MAIL_FROM.trim()));
    checks.push({
        id: "mail_from",
        category: "Deliverability",
        name: "Sender Address (MAIL_FROM)",
        status: isMailFromValid ? "ok" : "error",
        value: MAIL_FROM || "(not set)",
        expected: "Valid RFC 5322 email (e.g. campaigns@airepro.solutions)",
        details: `Default sender identity is ${MAIL_FROM}`,
        remedy: isMailFromValid ? null : "Set MAIL_FROM in .env to a valid sender address with your verified domain."
    });

    // 6. High-Volume Connection Pool Check
    const maxConnections = Number(SMTP_CONFIG.maxConnections);
    const isPoolValid = maxConnections >= 1 && maxConnections <= 100;
    checks.push({
        id: "pool_connections",
        category: "Performance",
        name: "Max Socket Connections",
        status: isPoolValid ? "ok" : "warning",
        value: `${maxConnections} sockets`,
        expected: "Between 5 and 50 for bulk 10k+ dispatch",
        details: `Pooled socket concurrency set to ${maxConnections}`,
        remedy: isPoolValid ? null : "Adjust SMTP_MAX_CONNECTIONS in .env (10-25 recommended for 10k+ volume)."
    });

    // 7. Max Messages Per Connection
    const maxMessages = Number(SMTP_CONFIG.maxMessages);
    const isMaxMessagesValid = maxMessages >= 1;
    checks.push({
        id: "pool_messages",
        category: "Performance",
        name: "Max Messages per Connection",
        status: isMaxMessagesValid ? "ok" : "warning",
        value: `${maxMessages} msgs/socket`,
        expected: ">= 50 to maximize reuse before socket recycling",
        details: `Sockets recycle after delivering ${maxMessages} emails`,
        remedy: isMaxMessagesValid ? null : "Set SMTP_MAX_MESSAGES in .env (200 recommended)."
    });

    // 8. Rate Limiting Check
    const rateLimit = Number(SMTP_CONFIG.rateLimit);
    checks.push({
        id: "rate_limit",
        category: "Performance",
        name: "SMTP Rate Limiter",
        status: "ok",
        value: rateLimit > 0 ? `${rateLimit} emails/sec` : "Unrestricted (0 = max throughput)",
        expected: "0 for maximum speed or throttle limit",
        details: rateLimit > 0 ? `Throttled at ${rateLimit}/s` : "Full speed enabled",
        remedy: null
    });

    // 9. DKIM Key File Check
    const dkimPath = path.resolve(__dirname, "../../dkim/airepro.solutions.txt");
    const dkimExists = fs.existsSync(dkimPath);
    let dkimValid = false;
    let dkimPreview = "";
    if (dkimExists) {
        try {
            const content = fs.readFileSync(dkimPath, "utf8");
            if (content.includes("v=DKIM1") && content.includes("p=")) {
                dkimValid = true;
                const match = content.match(/p=([A-Za-z0-9+/=]+)/);
                dkimPreview = match ? `p=${match[1].slice(0, 24)}...` : "Valid DKIM TXT record found";
            }
        } catch (e) {
            dkimValid = false;
        }
    }
    checks.push({
        id: "dkim_file",
        category: "Deliverability",
        name: "DKIM Key Verification File",
        status: dkimValid ? "ok" : (dkimExists ? "warning" : "error"),
        value: dkimValid ? "Verified (./dkim/airepro.solutions.txt)" : (dkimExists ? "Present but invalid syntax" : "Missing key file"),
        expected: "TXT record in ./dkim with v=DKIM1 and RSA public key",
        details: dkimValid ? `DKIM public key is loaded (${dkimPreview})` : "DKIM keys ensure emails don't land in Spam/Junk.",
        remedy: dkimValid ? null : "Ensure Docker postfix container generated keys in ./dkim/airepro.solutions.txt or copy existing keys."
    });

    // 10. Live SMTP Connection & Handshake Check
    let smtpConnected = false;
    let smtpLatency = 0;
    let smtpError = null;
    const pingStart = Date.now();

    const verifyWithTimeout = (timeoutMs = 4000) => {
        return Promise.race([
            transporter.verify(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Connection timed out after ${timeoutMs}ms trying to reach ${SMTP_CONFIG.host}:${SMTP_CONFIG.port}`)), timeoutMs)
            )
        ]);
    };

    try {
        await verifyWithTimeout(4000);
        smtpConnected = true;
        smtpLatency = Date.now() - pingStart;
    } catch (err) {
        smtpConnected = false;
        smtpError = err.message;
        smtpLatency = Date.now() - pingStart;
    }


    checks.push({
        id: "smtp_handshake",
        category: "SMTP",
        name: "Live SMTP Handshake",
        status: smtpConnected ? "ok" : "error",
        value: smtpConnected ? `Connected (${smtpLatency}ms)` : "Connection Failed",
        expected: `Active handshake with ${SMTP_CONFIG.host}:${SMTP_CONFIG.port}`,
        details: smtpConnected
            ? `Successfully verified socket connection with SMTP server in ${smtpLatency}ms.`
            : `SMTP verification error: ${smtpError || "Connection refused/timeout"}`,
        remedy: smtpConnected
            ? null
            : `Ensure Postfix or your SMTP container is running on ${SMTP_CONFIG.host}:${SMTP_CONFIG.port}. Check firewall or Docker container 'airepro-postfix'.`
    });

    // Determine overall state
    const errors = checks.filter(c => c.status === "error");
    const warnings = checks.filter(c => c.status === "warning");
    const allOk = errors.length === 0 && warnings.length === 0;
    const isDegraded = errors.length === 0 && warnings.length > 0;

    const memoryUsage = process.memoryUsage();

    return res.status(200).json({
        success: true,
        allOk,
        status: allOk ? "ALL_OK" : (errors.length > 0 ? "ISSUES_DETECTED" : "DEGRADED"),
        summaryMessage: allOk
            ? "All backend configurations and services are verified and operational."
            : errors.length > 0
                ? `${errors.length} critical issue${errors.length > 1 ? "s" : ""} detected in backend configuration.`
                : `${warnings.length} warning${warnings.length > 1 ? "s" : ""} detected in backend configuration.`,
        stats: {
            total: checks.length,
            passed: checks.filter(c => c.status === "ok").length,
            warnings: warnings.length,
            errors: errors.length
        },
        auditDurationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        checks,
        errors,
        warnings,
        system: {
            uptimeSeconds: Math.floor(process.uptime()),
            memoryRssMb: Number((memoryUsage.rss / (1024 * 1024)).toFixed(2)),
            heapUsedMb: Number((memoryUsage.heapUsed / (1024 * 1024)).toFixed(2)),
            heapTotalMb: Number((memoryUsage.heapTotal / (1024 * 1024)).toFixed(2))
        }
    });
});

module.exports = router;
