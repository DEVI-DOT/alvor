// ============================================================
// ALVOR — Authentication  (js/auth.js)
// "Where Thread Meets Tradition"
// ============================================================
// Exports:
//   signInWithGoogle()
//   signInAsGuest(name, phone)
//   signOutUser()
//   getCurrentUser()          — returns unified user object or null
//   isAdmin()                 — checks current user against ADMIN_EMAIL
//   onAuthChange(callback)    — fires on every auth-state change
//   requireAdmin()            — redirects to admin login if not admin
//   requireAuth()             — redirects to account.html if not logged in
//   updateGuestProfile(name, phone)
//   clearGuest()
// ============================================================

import {
  auth,
  googleProvider,
  signInWithPopup,
  firebaseSignOut,
  onAuthStateChanged,
  upsertCustomer
} from "./firebase-config.js";

// ── Admin Config ─────────────────────────────────────────────
// ⚠️  Replace with your actual Gmail address before going live
const ADMIN_EMAIL = "alvor.emb@gmail.com";

// ── Storage Keys ─────────────────────────────────────────────
const GUEST_KEY      = "alvor_guest";
const AUTH_STATE_KEY = "alvor_auth_state";

// ── Internal state ────────────────────────────────────────────
let _currentFirebaseUser = null;  // Firebase Auth user object or null
let _authListeners       = [];    // registered onAuthChange callbacks

// ============================================================
// GOOGLE SIGN-IN
// ============================================================

/**
 * Open Google sign-in popup and upsert customer record.
 * @returns {Promise<{uid, name, email, photo, type:'google'}>}
 */
async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user   = result.user;

    // Persist customer record in Firestore
    await upsertCustomer(user);

    // Clear any guest session — real account takes over
    clearGuest();

    return _normaliseFirebaseUser(user);
  } catch (err) {
    console.error("signInWithGoogle error:", err);

    // User closed the popup — not a real error
    if (err.code === "auth/popup-closed-by-user" ||
        err.code === "auth/cancelled-popup-request") {
      return null;
    }
    throw err;
  }
}

// ============================================================
// GUEST SESSION
// ============================================================

/**
 * Save a guest profile to localStorage so pages can personalise
 * without requiring a Google account.
 * @param {string} name
 * @param {string} phone
 * @returns {{ uid:null, name, phone, type:'guest' }}
 */
function signInAsGuest(name, phone) {
  if (!name || !phone) throw new Error("Name and phone are required for guest session.");

  const guest = {
    uid:   null,
    name:  _sanitise(name),
    phone: _sanitise(phone),
    email: "",
    photo: "",
    type:  "guest"
  };

  localStorage.setItem(GUEST_KEY, JSON.stringify(guest));
  _notifyListeners(guest);
  return guest;
}

/**
 * Update an existing guest's name / phone (e.g. from checkout form).
 * @param {string} name
 * @param {string} phone
 */
function updateGuestProfile(name, phone) {
  const existing = _getGuest();
  if (!existing) return;

  const updated = {
    ...existing,
    name:  _sanitise(name)  || existing.name,
    phone: _sanitise(phone) || existing.phone
  };

  localStorage.setItem(GUEST_KEY, JSON.stringify(updated));
  _notifyListeners(updated);
}

/** Remove guest session from localStorage. */
function clearGuest() {
  localStorage.removeItem(GUEST_KEY);
}

// ============================================================
// SIGN OUT
// ============================================================

/**
 * Sign out Firebase user AND clear any guest session.
 * @returns {Promise<void>}
 */
async function signOutUser() {
  try {
    clearGuest();
    if (_currentFirebaseUser) {
      await firebaseSignOut(auth);
    }
    _notifyListeners(null);
  } catch (err) {
    console.error("signOutUser error:", err);
    throw err;
  }
}

// ============================================================
// CURRENT USER
// ============================================================

/**
 * Returns the currently active user — Firebase account or guest.
 * Shape:
 *   { uid, name, email, phone, photo, type: 'google'|'guest' }
 * Returns null if nobody is logged in.
 */
function getCurrentUser() {
  // Firebase user takes priority
  if (_currentFirebaseUser) {
    return _normaliseFirebaseUser(_currentFirebaseUser);
  }

  // Fall back to guest session
  const guest = _getGuest();
  if (guest) return guest;

  return null;
}

