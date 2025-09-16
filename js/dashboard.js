// Dashboard Logic
document.addEventListener("DOMContentLoaded", () => {
  const auth = firebase.auth();
  const db = firebase.firestore();

  const userNameEl = document.getElementById("user-name");
  const userPlanEl = document.getElementById("user-plan");
  const userCreditsEl = document.getElementById("user-credits");
  const welcomeEl = document.getElementById("welcome-message");

  const wordsEl = document.getElementById("stat-words");
  const projectsEl = document.getElementById("stat-projects");
  const creditsEl = document.getElementById("stat-credits");
  const timeEl = document.getElementById("stat-time");

  const toolWriterEl = document.getElementById("tool-writer");
  const toolResearchEl = document.getElementById("tool-research");
  const toolDetectorEl = document.getElementById("tool-detector");
  const toolPromptEl = document.getElementById("tool-prompt");

  const activitySection = document.getElementById("activity-section");
  const notificationBtn = document.getElementById("notification-btn");
  const notificationBadge = document.getElementById("notification-badge");
  const notificationDropdown = document.getElementById("notification-dropdown");

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = "auth.html";
      return;
    }

    // Load user data
    const userDoc = await db.collection("users").doc(user.uid).get();
    const data = userDoc.data();

    userNameEl.textContent = data.displayName || user.email;
    userPlanEl.textContent = data.planType || "Free Plan";
    userCreditsEl.textContent = `${data.credits || 0}/${
      data.totalCredits || 200
    } Credits`;
    welcomeEl.textContent = `Welcome back, ${
      data.displayName || user.email
    }! 👋`;

    // Stats
    wordsEl.textContent = data.stats?.wordsGenerated || 0;
    projectsEl.textContent = data.stats?.projectsCompleted || 0;
    creditsEl.textContent = `${data.creditsUsed || 0}/${
      data.totalCredits || 200
    }`;
    timeEl.textContent = `${data.stats?.timeSaved || 0}h`;

    toolWriterEl.textContent = `${data.stats?.todayWords || 0} words today`;
    toolResearchEl.textContent = `${data.stats?.sourcesFound || 0} sources found`;
    toolDetectorEl.textContent = `${data.stats?.originalityScore || 0}% original`;
    toolPromptEl.textContent = `${data.stats?.promptsOptimized || 0} prompts optimized`;

    // Load activity
    const activities = await db
      .collection("activities")
      .where("userId", "==", user.uid)
      .orderBy("timestamp", "desc")
      .limit(5)
      .get();

    if (activities.empty) {
      activitySection.innerHTML =
        "<p>No recent activity. Start using tools to see activity here.</p>";
    } else {
      activitySection.innerHTML = activities.docs
        .map((doc) => {
          const a = doc.data();
          return `<div class="activity-item"><strong>${a.title}</strong><p>${a.description}</p></div>`;
        })
        .join("");
    }

    // Notifications listener
    db.collection("notifications")
      .where("userId", "==", user.uid)
      .orderBy("timestamp", "desc")
      .limit(10)
      .onSnapshot((snapshot) => {
        if (!snapshot.empty) {
          notificationBadge.style.display = "block";
          notificationDropdown.innerHTML =
            "<h4>Notifications</h4>" +
            snapshot.docs
              .map((doc) => {
                const n = doc.data();
                return `<div class="notification-item"><strong>${n.title}</strong><p>${n.message}</p></div>`;
              })
              .join("");
        }
      });
  });

  // Toggle notifications
  notificationBtn.addEventListener("click", () => {
    notificationDropdown.style.display =
      notificationDropdown.style.display === "block" ? "none" : "block";
    notificationBadge.style.display = "none";
  });
});
