// ============================================================
// ALVOR — Cart Manager  (js/cart.js)
// "Where Thread Meets Tradition"
// ============================================================
// All cart data lives in localStorage under key "alvor_cart".
// Cart item shape:
//   {
//     productId  : string,
//     title      : string,
//     price      : number,
//     originalPrice: number | null,
//     size       : string,
//     quantity   : number,
//     imageURL   : string,
//     addedAt    : number   (Date.now())
//   }
//
// Exports:
//   addToCart(productId, title, price, size, quantity, imageURL, originalPrice?)
//   removeFromCart(productId, size)
//   updateQuantity(productId, size, newQty)
//   getCart()
//   getCartCount()
//   getCartTotal()
//   getCartSubtotal()
//   clearCart()
//   isInCart(productId, size)
//   applyDiscount(percent)        — stores discount in session
//   clearDiscount()
//   getDiscount()                 — { code, percent, amount }
//   onCartChange(callback)        — reactive listener
//   renderCartBadge()             — syncs all navbar badges
// ============================================================

// ── Storage Keys ─────────────────────────────────────────────
const CART_KEY     = "alvor_cart";
const DISCOUNT_KEY = "alvor_cart_discount";

// ── Max quantity per line item ────────────────────────────────
const MAX_QTY = 99;
const MIN_QTY = 1;

// ── Internal listeners list ───────────────────────────────────
let _cartListeners = [];

// ============================================================
// READ
// ============================================================

/**
 * Return the full cart array from localStorage.
 * Always returns an array — never null / undefined.
 * @returns {Array<CartItem>}
 */
function getCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * Total number of individual units across all line items.
 * e.g. 2× item A + 3× item B = 5
 * @returns {number}
 */
function getCartCount() {
  return getCart().reduce((sum, item) => sum + (item.quantity || 1), 0);
}

/**
 * Subtotal before any discount.
 * @returns {number}
 */
function getCartSubtotal() {
  return getCart().reduce((sum, item) => {
    return sum + (item.price * (item.quantity || 1));
  }, 0);
}

/**
 * Total after discount.
 * @returns {number}
 */
function getCartTotal() {
  const subtotal = getCartSubtotal();
  const discount = getDiscount();
  if (!discount || !discount.amount) return subtotal;
  return Math.max(0, subtotal - discount.amount);
}

/**
 * Check whether a specific product+size combo is already in the cart.
 * @param {string} productId
 * @param {string} size
 * @returns {boolean}
 */
function isInCart(productId, size = "") {
  return getCart().some(
    item => item.productId === productId && item.size === size
  );
}

// ============================================================
// WRITE
// ============================================================

/**
 * Add a product to the cart.
 * If the same productId + size already exists, quantity is incremented.
 *
 * @param {string} productId
 * @param {string} title
 * @param {number} price           — selling price
 * @param {string} size            — selected size (pass "" if no sizes)
 * @param {number} quantity        — units to add (default 1)
 * @param {string} imageURL
 * @param {number|null} originalPrice — crossed-out price (optional)
 * @returns {{ success: boolean, message: string, cart: Array }}
 */
function addToCart(
  productId,
  title,
  price,
  size       = "",
  quantity   = 1,
  imageURL   = "",
  originalPrice = null
) {
  // ── Validate inputs ───────────────────────────────────────
  if (!productId || typeof productId !== "string") {
    return { success: false, message: "Invalid product ID.", cart: getCart() };
  }
  if (!title || typeof title !== "string") {
    return { success: false, message: "Invalid product title.", cart: getCart() };
  }
  const cleanPrice = parseFloat(price);
  if (isNaN(cleanPrice) || cleanPrice < 0) {
    return { success: false, message: "Invalid price.", cart: getCart() };
  }
  const cleanQty = parseInt(quantity, 10);
  if (isNaN(cleanQty) || cleanQty < MIN_QTY) {
    return { success: false, message: "Quantity must be at least 1.", cart: getCart() };
  }

  const cart     = getCart();
  const existing = cart.find(
    item => item.productId === productId && item.size === size
  );

  if (existing) {
    // Increment — cap at MAX_QTY
    const newQty = Math.min(existing.quantity + cleanQty, MAX_QTY);
    existing.quantity = newQty;
  } else {
    // New line item
    cart.push({
      productId,
      title:         _sanitise(title),
      price:         cleanPrice,
      originalPrice: originalPrice !== null ? parseFloat(originalPrice) || null : null,
      size:          _sanitise(size),
      quantity:      Math.min(cleanQty, MAX_QTY),
      imageURL:      typeof imageURL === "string" ? imageURL : "",
      addedAt:       Date.now()
    });
  }

  _saveCart(cart);
  return { success: true, message: "Added to cart.", cart };
}

