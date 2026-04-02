// ============================================================
// ALVOR — Firebase Configuration
// ============================================================
// SETUP INSTRUCTIONS:
// 1. Go to https://console.firebase.google.com
// 2. Create a new project named "alvor-store"
// 3. Enable Firestore Database (start in production mode)
// 4. Enable Firebase Storage
// 5. Enable Authentication → Google sign-in provider
// 6. Go to Project Settings → Your Apps → Add Web App
// 7. Copy your config object and replace the placeholder below
// 8. In Firestore rules, paste the rules commented below
// 9. Add your Netlify domain to Auth > Authorized Domains after deploy
// ============================================================

// ── Firebase SDK — ESM via CDN (v10) ─────────────────────────
import { initializeApp }          from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore,
         collection, doc,
         getDoc, getDocs, addDoc,
         updateDoc, deleteDoc,
         query, where, orderBy,
         limit, startAfter,
         onSnapshot, serverTimestamp,
         increment }               from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage,
         ref, uploadBytesResumable,
         getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getAuth,
         GoogleAuthProvider,
         signInWithPopup,
         signOut as firebaseSignOut,
         onAuthStateChanged }      from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ============================================================
// ⚠️  REPLACE THIS BLOCK WITH YOUR REAL FIREBASE CONFIG
// ============================================================
const firebaseConfig = {
  apiKey:            "AIzaSyBo746KDJuzovRnkZcX_2ZfUbeTL3clOgo",
  authDomain:        "alvor-website.firebaseapp.com",
  projectId:         "alvor-website",
  storageBucket:     "alvor-website.firebasestorage.app",
  messagingSenderId: "706932421525",
  appId:             "1:706932421525:web:fc31e4df05bffda0a47c9c",
  measurementId:     "G-DXNF1ZC0JD"   // optional — remove if not using Analytics
};
// ============================================================

// ── Initialize Firebase ──────────────────────────────────────
const app     = initializeApp(firebaseConfig);
const db      = getFirestore(app);
const storage = getStorage(app);
const auth    = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// ── Collection References ────────────────────────────────────
const COLLECTIONS = {
  PRODUCTS:  "products",
  ORDERS:    "orders",
  CUSTOMERS: "customers",
  REVIEWS:   "reviews",
  SETTINGS:  "settings",
  COUPONS:   "coupons"
};

// ── Settings Document ID ─────────────────────────────────────
// Store all site settings in a single document
const SETTINGS_DOC_ID = "global";

// ── Helper — Sanitise strings before Firestore writes ────────
function sanitiseString(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[<>]/g, "").trim().slice(0, 2000);
}

