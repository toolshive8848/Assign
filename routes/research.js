// routes/research.js
const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");
const ImprovedCreditSystem = require("../services/improvedCreditSystem");
const ResearchService = require("../services/researchService");

const creditSystem = new ImprovedCreditSystem();
const researchService = new ResearchService();

/**
 * Middleware-like auth check (no external middleware)
 */
async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.split("Bearer ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    console.error("Auth error:", err.message);
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Run research query
 */
router.post("/query", requireAuth, async (req, res) => {
  const { query, depth = 1, researchType = "general" } = req.body;
  const userId = req.user.uid;

  try {
    if (!query || query.length < 3) {
      return res.status(400).json({ error: "Query is too short" });
    }

    // Estimate words and credits
    const estimatedWords = query.split(" ").length * depth * 200;
    const deduction = await creditSystem.deductCreditsAtomic(
      userId,
      estimatedWords,
      req.user.planType || "freemium",
      "research"
    );

    if (!deduction.success) {
      return res.status(400).json({ error: "Insufficient credits" });
    }

    // Conduct research
    const result = await researchService.conductResearch(query, {
      depth,
      type: researchType,
      userId
    });

    // Adjust credits if actual < estimated
    if (result.words < estimatedWords) {
      await creditSystem.rollbackTransaction(
        userId,
        deduction.transactionId,
        deduction.creditsDeducted - result.words,
        deduction.wordsAllocated - result.words
      );
    }

    res.json({
      success: true,
      result,
      credits: {
        deducted: deduction.creditsDeducted,
        remaining: deduction.newBalance
      }
    });
  } catch (err) {
    console.error("Research error:", err.message);
    res.status(500).json({ error: "Research failed", details: err.message });
  }
});

/**
 * Get saved research history
 */
router.get("/history", requireAuth, async (req, res) => {
  try {
    const snapshot = await admin
      .firestore()
      .collection("research_history")
      .where("userId", "==", req.user.uid)
      .orderBy("timestamp", "desc")
      .limit(10)
      .get();

    const history = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch history", details: err.message });
  }
});

/**
 * Get a source quote (no mock)
 */
router.get("/quote/:id", requireAuth, async (req, res) => {
  try {
    const docSnap = await admin
      .firestore()
      .collection("research_history")
      .doc(req.params.id)
      .get();

    if (!docSnap.exists) {
      return res.status(404).json({ error: "Research not found" });
    }

    const data = docSnap.data();
    const quote = data.sources?.[0]?.snippet || "No quote available";

    res.json({ quote });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch quote", details: err.message });
  }
});

module.exports = router;
