// ============================================================
// ALVOR — Checkout Page  (js/checkout.js)
// "Where Thread Meets Tradition"
// ============================================================
// Handles all logic for checkout.html:
//   • Render order summary from localStorage cart
//   • Pre-fill form from saved guest/account details
//   • AP cities dropdown
//   • Full form validation
//   • Coupon code apply / remove
//   • Save order to Firestore (createOrder)
//   • Generate WhatsApp pre-filled message
//   • Redirect to confirmation.html?orderId=ALVOR-XXXX
//   • Save customer details to localStorage for next time
// ============================================================

import {
  createOrder,
  validateCoupon
} from "./firebase-config.js";

import {
  getCart,
  getCartSubtotal,
  getCartTotal,
  getCartSummaryText,
  clearCart,
  applyDiscount,
  clearDiscount,
  getDiscount,
  formatPrice
} from "./cart.js";

import {
  initUI,
  showToast,
  showLoader,
  hideLoader,
  formatDate,
  debounce
} from "./ui.js";

import { getCurrentUser } from "./auth.js";

// ── Config ────────────────────────────────────────────────────
const WHATSAPP_NUMBER  = "919876543210"; // ⚠️  Replace before go-live
const INSTAGRAM_HANDLE = "alvor_emb";
const SAVED_DETAILS_KEY= "alvor_saved_details";

// ── Andhra Pradesh Cities ─────────────────────────────────────
const AP_CITIES = [
  "Visakhapatnam", "Vijayawada", "Guntur", "Nellore", "Kurnool",
  "Rajahmundry", "Kakinada", "Tirupati", "Kadapa", "Anantapur",
  "Vizianagaram", "Eluru", "Ongole", "Nandyal", "Machilipatnam",
  "Adoni", "Tenali", "Proddatur", "Chittoor", "Hindupur",
  "Bhimavaram", "Madanapalle", "Guntakal", "Dharmavaram",
  "Gudivada", "Narasaraopet", "Tadipatri", "Palasa", "Kavali",
  "Tanuku", "Tadepalligudem", "Bapatla", "Chilakaluripet",
  "Markapur", "Kandukur", "Srikakulam", "Parvathipuram",
  "Bobbili", "Rajam", "Narasapuram", "Amalapuram", "Jangareddygudem",
  "Peddapuram", "Samalkot", "Tuni", "Narsipatnam", "Palakonda",
  "Salur", "Parvatipuram", "Kukatpally", "Amaravati",
  "Other"
];

// ── State ─────────────────────────────────────────────────────
let _cart          = [];
let _discount      = null;
let _couponApplied = false;

// ============================================================
// ENTRY POINT
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  await initUI({
    isHeroPage      : false,
    whatsappNumber  : WHATSAPP_NUMBER,
    instagramHandle : INSTAGRAM_HANDLE
  });

  _cart     = getCart();
  _discount = getDiscount();

  // ── Redirect to cart if empty ─────────────────────────────
  if (!_cart.length) {
    showToast("Your cart is empty. Add items before checking out.", "info");
    setTimeout(() => { window.location.href = "cart.html"; }, 1800);
    return;
  }

  // ── Build cities dropdown ─────────────────────────────────
  _buildCityDropdown();

  // ── Pre-fill form ─────────────────────────────────────────
  _prefillForm();

  // ── Render order summary ──────────────────────────────────
  _renderOrderSummary();

  // ── Wire up all interactions ──────────────────────────────
  _bindCoupon();
  _bindFormValidation();
  _bindPlaceOrder();
  _bindSaveDetailsToggle();
});

// ============================================================
// CITIES DROPDOWN
// ============================================================

function _buildCityDropdown() {
  const select = document.getElementById("field-city");
  if (!select) return;

  select.innerHTML = `<option value="" disabled selected>Select your city</option>` +
    AP_CITIES.map(c => `<option value="${_escapeHtml(c)}">${_escapeHtml(c)}</option>`).join("");
}

// ============================================================
// PRE-FILL FORM
// ============================================================