/**
 * Remove a line item from the cart entirely.
 * @param {string} productId
 * @param {string} size
 * @returns {{ success: boolean, cart: Array }}
 */
function removeFromCart(productId, size = "") {
  const cart    = getCart();
  const updated = cart.filter(
    item => !(item.productId === productId && item.size === size)
  );

  if (updated.length === cart.length) {
    return { success: false, message: "Item not found in cart.", cart };
  }

  _saveCart(updated);
  return { success: true, message: "Item removed.", cart: updated };
}

/**
 * Set the quantity of a specific line item.
 * Passing 0 or below removes the item.
 * @param {string} productId
 * @param {string} size
 * @param {number} newQty
 * @returns {{ success: boolean, message: string, cart: Array }}
 */
function updateQuantity(productId, size = "", newQty) {
  const cleanQty = parseInt(newQty, 10);

  // Remove if qty ≤ 0
  if (isNaN(cleanQty) || cleanQty <= 0) {
    return removeFromCart(productId, size);
  }

  const cart = getCart();
  const item = cart.find(
    i => i.productId === productId && i.size === size
  );

  if (!item) {
    return { success: false, message: "Item not found in cart.", cart };
  }

  item.quantity = Math.min(cleanQty, MAX_QTY);
  _saveCart(cart);
  return { success: true, message: "Quantity updated.", cart };
}

/**
 * Empty the entire cart.
 * Does NOT clear applied discounts — call clearDiscount() separately.
 */
function clearCart() {
  localStorage.removeItem(CART_KEY);
  _notifyListeners([]);
  renderCartBadge();
}

// ============================================================
// DISCOUNT / COUPON
// ============================================================

/**
 * Store a validated coupon discount for the current session.
 * Call this AFTER validating with validateCoupon() from firebase-config.js.
 * @param {string} code
 * @param {number} percent    — e.g. 10 for 10%
 * @param {number} minOrder   — minimum subtotal required
 */
function applyDiscount(code, percent, minOrder = 0) {
  const subtotal = getCartSubtotal();

  if (subtotal < minOrder) {
    return {
      success: false,
      message: `Minimum order of ₹${minOrder} required for this coupon.`
    };
  }

  const amount = Math.round((subtotal * percent) / 100);
  const discount = {
    code:    _sanitise(code).toUpperCase(),
    percent: parseFloat(percent) || 0,
    minOrder: parseFloat(minOrder) || 0,
    amount
  };

  sessionStorage.setItem(DISCOUNT_KEY, JSON.stringify(discount));
  _notifyListeners(getCart());

  return { success: true, message: `Coupon "${discount.code}" applied! You save ₹${amount}.`, discount };
}

/**
 * Remove applied coupon discount.
 */
function clearDiscount() {
  sessionStorage.removeItem(DISCOUNT_KEY);
  _notifyListeners(getCart());
}

/**
 * Get current discount object or null.
 * @returns {{ code, percent, amount, minOrder } | null}
 */
