// js/dashboardData.js
import { auth, db } from "../config/firebase-web.js";
import {
  doc, onSnapshot, collection, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

class DashboardData {
  constructor() {
    this.user = null;
  }

  init() {
    auth.onAuthStateChanged((user) => {
      if (!user) {
        window.location.href = "auth.html";
        return;
      }
      this.user = user;
      this.listenToUser();
      this.listenToNotifications();
    });
  }

  listenToUser() {
    const userRef = doc(db, "users", this.user.uid);
    onSnapshot(userRef, (docSnap) => {
      if (!docSnap.exists()) return;
      const data = docSnap.data();
      this.updateDashboard(data);
    });
  }

  listenToNotifications() {
    const notifRef = collection(db, "notifications", this.user.uid, "items");
    const q = query(notifRef, orderBy("timestamp", "desc"), limit(10));

    onSnapshot(q, (snapshot) => {
      const dropdown = document.getElementById("notification-dropdown");
      if (!dropdown) return;
      dropdown.style.display = "block";

      if (snapshot.empty) {
        dropdown.innerHTML = `<p style="color:#94a3b8">No notifications yet</p>`;
        return;
      }

      dropdown.innerHTML = snapshot.docs.map(doc => {
        const n = doc.data();
        return `
          <div class="notif-item">
            <strong>${n.title}</strong>
            <p>${n.message}</p>
            <span style="font-size:0.8rem;color:#94a3b8">${this.formatTimeAgo(n.timestamp?.toDate?.() || new Date())}</span>
          </div>
        `;
      }).join("");
    });
  }

  updateDashboard(data) {
    this.setText("#user-name", data.displayName || this.user.email);
    this.setText("#user-plan", data.planType || "freemium");
    this.setText("#user-credits", `${data.credits || 0}/${this.getTotalCredits(data.planType)} Credits`);
    this.setText("#welcome-message", `Welcome back, ${(data.displayName || "User").split(" ")[0]}! 👋`);

    // Stats
    const s = data.stats || {};
    this.setText(".stat-card:nth-child(1) .stat-value", this.formatNumber(s.wordsGenerated || 0));
    this.setText(".stat-card:nth-child(2) .stat-value", s.projectsCompleted || 0);
    this.setText(".stat-card:nth-child(3) .stat-value", `${data.credits || 0}/${this.getTotalCredits(data.planType)}`);
    this.setText(".stat-card:nth-child(4) .stat-value", this.formatTime(s.timeSaved || 0));

    // Tools
    this.setText(".tool-card:nth-child(1) .tool-stat", `${s.todayWords || 0} words today`);
    this.setText(".tool-card:nth-child(2) .tool-stat", `${s.sourcesFound || 0} sources found`);
    this.setText(".tool-card:nth-child(3) .tool-stat", `${s.originalityScore || 0}% original`);
    this.setText(".tool-card:nth-child(4) .tool-stat", `${s.promptsOptimized || 0} prompts optimized`);
  }

  // Helpers
  setText(selector, text) { const el = document.querySelector(selector); if (el) el.textContent = text; }
  getTotalCredits(plan) { return plan === "premium" ? 2000 : plan === "custom" ? 3300 : 200; }
  formatNumber(num) { return num >= 1000 ? (num/1000).toFixed(1)+"k" : num; }
  formatTime(h) { return h >= 24 ? `${Math.floor(h/24)}d` : `${h}h`; }
  formatTimeAgo(t) {
    const diff = Date.now() - t.getTime();
    if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
    return `${Math.floor(diff/86400000)}d ago`;
  }
}

const dashboardData = new DashboardData();
dashboardData.init();
