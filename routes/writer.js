const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");
const multer = require("multer");
const { Document, Packer, Paragraph } = require("docx");

const ImprovedCreditSystem = require("../services/improvedCreditSystem");
const PlanValidator = require("../middleware/planValidator");

const fileProcessingService = require("../services/fileProcessingService");
const multiPartGenerator = require("../services/multiPartGenerator");
const contentValidator = require("../services/contentValidator");
const contentHistory = require("../services/contentHistory");

const db = admin.firestore();
const creditSystem = new ImprovedCreditSystem();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * 🔹 Log activity (for dashboard)
 */
async function logActivity(userId, action, details = {}) {
  try {
    await db.collection("activities").add({
      userId,
      action,
      details,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("Error logging activity:", err);
  }
}

/**
 * 🔹 Generate content
 */
router.post("/generate", PlanValidator.validate, async (req, res) => {
  const { prompt, wordCount = 500, style = "academic" } = req.body;
  const userId = req.user.uid;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  try {
    const cost = Math.ceil(wordCount / 5); // 1 credit = ~5 words
    const session = await creditSystem.startSession(userId, cost);

    const content = await multiPartGenerator.generate(userId, prompt, wordCount, style);

    // Validate content quality
    const validation = contentValidator.validate(content, wordCount);

    // Save to history
    const historyId = await contentHistory.save(userId, {
      prompt,
      content,
      style,
      wordCount,
      validation,
      creditsUsed: cost,
    });

    await creditSystem.commit(session);

    // Log activity
    await logActivity(userId, "Writer: Generated content", { wordCount, creditsUsed: cost });

    res.json({ id: historyId, content, validation });
  } catch (err) {
    console.error("Writer generate error:", err);
    res.status(500).json({ error: "Failed to generate content" });
  }
});

/**
 * 🔹 Upload + generate
 */
router.post("/upload-and-generate", upload.single("file"), PlanValidator.validate, async (req, res) => {
  const userId = req.user.uid;
  const { wordCount = 500, style = "academic" } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: "File is required" });
  }

  try {
    const extracted = await fileProcessingService.extractText(req.file);
    const cost = Math.ceil(wordCount / 5);

    const session = await creditSystem.startSession(userId, cost);

    const content = await multiPartGenerator.generate(userId, extracted, wordCount, style);
    const validation = contentValidator.validate(content, wordCount);

    const historyId = await contentHistory.save(userId, {
      prompt: extracted.slice(0, 100) + "...",
      content,
      style,
      wordCount,
      validation,
      creditsUsed: cost,
    });

    await creditSystem.commit(session);

    await logActivity(userId, "Writer: Generated from upload", { wordCount, creditsUsed: cost });

    res.json({ id: historyId, content, validation });
  } catch (err) {
    console.error("Upload generate error:", err);
    res.status(500).json({ error: "Failed to generate from file" });
  }
});

/**
 * 🔹 Validate file type
 */
router.post("/validate-files", upload.array("files"), (req, res) => {
  const valid = req.files.every((f) => fileProcessingService.isValidFormat(f));
  res.json({ valid });
});

/**
 * 🔹 Supported formats
 */
router.get("/supported-formats", (req, res) => {
  res.json({ formats: fileProcessingService.getSupportedFormats() });
});

/**
 * 🔹 Download as DOCX
 */
router.post("/download", async (req, res) => {
  try {
    const { content, filename = "document.docx" } = req.body;

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [new Paragraph(content)],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.send(buffer);
  } catch (err) {
    console.error("Download error:", err);
    res.status(500).json({ error: "Failed to generate download" });
  }
});

/**
 * 🔹 Health check
 */
router.get("/health", (req, res) => {
  res.json({ status: "ok", creditSystem: creditSystem.healthCheck() });
});

module.exports = router;
