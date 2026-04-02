// ============================================================
// ALVOR — UI Utilities  (js/ui.js)
// Shared helpers used across every page
// ============================================================
// Exports:
//   showToast(message, type, duration)
//   showLoader() / hideLoader()
//   showModal(modalEl) / hideModal(modalEl)
//   initScrollAnimations()
//   initNavbarScroll()
//   initAnnouncementBar()
//   initMobileNav()
//   initFloatingWhatsApp(number)
//   renderStars(rating, reviewCount)
//   renderSkeletonCards(container, count)
//   renderProductCard(product)
//   formatPrice(amount)
//   formatDate(timestamp)
//   formatPhone(phone)
//   truncate(str, maxLen)
//   debounce(fn, delay)
//   throttle(fn, delay)
//   getParam(key)
//   setParam(key, value)
//   scrollToEl(selector, offset)
//   copyToClipboard(text)
//   getWishlist() / toggleWishlist(productId) / isWishlisted(productId)
//   getRecentlyViewed() / addToRecentlyViewed(product)
//   initPageTransition()
//   setActiveNavLink()
// ============================================================

import { getSettings } from "./firebase-config.js";

// ── Constants ────────────────────────────────────────────────
const WISHLIST_KEY       = "alvor_wishlist";
const RECENTLY_VIEWED_KEY= "alvor_recently_viewed";
const RECENTLY_VIEWED_MAX= 8;
const ANNOUNCEMENT_KEY   = "alvor_announcement_dismissed";

// ── Cached DOM refs (populated on first use) ─────────────────
let _toastContainer = null;
let _pageLoader     = null;

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

/**
 * Show a toast notification
 * @param {string} message  — text to display
 * @param {'success'|'error'|'info'} type
 * @param {number} duration — ms before auto-dismiss (0 = manual only)
 */