function _prefillForm() {
  // Priority: Firebase user > guest session > saved details localStorage
  const user    = getCurrentUser();
  const saved   = _getSavedDetails();
  const source  = user || saved;

  if (!source) return;

  _setField("field-name",    source.name  || "");
  _setField("field-phone",   source.phone || "");
  _setField("field-email",   source.email || "");

  if (saved) {
    _setField("field-address",  saved.address  || "");
    _setField("field-pincode",  saved.pincode  || "");
    _setField("field-landmark", saved.landmark || "");

    const citySelect = document.getElementById("field-city");
    if (citySelect && saved.city) {
      // Try exact match first, fall back to "Other"
      const opt = Array.from(citySelect.options).find(o => o.value === saved.city);
      if (opt) citySelect.value = saved.city;
    }
  }

  // Tick "save details" checkbox if user is logged in
  const saveChk = document.getElementById("save-details");
  if (saveChk && user) saveChk.checked = true;
}

// ============================================================
// ORDER SUMMARY
// ============================================================

function _renderOrderSummary() {
  _renderCartItems();
  _renderTotals();
  _renderEstimatedDelivery();
}

function _renderCartItems() {
  const container = document.getElementById("checkout-items");
  if (!container) return;

  container.innerHTML = _cart.map(item => {
    const lineTotal = item.price * item.quantity;
    const sizeStr   = item.size ? `<span class="checkout-item__size">${_escapeHtml(item.size)}</span>` : "";
    const originalStr = item.originalPrice && item.originalPrice > item.price
      ? `<s class="text-muted">${formatPrice(item.originalPrice)}</s> ` : "";

    return `
      <div class="checkout-item">
        <div class="checkout-item__img-wrap">
          ${item.imageURL
            ? `<img src="${_escapeHtml(item.imageURL)}"
                    alt="${_escapeHtml(item.title)}"
                    class="checkout-item__img"
                    loading="lazy">`
            : `<div class="checkout-item__img-placeholder"><i class="fa-regular fa-image"></i></div>`
          }
          <span class="checkout-item__qty-badge">${item.quantity}</span>
        </div>
        <div class="checkout-item__details">
          <p class="checkout-item__title">${_escapeHtml(item.title)}</p>
          ${sizeStr}
        </div>
        <div class="checkout-item__price">
          ${originalStr}${formatPrice(lineTotal)}
        </div>
      </div>
    `;
  }).join("");
}

function _renderTotals() {
  const subtotal  = getCartSubtotal();
  const discount  = _discount;
  const total     = getCartTotal();

  _setText("checkout-subtotal", formatPrice(subtotal));
  _setText("checkout-delivery", "Free");
  _setText("checkout-total",    formatPrice(total));

  // Discount row
  const discountRow = document.getElementById("checkout-discount-row");
  if (discountRow) {
    if (discount && discount.amount > 0) {
      discountRow.style.display = "";
      _setText("checkout-discount-code",   discount.code);
      _setText("checkout-discount-amount", `−${formatPrice(discount.amount)}`);
      _couponApplied = true;
    } else {
      discountRow.style.display = "none";
    }
  }
}

function _renderEstimatedDelivery() {
  const el = document.getElementById("checkout-delivery-estimate");
  if (!el) return;

  // Find max estimated days across all cart items
  // (products don't carry estimatedDays in cart snapshot, use a default)
  const today    = new Date();
  const minDays  = 3;
  const maxDays  = 7;
  const fromDate = new Date(today.getTime() + minDays * 86400000);
  const toDate   = new Date(today.getTime() + maxDays * 86400000);

  const fmt = d => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  el.textContent = `Estimated delivery: ${fmt(fromDate)} – ${fmt(toDate)}`;
}

// ============================================================
// COUPON
// ============================================================

