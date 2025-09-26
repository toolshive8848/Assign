const functions = require("firebase-functions");
const admin = require("firebase-admin");
const creditAllocationService = require("../services/creditAllocationService");

admin.initializeApp();
const db = admin.firestore();

/**
 * Cloud Function: Refresh Freemium User Credits
 * Runs daily via Cloud Scheduler
 */
exports.refreshFreemiumCredits = functions.pubsub
    .schedule("0 2 * * *") // runs every day at 2 AM UTC
    .timeZone("UTC")
    .onRun(async () => {
        console.log("🔄 Running freemium credits refresh...");

        const today = new Date();
        const currentDay = today.getDate();

        try {
            // Fetch all freemium users
            const usersSnapshot = await db.collection("users")
                .where("planType", "==", "freemium")
                .get();

            if (usersSnapshot.empty) {
                console.log("No freemium users found.");
                return null;
            }

            for (const userDoc of usersSnapshot.docs) {
                const userData = userDoc.data();
                const userId = userDoc.id;

                if (!userData.createdAt) continue;

                const signupDate = userData.createdAt.toDate();
                const signupDay = signupDate.getDate();

                // ✅ Refresh credits only if today matches signup day
                if (currentDay === signupDay) {
                    console.log(`Refreshing credits for user ${userId}`);
                    await creditAllocationService.refreshFreemiumCredits(userId);
                }
            }

            console.log("✅ Freemium credits refresh completed");
            return null;
        } catch (error) {
            console.error("❌ Error refreshing freemium credits:", error);
            throw new Error(error.message);
        }
    });
