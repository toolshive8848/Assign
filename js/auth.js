async function initCredits(user) {
  try {
    const idToken = await user.getIdToken();
    await fetch("/api/credits/init", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      }
    });
  } catch (err) {
    console.error("Failed to initialize credits:", err);
  }
}

// Signup
document.getElementById('signup-btn').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    const userCredential = await auth.createUserWithEmailAndPassword(email, password);
    await createUserDoc(userCredential.user);  // minimal fields only
    await initCredits(userCredential.user);    // backend allocates credits
    window.location.href = "dashboard.html";
  } catch (error) {
    authMessage.textContent = error.message;
  }
});

// Login
document.getElementById('login-btn').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    const userCredential = await auth.signInWithEmailAndPassword(email, password);
    await createUserDoc(userCredential.user);  // only if not exists
    await initCredits(userCredential.user);    // backend checks + refreshes
    window.location.href = "dashboard.html";
  } catch (error) {
    authMessage.textContent = error.message;
  }
});

// Google login
document.getElementById('google-login').addEventListener('click', async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    const result = await auth.signInWithPopup(provider);
    await createUserDoc(result.user);
    await initCredits(result.user);
    window.location.href = "dashboard.html";
  } catch (error) {
    authMessage.textContent = error.message;
  }
});