// ============================================================
// ADMIN CHECK
// ============================================================

/**
 * Returns true if the current Firebase user's email matches ADMIN_EMAIL.
 * Guest sessions can never be admin.
 */
function isAdmin() {
  if (!_currentFirebaseUser) return false;
  return _currentFirebaseUser.email === ADMIN_EMAIL;
}

// ============================================================
// AUTH CHANGE LISTENER
// ============================================================

/**
 * Register a callback that fires whenever auth state changes.
 * Fires immediately with the current user.
 * @param {Function} callback — receives user object or null
 * @returns {Function} unsubscribe — call to remove this listener
 */
function onAuthChange(callback) {
  if (typeof callback !== "function") return () => {};
  _authListeners.push(callback);

  // Fire immediately with current state
  callback(getCurrentUser());

  // Return unsubscribe
  return () => {
    _authListeners = _authListeners.filter(fn => fn !== callback);
  };
}

// ============================================================
// GUARDS — Page-level auth enforcement
// ============================================================

/**
 * Call at the top of admin.html's script.
 * Waits for Firebase to resolve, then redirects if not admin.
 * @returns {Promise<void>}
 */
async function requireAdmin() {
  return new Promise(resolve => {
    const unsubscribe = onAuthStateChanged(auth, user => {
      unsubscribe(); // listen once

      if (!user || user.email !== ADMIN_EMAIL) {
        // Store intended destination for post-login redirect
        sessionStorage.setItem("alvor_redirect_after_login", window.location.href);
        window.location.href = "admin.html?auth=required";
        return;
      }

      _currentFirebaseUser = user;
      resolve();
    });
  });
}

/**
 * Call on pages that require any login (Google or guest).
 * If no user at all, redirects to account.html.
 * @returns {Promise<void>}
 */
async function requireAuth() {
  return new Promise(resolve => {
    const unsubscribe = onAuthStateChanged(auth, user => {
      unsubscribe();

      if (user) {
        _currentFirebaseUser = user;
        resolve();
        return;
      }

      const guest = _getGuest();
      if (guest) {
        resolve();
        return;
      }

      sessionStorage.setItem("alvor_redirect_after_login", window.location.href);
      window.location.href = "account.html?auth=required";
    });
  });
}

// ============================================================
// FIREBASE AUTH STATE WATCHER
// Runs on module load — keeps _currentFirebaseUser in sync.
// ============================================================

onAuthStateChanged(auth, user => {
  _currentFirebaseUser = user || null;
  _notifyListeners(getCurrentUser());

  // Persist a lightweight flag so other tabs can react
  if (user) {
    localStorage.setItem(AUTH_STATE_KEY, JSON.stringify({
      uid:   user.uid,
      email: user.email,
      name:  user.displayName || "",
      photo: user.photoURL    || ""
    }));
  } else {
    localStorage.removeItem(AUTH_STATE_KEY);
  }
});

// ============================================================
// INTERNAL HELPERS
// ============================================================

/** Normalise a Firebase User object into ALVOR's user shape. */
function _normaliseFirebaseUser(user) {
  return {
    uid:   user.uid,
    name:  user.displayName || "Customer",
    email: user.email       || "",
    phone: "",          // phone not provided by Google Auth
    photo: user.photoURL || "",
    type:  "google"
  };
}

/** Read guest object from localStorage (or null). */
function _getGuest() {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Validate shape
    if (parsed && parsed.type === "guest" && parsed.name) return parsed;
    return null;
  } catch (_) {
    return null;
  }
}

/** Fire all registered auth-change callbacks. */
function _notifyListeners(user) {
  _authListeners.forEach(fn => {
    try { fn(user); } catch (err) { console.warn("onAuthChange callback error:", err); }
  });
}

/** Basic string sanitiser (mirrors firebase-config.js). */
function _sanitise(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[<>]/g, "").trim().slice(0, 200);
}

// ============================================================
// EXPORTS
// ============================================================
export {
  // Actions
  signInWithGoogle,
  signInAsGuest,
  signOutUser,
  updateGuestProfile,
  clearGuest,

  // State
  getCurrentUser,
  isAdmin,
  onAuthChange,

  // Guards
  requireAdmin,
  requireAuth,

  // Constants (exposed for admin panel's hardcoded check)
  ADMIN_EMAIL
};
