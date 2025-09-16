// Firebase Dashboard Logic
document.addEventListener('DOMContentLoaded', () => {
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = 'auth.html';
      return;
    }
    await loadDashboard(user);
  });

  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    document.getElementById('dashboard-sidebar').classList.toggle('open');
  });

  document.getElementById('user-profile-card').addEventListener('click', () => {
    document.getElementById('user-profile-modal').style.display = 'flex';
  });

  document.getElementById('close-profile-modal').addEventListener('click', () => {
    document.getElementById('user-profile-modal').style.display = 'none';
  });

  document.getElementById('notification-btn').addEventListener('click', () => {
    const dropdown = document.getElementById('notification-dropdown');
    dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
  });
});

// Load Dashboard Data
async function loadDashboard(user) {
  const userRef = firebase.firestore().collection('users').doc(user.uid);
  const userDoc = await userRef.get();
  if (!userDoc.exists) return;

  const data = userDoc.data();
  updateUserInfo(user, data);
  updateStats(data);
  loadRecentActivity(user.uid);
  loadNotifications(user.uid);
}

// Update User Info
function updateUserInfo(user, data) {
  document.getElementById('user-name').textContent = user.displayName || user.email;
  document.getElementById('welcome-message').textContent = `Welcome back, ${user.displayName || 'friend'} 👋`;
  document.getElementById('user-plan').textContent = `Plan: ${data.planType || 'freemium'}`;
  document.getElementById('user-credits').textContent = `${data.credits || 0} Credits`;
  document.getElementById('modal-user-name').textContent = user.displayName || 'User';
  document.getElementById('modal-user-email').textContent = user.email;
  document.getElementById('modal-user-plan').textContent = data.planType || 'freemium';
}

// Update Stats
function updateStats(data) {
  document.getElementById('stat-words').textContent = data.stats?.wordsGenerated || 0;
  document.getElementById('stat-projects').textContent = data.stats?.projectsCompleted || 0;
  document.getElementById('stat-credits').textContent = `${data.credits || 0}/${getPlanCredits(data.planType)}`;
  document.getElementById('stat-time').textContent = `${data.stats?.timeSaved || 0}h`;

  document.getElementById('tool-writer').textContent = `${data.stats?.todayWords || 0} words today`;
  document.getElementById('tool-researcher').textContent = `${data.stats?.sourcesFound || 0} sources found`;
  document.getElementById('tool-detector').textContent = `${data.stats?.originalityScore || 0}% original`;
  document.getElementById('tool-prompt').textContent = `${data.stats?.promptsOptimized || 0} prompts optimized`;
}

function getPlanCredits(plan) {
  const plans = { freemium: 200, premium: 2000, custom: 3300 };
  return plans[plan] || 200;
}

// Load Recent Activity
async function loadRecentActivity(uid) {
  const snapshot = await firebase.firestore()
    .collection('activities')
    .where('userId', '==', uid)
    .orderBy('timestamp', 'desc')
    .limit(5)
    .get();

  const container = document.getElementById('activity-list');
  if (snapshot.empty) {
    container.innerHTML = `<p>No recent activity</p>`;
    return;
  }
  container.innerHTML = snapshot.docs.map(doc => {
    const a = doc.data();
    return `<div class="activity-item"><strong>${a.title}</strong><p>${a.description}</p><small>${formatTimeAgo(a.timestamp?.toDate())}</small></div>`;
  }).join('');
}

// Load Notifications
async function loadNotifications(uid) {
  const snapshot = await firebase.firestore()
    .collection('notifications')
    .where('userId', '==', uid)
    .orderBy('timestamp', 'desc')
    .limit(5)
    .get();

  const dropdown = document.getElementById('notification-dropdown');
  if (snapshot.empty) {
    dropdown.innerHTML = `<div class="notification-item">No notifications</div>`;
    document.getElementById('notification-badge').style.display = 'none';
    return;
  }

  document.getElementById('notification-badge').style.display = 'block';
  dropdown.innerHTML = snapshot.docs.map(doc => {
    const n = doc.data();
    return `<div class="notification-item"><strong>${n.title}</strong><br><small>${n.message}</small><br><span>${formatTimeAgo(n.timestamp?.toDate())}</span></div>`;
  }).join('');
}

// Utils
function formatTimeAgo(time) {
  if (!time) return '';
  const diff = Date.now() - time.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