function showToast(message, type = "info", duration = 3500) {
  _ensureToastContainer();

  const icons = {
    success: "fa-circle-check",
    error:   "fa-circle-xmark",
    info:    "fa-circle-info"
  };

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.setAttribute("role", "alert");
  toast.innerHTML = `
    <i class="toast__icon fa-solid ${icons[type] || icons.info}"></i>
    <span class="toast__message">${_escapeHtml(message)}</span>
    <button class="toast__close" aria-label="Dismiss">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;

  const closeBtn = toast.querySelector(".toast__close");
  closeBtn.addEventListener("click", () => _dismissToast(toast));

  _toastContainer.appendChild(toast);

  // Auto-dismiss
  if (duration > 0) {
    setTimeout(() => _dismissToast(toast), duration);
  }

  return toast;
}

function _dismissToast(toast) {
  if (!toast || !toast.parentNode) return;
  toast.classList.add("removing");
  toast.addEventListener("animationend", () => toast.remove(), { once: true });
  // Fallback in case animationend doesn't fire
  setTimeout(() => toast.remove(), 400);
}

function _ensureToastContainer() {
  if (_toastContainer && document.body.contains(_toastContainer)) return;
  _toastContainer = document.querySelector(".toast-container");
  if (!_toastContainer) {
    _toastContainer = document.createElement("div");
    _toastContainer.className = "toast-container";
    _toastContainer.setAttribute("aria-live", "polite");
    document.body.appendChild(_toastContainer);
  }
}

// ============================================================
// PAGE LOADER
// ============================================================

function showLoader() {
  _ensureLoader();
  _pageLoader.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function hideLoader() {
  if (!_pageLoader) return;
  _pageLoader.classList.add("hidden");
  document.body.style.overflow = "";
  // Remove from DOM after transition
  setTimeout(() => {
    if (_pageLoader && _pageLoader.classList.contains("hidden")) {
      _pageLoader.remove();
      _pageLoader = null;
    }
  }, 500);
}

function _ensureLoader() {
  if (_pageLoader && document.body.contains(_pageLoader)) return;
  _pageLoader = document.querySelector(".page-loader");
  if (!_pageLoader) {
    _pageLoader = document.createElement("div");
    _pageLoader.className = "page-loader";
    _pageLoader.innerHTML = `
      <div class="page-loader__spinner"></div>
      <span class="page-loader__text">ALVOR</span>
    `;
    document.body.appendChild(_pageLoader);
  }
}

// ============================================================
// MODAL HELPERS
// ============================================================

/**
 * Open a modal overlay
 * @param {HTMLElement} modalOverlayEl — element with class .modal-overlay
 */
function showModal(modalOverlayEl) {
  if (!modalOverlayEl) return;
  modalOverlayEl.classList.add("open");
  document.body.style.overflow = "hidden";

  // Close on backdrop click
  modalOverlayEl.addEventListener("click", e => {
    if (e.target === modalOverlayEl) hideModal(modalOverlayEl);
  }, { once: true });

  // Close on Escape
  const onEsc = e => {
    if (e.key === "Escape") { hideModal(modalOverlayEl); document.removeEventListener("keydown", onEsc); }
  };
  document.addEventListener("keydown", onEsc);

  // Wire up inner close buttons
  modalOverlayEl.querySelectorAll(".modal__close, [data-modal-close]").forEach(btn => {
    btn.addEventListener("click", () => hideModal(modalOverlayEl), { once: true });
  });
}

function hideModal(modalOverlayEl) {
  if (!modalOverlayEl) return;
  modalOverlayEl.classList.remove("open");
  document.body.style.overflow = "";
}

// ============================================================
// SCROLL ANIMATIONS  (Intersection Observer)
// ============================================================

/**
 * Observe all [.fade-up, .fade-in, .scale-in] elements and
 * add .visible when they enter the viewport.
 */
function initScrollAnimations() {
  const targets = document.querySelectorAll(".fade-up, .fade-in, .scale-in");
  if (!targets.length) return;

  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target); // animate once
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );

  targets.forEach(el => observer.observe(el));
}

// ============================================================
// NAVBAR SCROLL BEHAVIOUR
// ============================================================

/**
 * Switches navbar between --transparent and --solid states.
 * Call once per page. Pass isHeroPage=true for pages with
 * a full-bleed hero where navbar should start transparent.
 * @param {boolean} isHeroPage
 */
function initNavbarScroll(isHeroPage = false) {
  const navbar = document.querySelector(".navbar");
  if (!navbar) return;

  const SCROLL_THRESHOLD = 80;

  function update() {
    const scrolled = window.scrollY > SCROLL_THRESHOLD;
    if (isHeroPage) {
      navbar.classList.toggle("navbar--transparent", !scrolled);
      navbar.classList.toggle("navbar--solid", scrolled);
    } else {
      navbar.classList.remove("navbar--transparent");
      navbar.classList.add("navbar--solid");
    }
  }

  update(); // run immediately
  window.addEventListener("scroll", throttle(update, 80), { passive: true });
}

// ============================================================
// ANNOUNCEMENT BAR
// ============================================================

async function initAnnouncementBar() {
  const bar = document.querySelector(".announcement-bar");
  if (!bar) return;

  // Check if already dismissed this session
  const dismissed = sessionStorage.getItem(ANNOUNCEMENT_KEY);
  if (dismissed) {
    bar.classList.add("dismissed");
    document.body.classList.remove("has-announcement");
    _syncNavbarTop(false);
    return;
  }

  // Load text from Firestore
  try {
    const settings = await getSettings();
    if (!settings.announcementActive) {
      bar.classList.add("dismissed");
      document.body.classList.remove("has-announcement");
      _syncNavbarTop(false);
      return;
    }
    const textEl = bar.querySelector(".announcement-bar__text");
    if (textEl && settings.announcementBar) {
      textEl.textContent = settings.announcementBar;
    }
  } catch (_) {
    // leave default HTML text
  }

  document.body.classList.add("has-announcement");
  _syncNavbarTop(true);

  // Dismiss button
  const closeBtn = bar.querySelector(".announcement-bar__close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      bar.classList.add("dismissed");
      sessionStorage.setItem(ANNOUNCEMENT_KEY, "1");
      document.body.classList.remove("has-announcement");
      _syncNavbarTop(false);
    });
  }
}

function _syncNavbarTop(hasAnnouncement) {
  const navbar = document.querySelector(".navbar");
  if (!navbar) return;
  const announcementHeight = hasAnnouncement
    ? parseInt(getComputedStyle(document.documentElement)
        .getPropertyValue("--announcement-height")) || 44
    : 0;
  navbar.style.top = `${announcementHeight}px`;
}

// ============================================================
// MOBILE NAV DRAWER
// ============================================================

function initMobileNav() {
  const hamburger  = document.querySelector(".navbar__hamburger");
  const drawer     = document.querySelector(".nav-drawer");
  const overlay    = document.querySelector(".nav-overlay");
  const closeBtn   = document.querySelector(".nav-drawer__close");

  if (!hamburger || !drawer) return;

  function openDrawer() {
    drawer.classList.add("open");
    overlay?.classList.add("open");
    document.body.style.overflow = "hidden";
    hamburger.setAttribute("aria-expanded", "true");
    // Trap focus inside drawer
    setTimeout(() => closeBtn?.focus(), 100);
  }

  function closeDrawer() {
    drawer.classList.remove("open");
    overlay?.classList.remove("open");
    document.body.style.overflow = "";
    hamburger.setAttribute("aria-expanded", "false");
    hamburger.focus();
  }

  hamburger.addEventListener("click", openDrawer);
  closeBtn?.addEventListener("click", closeDrawer);
  overlay?.addEventListener("click", closeDrawer);

  // Escape key
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && drawer.classList.contains("open")) closeDrawer();
  });

  // Close drawer on nav link click (SPA feel)
  drawer.querySelectorAll(".nav-drawer__link").forEach(link => {
    link.addEventListener("click", closeDrawer);
  });
}

// ============================================================
// FLOATING WHATSAPP BUTTON
// ============================================================

/**
 * Inject the floating WhatsApp button if not already in HTML.
 * @param {string} number — e.g. "919876543210"
 * @param {string} defaultMsg
 */
function initFloatingWhatsApp(number, defaultMsg = "Hi ALVOR! I'd like to know more about your products.") {
  // Don't double-inject
  if (document.querySelector(".whatsapp-float")) return;

  const encoded = encodeURIComponent(defaultMsg);
  const btn = document.createElement("a");
  btn.className = "whatsapp-float";
  btn.href = `https://wa.me/${number}?text=${encoded}`;
  btn.target = "_blank";
  btn.rel = "noopener noreferrer";
  btn.setAttribute("aria-label", "Chat on WhatsApp");
  btn.innerHTML = `<i class="fa-brands fa-whatsapp"></i>`;
  document.body.appendChild(btn);
}