function getDiscount() {
  try {
    const raw = sessionStorage.getItem(DISCOUNT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

// ============================================================
// REACTIVE LISTENER
// ============================================================

/**
 * Register a callback that fires whenever the cart changes.
 * Fires immediately with the current cart.
 * @param {Function} callback — receives cart array
 * @returns {Function} unsubscribe
 */
function onCartChange(callback) {
  if (typeof callback !== "function") return () => {};
  _cartListeners.push(callback);
  callback(getCart()); // fire immediately
  return () => {
    _cartListeners = _cartListeners.filter(fn => fn !== callback);
  };
}

// ============================================================
// CART BADGE
// ============================================================

/**
 * Update all .navbar__cart-badge elements on the page
 * to reflect the current cart item count.
 */
function renderCartBadge() {
  const count  = getCartCount();
  const badges = document.querySelectorAll(".navbar__cart-badge");

  badges.forEach(badge => {
    badge.textContent = count > 99 ? "99+" : count;
    badge.style.display = count > 0 ? "flex" : "none";
  });
}

// ============================================================
// CART SUMMARY HELPER
// ============================================================

/**
 * Return a plain-text summary of cart items for WhatsApp messages.
 * e.g.:
 *   1× Lotus Embroidery (Medium) — ₹1,200
 *   2× Peacock Frame (Large) — ₹4,800
 * @returns {string}
 */
function getCartSummaryText() {
  const cart = getCart();
  if (!cart.length) return "No items";

  return cart
    .map(item => {
      const sizeStr = item.size ? ` (${item.size})` : "";
      const total   = formatPrice(item.price * item.quantity);
      return `${item.quantity}× ${item.title}${sizeStr} — ${total}`;
    })
    .join("\n");
}

/**
 * Format cart items as an HTML string for order confirmation / checkout UI.
 * Returns a <ul> of line items.
 * @returns {string} HTML string
 */
function getCartItemsHTML() {
  const cart = getCart();
  if (!cart.length) return "<p>No items in cart.</p>";

  const rows = cart.map(item => {
    const sizeStr     = item.size ? `<span class="cart-item__size">${_escapeHtml(item.size)}</span>` : "";
    const lineTotal   = formatPrice(item.price * item.quantity);
    const originalStr = item.originalPrice
      ? `<s class="text-muted">${formatPrice(item.originalPrice)}</s> `
      : "";

    return `
      <li class="cart-summary__item">
        <img src="${_escapeHtml(item.imageURL || "")}"
             alt="${_escapeHtml(item.title)}"
             class="cart-summary__img"
             loading="lazy"
             onerror="this.style.background='var(--color-bg-secondary)';this.src=''">
        <div class="cart-summary__details">
          <span class="cart-summary__title">${_escapeHtml(item.title)}</span>
          ${sizeStr}
          <span class="cart-summary__qty">Qty: ${item.quantity}</span>
        </div>
        <div class="cart-summary__price">
          ${originalStr}${lineTotal}
        </div>
      </li>
    `;
  }).join("");

  return `<ul class="cart-summary__list">${rows}</ul>`;
}

// ============================================================
// PRICE FORMATTER (local — mirrors ui.js formatPrice)
// ============================================================

/**
 * Format a number as Indian Rupees.
 * e.g. 2500 → "₹2,500"
 * @param {number} amount
 * @returns {string}
 */
function formatPrice(amount) {
  if (typeof amount !== "number" || isNaN(amount)) return "₹0";
  return "₹" + amount.toLocaleString("en-IN");
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/** Persist cart array to localStorage and notify listeners. */
function _saveCart(cart) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch (err) {
    console.error("cart._saveCart: localStorage write failed:", err);
  }
  _notifyListeners(cart);
  renderCartBadge();
}

/** Fire all registered cart-change callbacks. */
function _notifyListeners(cart) {
  _cartListeners.forEach(fn => {
    try { fn(cart); } catch (err) { console.warn("onCartChange callback error:", err); }
  });
}

/** Basic HTML escape — keep XSS out of innerHTML renders. */
function _escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#39;");
}

/** Strip dangerous chars before localStorage writes. */
function _sanitise(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[<>]/g, "").trim().slice(0, 500);
}

// ============================================================
// CROSS-TAB SYNC
// Listen for localStorage changes from other browser tabs
// and keep badges in sync.
// ============================================================
window.addEventListener("storage", e => {
  if (e.key === CART_KEY) {
    _notifyListeners(getCart());
    renderCartBadge();
  }
});

// ── Init badge on module load ─────────────────────────────────
// Runs once when this module is first imported by any page.
document.addEventListener("DOMContentLoaded", renderCartBadge);

// ============================================================
// EXPORTS
// ============================================================
export {
  // Read
  getCart,
  getCartCount,
  getCartSubtotal,
  getCartTotal,
  isInCart,

  // Write
  addToCart,
  removeFromCart,
  updateQuantity,
  clearCart,

  // Discount
  applyDiscount,
  clearDiscount,
  getDiscount,

  // Reactive
  onCartChange,

  // UI
  renderCartBadge,

  // Helpers
  getCartSummaryText,
  getCartItemsHTML,
  formatPrice
};
