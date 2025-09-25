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

  if (user.planType !== "freemium") return { skipped: true, reason: "Not a freemium user" };

  const signupDate = user.createdAt?.toDate ? user.createdAt.toDate() : new Date(user.createdAt);
  const now = new Date();

  const monthsSinceSignup =
    (now.getFullYear() - signupDate.getFullYear()) * 12 +
    (now.getMonth() - signupDate.getMonth());

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
 * Allocate credits for PRO plan (after payment)
 */
async function allocateProCredits(userId) {
  const userRef = db.collection("users").doc(userId);
  const userDoc = await userRef.get();
  if (!userDoc.exists) throw new Error("User not found");

  await userRef.update({
    credits: admin.firestore.FieldValue.increment(CREDIT_CONFIG.PRO.monthlyCredits),
    lastCreditAllocation: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true, credits: CREDIT_CONFIG.PRO.monthlyCredits };
}

/**
 * Allocate credits for CUSTOM plan (after payment)
 * @param {string} userId
 * @param {number} amountPaid - in USD
 */
async function allocateCustomCredits(userId, amountPaid) {
  if (amountPaid < CREDIT_CONFIG.CUSTOM.minAmount) {
    throw new Error(`Minimum payment is $${CREDIT_CONFIG.CUSTOM.minAmount}`);
  }

  const creditsToAdd = amountPaid * CREDIT_CONFIG.CUSTOM.creditsPerDollar;

  const userRef = db.collection("users").doc(userId);
  const userDoc = await userRef.get();
  if (!userDoc.exists) throw new Error("User not found");

  await userRef.update({
    credits: admin.firestore.FieldValue.increment(creditsToAdd),
    lastCreditAllocation: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true, credits: creditsToAdd };
}

module.exports = {
  refreshFreemiumCredits,
  allocateProCredits,
  allocateCustomCredits
};