// ============================================================
// ACTIVE NAV LINK HIGHLIGHTING
// ============================================================

function setActiveNavLink() {
  const currentPath = window.location.pathname.split("/").pop() || "index.html";

  // Desktop nav
  document.querySelectorAll(".navbar__nav-link").forEach(link => {
    const href = link.getAttribute("href")?.split("/").pop() || "";
    if (href === currentPath || (currentPath === "" && href === "index.html")) {
      link.classList.add("active");
    }
  });

  // Mobile drawer
  document.querySelectorAll(".nav-drawer__link").forEach(link => {
    const href = link.getAttribute("href")?.split("/").pop() || "";
    if (href === currentPath || (currentPath === "" && href === "index.html")) {
      link.classList.add("active");
    }
  });
}

// ============================================================
// PAGE TRANSITION
// ============================================================

function initPageTransition() {
  // Fade in current page
  document.body.classList.add("page-transition");

  // Fade out before navigating away
  document.querySelectorAll("a[href]").forEach(link => {
    const href = link.getAttribute("href");
    // Only internal same-origin links, not anchors or external
    if (!href || href.startsWith("#") || href.startsWith("http") ||
        href.startsWith("mailto") || href.startsWith("tel") ||
        href.startsWith("wa.me") || link.target === "_blank") return;

    link.addEventListener("click", e => {
      e.preventDefault();
      document.body.style.opacity = "0";
      document.body.style.transition = "opacity 0.2s ease";
      setTimeout(() => { window.location.href = href; }, 200);
    });
  });
}

// ============================================================
// RENDERING HELPERS
// ============================================================

/**
 * Render star icons based on a rating (0–5)
 * @param {number} rating
 * @param {number} reviewCount — optional
 * @returns {string} HTML string
 */
function renderStars(rating = 0, reviewCount = null) {
  const fullStars  = Math.floor(rating);
  const halfStar   = rating % 1 >= 0.5;
  const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);

  let html = `<div class="stars" aria-label="Rating: ${rating} out of 5">`;

  for (let i = 0; i < fullStars;  i++) html += `<i class="fa-solid fa-star"></i>`;
  if (halfStar)                        html += `<i class="fa-solid fa-star-half-stroke"></i>`;
  for (let i = 0; i < emptyStars; i++) html += `<i class="fa-regular fa-star"></i>`;

  html += `</div>`;

  if (reviewCount !== null) {
    html += `<span class="stars__count">(${reviewCount})</span>`;
  }

  return html;
}

/**
 * Render N skeleton product cards into a container
 * @param {HTMLElement} container
 * @param {number}      count
 */
function renderSkeletonCards(container, count = 4) {
  if (!container) return;
  container.innerHTML = Array.from({ length: count }, () => `
    <div class="skeleton-card">
      <div class="skeleton skeleton-img"></div>
      <div class="skeleton-text">
        <div class="skeleton skeleton-line w-60"></div>
        <div class="skeleton skeleton-line w-80"></div>
        <div class="skeleton skeleton-line w-40"></div>
        <div class="skeleton skeleton-line w-full" style="height:36px;border-radius:8px;margin-top:8px;"></div>
      </div>
    </div>
  `).join("");
}

/**
 * Build a product card HTML string
 * @param {Object} product — Firestore product document
 * @returns {string} HTML
 */
