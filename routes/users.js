// users.js
const express = require("express");
const router = express.Router();
const { admin, db } = require("../config/firebase");
const creditAllocationService = require("../services/creditAllocationService");

/**
 * Refresh credits for the logged-in user
 * POST /api/users/refresh-credits
 */
router.post("/refresh-credits", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userDoc.data();

    let result;

    // Delegate refresh logic to central service
    if (user.planType === "freemium") {
      result = await creditAllocationService.refreshFreemiumCredits(userId);
    } else if (user.planType === "pro") {
      result = await creditAllocationService.allocateProCredits(userId);
    } else if (user.planType === "custom") {
      // Optional: if you support refreshing for custom plans
      result = { skipped: true, reason: "Custom plan refresh not supported" };
    } else {
      result = { skipped: true, reason: "Unknown plan type" };
    }

    res.json({
      success: true,
      planType: user.planType,
      result,
    });
  } catch (error) {
    console.error("Error refreshing credits:", error);
    res.status(500).json({ error: "Failed to refresh credits" });
  }
});

module.exports = router;
