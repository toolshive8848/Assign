const express = require("express");
const router = express.Router();
const { unifiedAuth } = require("../middleware/unifiedAuth");
const PromptEngineerService = require("../services/promptEngineerService");

const promptService = new PromptEngineerService();

/**
 * 🔹 Optimize prompt (requires credits)
 */
router.post("/optimize", unifiedAuth, async (req, res) => {
  try {
    const { prompt, category = "general" } = req.body;
    const userId = req.user.uid;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const result = await promptService.optimizePrompt(prompt, category, userId);
    res.json(result);
  } catch (err) {
    console.error("Optimize error:", err);
    res.status(500).json({ error: "Failed to optimize prompt" });
  }
});

/**
 * 🔹 Analyze prompt (requires credits)
 */
router.post("/analyze", unifiedAuth, async (req, res) => {
  try {
    const { prompt } = req.body;
    const userId = req.user.uid;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const result = await promptService.analyzePromptWithCredits(prompt, userId);
    res.json(result);
  } catch (err) {
    console.error("Analyze error:", err);
    res.status(500).json({ error: "Failed to analyze prompt" });
  }
});

/**
 * 🔹 Analyze prompt (free mode, no credits, no login)
 */
router.post("/analyze-free", async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const result = await promptService.analyzePromptFree(prompt);
    res.json(result);
  } catch (err) {
    console.error("Analyze-free error:", err);
    res.status(500).json({ error: "Failed to analyze prompt (free mode)" });
  }
});

/**
 * 🔹 Get user history (requires login)
 */
router.get("/history", unifiedAuth, async (req, res) => {
  try {
    const userId = req.user.uid;
    const history = await promptService.getHistory(userId);
    res.json(history);
  } catch (err) {
    console.error("History error:", err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

/**
 * 🔹 Get quick-start templates (static)
 */
router.get("/templates", (req, res) => {
  res.json([
    { category: "General", prompt: "Summarize this article in 3 key points." },
    { category: "Academic", prompt: "Explain the significance of quantum computing in simple terms." },
    { category: "Creative", prompt: "Write a short story about time travel in 200 words." },
    { category: "Technical", prompt: "Explain REST API vs GraphQL in detail." },
  ]);
});

/**
 * 🔹 Get user credit info
 */
router.get("/credit-info", unifiedAuth, async (req, res) => {
  try {
    const userId = req.user.uid;
    const info = await promptService.getUserCreditInfo(userId);
    res.json(info);
  } catch (err) {
    console.error("Credit-info error:", err);
    res.status(500).json({ error: "Failed to fetch credit info" });
  }
});

module.exports = router;
