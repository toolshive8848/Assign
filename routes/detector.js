const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");

const DetectorService = require("../services/detectorService");
const { unifiedAuth } = require("../middleware/unifiedAuth");

const db = admin.firestore();
const detectorService = new DetectorService();

/**
 * 🔹 Analyze content
 */
router.post("/analyze", unifiedAuth, async (req, res) => {
  try {
    const { text } = req.body;
    const userId = req.user.uid;

    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }

    const result = await detectorService.analyzeContent(userId, text);
    res.json(result);
  } catch (err) {
    console.error("Analyze error:", err);
    res.status(500).json({ error: "Failed to analyze content" });
  }
});

/**
 * 🔹 Remove detected issues (rewrite)
 */
router.post("/remove-all", unifiedAuth, async (req, res) => {
  try {
    const { text, issues } = req.body;
    const userId = req.user.uid;

    if (!text || !issues) {
      return res.status(400).json({ error: "Text and issues are required" });
    }

    const result = await detectorService.removeDetectedIssues(userId, text, issues);
    res.json(result);
  } catch (err) {
    console.error("Remove issues error:", err);
    res.status(500).json({ error: "Failed to remove detected issues" });
  }
});

/**
 * 🔹 Full workflow: detect → rewrite → re-detect
 */
router.post("/workflow", unifiedAuth, async (req, res) => {
  try {
    const { text } = req.body;
    const userId = req.user.uid;

    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }

    const result = await detectorService.detectAndRemoveWorkflow(userId, text);
    res.json(result);
  } catch (err) {
    console.error("Workflow error:", err);
    res.status(500).json({ error: "Failed to run workflow" });
  }
});

/**
 * 🔹 Fetch past results (history)
 */
router.get("/history", unifiedAuth, async (req, res) => {
  try {
    const snapshot = await db
      .collection("detectorResults")
      .where("userId", "==", req.user.uid)
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();

    const results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(results);
  } catch (err) {
    console.error("History error:", err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

module.exports = router;

