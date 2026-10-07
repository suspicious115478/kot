import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCe5OQs08vztxgBLYSJEwuqc8RnA-1UYFQ",
  authDomain: "self-order-ebd7e.firebaseapp.com",
  projectId: "self-order-ebd7e",
  databaseURL: "https://self-order-ebd7e-default-rtdb.firebaseio.com"
};

export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
export const rtdb = getDatabase(app);

// ── Restaurant ID cache ─────────────────────────────────────────
let _restaurantId   = null;
let _restaurantName = null;

export async function getRestaurantId() {
  if (_restaurantId) return _restaurantId;

  const user = auth.currentUser;
  if (!user) return null;

  // ✅ restaurantId = UID
  _restaurantId = user.uid;
  return _restaurantId;
}

export async function getRestaurantName() {
  if (_restaurantName) return _restaurantName;

  const user = auth.currentUser;
  if (!user) return null;

  // Firestore se actual restaurant name fetch karo
  const { getDoc, doc } = await import(
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"
  );
  const snap = await getDoc(doc(db, "restaurants", user.uid));
  if (snap.exists() && snap.data().name) {
    _restaurantName = snap.data().name;
  } else {
    _restaurantName = user.email?.split("@")[0] || "My Restaurant";
  }
  return _restaurantName;
}

export function clearCache() {
  _restaurantId   = null;
  _restaurantName = null;
}

// ── Auth guard ─────────────────────────────────────────────────
export function requireAuth() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      if (!user) {
        window.location.href = "./index.html";
      } else {
        resolve(user);
      }
    });
  });
}

// ── Redirect if logged in ──────────────────────────────────────
export function redirectIfLoggedIn() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      if (user) {
        window.location.href = "./dashboard.html";
      } else {
        resolve();
      }
    });
  });
}

// ── Logout ─────────────────────────────────────────────────────
export async function handleLogout() {
  clearCache();
  await signOut(auth);
  window.location.href = "./index.html";
}

// ── Toast ──────────────────────────────────────────────────────
let _toastTimer = null;
export function showToast(msg, isError = false) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.className   = "toast show" + (isError ? " error" : "");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { toast.className = "toast"; }, 3500);
}

// ── Image compress ─────────────────────────────────────────────
// ── Image compress (Fixed for Transparency) ───────────────────────────────────
export function compressImage(file, maxSize = 400) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject("File read error");
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject("Image load error");
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > h && w > maxSize) { h = h * (maxSize / w); w = maxSize; }
        else if (h > maxSize)     { w = w * (maxSize / h); h = maxSize; }

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext("2d");
        
        // 1. Pehle canvas ko poora saaf (transparent) karo
        ctx.clearRect(0, 0, w, h);

        // 2. Image draw karo
        ctx.drawImage(img, 0, 0, w, h);

        // 3. CRITICAL FIX: "image/jpeg" ko badal kar "image/png" karo
        // PNG transparency ko preserve karta hai. 
        // Note: PNG mein quality parameter (0.65) kaam nahi karta, isliye hata diya.
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}


// ── Preview helper ─────────────────────────────────────────────
export function bindPreview(inputId, previewId) {
  const input = document.getElementById(inputId);
  const prev  = document.getElementById(previewId);
  if (!input || !prev) return;

  input.addEventListener("change", () => {
    const file = input.files[0];
    if (file) {
      prev.src = URL.createObjectURL(file);
      prev.style.display = "block";
    }
  });
}