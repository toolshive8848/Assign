// Firebase initialization comes from firebase-web.js
const auth = firebase.auth();

const authMessage = document.getElementById("auth-message");

// Call backend to initialize user (credits, plan, etc.)
async function initUser(user) {
  try {
    await fetch("/api/users/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || ""
      })
    });
  } catch (err) {
    console.error("Failed to init user:", err);
  }
}

// Login with email/password
document.getElementById("login-btn").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    const userCredential = await auth.signInWithEmailAndPassword(email, password);
    await initUser(userCredential.user);
    window.location.href = "dashboard.html";
  } catch (error) {
    authMessage.textContent = error.message;
  }
});

// Signup with email/password
document.getElementById("signup-btn").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    const userCredential = await auth.createUserWithEmailAndPassword(email, password);
    await initUser(userCredential.user);
    window.location.href = "dashboard.html";
  } catch (error) {
    authMessage.textContent = error.message;
  }
});

// Google login
document.getElementById("google-login").addEventListener("click", async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    const result = await auth.signInWithPopup(provider);
    await initUser(result.user);
    window.location.href = "dashboard.html";
  } catch (error) {
    authMessage.textContent = error.message;
  }
});
