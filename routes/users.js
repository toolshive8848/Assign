const express = require("express");
const router = express.Router();
const { db, admin } = require("../config/firebase");

/**
 * Initialize user document in Firestore
 * Ensures freemium users get 200 credits on first login
 */
router.post("/init", async (req, res) => {
  try {
    const { uid, email, displayName } = req.body;
    if (!uid || !email) {
      return res.status(400).json({ error: "Missing uid or email" });
    }

    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      // Create new user with 200 credits
      await userRef.set({
        email,
        displayName: displayName || "",
        planType: "freemium",
        credits: 200,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastCreditRefresh: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.json({ success: true, newUser: true, credits: 200 });
    } else {
      // User exists → don’t reset credits
      return res.json({ success: true, newUser: false, ...userDoc.data() });
    }
  } catch (error) {
    console.error("Error initializing user:", error);
    res.status(500).json({ error: "Failed to initialize user" });
  }
});

module.exports = router;
