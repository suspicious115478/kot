import {
  auth, db, rtdb,
  redirectIfLoggedIn, showToast
} from "./firebase.js";

import { doc, setDoc } from
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  ref, set, get
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";


// ── Redirect if already logged in ─────────────────────────────
await redirectIfLoggedIn();

// ── Password Validator ─────────────────────────────────────────
function validatePassword(password) {
  const checks = {
    length:  password.length >= 8,
    upper:   /[A-Z]/.test(password),
    number:  /[0-9]/.test(password),
    special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  };
  const messages = [];
  if (!checks.length)  messages.push("at least 8 characters");
  if (!checks.upper)   messages.push("1 uppercase letter");
  if (!checks.number)  messages.push("1 number");
  if (!checks.special) messages.push("1 special character");
  return messages; // empty array = valid
}

// ── Tab switching ──────────────────────────────────────────────
document.querySelectorAll(".auth-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    const panel = btn.dataset.panel;
    document.querySelectorAll(".auth-tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".auth-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("panel-" + panel).classList.add("active");
  });
});

// ── Forgot password flow ───────────────────────────────────────
document.getElementById("showForgot").addEventListener("click", () => {
  document.querySelectorAll(".auth-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("panel-forgot").classList.add("active");
  // Pre-fill forgot email if login email already entered
  const loginEmail = document.getElementById("loginEmail").value.trim();
  if (loginEmail) document.getElementById("forgotEmail").value = loginEmail;
});

document.getElementById("backToLogin").addEventListener("click", () => {
  document.querySelectorAll(".auth-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".auth-tab").forEach(b => b.classList.remove("active"));
  document.getElementById("panel-login").classList.add("active");
  document.querySelector('[data-panel="login"]').classList.add("active");
  // Reset the success state in case they come back
  document.getElementById("resetSuccess").style.display = "none";
  document.getElementById("resetBtn").style.display = "flex";
});

// ── Send password reset email ──────────────────────────────────
document.getElementById("resetBtn").addEventListener("click", async () => {
  const email = document.getElementById("forgotEmail").value.trim();

  if (!email) return showToast("Please enter your email address", true);

  const btn = document.getElementById("resetBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Sending...';

  try {
    await sendPasswordResetEmail(auth, email);

    // Show success state
    document.getElementById("resetSuccess").style.display = "block";
    btn.style.display = "none";

    showToast("Reset email sent! Check your inbox ✅");

  } catch (e) {
    let msg = "Failed to send reset email";
    if (e.code === "auth/user-not-found")    msg = "No account found with this email";
    if (e.code === "auth/invalid-email")     msg = "Please enter a valid email address";
    if (e.code === "auth/too-many-requests") msg = "Too many requests. Please try again later";

    showToast(msg, true);
    btn.disabled = false;
    btn.innerHTML = `Send Reset Link <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  }
});

// ── LOGIN ──────────────────────────────────────────────────────
document.getElementById("loginBtn").addEventListener("click", async () => {
  const email    = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  if (!email)    return showToast("Please enter your email address", true);
  if (!password) return showToast("Please enter your password", true);

  const btn = document.getElementById("loginBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Signing in...';

  try {
    await signInWithEmailAndPassword(auth, email, password);
    showToast("Signed in successfully ✅");
    window.location.href = "./dashboard.html";

  } catch (e) {
    let msg = "Login failed. Please try again";
    if (e.code === "auth/user-not-found")      msg = "No account found with this email";
    if (e.code === "auth/wrong-password")      msg = "Incorrect password";
    if (e.code === "auth/invalid-email")       msg = "Please enter a valid email address";
    if (e.code === "auth/too-many-requests")   msg = "Too many attempts. Please try again later";
    if (e.code === "auth/invalid-credential")  msg = "Invalid email or password";

    showToast(msg, true);
    btn.disabled = false;
    btn.innerHTML = `Sign In <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
  }
});

// ── SIGNUP ─────────────────────────────────────────────────────
document.getElementById("signupBtn").addEventListener("click", async () => {
  const name     = document.getElementById("signupName").value.trim();
  const email    = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;

  if (!email)            return showToast("Please enter your email address", true);
  if (!password)         return showToast("Please enter a password", true);
  const pwErrors = validatePassword(password);
if (pwErrors.length > 0)
  return showToast("Password needs: " + pwErrors.join(", "), true);

  const btn = document.getElementById("signupBtn");
  btn.disabled = true;
  const safeKey = email.replace(/\./g, '_').replace(/@/g, '__at__');
const snap = await get(ref(rtdb, `customers/${safeKey}`));
if (!snap.exists()) {
  showToast("You are not authorized to sign up", true);
  btn.disabled = false;
  btn.innerHTML = `Create Account <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
  return;
}
  btn.innerHTML = '<span class="spinner"></span> Creating account...';

  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    const uid      = userCred.user.uid;

    // Create restaurant document (restaurantId = uid)
    await setDoc(doc(db, "restaurants", uid), {
      name:      name || email.split("@")[0],
      ownerId:   uid,
      createdAt: Date.now()
    });

    // Realtime DB mapping
    await set(ref(rtdb, "users/" + uid), {
      email:        email,
      restaurantId: uid
    });

    showToast("Account created! Welcome 🎉");
    window.location.href = "./dashboard.html";

  } catch (e) {
    let msg = "Failed to create account";
    if (e.code === "auth/email-already-in-use") msg = "An account with this email already exists";
    if (e.code === "auth/invalid-email")        msg = "Please enter a valid email address";
    if (e.code === "auth/weak-password")        msg = "Password must be at least 6 characters";

    showToast(msg, true);
    btn.disabled = false;
    btn.innerHTML = `Create Account <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
  }
});

// ── Enter key support ──────────────────────────────────────────
document.getElementById("loginPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("loginBtn").click();
});
document.getElementById("forgotEmail").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("resetBtn").click();
});
document.getElementById("signupPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("signupBtn").click();
});
// ── Eye toggle ─────────────────────────────────────────────────
function togglePass(inputId, btn) {
  const input = document.getElementById(inputId);
  const isText = input.type === "text";
  input.type = isText ? "password" : "text";
  btn.style.color = isText ? "" : "var(--accent)";
}

document.getElementById("eyeLogin").addEventListener("click", function() {
  togglePass("loginPassword", this);
});
document.getElementById("eyeSignup").addEventListener("click", function() {
  togglePass("signupPassword", this);
});