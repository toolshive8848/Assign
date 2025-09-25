// googleAuth.js
const express = require("express");
const router = express.Router();
const { admin, db } = require("../config/firebase");
const { OAuth2Client } = require("google-auth-library");
const creditAllocationService = require("../services/creditAllocationService");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * Google Sign-in
 * POST /api/auth/google
 */
router.post("/google", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Missing Google token" });
    }

    // Verify Google token
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    const userId = payload.sub;
    const email = payload.email;
    const name = payload.name;
    const picture = payload.picture;

    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      // New user → initialize with freemium plan via CreditAllocationService
      await userRef.set({
        email,
        name,
        picture,
        planType: "freemium",
        subscriptionStatus: "inactive",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // ✅ Call central allocation service
      await creditAllocationService.refreshFreemiumCredits(userId);
    }

    // Create custom Firebase token
    const customToken = await admin.auth().createCustomToken(userId);

    res.json({
      token: customToken,
      user: { id: userId, email, name, picture },
    });
  } catch (error) {
    console.error("Error during Google login:", error);
    res.status(500).json({ error: "Google login failed" });
  }
});

module.exports = router;
