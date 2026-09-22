const nodemailer = require("nodemailer");
require("dotenv").config();

const SMTP_HOST = process.env.SMTP_HOST || "127.0.0.1";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 2525;
const MAIL_FROM = process.env.MAIL_FROM || "campaigns@airepro.in";
const MAX_CONNECTIONS = Number(process.env.SMTP_MAX_CONNECTIONS) || 10;
const MAX_MESSAGES = Number(process.env.SMTP_MAX_MESSAGES) || 200;
const RATE_LIMIT = Number(process.env.SMTP_RATE_LIMIT) || 0; // 0 = no rate limit (max speed)

// Create a pooled Nodemailer transporter for high-throughput SMTP delivery
const transporter = nodemailer.createTransport({
    pool: true,
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    maxConnections: MAX_CONNECTIONS,
    maxMessages: MAX_MESSAGES,
    rateLimit: RATE_LIMIT > 0 ? RATE_LIMIT : undefined,
    tls: {
        rejectUnauthorized: false
    }
});

/**
 * Verify connection to SMTP server
 * @returns {Promise<boolean>}
 */
async function verifyConnection() {
    try {
        await transporter.verify();
        console.log(`[SMTP] Successfully connected and pooled to ${SMTP_HOST}:${SMTP_PORT}`);
        return true;
    } catch (error) {
        console.error(`[SMTP] Verification failed for ${SMTP_HOST}:${SMTP_PORT}:`, error.message);
        return false;
    }
}

module.exports = {
    transporter,
    verifyConnection,
    MAIL_FROM,
    SMTP_CONFIG: {
        host: SMTP_HOST,
        port: SMTP_PORT,
        maxConnections: MAX_CONNECTIONS,
        maxMessages: MAX_MESSAGES,
        rateLimit: RATE_LIMIT
    }
};