function renderProductCard(product) {
  const {
    id, title, category, price, originalPrice,
    mainImage, images, tags = [], rating = 0, reviewCount = 0
  } = product;

  const imgSrc    = mainImage || (images && images[0]) || "";
  const discounted= originalPrice && originalPrice > price;
  const isNew     = tags.includes("new");
  const isBest    = tags.includes("bestseller");
  const wishlisted= isWishlisted(id);

  const badge = isNew
    ? `<span class="product-card__badge badge--new">New</span>`
    : isBest
    ? `<span class="product-card__badge badge--bestseller">Bestseller</span>`
    : "";

  const priceHtml = discounted
    ? `<span class="price-current">${formatPrice(price)}</span>
       <span class="price-original">${formatPrice(originalPrice)}</span>`
    : `<span class="price-current">${formatPrice(price)}</span>`;

  const imgHtml = imgSrc
    ? `<img class="product-card__img" src="${imgSrc}" alt="${_escapeHtml(title)}" loading="lazy">`
    : `<div class="product-card__img-placeholder"><i class="fa-solid fa-image"></i></div>`;

  return `
    <article class="product-card fade-up" data-product-id="${id}">
      <a href="product.html?id=${id}" class="product-card__img-wrap" aria-label="${_escapeHtml(title)}">
        ${imgHtml}
        ${badge}
        <button class="product-card__wishlist ${wishlisted ? "active" : ""}"
                aria-label="${wishlisted ? "Remove from wishlist" : "Add to wishlist"}"
                data-wishlist="${id}"
                onclick="event.preventDefault(); event.stopPropagation();">
          <i class="${wishlisted ? "fa-solid" : "fa-regular"} fa-heart"></i>
        </button>
      </a>
      <div class="product-card__body">
        <span class="product-card__category">${_escapeHtml(category || "")}</span>
        <a href="product.html?id=${id}">
          <h3 class="product-card__title">${_escapeHtml(title)}</h3>
        </a>
        <div class="product-card__stars">
          ${renderStars(rating, reviewCount > 0 ? reviewCount : null)}
        </div>
        <div class="product-card__price">${priceHtml}</div>
        <button class="product-card__add-btn"
                data-add-to-cart="${id}"
                data-product='${JSON.stringify({
                  id, title, price,
                  image: imgSrc,
                  category
                }).replace(/'/g, "&#39;")}'>
          <i class="fa-solid fa-bag-shopping"></i> Add to Cart
        </button>
      </div>
    </article>
  `;
}

// ============================================================
// FORMATTING HELPERS
// ============================================================

/**
 * Format a number as Indian Rupees
 * @param {number} amount
 * @returns {string} e.g. "₹2,500"
 */
function formatPrice(amount) {
  if (amount === undefined || amount === null) return "₹0";
  return "₹" + Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
}

/**
 * Format a Firestore Timestamp or Date object
 * @param {Object|Date} timestamp
 * @returns {string} e.g. "29 Mar 2026"
 */
function formatDate(timestamp) {
  if (!timestamp) return "—";
  let date;
  if (timestamp.toDate) {
    date = timestamp.toDate(); // Firestore Timestamp
  } else if (timestamp instanceof Date) {
    date = timestamp;
  } else if (typeof timestamp === "number") {
    date = new Date(timestamp);
  } else {
    return "—";
  }
  return date.toLocaleDateString("en-IN", {
    day:   "2-digit",
    month: "short",
    year:  "numeric"
  });
}

/**
 * Format a phone number for display
 * @param {string} phone — "919876543210"
 * @returns {string} "+91 98765 43210"
 */
function formatPhone(phone) {
  if (!phone) return "";
  const str = phone.replace(/\D/g, "");
  if (str.length === 12 && str.startsWith("91")) {
    const local = str.slice(2);
    return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
  }
  if (str.length === 10) {
    return `+91 ${str.slice(0, 5)} ${str.slice(5)}`;
  }
  return phone;
}

/**
 * Truncate a string to maxLen characters
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen = 100) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen).trimEnd() + "…";
}

// ============================================================
// FUNCTION UTILITIES
// ============================================================

/**
 * Debounce — delays fn execution until after delay ms of inactivity
 */
function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Throttle — calls fn at most once per delay ms
 */
function throttle(fn, delay = 200) {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn.apply(this, args);
    }
  };
}

// ============================================================
// URL PARAM HELPERS
// ============================================================

/**
 * Get a URL search parameter
 * @param {string} key
 * @returns {string|null}
 */
function getParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}

/**
 * Update a URL param without page reload
 * @param {string} key
 * @param {string} value — pass null to remove
 */
function setParam(key, value) {
  const params = new URLSearchParams(window.location.search);
  if (value === null || value === "") {
    params.delete(key);
  } else {
    params.set(key, value);
  }
  const newUrl = `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`;
  window.history.replaceState({}, "", newUrl);
}

// ============================================================
// SCROLL TO ELEMENT
// ============================================================

/**
 * Smooth scroll to a CSS selector, with optional offset
 * @param {string} selector
 * @param {number} offset — pixels to subtract (e.g. navbar height)
 */
function scrollToEl(selector, offset = 80) {
  const el = document.querySelector(selector);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top, behavior: "smooth" });
}

// ============================================================
// CLIPBOARD
// ============================================================

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied to clipboard!", "success", 2000);
    return true;
  } catch {
    // Fallback for older browsers
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    showToast("Copied!", "success", 2000);
    return true;
  }
}

// ============================================================
// WISHLIST  (localStorage)
// ============================================================

function getWishlist() {
  try {
    return JSON.parse(localStorage.getItem(WISHLIST_KEY)) || [];
  } catch {
    return [];
  }
}

