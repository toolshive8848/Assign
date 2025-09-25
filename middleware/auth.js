const { unifiedAuth, firebaseAuth, adminAuth } = require('./unifiedAuth');
const { db, admin } = require('../config/firebase');

// Default middleware
const authenticateToken = async (req, res, next) => {
  try {
    // Use unified auth (handles Firebase/Admin/etc.)
    const decoded = await unifiedAuth(req, res);

    if (!decoded || !decoded.uid) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Fetch Firestore user doc
    const userRef = db.collection("users").doc(decoded.uid);
    const userDoc = await userRef.get();

    let userData = {};
    if (userDoc.exists) {
      userData = userDoc.data();
    } else {
      // fallback if user doc missing
      userData = {
        planType: "freemium",
        credits: 200,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await userRef.set(userData, { merge: true });
    }

    // Attach both Firebase claims and Firestore info to req.user
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
      ...userData,
      firebase: decoded
    };

    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

/**
 * Admin check
 */
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });

    const userRecord = await admin.auth().getUser(req.user.uid);
    if (!userRecord.customClaims || !userRecord.customClaims.admin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    req.user.isAdmin = true;
    next();
  } catch (error) {
    console.error("Admin check error:", error);
    return res.status(500).json({ error: "Authorization check failed" });
  }
};

/**
 * Premium check (for paid users)
 */
const requirePremium = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });

    if (req.user.planType !== "pro" && req.user.planType !== "custom") {
      return res.status(403).json({ error: "Premium subscription required" });
    }

    next();
  } catch (error) {
    console.error("Premium check error:", error);
    return res.status(500).json({ error: "Subscription check failed" });
  }
};

/**
 * Optional Auth (does not fail if missing token)
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return next();

    const token = authHeader.split(" ")[1];
    if (!token) return next();

    const decoded = await admin.auth().verifyIdToken(token);
    const userRef = db.collection("users").doc(decoded.uid);
    const userDoc = await userRef.get();

    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      ...userDoc.data(),
      firebase: decoded
    };

    next();
  } catch (error) {
    console.warn("Optional auth failed:", error.message);
    next();
  }
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requirePremium,
  optionalAuth,
};
