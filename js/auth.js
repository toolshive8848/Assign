// Switch between Login and Signup tabs
const loginTab = document.getElementById("login-tab");
const signupTab = document.getElementById("signup-tab");
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");

loginTab.addEventListener("click", () => {
  loginTab.classList.add("active");
  signupTab.classList.remove("active");
  loginForm.classList.add("active");
  signupForm.classList.remove("active");
});

signupTab.addEventListener("click", () => {
  signupTab.classList.add("active");
  loginTab.classList.remove("active");
  signupForm.classList.add("active");
  loginForm.classList.remove("active");
});

// Firebase Auth
const auth = firebase.auth();

// Email/Password Login
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;

  try {
    await auth.signInWithEmailAndPassword(email, password);
    window.location.href = "dashboard.html";
  } catch (error) {
    alert(error.message);
  }
});

// Email/Password Signup
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("signup-name").value;
  const email = document.getElementById("signup-email").value;
  const password = document.getElementById("signup-password").value;

  try {
    const userCredential = await auth.createUserWithEmailAndPassword(email, password);
    await userCredential.user.updateProfile({ displayName: name });
    window.location.href = "dashboard.html";
  } catch (error) {
    alert(error.message);
  }
});

// Google Login & Signup
const googleProvider = new firebase.auth.GoogleAuthProvider();
document.getElementById("google-login").addEventListener("click", async () => {
  try {
    await auth.signInWithPopup(googleProvider);
    window.location.href = "dashboard.html";
  } catch (error) {
    alert(error.message);
  }
});
document.getElementById("google-signup").addEventListener("click", async () => {
  try {
    await auth.signInWithPopup(googleProvider);
    window.location.href = "dashboard.html";
  } catch (error) {
    alert(error.message);
  }
});

// Forgot Password
document.getElementById("forgot-password").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = prompt("Enter your email for password reset:");
  if (email) {
    try {
      await auth.sendPasswordResetEmail(email);
      alert("Password reset email sent!");
    } catch (error) {
      alert(error.message);
    }
  }
});
