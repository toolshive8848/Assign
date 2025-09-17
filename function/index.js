const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const admin = require("firebase-admin");

// Initialize Firebase Admin (only once)
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Stripe init
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const app = express();
app.use(cors({ origin: true }));

// ✅ 1. Create Checkout Session
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { plan, userId } = req.body;

    if (!plan || !userId) {
      return res.status(400).json({ error: "Missing plan or userId" });
    }

    // Map plans to Stripe prices
    const priceMap = {
      pro: process.env.STRIPE_PRICE_PRO,
      custom: process.env.STRIPE_PRICE_CUSTOM,
    };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [
        {
          price: priceMap[plan],
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/payment-success.html`,
      cancel_url: `${process.env.FRONTEND_URL}/payment-cancel.html`,
      metadata: { userId, plan },
    });

    res.json({ id: session.id });
  } catch (err) {
    console.error("Error creating checkout session:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// ✅ 2. Stripe Webhook
app.post("/api/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle events
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata.userId;
    const plan = session.metadata.plan;

    let credits = 200;
    if (plan === "pro") credits = 2000;
    if (plan === "custom") credits = 3300;

    db.collection("users").doc(userId).set(
      {
        planType: plan,
        credits,
        subscriptionStatus: "active",
        subscriptionId: session.subscription,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log(`✅ User ${userId} upgraded to ${plan}`);
  }

  if (event.type === "invoice.payment_failed") {
    console.log("❌ Payment failed:", event.data.object);
  }

  res.json({ received: true });
});

// ✅ Export to Firebase
exports.api = functions.https.onRequest(app);
