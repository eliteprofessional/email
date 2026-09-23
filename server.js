require("dotenv").config();
const express = require("express");
const { transporter, verifyConnection, SMTP_CONFIG } = require("./src/config/mailer");
const mailRoutes = require("./src/routes/mailRoutes");
const auditRoutes = require("./src/routes/auditRoutes");

const app = express();
const PORT = process.env.PORT || 3000;

// CORS Middleware
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === "OPTIONS") {
        return res.sendStatus(200);
    }
    next();
});

// Middleware: allow large JSON payloads (up to 50MB) to easily accept 10k+ recipient batches
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Health and Diagnostics Endpoint
app.get("/health", async (req, res) => {
    let smtpOk = false;
    let smtpError = null;

    try {
        await transporter.verify();
        smtpOk = true;
    } catch (err) {
        smtpError = err.message;
    }

    const memoryUsage = process.memoryUsage();

    return res.status(smtpOk ? 200 : 503).json({
        status: smtpOk ? "healthy" : "degraded",
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        smtp: {
            connected: smtpOk,
            host: SMTP_CONFIG.host,
            port: SMTP_CONFIG.port,
            maxConnections: SMTP_CONFIG.maxConnections,
            maxMessages: SMTP_CONFIG.maxMessages,
            rateLimit: SMTP_CONFIG.rateLimit,
            error: smtpError
        },
        memory: {
            rssMb: Number((memoryUsage.rss / (1024 * 1024)).toFixed(2)),
            heapUsedMb: Number((memoryUsage.heapUsed / (1024 * 1024)).toFixed(2)),
            heapTotalMb: Number((memoryUsage.heapTotal / (1024 * 1024)).toFixed(2))
        }
    });
});

// Mount Mail and Config Audit API Routes
app.use("/api/mail", mailRoutes);
app.use("/api/config", auditRoutes);


// 404 Handler
app.use((req, res) => {
    res.status(404).json({ error: `Not Found: ${req.method} ${req.url}` });
});

// Error Handler
app.use((err, req, res, next) => {
    console.error("[Server Error]", err);
    res.status(err.status || 500).json({
        error: err.message || "Internal Server Error"
    });
});

// Start Server
const server = app.listen(PORT, async () => {
    console.log(`=========================================`);
    console.log(`🚀 Airepro Mail Engine listening on port ${PORT}`);
    console.log(`📡 SMTP Target: ${SMTP_CONFIG.host}:${SMTP_CONFIG.port}`);
    console.log(`⚡ Max Pool Connections: ${SMTP_CONFIG.maxConnections}`);
    console.log(`=========================================`);

    // Verify SMTP connection on startup
    await verifyConnection();
});

server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
        console.error(`\n❌ [PORT CONFLICT] Port ${PORT} is already in use by another process (e.g. docker container)!`);
        console.error(`👉 Change PORT in .env (for example: PORT=3001) or free up port ${PORT}.\n`);
    } else {
        console.error("[Server Listen Error]", err);
    }
    process.exit(1);
});


// Graceful Shutdown
function handleShutdown(signal) {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    server.close(() => {
        console.log("HTTP server closed.");
        try {
            transporter.close();
            console.log("SMTP connection pool closed.");
        } catch (e) {
            // ignore close error
        }
        process.exit(0);
    });

    // Force shutdown after 10s if hanging
    setTimeout(() => {
        console.error("Forcing shutdown after timeout.");
        process.exit(1);
    }, 10000).unref();
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

module.exports = { app, server };