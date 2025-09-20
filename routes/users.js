const express = require("express");
const router = express.Router();
const { unifiedAuth } = require("../middleware/unifiedAuth");
const admin = require("firebase-admin");

const db = admin.firestore();

/**
 * GET /api/users/profile
 * Returns current user profile
 */
router.get("/profile", unifiedAuth, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ id: userId, ...userDoc.data() });
  } catch (err) {
    console.error("Error fetching profile:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

/**
 * PUT /api/users/profile
 * Update user profile
 */
router.put("/profile", unifiedAuth, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { displayName } = req.body;

    if (!displayName) {
      return res.status(400).json({ error: "Display name is required" });
    }

    await db.collection("users").doc(userId).set(
      { displayName },
      { merge: true }
    );

    res.json({ success: true, message: "Profile updated" });
  } catch (err) {
    console.error("Error updating profile:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

/**
 * GET /api/users/stats
 * Returns user stats (credits, usage, etc.)
 */
router.get("/stats", unifiedAuth, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const data = userDoc.data();
    res.json({
      credits: data.credits || 0,
      planType: data.planType || "freemium",
      stats: data.stats || {}
    });
  } catch (err) {
    console.error("Error fetching stats:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

/**
 * POST /api/users/refresh-credits
 * Reset monthly credits (manual/admin or scheduled job)
 */
router.post("/refresh-credits", unifiedAuth, async (req, res) => {
  try {
    const userId = req.user.uid;
    const resetValue = req.body.credits || 200;

    await db.collection("users").doc(userId).set(
      {
        credits: resetValue,
        creditResetDate: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.json({ success: true, message: "Credits refreshed", credits: resetValue });
  } catch (err) {
    console.error("Error refreshing credits:", err);
    res.status(500).json({ error: "Failed to refresh credits" });
  }
});

module.exports = router;
