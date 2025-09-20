/**
 * User Session Manager with Firestore real-time sync
 * Keeps user profile, plan, and credits dynamic across pages
 */

import { auth, db } from "../config/firebase-web.js";
import {
  doc,
  onSnapshot,
  getDoc
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

class UserSessionManager {
  constructor() {
    this.defaultUser = {
      name: null,
      email: null,
      plan: "free", // "free", "pro", "custom"
      credits: 0,
      maxCredits: 200
    };
    this.currentUser = null;
    this.unsubscribe = null;
  }

  /**
   * Start listening to auth + Firestore changes
   */
  init() {
    auth.onAuthStateChanged((user) => {
      if (!user) {
        console.log("❌ No user logged in");
        this.showNotLoggedInState();
        return;
      }

      this.currentUser = { ...this.defaultUser, uid: user.uid, email: user.email };
      console.log("✅ Logged in:", user.email);

      // Start Firestore real-time listener for this user
      this.listenToUserDoc(user.uid);
    });
  }

  /**
   * Real-time Firestore listener
   */
  listenToUserDoc(uid) {
    if (this.unsubscribe) this.unsubscribe(); // cleanup old listener
    const userRef = doc(db, "users", uid);

    this.unsubscribe = onSnapshot(userRef, (snap) => {
      if (!snap.exists()) {
        console.warn("⚠️ No Firestore profile found for user");
        return;
      }

      const data = snap.data();

      // Map plan → maxCredits
      let maxCredits = 200;
      if (data.planType === "pro") maxCredits = 2000;
      else if (data.planType === "custom") maxCredits = 3300;

      this.currentUser = {
        uid,
        name: data.name || "User",
        email: data.email || this.currentUser?.email,
        plan: data.planType || "free",
        credits: data.credits || 0,
        maxCredits
      };

      console.log("🔄 Updated user from Firestore:", this.currentUser);
      this.updateAllDisplays();
    });
  }

  /**
   * Update all UI displays
   */
  updateAllDisplays() {
    if (!this.currentUser) {
      this.showNotLoggedInState();
      return;
    }

    // Sidebar
    const userNameEl = document.getElementById("user-name");
    const userPlanEl = document.getElementById("user-plan");
    const userCreditsEl = document.getElementById("user-credits");

    if (userNameEl) userNameEl.textContent = this.currentUser.name;
    if (userPlanEl) userPlanEl.textContent = this.getPlanDisplayText();
    if (userCreditsEl)
      userCreditsEl.textContent = this.getCreditsDisplayText();

    // Modal
    const modalUserNameEl = document.getElementById("modal-user-name");
    const modalUserEmailEl = document.getElementById("modal-user-email");
    const modalUserPlanEl = document.getElementById("modal-user-plan");
    const modalUserCreditsEl = document.getElementById("modal-user-credits");

    if (modalUserNameEl) modalUserNameEl.textContent = this.currentUser.name;
    if (modalUserEmailEl) modalUserEmailEl.textContent = this.currentUser.email;
    if (modalUserPlanEl) modalUserPlanEl.textContent = this.getPlanDisplayText();
    if (modalUserCreditsEl)
      modalUserCreditsEl.textContent = this.getCreditsDisplayText();
  }

  /**
   * Plan → Display Text
   */
  getPlanDisplayText() {
    switch (this.currentUser.plan) {
      case "free":
        return "Free Plan";
      case "pro":
        return "Pro Plan";
      case "custom":
        return "Custom Plan";
      default:
        return "Free Plan";
    }
  }

  /**
   * Credits → Display Text
   */
  getCreditsDisplayText() {
    return `${this.currentUser.credits}/${this.currentUser.maxCredits} Credits`;
  }

  /**
   * Show not logged in state
   */
  showNotLoggedInState() {
    const userNameEl = document.getElementById("user-name");
    const userPlanEl = document.getElementById("user-plan");
    const userCreditsEl = document.getElementById("user-credits");

    if (userNameEl) userNameEl.textContent = "Please Login";
    if (userPlanEl) userPlanEl.textContent = "Not Logged In";
    if (userCreditsEl) userCreditsEl.textContent = "Login Required";
  }

  /**
   * Logout
   */
  async logout() {
    await auth.signOut();
    this.currentUser = null;
    if (this.unsubscribe) this.unsubscribe();
    this.showNotLoggedInState();
    window.location.href = "auth.html";
  }
}

// Create global instance
window.userSession = new UserSessionManager();
window.userSession.init();
