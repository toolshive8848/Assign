// authCheck.js
// Ensures only authenticated users can access protected pages (like dashboard)

import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { app } from "./firebase-web.js"; // 🔹 Make sure this points to your Firebase config file

const auth = getAuth(app);
const db = getFirestore(app);

// Run auth check once DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      // Not logged in → send to login page
      window.location.href = "auth.html";
    } else {
      try {
        // Check if user profile exists in Firestore
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          // Create new user doc if missing
          await setDoc(userRef, {
            email: user.email,
            name: user.displayName || "User",
            credits: { used: 0, total: 200 }, // default free credits
            stats: {
              wordsGenerated: 0,
              projectsCompleted: 0,
              timeSaved: 0,
              todayWords: 0,
              sourcesFound: 0,
              originalityScore: 0,
              promptsOptimized: 0
            },
            createdAt: new Date(),
          });
        }

        console.log("✅ Authenticated:", user.email);
      } catch (err) {
        console.error("Error verifying user in Firestore:", err);
      }
    }
  });
});