function sanitiseNumber(val, fallback = 0) {
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

// ── Helper — Generate Order ID ────────────────────────────────
function generateOrderId() {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ALVOR-${ts}-${rand}`;
}

// ── Products API ─────────────────────────────────────────────

/** Fetch all visible products, newest first */
async function getProducts(filters = {}) {
  try {
    const colRef = collection(db, COLLECTIONS.PRODUCTS);
    let constraints = [where("visible", "==", true)];

    if (filters.category && filters.category !== "all") {
      constraints.push(where("category", "==", filters.category));
    }
    if (filters.tag) {
      constraints.push(where("tags", "array-contains", filters.tag));
    }

    constraints.push(orderBy("createdAt", "desc"));

    if (filters.limitCount) {
      constraints.push(limit(filters.limitCount));
    }

    const q   = query(colRef, ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("getProducts error:", err);
    return [];
  }
}

/** Fetch a single product by ID */
async function getProductById(productId) {
  try {
    const docRef  = doc(db, COLLECTIONS.PRODUCTS, productId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() };
    }
    return null;
  } catch (err) {
    console.error("getProductById error:", err);
    return null;
  }
}

/** Add a new product (admin only) */
async function addProduct(productData) {
  try {
    const clean = {
      title:         sanitiseString(productData.title),
      category:      sanitiseString(productData.category),
      description:   sanitiseString(productData.description),
      price:         sanitiseNumber(productData.price),
      originalPrice: sanitiseNumber(productData.originalPrice),
      images:        Array.isArray(productData.images) ? productData.images : [],
      mainImage:     sanitiseString(productData.mainImage),
      sizes:         Array.isArray(productData.sizes) ? productData.sizes : [],
      stock:         sanitiseNumber(productData.stock, 0),
      visible:       Boolean(productData.visible),
      estimatedDays: sanitiseString(productData.estimatedDays),
      tags:          Array.isArray(productData.tags) ? productData.tags : [],
      createdAt:     serverTimestamp(),
      updatedAt:     serverTimestamp()
    };
    const docRef = await addDoc(collection(db, COLLECTIONS.PRODUCTS), clean);
    return docRef.id;
  } catch (err) {
    console.error("addProduct error:", err);
    throw err;
  }
}

/** Update an existing product (admin only) */
async function updateProduct(productId, updates) {
  try {
    const docRef = doc(db, COLLECTIONS.PRODUCTS, productId);
    await updateDoc(docRef, { ...updates, updatedAt: serverTimestamp() });
  } catch (err) {
    console.error("updateProduct error:", err);
    throw err;
  }
}

/** Delete a product (admin only) */
async function deleteProduct(productId) {
  try {
    await deleteDoc(doc(db, COLLECTIONS.PRODUCTS, productId));
  } catch (err) {
    console.error("deleteProduct error:", err);
    throw err;
  }
}

// ── Orders API ───────────────────────────────────────────────

/** Save a new order to Firestore */
async function createOrder(orderData) {
  try {
    const orderId = generateOrderId();
    const clean = {
      id:             orderId,
      customerName:   sanitiseString(orderData.customerName),
      customerPhone:  sanitiseString(orderData.customerPhone),
      customerEmail:  sanitiseString(orderData.customerEmail || ""),
      items:          Array.isArray(orderData.items) ? orderData.items : [],
      totalAmount:    sanitiseNumber(orderData.totalAmount),
      deliveryArea:   sanitiseString(orderData.deliveryArea),
      address:        sanitiseString(orderData.address || ""),
      city:           sanitiseString(orderData.city || ""),
      pincode:        sanitiseString(orderData.pincode || ""),
      landmark:       sanitiseString(orderData.landmark || ""),
      notes:          sanitiseString(orderData.notes || ""),
      couponCode:     sanitiseString(orderData.couponCode || ""),
      discountAmount: sanitiseNumber(orderData.discountAmount || 0),
      status:         "new",
      source:         orderData.source || "website",
      type:           orderData.type   || "product",
      createdAt:      serverTimestamp(),
      updatedAt:      serverTimestamp()
    };
    await addDoc(collection(db, COLLECTIONS.ORDERS), clean);
    return orderId;
  } catch (err) {
    console.error("createOrder error:", err);
    throw err;
  }
}

/** Get all orders (admin only) */
async function getOrders(filters = {}) {
  try {
    const colRef = collection(db, COLLECTIONS.ORDERS);
    let constraints = [orderBy("createdAt", "desc")];

    if (filters.status) {
      constraints = [where("status", "==", filters.status), orderBy("createdAt", "desc")];
    }
    if (filters.limitCount) {
      constraints.push(limit(filters.limitCount));
    }

    const q    = query(colRef, ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ docId: d.id, ...d.data() }));
  } catch (err) {
    console.error("getOrders error:", err);
    return [];
  }
}

/** Get orders for a specific phone number */
async function getOrdersByPhone(phone) {
  try {
    const q    = query(
      collection(db, COLLECTIONS.ORDERS),
      where("customerPhone", "==", phone),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ docId: d.id, ...d.data() }));
  } catch (err) {
    console.error("getOrdersByPhone error:", err);
    return [];
  }
}

/** Update order status (admin only) */
async function updateOrderStatus(docId, status) {
  try {
    await updateDoc(doc(db, COLLECTIONS.ORDERS, docId), {
      status,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    console.error("updateOrderStatus error:", err);
    throw err;
  }
}

// ── Reviews API ──────────────────────────────────────────────

/** Get reviews for a product */
async function getReviewsByProduct(productId) {
  try {
    const q    = query(
      collection(db, COLLECTIONS.REVIEWS),
      where("productId", "==", productId),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("getReviewsByProduct error:", err);
    return [];
  }
}

/** Get all reviews (for homepage testimonials) */
async function getAllReviews(limitCount = 10) {
  try {
    const q    = query(
      collection(db, COLLECTIONS.REVIEWS),
      orderBy("createdAt", "desc"),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("getAllReviews error:", err);
    return [];
  }
}

/** Add a review */
async function addReview(reviewData) {
  try {
    const clean = {
      productId:    sanitiseString(reviewData.productId),
      customerId:   sanitiseString(reviewData.customerId || "guest"),
      customerName: sanitiseString(reviewData.customerName),
      rating:       Math.min(5, Math.max(1, parseInt(reviewData.rating) || 5)),
      comment:      sanitiseString(reviewData.comment),
      createdAt:    serverTimestamp()
    };
    const docRef = await addDoc(collection(db, COLLECTIONS.REVIEWS), clean);
    return docRef.id;
  } catch (err) {
    console.error("addReview error:", err);
    throw err;
  }
}

// ── Settings API ─────────────────────────────────────────────

/** Load site settings from Firestore */
async function getSettings() {
  try {
    const docSnap = await getDoc(doc(db, COLLECTIONS.SETTINGS, SETTINGS_DOC_ID));
    if (docSnap.exists()) {
      return docSnap.data();
    }
    // Return sensible defaults if settings doc doesn't exist yet
    return {
      heroHeading:      "Where Thread Meets Tradition",
      heroSubheading:   "Premium handcrafted embroidery art & interior decoration from Andhra Pradesh",
      aboutText:        "ALVOR was born from a deep love of traditional Indian embroidery...",
      whatsappNumber:   "91XXXXXXXXXX",
      instagramHandle:  "alvor_emb",
      deliveryDays:     "5-7",
      announcementBar:  "✨ Free delivery across Andhra Pradesh on all orders!",
      announcementActive: true
    };
  } catch (err) {
    console.error("getSettings error:", err);
    return {};
  }
}

/** Update site settings (admin only) */
async function updateSettings(settingsData) {
  try {
    const docRef = doc(db, COLLECTIONS.SETTINGS, SETTINGS_DOC_ID);
    await updateDoc(docRef, { ...settingsData, updatedAt: serverTimestamp() });
  } catch (err) {
    // If document doesn't exist, create it
    try {
      await addDoc(collection(db, COLLECTIONS.SETTINGS), {
        ...settingsData,
        id: SETTINGS_DOC_ID,
        updatedAt: serverTimestamp()
      });
    } catch (innerErr) {
      console.error("updateSettings error:", innerErr);
      throw innerErr;
    }
  }
}

// ── Coupons API ──────────────────────────────────────────────

/** Validate a coupon code */
async function validateCoupon(code, orderTotal) {
  try {
    const q    = query(
      collection(db, COLLECTIONS.COUPONS),
      where("code",   "==", code.toUpperCase().trim()),
      where("active", "==", true)
    );
    const snap = await getDocs(q);
    if (snap.empty) return { valid: false, message: "Invalid coupon code." };

    const coupon = snap.docs[0].data();
    const now    = new Date();

    if (coupon.expiryDate && coupon.expiryDate.toDate() < now) {
      return { valid: false, message: "This coupon has expired." };
    }
    if (coupon.minOrder && orderTotal < coupon.minOrder) {
      return {
        valid:   false,
        message: `Minimum order ₹${coupon.minOrder} required for this coupon.`
      };
    }

    const discount = Math.round(orderTotal * (coupon.discountPercent / 100));
    return {
      valid:           true,
      discountPercent: coupon.discountPercent,
      discountAmount:  discount,
      message:         `${coupon.discountPercent}% discount applied!`
    };
  } catch (err) {
    console.error("validateCoupon error:", err);
    return { valid: false, message: "Error validating coupon." };
  }
}

/** Get all coupons (admin only) */
async function getCoupons() {
  try {
    const snap = await getDocs(collection(db, COLLECTIONS.COUPONS));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("getCoupons error:", err);
    return [];
  }
}

/** Add a new coupon (admin only) */
async function addCoupon(couponData) {
  try {
    const clean = {
      code:            couponData.code.toUpperCase().trim(),
      discountPercent: sanitiseNumber(couponData.discountPercent),
      minOrder:        sanitiseNumber(couponData.minOrder, 0),
      active:          Boolean(couponData.active),
      expiryDate:      couponData.expiryDate || null,
      createdAt:       serverTimestamp()
    };
    const docRef = await addDoc(collection(db, COLLECTIONS.COUPONS), clean);
    return docRef.id;
  } catch (err) {
    console.error("addCoupon error:", err);
    throw err;
  }
}

/** Toggle coupon active state (admin only) */
async function toggleCoupon(couponId, active) {
  try {
    await updateDoc(doc(db, COLLECTIONS.COUPONS, couponId), { active });
  } catch (err) {
    console.error("toggleCoupon error:", err);
    throw err;
  }
}

// ── Storage API ──────────────────────────────────────────────

/**
 * Upload a product image to Firebase Storage
 * @param {File}     file       — the File object from input[type=file]
 * @param {string}   folder     — e.g. "products"
 * @param {Function} onProgress — optional callback(percent)
 * @returns {Promise<string>}  — download URL
 */
async function uploadImage(file, folder = "products", onProgress = null) {
  return new Promise((resolve, reject) => {
    const safeName  = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const storageRef = ref(storage, `${folder}/${safeName}`);
    const task       = uploadBytesResumable(storageRef, file);

    task.on("state_changed",
      snapshot => {
        if (onProgress) {
          const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          onProgress(pct);
        }
      },
      err  => reject(err),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve(url);
      }
    );
  });
}

/** Delete an image from Firebase Storage by its URL */
async function deleteImage(imageUrl) {
  try {
    const imgRef = ref(storage, imageUrl);
    await deleteObject(imgRef);
  } catch (err) {
    console.error("deleteImage error:", err);
  }
}

// ── Customers API ────────────────────────────────────────────

/** Upsert a customer record after Google login */
async function upsertCustomer(user) {
  try {
    const docRef  = doc(db, COLLECTIONS.CUSTOMERS, user.uid);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      await updateDoc(docRef, {
        uid:          user.uid,
        name:         user.displayName || "",
        email:        user.email       || "",
        phone:        "",
        orderHistory: [],
        createdAt:    serverTimestamp()
      });
    }
  } catch (err) {
    // Document may not exist yet — create it
    console.warn("upsertCustomer: creating new customer record");
  }
}

/** Get all customers (admin only) */
async function getCustomers() {
  try {
    const snap = await getDocs(collection(db, COLLECTIONS.CUSTOMERS));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("getCustomers error:", err);
    return [];
  }
}

// ── Real-time Listener Helpers ───────────────────────────────

/** Listen to new orders in real-time (admin dashboard) */
function listenToNewOrders(callback) {
  const q = query(
    collection(db, COLLECTIONS.ORDERS),
    where("status", "==", "new"),
    orderBy("createdAt", "desc")
  );
  return onSnapshot(q, snap => {
    const orders = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
    callback(orders);
  });
}

// ── Export everything ────────────────────────────────────────
export {
  // Core instances
  app, db, storage, auth, googleProvider,

  // Firestore helpers (re-exported for use in other modules)
  collection, doc, getDoc, getDocs, addDoc,
  updateDoc, deleteDoc, query, where,
  orderBy, limit, onSnapshot, serverTimestamp,

  // Constants
  COLLECTIONS, SETTINGS_DOC_ID,

  // Utility
  sanitiseString, sanitiseNumber, generateOrderId,

  // Products
  getProducts, getProductById, addProduct, updateProduct, deleteProduct,

  // Orders
  createOrder, getOrders, getOrdersByPhone, updateOrderStatus,

  // Reviews
  getReviewsByProduct, getAllReviews, addReview,

  // Settings
  getSettings, updateSettings,

  // Coupons
  validateCoupon, getCoupons, addCoupon, toggleCoupon,

  // Storage
  uploadImage, deleteImage,

  // Customers
  upsertCustomer, getCustomers,

  // Real-time
  listenToNewOrders,

  // Auth exports
  GoogleAuthProvider, signInWithPopup, firebaseSignOut, onAuthStateChanged
};

// ============================================================
// FIRESTORE SECURITY RULES
// Paste these into Firebase Console → Firestore → Rules
// ============================================================
/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ── Helper functions ─────────────────────────────────────
    function isAdmin() {
      return request.auth != null
          && request.auth.token.email == "YOUR_ADMIN_EMAIL@gmail.com";
    }

    function isLoggedIn() {
      return request.auth != null;
    }

    // ── Products ─────────────────────────────────────────────
    // Public read for visible products; admin write
    match /products/{productId} {
      allow read:  if resource.data.visible == true || isAdmin();
      allow write: if isAdmin();
    }

    // ── Orders ───────────────────────────────────────────────
    // Anyone can create; only admin can read all / update
    match /orders/{orderId} {
      allow create: if true;
      allow read, update, delete: if isAdmin();
    }

    // ── Reviews ──────────────────────────────────────────────
    // Public read; logged-in users can create
    match /reviews/{reviewId} {
      allow read:   if true;
      allow create: if isLoggedIn();
      allow update, delete: if isAdmin();
    }

    // ── Settings ─────────────────────────────────────────────
    // Public read; admin write
    match /settings/{docId} {
      allow read:  if true;
      allow write: if isAdmin();
    }

    // ── Coupons ───────────────────────────────────────────────
    // Public read (needed for validation); admin write
    match /coupons/{couponId} {
      allow read:  if true;
      allow write: if isAdmin();
    }

    // ── Customers ─────────────────────────────────────────────
    // User can read/write own doc; admin can read all
    match /customers/{uid} {
      allow read, write: if isLoggedIn() && request.auth.uid == uid;
      allow read:        if isAdmin();
    }
  }
}
*/

// ============================================================
// FIREBASE STORAGE RULES
// Paste into Firebase Console → Storage → Rules
// ============================================================
/*
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {

    // Product images — admin upload, public read
    match /products/{imageFile} {
      allow read:  if true;
      allow write: if request.auth != null
                   && request.auth.token.email == "YOUR_ADMIN_EMAIL@gmail.com"
                   && request.resource.size < 5 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
    }

    // Catch-all — deny everything else
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
*/