function isWishlisted(productId) {
  return getWishlist().includes(productId);
}

/**
 * Toggle wishlist and return new state
 * @param {string} productId
 * @returns {boolean} true if now wishlisted
 */
function toggleWishlist(productId) {
  const list = getWishlist();
  const idx  = list.indexOf(productId);
  if (idx === -1) {
    list.push(productId);
    showToast("Added to wishlist ♥", "success", 2000);
  } else {
    list.splice(idx, 1);
    showToast("Removed from wishlist", "info", 2000);
  }
  localStorage.setItem(WISHLIST_KEY, JSON.stringify(list));

  // Update all wishlist buttons for this product
  document.querySelectorAll(`[data-wishlist="${productId}"]`).forEach(btn => {
    const icon = btn.querySelector("i");
    const nowActive = list.includes(productId);
    btn.classList.toggle("active", nowActive);
    btn.setAttribute("aria-label", nowActive ? "Remove from wishlist" : "Add to wishlist");
    if (icon) {
      icon.className = nowActive ? "fa-solid fa-heart" : "fa-regular fa-heart";
    }
  });

  return list.includes(productId);
}

// ============================================================
// RECENTLY VIEWED  (localStorage)
// ============================================================

function getRecentlyViewed() {
  try {
    return JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY)) || [];
  } catch {
    return [];
  }
}

/**
 * Add a product to recently-viewed (deduplicates, trims to max)
 * @param {Object} product — must have id, title, price, mainImage, category
 */
function addToRecentlyViewed(product) {
  if (!product?.id) return;
  let list = getRecentlyViewed();
  // Remove existing entry for this product
  list = list.filter(p => p.id !== product.id);
  // Add to front
  list.unshift({
    id:       product.id,
    title:    product.title,
    price:    product.price,
    mainImage:product.mainImage || (product.images && product.images[0]) || "",
    category: product.category
  });
  // Trim
  list = list.slice(0, RECENTLY_VIEWED_MAX);
  localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(list));
}

// ============================================================
// WISHLIST BUTTON DELEGATION
// Attach a single delegated listener to handle all [data-wishlist]
// buttons across dynamically rendered content.
// Call once on DOMContentLoaded.
// ============================================================

function initWishlistDelegation() {
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-wishlist]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const productId = btn.dataset.wishlist;
    if (productId) toggleWishlist(productId);
  });
}

// ============================================================
// CART BADGE UPDATER  (called by cart.js; defined here so
// ui.js can also call it without circular imports)
// ============================================================

function updateCartBadge(count) {
  document.querySelectorAll(".navbar__cart-badge").forEach(badge => {
    badge.textContent = count > 0 ? (count > 99 ? "99+" : count) : "";
    badge.style.display = count > 0 ? "flex" : "none";

    // Bump animation
    badge.classList.remove("bump");
    void badge.offsetWidth; // reflow
    badge.classList.add("bump");
    setTimeout(() => badge.classList.remove("bump"), 400);
  });
}

// ============================================================
// CONFIRMATION DIALOG  (lightweight — no library needed)
// ============================================================

/**
 * Show a simple in-page confirm dialog
 * @param {string}   message
 * @param {string}   confirmText
 * @param {'danger'|'primary'} confirmStyle
 * @returns {Promise<boolean>}
 */
function confirmDialog(message, confirmText = "Confirm", confirmStyle = "danger") {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay open";
    overlay.style.zIndex = "700";
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px;">
        <div class="modal__body" style="text-align:center;padding:2rem;">
          <div style="font-size:2.5rem;color:var(--color-${confirmStyle === "danger" ? "error" : "primary"});margin-bottom:1rem;">
            <i class="fa-solid fa-${confirmStyle === "danger" ? "triangle-exclamation" : "circle-question"}"></i>
          </div>
          <p style="font-size:1rem;color:var(--color-text);line-height:1.7;margin-bottom:1.5rem;">
            ${_escapeHtml(message)}
          </p>
          <div style="display:flex;gap:0.75rem;justify-content:center;">
            <button class="btn btn-ghost btn-sm" id="confirm-cancel">Cancel</button>
            <button class="btn btn-sm ${confirmStyle === "danger" ? "" : "btn-primary"}"
                    id="confirm-ok"
                    style="${confirmStyle === "danger" ? "background:var(--color-error);color:#fff;border-color:var(--color-error);" : ""}">
              ${_escapeHtml(confirmText)}
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector("#confirm-cancel").addEventListener("click", () => {
      overlay.remove();
      resolve(false);
    });
    overlay.querySelector("#confirm-ok").addEventListener("click", () => {
      overlay.remove();
      resolve(true);
    });
    overlay.addEventListener("click", e => {
      if (e.target === overlay) { overlay.remove(); resolve(false); }
    });
  });
}

// ============================================================
// TABS
// ============================================================

