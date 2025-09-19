// routes/writer.js
const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");
const ImprovedCreditSystem = require("../services/improvedCreditSystem");
const ContentProcessor = require("../services/contentProcessor"); // assuming you have this
const DraftManager = require("../services/draftManager"); // optional if drafts exist

const creditSystem = new ImprovedCreditSystem();
const contentProcessor = new ContentProcessor();
const draftManager = new DraftManager();

/**
 * Middleware-like auth check
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
 * Create new writing content
 */
router.post("/generate", requireAuth, async (req, res) => {
  const { topic, instructions = "", wordCount = 500 } = req.body;
  const userId = req.user.uid;

  try {
    if (!topic || topic.length < 3) {
      return res.status(400).json({ error: "Topic is too short" });
    }

    // Deduct credits based on word count
    const deduction = await creditSystem.deductCreditsAtomic(
      userId,
      wordCount,
      req.user.planType || "freemium",
      "writing"
    );

    if (!deduction.success) {
      return res.status(400).json({ error: "Insufficient credits" });
    }

    // Generate content
    const result = await contentProcessor.generateContent(topic, {
      wordCount,
      instructions,
      userId
    });

    // Rollback if actual words < charged words
    const actualWords = result.wordCount || result.content.split(" ").length;
    if (actualWords < wordCount) {
      await creditSystem.rollbackTransaction(
        userId,
        deduction.transactionId,
        deduction.creditsDeducted - Math.ceil(actualWords / 3),
        deduction.wordsAllocated - actualWords
      );
    }

    // Save to drafts/history
    await draftManager.saveDraft(userId, {
      topic,
      content: result.content,
      wordCount: actualWords,
      timestamp: new Date(),
      status: "completed"
    });

    res.json({
      success: true,
      content: result.content,
      wordCount: actualWords,
      credits: {
        deducted: deduction.creditsDeducted,
        remaining: deduction.newBalance
      }
    });
  } catch (err) {
    console.error("Writer error:", err.message);
    res.status(500).json({ error: "Failed to generate content", details: err.message });
  }
});

/**
 * Get writing history
 */
router.get("/history", requireAuth, async (req, res) => {
  try {
    const snapshot = await admin
      .firestore()
      .collection("writing_history")
      .where("userId", "==", req.user.uid)
      .orderBy("timestamp", "desc")
      .limit(10)
      .get();

    const history = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ history });
  } catch (err) {
    console.error("History fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch history", details: err.message });
  }
});

/**
 * Get single draft
 */
router.get("/draft/:id", requireAuth, async (req, res) => {
  try {
    const docSnap = await admin
      .firestore()
      .collection("writing_history")
      .doc(req.params.id)
      .get();

    if (!docSnap.exists) {
      return res.status(404).json({ error: "Draft not found" });
    }

    res.json({ draft: { id: docSnap.id, ...docSnap.data() } });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch draft", details: err.message });
  }
});

module.exports = router;
