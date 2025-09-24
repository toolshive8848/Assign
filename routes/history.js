const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");
const { authenticateToken } = require("../middleware/auth");

const contentHistory = require("../services/contentHistory");
const ResearchService = require("../services/researchService");
const DetectorService = require("../services/detectorService");
const PromptEngineerService = require("../services/promptEngineerService");

const db = admin.firestore();

const researchService = new ResearchService();
const detectorService = new DetectorService();
const promptService = new PromptEngineerService();

/**
 * 🔹 Helper: format item for frontend
 */
function formatItem(item, type) {
  return {
    id: item.id,
    type,
    title: item.title || item.prompt?.slice(0, 50) || "Untitled",
    status: item.status || "completed",
    wordCount: item.wordCount || 0,
    creditsUsed: item.creditsUsed || 0,
   preview: item.content?.slice(0, 200) 
  || item.result?.summary 
  || item.optimizedPrompt?.slice(0, 200) 
  || item.analysis?.overall?.feedback 
  || "",
    createdAt: item.timestamp?.toDate?.() || item.createdAt || new Date(),
    metadata: item.metadata || {},
  };
}

/**
 * 🔹 Get full history (with filters + stats + pagination)
 */
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { filter = "all", page = 1, limit = 10 } = req.query;

    // Collect history from all services
    const [writerHistory, researchHistory, detectorHistory, promptHistory] = await Promise.all([
      contentHistory.getHistory(userId),
      researchService.getHistory(userId),
      detectorService.getHistory(userId),
      promptService.getPromptHistory(userId, 20),
    ]);

    // Merge all items
    let history = [
      ...writerHistory.map((h) => formatItem(h, "writer")),
      ...researchHistory.map((h) => formatItem(h, "research")),
      ...detectorHistory.map((h) => formatItem(h, "detector")),
      ...promptHistory.analyses.map((h) => formatItem(h, "prompt-analysis")),
      ...promptHistory.optimizations.map((h) => formatItem(h, "prompt-optimization")),
    ];

    // Apply filter
   if (filter !== "all") {
  history = history.filter((h) => h.type === filter || h.status === filter);
}

    // Sort newest first
    history.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Pagination
    const start = (page - 1) * limit;
    const paginated = history.slice(start, start + parseInt(limit, 10));

    // Stats
    const stats = {
      total: history.length,
      completed: history.filter((h) => h.status === "completed").length,
      inProgress: history.filter((h) => h.status === "in-progress").length,
      failed: history.filter((h) => h.status === "failed").length,
      totalWords: history.reduce((sum, h) => sum + (h.wordCount || 0), 0),
    };

    res.json({
      history: paginated,
      stats,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: history.length,
      },
    });
  } catch (err) {
    console.error("History fetch error:", err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

/**
 * 🔹 Get single item
 */
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid;

    // Look in contentHistory (writer)
    const writerDoc = await contentHistory.getById(userId, id);
    if (writerDoc) return res.json(formatItem(writerDoc, "writer"));

    // Look in research
    const researchDoc = await researchService.getById(userId, id);
    if (researchDoc) return res.json(formatItem(researchDoc, "research"));

    // Look in detector
    const detectorDoc = await detectorService.getById(userId, id);
    if (detectorDoc) return res.json(formatItem(detectorDoc, "detector"));

    // Look in prompt
    const promptDoc = await promptService.getById(userId, id);
    if (promptDoc) return res.json(formatItem(promptDoc, "prompt"));

    res.status(404).json({ error: "History item not found" });
  } catch (err) {
    console.error("Single history error:", err);
    res.status(500).json({ error: "Failed to fetch history item" });
  }
});

/**
 * 🔹 Delete item
 */
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid;

    const { type } = req.query; // 🔹 pass ?type=writer|research|detector|prompt

if (type === "writer") await contentHistory.delete(userId, id);
else if (type === "research") await researchService.delete(userId, id);
else if (type === "detector") await detectorService.delete(userId, id);
// ❌ promptService has no delete

    res.json({ success: true });
  } catch (err) {
    console.error("Delete history error:", err);
    res.status(500).json({ error: "Failed to delete history item" });
  }
});

/**
 * 🔹 Export (JSON or CSV)
 */
router.post("/export", authenticateToken, async (req, res) => {
  try {
    const { format = "json" } = req.body;
    const userId = req.user.uid;

    const writerHistory = await contentHistory.getHistory(userId);

    if (format === "json") {
      res.json(writerHistory);
    } else if (format === "csv") {
      const header = "id,title,wordCount,creditsUsed,status\n";
      const rows = writerHistory
        .map((h) => `${h.id},${h.title},${h.wordCount},${h.creditsUsed},${h.status}`)
        .join("\n");
      res.type("text/csv").send(header + rows);
    } else {
      res.status(400).json({ error: "Unsupported format" });
    }
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ error: "Failed to export history" });
  }
});

module.exports = router;