/**
 * Initialise a tab group
 * HTML structure expected:
 *   <div class="tabs">
 *     <button class="tab-btn active" data-tab="desc">Description</button>
 *     ...
 *   </div>
 *   <div class="tab-panel active" id="tab-desc">...</div>
 *   ...
 * @param {HTMLElement} container — wrapping element containing both .tabs and .tab-panel elements
 */
function initTabs(container) {
  if (!container) return;
  const buttons = container.querySelectorAll(".tab-btn");
  const panels  = container.querySelectorAll(".tab-panel");

  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;

      buttons.forEach(b => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });

      panels.forEach(panel => {
        const active = panel.id === `tab-${target}`;
        panel.classList.toggle("active", active);
        panel.hidden = !active;
      });
    });
  });
}

// ============================================================
// HORIZONTAL SCROLL (for carousels on mobile)
// ============================================================

/**
 * Add mouse-drag horizontal scroll to an element
 * @param {HTMLElement} el
 */
function initDragScroll(el) {
  if (!el) return;
  let isDown = false, startX, scrollLeft;

  el.addEventListener("mousedown", e => {
    isDown = true;
    el.style.cursor = "grabbing";
    startX     = e.pageX - el.offsetLeft;
    scrollLeft = el.scrollLeft;
  });

  el.addEventListener("mouseleave",  () => { isDown = false; el.style.cursor = "grab"; });
  el.addEventListener("mouseup",     () => { isDown = false; el.style.cursor = "grab"; });
  el.addEventListener("mousemove",   e  => {
    if (!isDown) return;
    e.preventDefault();
    const x    = e.pageX - el.offsetLeft;
    const walk = (x - startX) * 1.5;
    el.scrollLeft = scrollLeft - walk;
  });

  el.style.cursor = "grab";
}

// ============================================================
// NAVBAR HTML BUILDER
// Injects the standard navbar + drawer into the page.
// Call once from each HTML page — or embed HTML directly.
// ============================================================

/**
 * Build and inject the full navbar + drawer HTML.
 * @param {string} whatsappNumber — digits only, e.g. "919876543210"
 */
function buildNavbar(whatsappNumber = "919876543210") {
  const navbarHTML = `
    <!-- Announcement Bar -->
    <div class="announcement-bar" role="banner" aria-label="Announcement">
      <span class="announcement-bar__text">
        ✨ Free delivery across Andhra Pradesh on all orders!
      </span>
      <button class="announcement-bar__close" aria-label="Dismiss announcement">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>

    <!-- Navbar -->
    <nav class="navbar navbar--transparent" role="navigation" aria-label="Main navigation">
      <div class="navbar__inner">

        <!-- Logo -->
        <a href="index.html" class="navbar__logo" aria-label="ALVOR Home">
          <svg class="navbar__logo-svg" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="20" cy="20" r="19" stroke="#C9A84C" stroke-width="1.5"/>
            <!-- 8-point star / compass -->
            <path d="M20 4 L21.8 18.2 L36 20 L21.8 21.8 L20 36 L18.2 21.8 L4 20 L18.2 18.2 Z"
                  fill="#C9A84C" opacity="0.9"/>
            <path d="M20 10 L20.9 19.1 L30 20 L20.9 20.9 L20 30 L19.1 20.9 L10 20 L19.1 19.1 Z"
                  fill="#1A1A1A"/>
            <circle cx="20" cy="20" r="2.5" fill="#C9A84C"/>
          </svg>
          <span class="navbar__logo-text">ALVOR</span>
        </a>

        <!-- Desktop Nav -->
        <ul class="navbar__nav" role="list">
          <li><a href="index.html"    class="navbar__nav-link">Home</a></li>
          <li><a href="shop.html"     class="navbar__nav-link">Shop</a></li>
          <li><a href="services.html" class="navbar__nav-link">Services</a></li>
          <li><a href="about.html"    class="navbar__nav-link">About</a></li>
          <li><a href="contact.html"  class="navbar__nav-link">Contact</a></li>
        </ul>

        <!-- Right Actions -->
        <div class="navbar__actions">
          <button class="navbar__icon-btn" aria-label="Search" id="nav-search-btn">
            <i class="fa-solid fa-magnifying-glass"></i>
          </button>
          <a href="account.html" class="navbar__icon-btn" aria-label="Account">
            <i class="fa-regular fa-user"></i>
          </a>
          <a href="cart.html" class="navbar__icon-btn" aria-label="Cart">
            <i class="fa-solid fa-bag-shopping"></i>
            <span class="navbar__cart-badge" aria-live="polite" style="display:none;">0</span>
          </a>
          <a href="https://wa.me/${whatsappNumber}" target="_blank" rel="noopener"
             class="navbar__cta" aria-label="Order on WhatsApp">
            <i class="fa-brands fa-whatsapp"></i> Order Now
          </a>
          <button class="navbar__hamburger" aria-label="Open menu" aria-expanded="false">
            <i class="fa-solid fa-bars"></i>
          </button>
        </div>
      </div>
    </nav>

    <!-- Mobile Nav Overlay -->
    <div class="nav-overlay" aria-hidden="true"></div>

    <!-- Mobile Nav Drawer -->
    <aside class="nav-drawer" aria-label="Mobile navigation" role="dialog" aria-modal="true">
      <div class="nav-drawer__header">
        <a href="index.html" class="navbar__logo">
          <svg width="32" height="32" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="20" cy="20" r="19" stroke="#C9A84C" stroke-width="1.5"/>
            <path d="M20 4 L21.8 18.2 L36 20 L21.8 21.8 L20 36 L18.2 21.8 L4 20 L18.2 18.2 Z" fill="#C9A84C" opacity="0.9"/>
            <path d="M20 10 L20.9 19.1 L30 20 L20.9 20.9 L20 30 L19.1 20.9 L10 20 L19.1 19.1 Z" fill="#1A1A1A"/>
            <circle cx="20" cy="20" r="2.5" fill="#C9A84C"/>
          </svg>
          <span class="navbar__logo-text">ALVOR</span>
        </a>
        <button class="nav-drawer__close" aria-label="Close menu">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <nav class="nav-drawer__links">
        <a href="index.html"    class="nav-drawer__link"><i class="fa-solid fa-house"></i>     Home</a>
        <a href="shop.html"     class="nav-drawer__link"><i class="fa-solid fa-store"></i>     Shop</a>
        <a href="services.html" class="nav-drawer__link"><i class="fa-solid fa-paintbrush"></i>Services</a>
        <a href="about.html"    class="nav-drawer__link"><i class="fa-solid fa-circle-info"></i>About</a>
        <a href="contact.html"  class="nav-drawer__link"><i class="fa-solid fa-envelope"></i>  Contact</a>
        <div class="nav-drawer__divider"></div>
        <a href="account.html"  class="nav-drawer__link"><i class="fa-regular fa-user"></i>    My Account</a>
        <a href="cart.html"     class="nav-drawer__link"><i class="fa-solid fa-bag-shopping"></i>Cart
          <span class="navbar__cart-badge" style="position:static;display:none;margin-left:auto;box-shadow:none;"></span>
        </a>
        <a href="admin.html"    class="nav-drawer__link"><i class="fa-solid fa-shield"></i>    Admin</a>
      </nav>

      <div class="nav-drawer__footer">
        <a href="https://wa.me/${whatsappNumber}" target="_blank" rel="noopener"
           class="nav-drawer__whatsapp">
          <i class="fa-brands fa-whatsapp"></i> Order on WhatsApp
        </a>
      </div>
    </aside>
  `;

  // Inject before first child of body
  document.body.insertAdjacentHTML("afterbegin", navbarHTML);
}

