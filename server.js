// server.js
require("dotenv").config();
const express = require("express");
const morgan = require("morgan");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const admin = require("firebase-admin");
const Stripe = require("stripe");

const security = require("./middleware/security");
const { globalErrorHandler, notFoundHandler } = require("./middleware/errorHandler");

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

// Init Express
const app = express();

// Middleware
app.use(morgan("dev"));
app.use(cors({ origin: true }));
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Apply security middlewares
app.use("/api/", security.apiLimiter);

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

// -------------------
// 🔹 API ROUTES
// -------------------
app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/assignments", require("./routes/assignments"));
app.use("/api/payments", require("./routes/payments")); // legacy payments if needed
app.use("/api/research", require("./routes/research"));
app.use("/api/detector", require("./routes/detector"));
app.use("/api/prompts", require("./routes/prompts"));
app.use("/api/writer", require("./routes/writer"));
app.use("/api/history", require("./routes/history"));

// -------------------
// 🔹 STRIPE ROUTES
// -------------------

// Create Checkout Session
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
      line_items: [{ price: priceMap[plan], quantity: 1 }],
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

// Stripe Webhook
app.post("/api/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle subscription success
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

// -------------------
// 🔹 ERROR HANDLING
// -------------------
app.use(notFoundHandler);
app.use(globalErrorHandler);

// -------------------
// 🔹 START SERVER
// -------------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports = app;