function _bindCoupon() {
  const applyBtn  = document.getElementById("btn-apply-coupon");
  const removeBtn = document.getElementById("btn-remove-coupon");
  const input     = document.getElementById("coupon-input");
  if (!applyBtn || !input) return;

  // If discount already applied from a previous step
  if (_couponApplied) _showCouponApplied();

  applyBtn.addEventListener("click", async () => {
    const code = (input.value || "").trim().toUpperCase();
    if (!code) {
      showToast("Please enter a coupon code.", "info");
      return;
    }

    applyBtn.disabled = true;
    applyBtn.textContent = "Checking…";

    try {
      const coupon = await validateCoupon(code);

      if (!coupon) {
        showToast("Invalid or expired coupon code.", "error");
        return;
      }

      const result = applyDiscount(code, coupon.discountPercent, coupon.minOrder || 0);

      if (!result.success) {
        showToast(result.message, "error");
        return;
      }

      _discount      = result.discount;
      _couponApplied = true;
      _renderTotals();
      _showCouponApplied();
      showToast(result.message, "success");

    } catch (err) {
      console.error("Coupon validation error:", err);
      showToast("Could not validate coupon. Try again.", "error");
    } finally {
      applyBtn.disabled    = false;
      applyBtn.textContent = "Apply";
    }
  });

  // Allow Enter key on coupon input
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); applyBtn.click(); }
  });

  // Remove coupon
  removeBtn?.addEventListener("click", () => {
    clearDiscount();
    _discount      = null;
    _couponApplied = false;
    input.value    = "";
    _hideCouponApplied();
    _renderTotals();
    showToast("Coupon removed.", "info");
  });
}

function _showCouponApplied() {
  const applyRow   = document.getElementById("coupon-apply-row");
  const appliedRow = document.getElementById("coupon-applied-row");
  const input      = document.getElementById("coupon-input");
  if (applyRow)   applyRow.style.display   = "none";
  if (appliedRow) appliedRow.style.display = "";
  if (input)      input.disabled           = true;
  // Show applied code label
  const codeLabel = document.getElementById("applied-coupon-code");
  if (codeLabel && _discount) codeLabel.textContent = _discount.code;
}

function _hideCouponApplied() {
  const applyRow   = document.getElementById("coupon-apply-row");
  const appliedRow = document.getElementById("coupon-applied-row");
  const input      = document.getElementById("coupon-input");
  if (applyRow)   applyRow.style.display   = "";
  if (appliedRow) appliedRow.style.display = "none";
  if (input)      input.disabled           = false;
}

// ============================================================
// FORM VALIDATION
// ============================================================

const _validators = {
  "field-name": {
    validate : v => v.trim().length >= 2,
    message  : "Please enter your full name (at least 2 characters)."
  },
  "field-phone": {
    validate : v => /^[6-9]\d{9}$/.test(v.trim().replace(/\s/g, "")),
    message  : "Please enter a valid 10-digit WhatsApp number."
  },
  "field-email": {
    validate : v => !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
    message  : "Please enter a valid email address (or leave empty)."
  },
  "field-address": {
    validate : v => v.trim().length >= 10,
    message  : "Please enter your full address (at least 10 characters)."
  },
  "field-city": {
    validate : v => v.trim().length > 0,
    message  : "Please select your city."
  },
  "field-pincode": {
    validate : v => /^\d{6}$/.test(v.trim()),
    message  : "Please enter a valid 6-digit pincode."
  }
};

function _bindFormValidation() {
  Object.keys(_validators).forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("blur",  () => _validateField(id));
    el.addEventListener("input", debounce(() => _validateField(id), 400));
  });
}

function _validateField(id) {
  const el        = document.getElementById(id);
  const { validate, message } = _validators[id] || {};
  if (!el || !validate) return true;

  const value   = el.value || "";
  const isValid = validate(value);

  const wrap   = el.closest(".form-group") || el.parentElement;
  const errEl  = wrap?.querySelector(".form-error");

  el.classList.toggle("form-input--error", !isValid);
  el.classList.toggle("form-input--valid",  isValid && value.trim().length > 0);

  if (errEl) {
    errEl.textContent    = isValid ? "" : message;
    errEl.style.display  = isValid ? "none" : "block";
  }

  return isValid;
}

function _validateAll() {
  let allValid = true;
  Object.keys(_validators).forEach(id => {
    if (!_validateField(id)) allValid = false;
  });
  return allValid;
}

// ============================================================
// PLACE ORDER
// ============================================================

