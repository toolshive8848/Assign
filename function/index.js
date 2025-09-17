// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const Stripe = require("stripe");

// ✅ Load config
const serviceAccount = require("./firebase-admin-key.json");
const creditSystem = require("./creditsystem"); // your renamed improvedCreditSystem.js
const stripe = Stripe(process.env.STRIPE_SECRET_KEY); // set in Firebase env

// ✅ Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();

// ✅ Express app
const app = express();
app.use(cors({ origin: true }));
app.use(bodyParser.json());

// -------------------
// Create Checkout Session
// -------------------
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { priceId, userId } = req.body;

    if (!priceId || !userId) {
      return res.status(400).json({ error: "Missing priceId or userId" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/payment-success.html`,
      cancel_url: `${process.env.FRONTEND_URL}/payment.html`,
      metadata: { userId },
    });

    return res.json({ url: session.url });
  } catch (error) {
    console.error("❌ Error creating checkout session:", error);
    return res.status(500).json({ error: error.message });
  }
});

// -------------------
// Stripe Webhook
// -------------------
app.post("/webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook signature verification failed.", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle Stripe events
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata.userId;

    console.log(`✅ Checkout completed for user ${userId}`);

    try {
      // Update Firestore user doc
      const userRef = db.collection("users").doc(userId);
      await userRef.set(
        {
          planType: "premium",
          subscriptionId: session.subscription,
          stripeCustomerId: session.customer,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // Allocate credits
      await creditSystem.allocateCredits(userId, "premium");

      console.log(`🎉 Premium plan + credits added to user ${userId}`);
    } catch (err) {
      console.error("🔥 Firestore update failed:", err.message);
    }
  }

  if (event.type === "invoice.payment_failed") {
    const session = event.data.object;
    console.warn(`⚠️ Payment failed for subscription ${session.subscription}`);
    // TODO: downgrade user if needed
  }

  res.json({ received: true });
});

// ✅ Export Cloud Function
exports.api = functions.https.onRequest(app);
