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
app.use("/api/auth", require("./routes/googleAuth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/payments/webhook", express.raw({ type: 'application/json' }), require("./routes/payments"));
app.use("/api/payments", express.json(), require("./routes/payments"));
app.use("/api/credits", require("./routes/credits"));
app.use("/api/citations", require("./routes/citations"));
app.use("/api/zotero", require("./routes/zotero"));
app.use("/api/history", require("./routes/history"));

// Tools
app.use("/api/research", require("./routes/research"));
app.use("/api/detector", require("./routes/detector"));
app.use("/api/prompts", require("./routes/prompts"));
app.use("/api/writer", require("./routes/writer"));

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