function _bindPlaceOrder() {
  const btn = document.getElementById("btn-place-order");
  if (!btn) return;

  btn.addEventListener("click", async e => {
    e.preventDefault();

    // ── Validate form ────────────────────────────────────────
    if (!_validateAll()) {
      showToast("Please fix the errors above before placing your order.", "error");
      // Scroll to first error
      const firstErr = document.querySelector(".form-input--error");
      firstErr?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    // ── Collect form values ───────────────────────────────────
    const name     = _getField("field-name");
    const phone    = _getField("field-phone").replace(/\s/g, "");
    const email    = _getField("field-email");
    const address  = _getField("field-address");
    const city     = _getField("field-city");
    const pincode  = _getField("field-pincode");
    const landmark = _getField("field-landmark");
    const notes    = _getField("field-notes");

    const subtotal      = getCartSubtotal();
    const discount      = getDiscount();
    const total         = getCartTotal();
    const discountAmt   = discount?.amount   || 0;
    const couponCode    = discount?.code     || "";

    // ── Optimistic save details ──────────────────────────────
    const saveChk = document.getElementById("save-details");
    if (saveChk?.checked) {
      _saveDetails({ name, phone, email, address, city, pincode, landmark });
    }

    // ── Disable button ────────────────────────────────────────
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Placing Order…`;
    showLoader();

    try {
      // ── Save order to Firestore ──────────────────────────────
      const orderId = await createOrder({
        customerName   : name,
        customerPhone  : phone,
        customerEmail  : email,
        items          : _cart.map(item => ({
          productId  : item.productId,
          title      : item.title,
          price      : item.price,
          size       : item.size,
          quantity   : item.quantity,
          imageURL   : item.imageURL
        })),
        totalAmount    : total,
        deliveryArea   : city,
        address,
        city,
        pincode,
        landmark,
        notes,
        couponCode,
        discountAmount : discountAmt,
        source         : "website",
        type           : "product"
      });

      // ── Build WhatsApp message ───────────────────────────────
      const itemsList = _cart
        .map(i => `  • ${i.quantity}× ${i.title}${i.size ? ` (${i.size})` : ""} — ${formatPrice(i.price * i.quantity)}`)
        .join("\n");

      const discountLine = discountAmt > 0
        ? `\nDiscount (${couponCode}): −${formatPrice(discountAmt)}` : "";

      const waMessage = encodeURIComponent(
        `Hi ALVOR! I just placed an order 🎉\n\n` +
        `*Order ID:* #${orderId}\n\n` +
        `*Items:*\n${itemsList}\n` +
        `*Subtotal:* ${formatPrice(subtotal)}${discountLine}\n` +
        `*Total:* ${formatPrice(total)}\n\n` +
        `*Name:* ${name}\n` +
        `*WhatsApp:* ${phone}\n` +
        `*Address:* ${address}, ${city} – ${pincode}` +
        (landmark ? `, Near ${landmark}` : "") +
        (notes ? `\n*Notes:* ${notes}` : "") +
        `\n\nPlease confirm my order. Thank you!`
      );

      // ── Clear cart + discount ────────────────────────────────
      clearCart();
      clearDiscount();

      hideLoader();

      // ── Open WhatsApp ────────────────────────────────────────
      window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${waMessage}`, "_blank", "noopener");

      // ── Redirect to confirmation page ────────────────────────
      window.location.href = `confirmation.html?orderId=${encodeURIComponent(orderId)}`;

    } catch (err) {
      hideLoader();
      console.error("Place order error:", err);
      showToast("Failed to place order. Please try again or order directly on WhatsApp.", "error");
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-brands fa-whatsapp"></i> Place Order on WhatsApp`;
    }
  });
}

// ============================================================
// SAVE DETAILS TOGGLE
// ============================================================

function _bindSaveDetailsToggle() {
  const chk = document.getElementById("save-details");
  if (!chk) return;
  // Auto-check if saved details exist
  if (_getSavedDetails()) chk.checked = true;
}

// ============================================================
// SAVED DETAILS — localStorage helpers
// ============================================================

function _saveDetails(details) {
  try {
    localStorage.setItem(SAVED_DETAILS_KEY, JSON.stringify({
      name     : details.name     || "",
      phone    : details.phone    || "",
      email    : details.email    || "",
      address  : details.address  || "",
      city     : details.city     || "",
      pincode  : details.pincode  || "",
      landmark : details.landmark || ""
    }));
  } catch (_) {}
}

function _getSavedDetails() {
  try {
    const raw = localStorage.getItem(SAVED_DETAILS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

// ============================================================
// DOM HELPERS
// ============================================================

function _getField(id) {
  return (document.getElementById(id)?.value || "").trim();
}

function _setField(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function _setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function _escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#39;");
}