/**
 * Build and inject the site footer HTML.
 * @param {string} whatsappNumber
 * @param {string} instagramHandle
 */
function buildFooter(whatsappNumber = "919876543210", instagramHandle = "alvor_emb") {
  const year = new Date().getFullYear();
  const footerHTML = `
    <footer class="footer" role="contentinfo">
      <div class="container">
        <div class="footer__top">

          <!-- Brand column -->
          <div>
            <div class="footer__brand-logo">
              <svg width="36" height="36" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="20" cy="20" r="19" stroke="#C9A84C" stroke-width="1.5"/>
                <path d="M20 4 L21.8 18.2 L36 20 L21.8 21.8 L20 36 L18.2 21.8 L4 20 L18.2 18.2 Z" fill="#C9A84C" opacity="0.9"/>
                <path d="M20 10 L20.9 19.1 L30 20 L20.9 20.9 L20 30 L19.1 20.9 L10 20 L19.1 19.1 Z" fill="rgba(255,255,255,0.15)"/>
                <circle cx="20" cy="20" r="2.5" fill="#C9A84C"/>
              </svg>
              <span class="logo-text">ALVOR</span>
            </div>
            <p class="footer__tagline">"Where Thread Meets Tradition"</p>
            <p class="footer__description">
              Premium handcrafted embroidery art &amp; interior decoration from the heart of Andhra Pradesh.
              Every piece is made with love, thread by thread.
            </p>
            <div class="footer__social">
              <a href="https://instagram.com/${instagramHandle}" target="_blank" rel="noopener"
                 class="footer__social-btn" aria-label="Instagram">
                <i class="fa-brands fa-instagram"></i>
              </a>
              <a href="https://wa.me/${whatsappNumber}" target="_blank" rel="noopener"
                 class="footer__social-btn" aria-label="WhatsApp">
                <i class="fa-brands fa-whatsapp"></i>
              </a>
            </div>
          </div>

          <!-- Quick Links -->
          <div>
            <h3 class="footer__col-title">Quick Links</h3>
            <ul class="footer__links">
              <li><a href="shop.html"     class="footer__link">Shop All</a></li>
              <li><a href="about.html"    class="footer__link">About Us</a></li>
              <li><a href="services.html" class="footer__link">Shop Decoration</a></li>
              <li><a href="contact.html"  class="footer__link">Contact</a></li>
              <li><a href="admin.html"    class="footer__link">Admin Panel</a></li>
            </ul>
          </div>

          <!-- Categories -->
          <div>
            <h3 class="footer__col-title">Categories</h3>
            <ul class="footer__links">
              <li><a href="shop.html?category=Embroidery+Art"  class="footer__link">Embroidery Art</a></li>
              <li><a href="shop.html?category=Framed+Pieces"   class="footer__link">Framed Pieces</a></li>
              <li><a href="shop.html?category=Shop+Decor"      class="footer__link">Shop Decor</a></li>
              <li><a href="services.html"                       class="footer__link">Custom Orders</a></li>
            </ul>
          </div>

          <!-- Contact -->
          <div>
            <h3 class="footer__col-title">Contact Us</h3>
            <div class="footer__contact-item">
              <i class="fa-brands fa-whatsapp"></i>
              <span>+91 XXXXX XXXXX</span>
            </div>
            <div class="footer__contact-item">
              <i class="fa-brands fa-instagram"></i>
              <span>@${instagramHandle}</span>
            </div>
            <div class="footer__contact-item">
              <i class="fa-solid fa-location-dot"></i>
              <span>Andhra Pradesh, India</span>
            </div>
            <div class="footer__contact-item">
              <i class="fa-regular fa-clock"></i>
              <span>Reply within 2–3 hours on WhatsApp</span>
            </div>
            <a href="https://wa.me/${whatsappNumber}" target="_blank" rel="noopener"
               class="footer__whatsapp-btn">
              <i class="fa-brands fa-whatsapp"></i> Chat on WhatsApp
            </a>
          </div>
        </div>

        <div class="footer__bottom">
          <p class="footer__copyright">
            &copy; ${year} ALVOR. All rights reserved. Made with ♥ in Andhra Pradesh.
          </p>
          <div class="footer__delivery-note">
            <i class="fa-solid fa-truck"></i>
            Currently delivering across Andhra Pradesh
          </div>
        </div>
      </div>
    </footer>
  `;

  document.body.insertAdjacentHTML("beforeend", footerHTML);
}

