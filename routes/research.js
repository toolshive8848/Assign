const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");

const ImprovedCreditSystem = require("../services/improvedCreditSystem");
const ResearchService = require("../services/researchService");

const creditSystem = new ImprovedCreditSystem();
const researchService = new ResearchService();

const db = admin.firestore();

/**
 * Middleware-like auth check (no external middleware here)
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
 * 🔹 Run research query
 */
router.post("/query", requireAuth, async (req, res) => {
  const { query, depth = 1, researchType = "general" } = req.body;
  const userId = req.user.uid;

  if (!query || query.length < 3) {
    return res.status(400).json({ error: "Query must be at least 3 characters" });
  }

  try {
    const cost = depth * 10;
    const session = await creditSystem.startSession(userId, cost);

    const results = await researchService.runQuery(query, { depth, researchType });

    await creditSystem.commit(session);

    // Store research history
    const docRef = await db.collection("research").add({
      userId,
      query,
      depth,
      researchType,
      results,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ id: docRef.id, results });
  } catch (err) {
    console.error("Research error:", err);
    res.status(500).json({ error: "Failed to run research query" });
  }
});

/**
 * 🔹 Get research history for user
 */
router.get("/history", requireAuth, async (req, res) => {
  try {
    const snapshot = await db
      .collection("research")
      .where("userId", "==", req.user.uid)
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();

    const history = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json(history);
  } catch (err) {
    console.error("Error fetching history:", err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

/**
 * 🔹 Get single research item
 */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const doc = await db.collection("research").doc(req.params.id).get();
    if (!doc.exists || doc.data().userId !== req.user.uid) {
      return res.status(404).json({ error: "Not found" });
    }
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    console.error("Error fetching research:", err);
    res.status(500).json({ error: "Failed to fetch research" });
  }
});

/**
 * 🔹 Delete research item
 */
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const ref = db.collection("research").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists || doc.data().userId !== req.user.uid) {
      return res.status(404).json({ error: "Not found" });
    }

    await ref.delete();
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting research:", err);
    res.status(500).json({ error: "Failed to delete research" });
  }
});

/**
 * 🔹 Export research in multiple formats
 */
router.get("/export/:id", requireAuth, async (req, res) => {
  try {
    const { format = "json" } = req.query;
    const doc = await db.collection("research").doc(req.params.id).get();

    if (!doc.exists || doc.data().userId !== req.user.uid) {
      return res.status(404).json({ error: "Not found" });
    }

    const research = doc.data();

    if (format === "json") {
      res.json(research);
    } else if (format === "txt") {
      res.type("text/plain").send(research.results.map(r => r.text).join("\n"));
    } else if (format === "md") {
      res.type("text/markdown").send(`# Research: ${research.query}\n\n` +
        research.results.map(r => `- ${r.text}`).join("\n"));
    } else if (format === "pdf") {
      // Lazy PDF export example (can integrate real PDF library)
      res.type("application/pdf").send("PDF export not implemented yet.");
    } else {
      res.status(400).json({ error: "Unsupported format" });
    }
  } catch (err) {
    console.error("Error exporting research:", err);
    res.status(500).json({ error: "Failed to export research" });
  }
});

/**
 * 🔹 Bookmark a source
 */
router.post("/bookmark", requireAuth, async (req, res) => {
  try {
    const { researchId, source } = req.body;
    if (!researchId || !source) {
      return res.status(400).json({ error: "Missing researchId or source" });
    }

    const ref = await db.collection("bookmarks").add({
      userId: req.user.uid,
      researchId,
      source,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ id: ref.id, success: true });
  } catch (err) {
    console.error("Error bookmarking:", err);
    res.status(500).json({ error: "Failed to save bookmark" });
  }
});

/**
 * 🔹 Get sample quotes from a source
 */
router.get("/quote/:sourceId", requireAuth, async (req, res) => {
  try {
    const { sourceId } = req.params;
    // Mock quotes for now
    const quotes = [
      { sourceId, text: "Sample quote 1 from source." },
      { sourceId, text: "Sample quote 2 from source." },
    ];
    res.json(quotes);
  } catch (err) {
    console.error("Error fetching quotes:", err);
    res.status(500).json({ error: "Failed to fetch quotes" });
  }
});

/**
 * 🔹 Generate PDF for a source
 */
router.get("/pdf/:sourceId", requireAuth, async (req, res) => {
  try {
    const { sourceId } = req.params;
    // Placeholder PDF response
    res.type("application/pdf").send(`PDF for source ${sourceId} (not implemented yet).`);
  } catch (err) {
    console.error("Error generating PDF:", err);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

module.exports = router;
