// functions/index.js
const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// Initialize Firebase Admin with service account
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require("./firebase-admin-key.json")),
    databaseURL: `https://${process.env.GCLOUD_PROJECT}.firebaseio.com`,
  });
}

const db = admin.firestore();

// Express app
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ========== ROUTES ==========

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "AssignSavvy backend is running 🚀" });
});

// Example: Get user profile
app.get("/user/:uid", async (req, res) => {
  try {
    const userRef = db.collection("users").doc(req.params.uid);
    const doc = await userRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ uid: req.params.uid, ...doc.data() });
  } catch (err) {
    console.error("Error fetching user:", err);
    res.status(500).json({ error: err.message });
  }
});

// Example: Update credits
app.post("/user/:uid/credits", async (req, res) => {
  try {
    const { amount } = req.body;
    const userRef = db.collection("users").doc(req.params.uid);

    await db.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) throw new Error("User not found");

      const current = snap.data().credits || 0;
      t.update(userRef, { credits: current + amount });
    });

    res.json({ success: true, message: `Added ${amount} credits` });
  } catch (err) {
    console.error("Error updating credits:", err);
    res.status(500).json({ error: err.message });
  }
});

// TODO: Import & mount your payments route when ready
// const paymentsRoute = require("./routes/payments");
// app.use("/payments", paymentsRoute);

// ========== EXPORT ==========

exports.api = functions.https.onRequest(app);