// ============================================================
// SECURITY — HTML escaping
// ============================================================

function _escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#39;");
}

// ============================================================
// GLOBAL INITIALISER
// Call initUI() from each page's DOMContentLoaded handler.
// ============================================================

/**
 * One-shot init that every page calls.
 * @param {Object} opts
 * @param {boolean} opts.isHeroPage      — true for index.html
 * @param {string}  opts.whatsappNumber
 * @param {string}  opts.instagramHandle
 * @param {boolean} opts.injectNavbar    — set false if HTML navbar is already in the page
 * @param {boolean} opts.injectFooter    — set false if HTML footer is already in the page
 */
async function initUI({
  isHeroPage       = false,
  whatsappNumber   = "919876543210",
  instagramHandle  = "alvor_emb",
  injectNavbar     = true,
  injectFooter     = true
} = {}) {
  // Inject structural HTML if needed
  if (injectNavbar) buildNavbar(whatsappNumber);
  if (injectFooter) buildFooter(whatsappNumber, instagramHandle);

  // Core inits
  initNavbarScroll(isHeroPage);
  await initAnnouncementBar();
  initMobileNav();
  setActiveNavLink();
  initScrollAnimations();
  initWishlistDelegation();
  initPageTransition();
  initFloatingWhatsApp(whatsappNumber);

  // Update cart badge from localStorage
  try {
    const cart = JSON.parse(localStorage.getItem("alvor_cart")) || [];
    const count = cart.reduce((sum, item) => sum + (item.quantity || 1), 0);
    updateCartBadge(count);
  } catch (_) {}
}

// ============================================================
// EXPORTS
// ============================================================
export {
  // Core UI
  showToast,
  showLoader,
  hideLoader,
  showModal,
  hideModal,
  confirmDialog,

  // Init helpers
  initUI,
  initScrollAnimations,
  initNavbarScroll,
  initAnnouncementBar,
  initMobileNav,
  initFloatingWhatsApp,
  initTabs,
  initDragScroll,
  initPageTransition,
  initWishlistDelegation,
  setActiveNavLink,
  buildNavbar,
  buildFooter,

  // Rendering
  renderStars,
  renderSkeletonCards,
  renderProductCard,
  updateCartBadge,

  // Formatting
  formatPrice,
  formatDate,
  formatPhone,
  truncate,

  // Utilities
  debounce,
  throttle,
  getParam,
  setParam,
  scrollToEl,
  copyToClipboard,

  // Wishlist
  getWishlist,
  toggleWishlist,
  isWishlisted,

  // Recently viewed
  getRecentlyViewed,
  addToRecentlyViewed,

  // Internal (exported for testing / override)
  _escapeHtml
};
