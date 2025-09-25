// routes/credits.js
const express = require("express");
const router = express.Router();
const { db, admin } = require("../config/firebase");
const creditAllocationService = require("../services/creditAllocationService");
const { unifiedAuth } = require("../middleware/unifiedAuth");

// Secure endpoint → only logged in users can call
router.post("/init", unifiedAuth, async (req, res) => {
  try {
    const userId = req.user.uid;

    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userDoc.data();

    if (user.planType === "freemium") {
      // Give them their monthly 200 credits if needed
      const result = await creditAllocationService.refreshFreemiumCredits(userId);
      return res.json({ success: true, ...result });
    }

    // For paid users we don’t auto-allocate → handled by payment webhook
    return res.json({ success: true, skipped: true, reason: "Paid user" });

  } catch (err) {
    console.error("Init credits error:", err);
    res.status(500).json({ error: "Failed to initialize credits" });
  }
});

module.exports = router;
