const { db, admin } = require("../config/firebase");

// Credit configuration
const CREDIT_CONFIG = {
  FREEMIUM: { monthlyCredits: 200 },
  PRO: { monthlyCredits: 2000, price: 9.99 }, // 2000 credits per $9.99
  CUSTOM: { minAmount: 15, creditsPerDollar: 220 }
};

/**
 * Refresh freemium credits (dynamic from signup date)
 */
async function refreshFreemiumCredits(userId) {
  const userRef = db.collection("users").doc(userId);
  const userDoc = await userRef.get();

  if (!userDoc.exists) throw new Error("User not found");
  const user = userDoc.data();

  const now = new Date();

  // 🔹 1. Auto-downgrade cancelled paid users → Freemium
  if (
    (user.planType === "pro" || user.planType === "custom") &&
    user.subscriptionStatus === "cancelled"
  ) {
    await userRef.update({
      planType: "freemium",
      credits: 200,
      lastCreditRefresh: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      downgraded: true,
      userId,
      newPlan: "freemium",
      newCredits: 200,
      refreshedAt: now,
    };
  }

  // 🔹 2. Skip non-freemium users
  if (user.planType !== "freemium") {
    return { skipped: true, reason: "Not a freemium user" };
  }

  // 🔹 3. Normal freemium monthly refresh
  const signupDate = user.createdAt?.toDate
    ? user.createdAt.toDate()
    : new Date(user.createdAt);

  const monthsSinceSignup =
    (now.getFullYear() - signupDate.getFullYear()) * 12 +
    (now.getMonth() - signupDate.getMonth());

  // Prevent duplicate refresh in the same month
  const lastRefreshedMonth = user.lastCreditRefresh
    ? user.lastCreditRefresh.toDate().getMonth()
    : null;
  const lastRefreshedYear = user.lastCreditRefresh
    ? user.lastCreditRefresh.toDate().getFullYear()
    : null;

  if (
    lastRefreshedMonth === now.getMonth() &&
    lastRefreshedYear === now.getFullYear()
  ) {
    return { skipped: true, reason: "Already refreshed this month" };
  }

  // ✅ Reset credits to 200 for freemium users
  await userRef.update({
    credits: 200,
    lastCreditRefresh: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    userId,
    newCredits: 200,
    monthsSinceSignup,
    refreshedAt: now,
  };
}

  // Already refreshed for this month?
  if (user.lastCreditRefresh && user.lastCreditRefresh.toDate) {
    const lastRefresh = user.lastCreditRefresh.toDate();
    if (lastRefresh.getFullYear() === now.getFullYear() && lastRefresh.getMonth() === now.getMonth()) {
      return { skipped: true, reason: "Already refreshed this month" };
    }
  }

  await userRef.update({
    credits: CREDIT_CONFIG.FREEMIUM.monthlyCredits,
    lastCreditRefresh: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true, credits: CREDIT_CONFIG.FREEMIUM.monthlyCredits };
}

/**
 * Allocate credits for PRO plan
 * @param {string} userId
 * @param {Object} options
 * @param {boolean} options.isUpgrade - true if upgrading from freemium, false if top-up
 */
async function allocateProCredits(userId, { isUpgrade = false } = {}) {
  const userRef = db.collection("users").doc(userId);
  const userDoc = await userRef.get();
  if (!userDoc.exists) throw new Error("User not found");

  if (isUpgrade) {
    // Reset credits on upgrade
    await userRef.update({
      credits: CREDIT_CONFIG.PRO.monthlyCredits,
      planType: "pro",
      lastCreditAllocation: admin.firestore.FieldValue.serverTimestamp()
    });
    return { success: true, credits: CREDIT_CONFIG.PRO.monthlyCredits, mode: "upgrade" };
  } else {
    // Top-up credits if already pro
    await userRef.update({
      credits: admin.firestore.FieldValue.increment(CREDIT_CONFIG.PRO.monthlyCredits),
      lastCreditAllocation: admin.firestore.FieldValue.serverTimestamp()
    });
    return { success: true, credits: CREDIT_CONFIG.PRO.monthlyCredits, mode: "topup" };
  }
}

/**
 * Allocate credits for CUSTOM plan
 * @param {string} userId
 * @param {number} amountPaid - in USD
 * @param {Object} options
 * @param {boolean} options.isUpgrade - true if upgrading from freemium, false if top-up
 */
async function allocateCustomCredits(userId, amountPaid, { isUpgrade = false } = {}) {
  if (amountPaid < CREDIT_CONFIG.CUSTOM.minAmount) {
    throw new Error(`Minimum payment is $${CREDIT_CONFIG.CUSTOM.minAmount}`);
  }

  const creditsToAdd = amountPaid * CREDIT_CONFIG.CUSTOM.creditsPerDollar;

  const userRef = db.collection("users").doc(userId);
  const userDoc = await userRef.get();
  if (!userDoc.exists) throw new Error("User not found");

  if (isUpgrade) {
    // Reset credits on upgrade
    await userRef.update({
      credits: creditsToAdd,
      planType: "custom",
      lastCreditAllocation: admin.firestore.FieldValue.serverTimestamp()
    });
    return { success: true, credits: creditsToAdd, mode: "upgrade" };
  } else {
    // Top-up credits
    await userRef.update({
      credits: admin.firestore.FieldValue.increment(creditsToAdd),
      lastCreditAllocation: admin.firestore.FieldValue.serverTimestamp()
    });
    return { success: true, credits: creditsToAdd, mode: "topup" };
  }
}

module.exports = {
  refreshFreemiumCredits,
  allocateProCredits,
  allocateCustomCredits
};
