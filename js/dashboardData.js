import { auth, db } from "../config/firebase-web.js";
import {
  doc,
  getDoc,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

class DashboardData {
  constructor() {
    this.user = null;
  }

   init() {
  auth.onAuthStateChanged((user) => {
    if (!user) {
      window.location.href = "auth.html"; // or show login UI
      return;
    }

    this.user = user;
    console.log("✅ Dashboard logged in:", user.email);

    // 🔹 Real-time Firestore listener for user plan/credits
    const userRef = doc(db, "users", user.uid);
    onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();

        // Update credits
        const creditsEl = document.getElementById("user-credits");
        if (creditsEl) {
          const maxCredits =
            data.planType === "pro"
              ? 2000
              : data.planType === "custom"
              ? 3300
              : 200;
          creditsEl.textContent = `${data.credits || 0}/${maxCredits} Credits`;
        }

        // Update plan
        const planEl = document.getElementById("user-plan");
        if (planEl) {
          planEl.textContent =
            data.planType === "pro"
              ? "Pro Plan"
              : data.planType === "custom"
              ? "Custom Plan"
              : "Free Plan";
        }
      } else {
        console.warn("⚠️ No user doc found for:", user.uid);
      }
    });

    // Keep your existing dashboard loading
    this.loadDashboard();
  });
}

  async loadDashboard() {
    if (!this.user) return;

    const credits = await this.getCredits();
    const activities = await this.getActivities();
    const history = await this.getRecentHistory();

    this.renderCredits(credits);
    this.renderActivities(activities);
    this.renderHistoryStats(history.stats);
    this.renderRecentHistory(history.history);
  }

  async getCredits() {
    const userRef = doc(db, "users", this.user.uid);
    const snapshot = await getDoc(userRef);
    return snapshot.exists() ? snapshot.data().credits || 0 : 0;
  }

  async getActivities() {
    const q = query(
      collection(db, "activities"),
      orderBy("createdAt", "desc"),
      limit(5)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async getRecentHistory() {
    try {
      const token = await this.user.getIdToken();
      const res = await fetch("/api/history?limit=5", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("Failed to fetch history");

      const data = await res.json();
      return data;
    } catch (err) {
      console.error("Recent history error:", err);
      return {
        stats: {
          total: 0,
          completed: 0,
          inProgress: 0,
          failed: 0,
          totalWords: 0,
        },
        history: [],
      };
    }
  }

  renderCredits(credits) {
    const el = document.getElementById("creditsValue");
    if (el) el.textContent = credits;
  }

  renderActivities(activities) {
    const list = document.getElementById("activityList");
    if (!list) return;

    list.innerHTML = activities
      .map(
        (a) =>
          `<li>${a.action} - ${new Date(
            a.createdAt.seconds * 1000
          ).toLocaleString()}</li>`
      )
      .join("");
  }

  renderHistoryStats(stats) {
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    setText("totalProjects", stats.total);
    setText("completedProjects", stats.completed);
    setText("inProgressProjects", stats.inProgress);
    setText("failedProjects", stats.failed);
    setText("totalWords", stats.totalWords);
  }

  renderRecentHistory(history) {
    const table = document.getElementById("recentHistoryTable");
    if (!table) return;

    if (!history || history.length === 0) {
      table.innerHTML = `<tr><td colspan="4">No history yet</td></tr>`;
      return;
    }

    table.innerHTML = history
      .map(
        (h) => `
      <tr>
        <td>${h.title || "Untitled"}</td>
        <td>${h.type}</td>
        <td>${h.wordCount || 0}</td>
        <td>${new Date(h.createdAt).toLocaleDateString()}</td>
      </tr>`
      )
      .join("");
  }
}

const dashboard = new DashboardData();
dashboard.init();
