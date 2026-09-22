const express = require("express");
const router = express.Router();
const mailController = require("../controllers/mailController");

// Single transactional email
router.post("/send", mailController.sendSingle);

// Bulk batch email dispatch
router.post("/batch", mailController.queueBatch);

// Query batch progress / metrics
router.get("/batch/:batchId", mailController.getStatus);

// Cancel ongoing batch
router.post("/batch/:batchId/cancel", mailController.cancel);

// List all batches
router.get("/batches", mailController.listBatches);

module.exports = router;
