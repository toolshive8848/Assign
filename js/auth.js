// Firebase initialization comes from firebase-web.js
const auth = firebase.auth();
const db = firebase.firestore();

const authMessage = document.getElementById('auth-message');

// Create Firestore user doc if not exists
async function createUserDoc(user) {
  const userRef = db.collection('users').doc(user.uid);
  const doc = await userRef.get();
  if (!doc.exists) {
    await userRef.set({
      email: user.email,
      displayName: user.displayName || "",
      planType: "freemium",
      credits: 200,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      creditResetDate: firebase.firestore.Timestamp.fromDate(new Date())
    });
  }
}

// Email login
document.getElementById('login-btn').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    const userCredential = await auth.signInWithEmailAndPassword(email, password);
    await createUserDoc(userCredential.user);
    window.location.href = "dashboard.html";
  } catch (error) {
    authMessage.textContent = error.message;
  }
});

// Signup
document.getElementById('signup-btn').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    const userCredential = await auth.createUserWithEmailAndPassword(email, password);
    await createUserDoc(userCredential.user);
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
    window.location.href = "dashboard.html";
  } catch (error) {
    authMessage.textContent = error.message;
  }
});
