// ============================================================
// ALVOR — Product Detail Page  (js/product.js)
// "Where Thread Meets Tradition"
// ============================================================
// Handles all logic for product.html:
//   • Load product from Firestore via ?id= URL param
//   • Image gallery — thumbnails, main image, zoom on hover
//   • Swipe gallery on mobile
//   • Size selector
//   • Quantity stepper
//   • Add to Cart
//   • Order on WhatsApp (pre-filled message)
//   • Share buttons
//   • Tabs — Description / Size Guide / Delivery / Reviews
//   • Reviews — load, display star breakdown, submit new review
//   • Recently Viewed — save + render
//   • Related Products — same category
//   • Breadcrumb update
//   • Page meta update (title + og tags)
// ============================================================

import {
  getProductById,
  getProducts,
  getReviewsByProduct,
  addReview,
  COLLECTIONS
} from "./firebase-config.js";

import {
  addToCart,
  isInCart
} from "./cart.js";

import {
  initUI,
  showToast,
  showLoader,
  hideLoader,
  renderSkeletonCards,
  renderStars,
  formatPrice,
  formatDate,
  getParam,
  scrollToEl,
  addToRecentlyViewed,
  getRecentlyViewed,
  initTabs,
  initScrollAnimations,
  updateCartBadge,
  toggleWishlist,
  isWishlisted
} from "./ui.js";

import { getCurrentUser } from "./auth.js";

// ── Config ────────────────────────────────────────────────────
const WHATSAPP_NUMBER  = "919876543210"; // ⚠️  Replace before go-live
const INSTAGRAM_HANDLE = "alvor_emb";

// ── State ─────────────────────────────────────────────────────
let _product       = null;
let _reviews       = [];
let _selectedSize  = "";
let _quantity      = 1;
let _currentImgIdx = 0;
let _images        = [];

// ── Touch tracking for swipe ──────────────────────────────────
let _touchStartX = 0;
let _touchStartY = 0;

// ============================================================
// ENTRY POINT
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  await initUI({
    isHeroPage      : false,
    whatsappNumber  : WHATSAPP_NUMBER,
    instagramHandle : INSTAGRAM_HANDLE
  });

  const productId = getParam("id");

  if (!productId) {
    _renderNotFound("No product ID provided.");
    return;
  }

  showLoader();

  try {
    // Load product + reviews in parallel
    const [product, reviews] = await Promise.all([
      getProductById(productId),
      getReviewsByProduct(productId)
    ]);

    hideLoader();

    if (!product || product.visible === false) {
      _renderNotFound("This product is no longer available.");
      return;
    }

    _product  = product;
    _reviews  = reviews || [];
    _images   = [
      ...(product.mainImage ? [product.mainImage] : []),
      ...(Array.isArray(product.images) ? product.images.filter(img => img !== product.mainImage) : [])
    ];

    // Default to first available size
    if (Array.isArray(product.sizes) && product.sizes.length > 0) {
      _selectedSize = product.sizes[0];
    }

    // ── Render everything ────────────────────────────────────
    _renderBreadcrumb(product);
    _updatePageMeta(product);
    _renderGallery();
    _renderProductInfo(product);
    _renderTabs(product);
    _renderReviews(_reviews);
    _renderRecentlyViewed();
    _renderRelatedProducts(product);

    // ── Save to recently viewed ──────────────────────────────
    addToRecentlyViewed({
      id        : product.id,
      title     : product.title,
      price     : product.price,
      mainImage : product.mainImage || (_images[0] || ""),
      category  : product.category
    });

    // ── Init interactions ────────────────────────────────────
    _bindGalleryEvents();
    _bindSizeSelector();
    _bindQuantityStepper();
    _bindCartButton();
    _bindWhatsAppButton();
    _bindShareButtons();
    _bindReviewForm();
    initTabs();
    initScrollAnimations();

  } catch (err) {
    hideLoader();
    console.error("product.js load error:", err);
    _renderNotFound("Failed to load product. Please try again.");
  }
});

// ============================================================
// BREADCRUMB
// ============================================================

function _renderBreadcrumb(product) {
  const el = document.getElementById("breadcrumb");
  if (!el) return;
  el.innerHTML = `
    <ol class="breadcrumb" itemscope itemtype="https://schema.org/BreadcrumbList">
      <li class="breadcrumb__item" itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
        <a href="index.html" class="breadcrumb__link" itemprop="item"><span itemprop="name">Home</span></a>
        <meta itemprop="position" content="1">
      </li>
      <span class="breadcrumb__sep"><i class="fa-solid fa-chevron-right"></i></span>
      <li class="breadcrumb__item" itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
        <a href="shop.html" class="breadcrumb__link" itemprop="item"><span itemprop="name">Shop</span></a>
        <meta itemprop="position" content="2">
      </li>
      <span class="breadcrumb__sep"><i class="fa-solid fa-chevron-right"></i></span>
      <li class="breadcrumb__item" itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
        <a href="shop.html?category=${encodeURIComponent(product.category || "")}"
           class="breadcrumb__link" itemprop="item">
          <span itemprop="name">${_escapeHtml(product.category || "All")}</span>
        </a>
        <meta itemprop="position" content="3">
      </li>
      <span class="breadcrumb__sep"><i class="fa-solid fa-chevron-right"></i></span>
      <li class="breadcrumb__item breadcrumb__item--active" itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
        <span itemprop="name">${_escapeHtml(product.title || "")}</span>
        <meta itemprop="position" content="4">
      </li>
    </ol>
  `;
}

// ============================================================
// PAGE META
// ============================================================

function _updatePageMeta(product) {
  document.title = `${product.title} — ALVOR`;

  const desc    = (product.description || "").slice(0, 160);
  const imgURL  = product.mainImage || "";

  _setMeta("description", desc);
  _setMeta("og:title",       `${product.title} — ALVOR`);
  _setMeta("og:description", desc);
  _setMeta("og:image",       imgURL);
  _setMeta("og:url",         window.location.href);
  _setMeta("og:type",        "product");
}

function _setMeta(name, content) {
  let el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(name.startsWith("og:") ? "property" : "name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

// ============================================================
// IMAGE GALLERY
// ============================================================

function _renderGallery() {
  const mainWrap  = document.getElementById("gallery-main");
  const thumbWrap = document.getElementById("gallery-thumbs");
  if (!mainWrap) return;

  if (!_images.length) {
    mainWrap.innerHTML = `
      <div class="gallery__placeholder">
        <i class="fa-regular fa-image"></i>
        <span>No image available</span>
      </div>`;
    return;
  }

  // Main image
  mainWrap.innerHTML = `
    <div class="gallery__main-wrap" id="gallery-zoom-wrap">
      <img
        src="${_escapeHtml(_images[0])}"
        alt="${_escapeHtml(_product?.title || "Product image")}"
        class="gallery__main-img"
        id="gallery-main-img"
        loading="eager"
        onerror="this.parentElement.classList.add('gallery__placeholder')">
      <div class="gallery__zoom-lens" id="gallery-zoom-lens" aria-hidden="true"></div>
      <div class="gallery__arrows">
        <button class="gallery__arrow gallery__arrow--prev" id="gallery-prev" aria-label="Previous image">
          <i class="fa-solid fa-chevron-left"></i>
        </button>
        <button class="gallery__arrow gallery__arrow--next" id="gallery-next" aria-label="Next image">
          <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>
      <div class="gallery__dots" id="gallery-dots">
        ${_images.map((_, i) => `
          <button class="gallery__dot ${i === 0 ? "active" : ""}"
                  data-idx="${i}" aria-label="Image ${i + 1}"></button>
        `).join("")}
      </div>
    </div>
  `;

  // Thumbnails
  if (thumbWrap && _images.length > 1) {
    thumbWrap.innerHTML = _images.map((img, i) => `
      <button class="gallery__thumb ${i === 0 ? "active" : ""}"
              data-idx="${i}"
              aria-label="View image ${i + 1}">
        <img src="${_escapeHtml(img)}"
             alt="Thumbnail ${i + 1}"
             loading="lazy"
             onerror="this.parentElement.style.display='none'">
      </button>
    `).join("");
  }

  _currentImgIdx = 0;
}

function _setGalleryImage(idx) {
  if (!_images.length) return;
  _currentImgIdx = (idx + _images.length) % _images.length;

  const mainImg = document.getElementById("gallery-main-img");
  if (mainImg) {
    mainImg.style.opacity = "0";
    mainImg.src = _images[_currentImgIdx];
    mainImg.onload = () => { mainImg.style.opacity = "1"; };
    mainImg.alt = `${_product?.title || "Product"} — image ${_currentImgIdx + 1}`;
  }

  // Sync thumbnails
  document.querySelectorAll(".gallery__thumb").forEach((btn, i) => {
    btn.classList.toggle("active", i === _currentImgIdx);
  });

  // Sync dots
  document.querySelectorAll(".gallery__dot").forEach((dot, i) => {
    dot.classList.toggle("active", i === _currentImgIdx);
  });
}

function _bindGalleryEvents() {
  // Thumbnail clicks
  document.getElementById("gallery-thumbs")?.addEventListener("click", e => {
    const thumb = e.target.closest(".gallery__thumb");
    if (!thumb) return;
    _setGalleryImage(parseInt(thumb.dataset.idx, 10));
  });

  // Dot clicks
  document.getElementById("gallery-dots")?.addEventListener("click", e => {
    const dot = e.target.closest(".gallery__dot");
    if (!dot) return;
    _setGalleryImage(parseInt(dot.dataset.idx, 10));
  });

  // Arrow buttons
  document.getElementById("gallery-prev")?.addEventListener("click", () => {
    _setGalleryImage(_currentImgIdx - 1);
  });
  document.getElementById("gallery-next")?.addEventListener("click", () => {
    _setGalleryImage(_currentImgIdx + 1);
  });

  // Keyboard arrows
  document.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft")  _setGalleryImage(_currentImgIdx - 1);
    if (e.key === "ArrowRight") _setGalleryImage(_currentImgIdx + 1);
  });

  // Touch swipe on mobile
  const mainWrap = document.getElementById("gallery-zoom-wrap");
  if (mainWrap) {
    mainWrap.addEventListener("touchstart", e => {
      _touchStartX = e.touches[0].clientX;
      _touchStartY = e.touches[0].clientY;
    }, { passive: true });

    mainWrap.addEventListener("touchend", e => {
      const dx = e.changedTouches[0].clientX - _touchStartX;
      const dy = e.changedTouches[0].clientY - _touchStartY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
        dx < 0 ? _setGalleryImage(_currentImgIdx + 1) : _setGalleryImage(_currentImgIdx - 1);
      }
    }, { passive: true });
  }

  // Desktop hover zoom
  _initZoom();
}

function _initZoom() {
  const wrap = document.getElementById("gallery-zoom-wrap");
  const lens = document.getElementById("gallery-zoom-lens");
  const img  = document.getElementById("gallery-main-img");
  if (!wrap || !lens || !img) return;

  // Only enable on non-touch devices
  if (window.matchMedia("(hover: none)").matches) return;

  const ZOOM = 2.5;

  wrap.addEventListener("mousemove", e => {
    const rect   = wrap.getBoundingClientRect();
    const x      = e.clientX - rect.left;
    const y      = e.clientY - rect.top;
    const pctX   = (x / rect.width)  * 100;
    const pctY   = (y / rect.height) * 100;

    lens.style.backgroundImage    = `url('${img.src}')`;
    lens.style.backgroundSize     = `${ZOOM * 100}%`;
    lens.style.backgroundPosition = `${pctX}% ${pctY}%`;
    lens.style.left  = `${x - lens.offsetWidth  / 2}px`;
    lens.style.top   = `${y - lens.offsetHeight / 2}px`;
  });

  wrap.addEventListener("mouseenter", () => { lens.style.display = "block"; });
  wrap.addEventListener("mouseleave", () => { lens.style.display = "none";  });
}

// ============================================================
// PRODUCT INFO
// ============================================================

function _renderProductInfo(product) {
  const container = document.getElementById("product-info");
  if (!container) return;

  const {
    title        = "Untitled",
    price        = 0,
    originalPrice,
    description  = "",
    sizes        = [],
    stock,
    estimatedDays= "5-7",
    tags         = [],
    id
  } = product;

  const avgRating  = _calcAvgRating(_reviews);
  const reviewCount= _reviews.length;
  const discount   = originalPrice && originalPrice > price
    ? Math.round(((originalPrice - price) / originalPrice) * 100) : 0;
  const isOutOfStock = stock !== undefined && stock <= 0;
  const isWished   = isWishlisted(id);

  container.innerHTML = `
    <!-- Title row -->
    <div class="product-info__title-row">
      <h1 class="product-info__title">${_escapeHtml(title)}</h1>
      <button class="product-info__wishlist ${isWished ? "wishlisted" : ""}"
              id="btn-wishlist"
              aria-label="${isWished ? "Remove from wishlist" : "Add to wishlist"}">
        <i class="${isWished ? "fa-solid" : "fa-regular"} fa-heart"></i>
      </button>
    </div>

    <!-- Rating row -->
    <div class="product-info__rating-row">
      <div class="product-info__stars">${_renderStarsHTML(avgRating)}</div>
      <button class="product-info__review-count" id="btn-scroll-reviews">
        ${reviewCount} review${reviewCount !== 1 ? "s" : ""}
      </button>
      ${tags.includes("bestseller") ? `<span class="badge badge-gold"><i class="fa-solid fa-fire-flame-curved"></i> Bestseller</span>` : ""}
      ${tags.includes("new")        ? `<span class="badge badge-dark">New Arrival</span>` : ""}
    </div>

    <!-- Price -->
    <div class="product-info__price-row">
      <span class="product-info__price">${formatPrice(price)}</span>
      ${originalPrice && originalPrice > price
        ? `<s class="product-info__original-price">${formatPrice(originalPrice)}</s>
           <span class="badge badge-red">${discount}% OFF</span>`
        : ""}
    </div>

    <!-- Short description -->
    <p class="product-info__desc">${_escapeHtml(description.slice(0, 300))}${description.length > 300 ? "…" : ""}</p>

    <!-- Size selector -->
    ${sizes.length > 0 ? `
      <div class="product-info__sizes" id="size-selector">
        <div class="product-info__size-label">
          Size: <strong id="selected-size-label">${_escapeHtml(sizes[0])}</strong>
          <a href="#tab-size-guide" class="product-info__size-guide-link" id="size-guide-link">
            Size Guide <i class="fa-solid fa-ruler"></i>
          </a>
        </div>
        <div class="product-info__size-btns">
          ${sizes.map((s, i) => `
            <button class="size-btn ${i === 0 ? "active" : ""}"
                    data-size="${_escapeHtml(s)}"
                    aria-pressed="${i === 0}">
              ${_escapeHtml(s)}
            </button>
          `).join("")}
        </div>
      </div>
    ` : ""}

    <!-- Quantity -->
    <div class="product-info__qty-row">
      <label class="product-info__qty-label">Quantity:</label>
      <div class="qty-stepper">
        <button class="qty-stepper__btn" id="qty-minus" aria-label="Decrease quantity">
          <i class="fa-solid fa-minus"></i>
        </button>
        <input type="number"
               class="qty-stepper__input"
               id="qty-input"
               value="1"
               min="1"
               max="99"
               aria-label="Quantity">
        <button class="qty-stepper__btn" id="qty-plus" aria-label="Increase quantity">
          <i class="fa-solid fa-plus"></i>
        </button>
      </div>
    </div>

    <!-- Estimated delivery -->
    <p class="product-info__delivery">
      <i class="fa-solid fa-truck text-gold"></i>
      Estimated delivery in <strong>${_escapeHtml(String(estimatedDays))} days</strong>
      within Andhra Pradesh
    </p>

    <!-- CTA Buttons -->
    <div class="product-info__cta-row">
      <button class="btn btn-primary btn-lg product-info__btn-cart ${isOutOfStock ? "btn--disabled" : ""}"
              id="btn-add-to-cart"
              ${isOutOfStock ? "disabled" : ""}>
        <i class="fa-solid fa-bag-shopping"></i>
        ${isOutOfStock ? "Out of Stock" : "Add to Cart"}
      </button>
      <button class="btn btn-outline-whatsapp btn-lg product-info__btn-whatsapp"
              id="btn-whatsapp-order">
        <i class="fa-brands fa-whatsapp"></i>
        Order on WhatsApp
      </button>
    </div>

    <!-- Share row -->
    <div class="product-info__share-row">
      <span class="product-info__share-label">Share:</span>
      <button class="btn-share btn-share--whatsapp" id="btn-share-whatsapp" title="Share on WhatsApp">
        <i class="fa-brands fa-whatsapp"></i> WhatsApp
      </button>
      <button class="btn-share btn-share--copy" id="btn-share-copy" title="Copy link">
        <i class="fa-regular fa-copy"></i> Copy Link
      </button>
    </div>

    <!-- Trust badges -->
    <div class="product-info__trust-badges">
      <div class="trust-badge">
        <i class="fa-solid fa-hands trust-badge__icon"></i>
        <span>100% Handcrafted</span>
      </div>
      <div class="trust-badge">
        <i class="fa-solid fa-frame trust-badge__icon"></i>
        <span>Premium Frame</span>
      </div>
      <div class="trust-badge">
        <i class="fa-solid fa-truck trust-badge__icon"></i>
        <span>AP Delivery</span>
      </div>
      <div class="trust-badge">
        <i class="fa-solid fa-wand-magic-sparkles trust-badge__icon"></i>
        <span>Custom Available</span>
      </div>
    </div>
  `;
}

// ============================================================
// TABS
// ============================================================

function _renderTabs(product) {
  // Description tab
  const descEl = document.getElementById("tab-description");
  if (descEl) {
    descEl.innerHTML = `<div class="tab-content__prose">${_escapeHtml(product.description || "No description available.")}</div>`;
  }

  // Size guide tab
  const sizeEl = document.getElementById("tab-size-guide");
  if (sizeEl) {
    if (Array.isArray(product.sizes) && product.sizes.length > 0) {
      sizeEl.innerHTML = `
        <div class="size-guide">
          <p class="size-guide__intro">All measurements are approximate. Sizes may vary slightly per piece.</p>
          <table class="size-guide__table">
            <thead>
              <tr>
                <th>Size</th>
                <th>Width (cm)</th>
                <th>Height (cm)</th>
                <th>Best For</th>
              </tr>
            </thead>
            <tbody>
              ${product.sizes.map(s => `
                <tr>
                  <td><strong>${_escapeHtml(s)}</strong></td>
                  <td>${_sizeToWidth(s)}</td>
                  <td>${_sizeToHeight(s)}</td>
                  <td>${_sizeBestFor(s)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          <p class="size-guide__note">
            <i class="fa-solid fa-circle-info text-gold"></i>
            Need a custom size? <a href="services.html" class="link-gold">Contact us</a> for a custom order.
          </p>
        </div>
      `;
    } else {
      sizeEl.innerHTML = `<p class="text-muted">This product is available in one standard size.</p>`;
    }
  }

  // Delivery info tab
  const deliveryEl = document.getElementById("tab-delivery");
  if (deliveryEl) {
    deliveryEl.innerHTML = `
      <div class="delivery-info">
        <div class="delivery-info__item">
          <i class="fa-solid fa-location-dot text-gold"></i>
          <div>
            <strong>Delivery Area</strong>
            <p>Currently delivering across all districts of Andhra Pradesh only.</p>
          </div>
        </div>
        <div class="delivery-info__item">
          <i class="fa-solid fa-clock text-gold"></i>
          <div>
            <strong>Estimated Delivery</strong>
            <p>${_escapeHtml(String(product.estimatedDays || "5–7"))} working days after order confirmation.</p>
          </div>
        </div>
        <div class="delivery-info__item">
          <i class="fa-brands fa-whatsapp text-gold"></i>
          <div>
            <strong>How It Works</strong>
            <ol class="delivery-info__steps">
              <li>Place your order on this website or via WhatsApp.</li>
              <li>We confirm your order within 2–3 hours on WhatsApp.</li>
              <li>You make payment after confirmation.</li>
              <li>We carefully pack and dispatch your piece.</li>
              <li>You receive your handcrafted artwork!</li>
            </ol>
          </div>
        </div>
        <div class="delivery-info__item">
          <i class="fa-solid fa-rotate-left text-gold"></i>
          <div>
            <strong>Returns & Damage</strong>
            <p>If your piece arrives damaged, please WhatsApp us with photos within 24 hours of delivery.
               We will arrange a replacement or refund.</p>
          </div>
        </div>
      </div>
    `;
  }
}

// ============================================================
// REVIEWS
// ============================================================

function _renderReviews(reviews) {
  const container = document.getElementById("tab-reviews");
  if (!container) return;

  const avgRating  = _calcAvgRating(reviews);
  const breakdown  = _calcRatingBreakdown(reviews);

  container.innerHTML = `
    <div class="reviews">
      <!-- Summary -->
      <div class="reviews__summary">
        <div class="reviews__avg-score">${avgRating.toFixed(1)}</div>
        <div class="reviews__avg-stars">${_renderStarsHTML(avgRating)}</div>
        <p class="reviews__count">${reviews.length} review${reviews.length !== 1 ? "s" : ""}</p>
      </div>

      <!-- Breakdown bars -->
      <div class="reviews__breakdown">
        ${[5,4,3,2,1].map(star => {
          const count = breakdown[star] || 0;
          const pct   = reviews.length ? Math.round((count / reviews.length) * 100) : 0;
          return `
            <div class="reviews__bar-row">
              <span class="reviews__bar-label">${star} <i class="fa-solid fa-star"></i></span>
              <div class="reviews__bar-track">
                <div class="reviews__bar-fill" style="width:${pct}%"></div>
              </div>
              <span class="reviews__bar-count">${count}</span>
            </div>
          `;
        }).join("")}
      </div>

      <!-- Individual reviews -->
      <div class="reviews__list" id="reviews-list">
        ${reviews.length === 0
          ? `<p class="reviews__empty">No reviews yet. Be the first to share your experience!</p>`
          : reviews.map(r => _buildReviewHTML(r)).join("")
        }
      </div>

      <!-- Submit review form -->
      <div class="reviews__form-wrap">
        <h3 class="reviews__form-title">Write a Review</h3>
        <form class="reviews__form" id="review-form" novalidate>
          <div class="reviews__star-picker" id="star-picker" role="group" aria-label="Rating">
            ${[1,2,3,4,5].map(n => `
              <button type="button"
                      class="star-pick-btn"
                      data-star="${n}"
                      aria-label="${n} star${n>1?"s":""}">
                <i class="fa-regular fa-star"></i>
              </button>
            `).join("")}
          </div>
          <div class="form-group">
            <label class="form-label" for="review-name">Your Name *</label>
            <input type="text" id="review-name" class="form-input" placeholder="e.g. Priya Sharma" required maxlength="80">
          </div>
          <div class="form-group">
            <label class="form-label" for="review-comment">Your Review *</label>
            <textarea id="review-comment" class="form-input form-textarea" rows="4"
                      placeholder="Share your experience with this piece…" required maxlength="1000"></textarea>
          </div>
          <button type="submit" class="btn btn-primary" id="btn-submit-review">
            <i class="fa-regular fa-paper-plane"></i> Submit Review
          </button>
        </form>
      </div>
    </div>
  `;

  _bindStarPicker();
}

function _buildReviewHTML(review) {
  const date = review.createdAt
    ? formatDate(review.createdAt)
    : "Recent";
  return `
    <div class="review-card">
      <div class="review-card__header">
        <div class="review-card__avatar">
          ${(review.customerName || "A")[0].toUpperCase()}
        </div>
        <div class="review-card__meta">
          <span class="review-card__name">${_escapeHtml(review.customerName || "Anonymous")}</span>
          <span class="review-card__date">${date}</span>
        </div>
        <div class="review-card__stars">${_renderStarsHTML(review.rating || 5)}</div>
      </div>
      <p class="review-card__comment">${_escapeHtml(review.comment || "")}</p>
    </div>
  `;
}

let _selectedRating = 0;

function _bindStarPicker() {
  const picker = document.getElementById("star-picker");
  if (!picker) return;

  const btns = picker.querySelectorAll(".star-pick-btn");

  btns.forEach(btn => {
    btn.addEventListener("mouseenter", () => _highlightStars(btns, parseInt(btn.dataset.star)));
    btn.addEventListener("mouseleave", () => _highlightStars(btns, _selectedRating));
    btn.addEventListener("click", () => {
      _selectedRating = parseInt(btn.dataset.star);
      _highlightStars(btns, _selectedRating);
    });
  });
}

function _highlightStars(btns, upTo) {
  btns.forEach((btn, i) => {
    const icon = btn.querySelector("i");
    if (icon) {
      icon.className = i < upTo ? "fa-solid fa-star" : "fa-regular fa-star";
    }
    btn.classList.toggle("active", i < upTo);
  });
}

function _bindReviewForm() {
  const form = document.getElementById("review-form");
  if (!form) return;

  form.addEventListener("submit", async e => {
    e.preventDefault();

    const nameInput    = document.getElementById("review-name");
    const commentInput = document.getElementById("review-comment");
    const submitBtn    = document.getElementById("btn-submit-review");

    const name    = (nameInput?.value    || "").trim();
    const comment = (commentInput?.value || "").trim();

    if (_selectedRating === 0) {
      showToast("Please select a star rating.", "error");
      return;
    }
    if (!name) {
      showToast("Please enter your name.", "error");
      nameInput?.focus();
      return;
    }
    if (!comment) {
      showToast("Please write your review.", "error");
      commentInput?.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Submitting…`;

    try {
      await addReview({
        productId    : _product.id,
        customerName : name,
        rating       : _selectedRating,
        comment
      });

      showToast("Thank you for your review!", "success");

      // Optimistically append review to list
      const newReview = {
        customerName : name,
        rating       : _selectedRating,
        comment,
        createdAt    : null
      };
      const list = document.getElementById("reviews-list");
      if (list) {
        const emptyMsg = list.querySelector(".reviews__empty");
        if (emptyMsg) emptyMsg.remove();
        list.insertAdjacentHTML("afterbegin", _buildReviewHTML(newReview));
      }

      // Reset form
      nameInput.value    = "";
      commentInput.value = "";
      _selectedRating    = 0;
      _highlightStars(document.querySelectorAll(".star-pick-btn"), 0);

    } catch (err) {
      console.error("Submit review error:", err);
      showToast("Could not submit review. Please try again.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-regular fa-paper-plane"></i> Submit Review`;
    }
  });
}

// ============================================================
// SIZE SELECTOR
// ============================================================

function _bindSizeSelector() {
  const container = document.getElementById("size-selector");
  if (!container) return;

  container.addEventListener("click", e => {
    const btn = e.target.closest(".size-btn");
    if (!btn) return;

    container.querySelectorAll(".size-btn").forEach(b => {
      b.classList.remove("active");
      b.setAttribute("aria-pressed", "false");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-pressed", "true");

    _selectedSize = btn.dataset.size;
    const label = document.getElementById("selected-size-label");
    if (label) label.textContent = _selectedSize;
  });

  // Size guide tab scroll
  document.getElementById("size-guide-link")?.addEventListener("click", e => {
    e.preventDefault();
    scrollToEl("#product-tabs", 80);
    // Activate size guide tab
    const sizeTab = document.querySelector('[data-tab="size-guide"]');
    sizeTab?.click();
  });
}

// ============================================================
// QUANTITY STEPPER
// ============================================================

function _bindQuantityStepper() {
  const minusBtn = document.getElementById("qty-minus");
  const plusBtn  = document.getElementById("qty-plus");
  const input    = document.getElementById("qty-input");
  if (!input) return;

  function _setQty(val) {
    _quantity          = Math.max(1, Math.min(99, parseInt(val, 10) || 1));
    input.value        = _quantity;
  }

  minusBtn?.addEventListener("click", () => _setQty(_quantity - 1));
  plusBtn?.addEventListener("click",  () => _setQty(_quantity + 1));
  input.addEventListener("change",    e  => _setQty(e.target.value));
  input.addEventListener("blur",      e  => _setQty(e.target.value));
}

// ============================================================
// ADD TO CART
// ============================================================

function _bindCartButton() {
  const btn = document.getElementById("btn-add-to-cart");
  if (!btn || !_product) return;

  btn.addEventListener("click", () => {
    const { id, title, price, originalPrice, mainImage, sizes = [] } = _product;

    // Require size selection if product has sizes
    if (sizes.length > 0 && !_selectedSize) {
      showToast("Please select a size.", "info");
      scrollToEl("#size-selector", 120);
      return;
    }

    const result = addToCart(
      id,
      title,
      price,
      _selectedSize,
      _quantity,
      mainImage || "",
      originalPrice || null
    );

    if (result.success) {
      const total = result.cart.reduce((s, i) => s + i.quantity, 0);
      updateCartBadge(total);
      showToast(`"${title}" added to cart!`, "success");

      // Button feedback
      btn.innerHTML = `<i class="fa-solid fa-check"></i> Added to Cart!`;
      btn.classList.add("btn--success");
      setTimeout(() => {
        btn.innerHTML = `<i class="fa-solid fa-bag-shopping"></i> Add to Cart`;
        btn.classList.remove("btn--success");
      }, 2500);
    } else {
      showToast(result.message || "Could not add to cart.", "error");
    }
  });
}

// ============================================================
// WHATSAPP ORDER
// ============================================================

function _bindWhatsAppButton() {
  const btn = document.getElementById("btn-whatsapp-order");
  if (!btn || !_product) return;

  btn.addEventListener("click", () => {
    const { title, price, id } = _product;
    const sizeStr = _selectedSize ? `\nSize: ${_selectedSize}` : "";
    const qtyStr  = `\nQuantity: ${_quantity}`;
    const url     = `${window.location.origin}/product.html?id=${id}`;

    const message = encodeURIComponent(
      `Hi ALVOR! I'm interested in ordering:\n\n` +
      `*${title}*${sizeStr}${qtyStr}\n` +
      `Price: ${formatPrice(price)}\n` +
      `Total: ${formatPrice(price * _quantity)}\n\n` +
      `Product link: ${url}\n\n` +
      `Please confirm availability and payment details. Thank you!`
    );

    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${message}`, "_blank", "noopener");
  });
}

// ============================================================
// SHARE BUTTONS
// ============================================================

function _bindShareButtons() {
  const pageURL   = encodeURIComponent(window.location.href);
  const pageTitle = encodeURIComponent(_product?.title || "ALVOR Product");

  // WhatsApp share
  document.getElementById("btn-share-whatsapp")?.addEventListener("click", () => {
    window.open(
      `https://wa.me/?text=${pageTitle}%20${pageURL}`,
      "_blank", "noopener"
    );
  });

  // Copy link
  document.getElementById("btn-share-copy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Link copied to clipboard!", "success");
    } catch (_) {
      showToast("Could not copy link.", "error");
    }
  });

  // Scroll to reviews
  document.getElementById("btn-scroll-reviews")?.addEventListener("click", () => {
    scrollToEl("#product-tabs", 80);
    document.querySelector('[data-tab="reviews"]')?.click();
  });

  // Wishlist toggle
  document.getElementById("btn-wishlist")?.addEventListener("click", function () {
    const isNow = toggleWishlist(_product.id);
    const icon  = this.querySelector("i");
    if (icon) icon.className = isNow ? "fa-solid fa-heart" : "fa-regular fa-heart";
    this.classList.toggle("wishlisted", isNow);
    this.setAttribute("aria-label", isNow ? "Remove from wishlist" : "Add to wishlist");
    showToast(isNow ? "Added to wishlist ♥" : "Removed from wishlist", isNow ? "success" : "info");
  });
}

// ============================================================
// RECENTLY VIEWED
// ============================================================

function _renderRecentlyViewed() {
  const container = document.getElementById("recently-viewed-grid");
  if (!container) return;

  const recent = getRecentlyViewed()
    .filter(p => p.id !== _product?.id)
    .slice(0, 4);

  const section = document.getElementById("recently-viewed-section");

  if (!recent.length) {
    if (section) section.style.display = "none";
    return;
  }

  if (section) section.style.display = "";

  container.innerHTML = recent.map(p => _buildMiniCard(p)).join("");
}

// ============================================================
// RELATED PRODUCTS
// ============================================================

async function _renderRelatedProducts(product) {
  const container = document.getElementById("related-products-grid");
  const section   = document.getElementById("related-products-section");
  if (!container) return;

  renderSkeletonCards(container, 4);

  try {
    const all = await getProducts({ category: product.category, limitCount: 8 });
    const related = all
      .filter(p => p.id !== product.id)
      .slice(0, 4);

    if (!related.length) {
      if (section) section.style.display = "none";
      return;
    }

    container.innerHTML = related.map(p => _buildMiniCard(p)).join("");
    initScrollAnimations();
  } catch (err) {
    console.error("_renderRelatedProducts error:", err);
    if (section) section.style.display = "none";
  }
}

// ============================================================
// MINI PRODUCT CARD (Recently Viewed + Related)
// ============================================================

function _buildMiniCard(p) {
  const img = p.mainImage || "";
  return `
    <a href="product.html?id=${p.id}" class="mini-card fade-up">
      <div class="mini-card__img-wrap">
        ${img
          ? `<img src="${_escapeHtml(img)}"
                  alt="${_escapeHtml(p.title || "")}"
                  class="mini-card__img"
                  loading="lazy">`
          : `<div class="mini-card__img-placeholder"><i class="fa-regular fa-image"></i></div>`
        }
      </div>
      <div class="mini-card__body">
        <p class="mini-card__title">${_escapeHtml(p.title || "")}</p>
        <p class="mini-card__price">${formatPrice(p.price || 0)}</p>
      </div>
    </a>
  `;
}

// ============================================================
// NOT FOUND / ERROR STATE
// ============================================================

function _renderNotFound(message) {
  const main = document.getElementById("product-main");
  if (!main) return;
  main.innerHTML = `
    <div class="product-not-found">
      <div class="product-not-found__icon">
        <i class="fa-regular fa-face-frown-open"></i>
      </div>
      <h2>Product Not Found</h2>
      <p>${_escapeHtml(message)}</p>
      <a href="shop.html" class="btn btn-primary">
        <i class="fa-solid fa-arrow-left"></i> Back to Shop
      </a>
    </div>
  `;
}

// ============================================================
// HELPERS
// ============================================================

function _calcAvgRating(reviews) {
  if (!reviews.length) return 0;
  const sum = reviews.reduce((acc, r) => acc + (r.rating || 0), 0);
  return Math.round((sum / reviews.length) * 10) / 10;
}

function _calcRatingBreakdown(reviews) {
  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  reviews.forEach(r => {
    const star = Math.round(r.rating || 0);
    if (star >= 1 && star <= 5) breakdown[star]++;
  });
  return breakdown;
}

function _renderStarsHTML(rating) {
  const full  = Math.floor(rating);
  const half  = rating % 1 >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return (
    `<i class="fa-solid fa-star star star--full"></i>`.repeat(full) +
    (half ? `<i class="fa-solid fa-star-half-stroke star star--half"></i>` : "") +
    `<i class="fa-regular fa-star star star--empty"></i>`.repeat(empty)
  );
}

// Size guide helpers — approximate dimensions by size label
function _sizeToWidth(size) {
  const map = { "Small": "15–20", "Medium": "25–30", "Large": "35–45", "XL": "50–60" };
  return map[size] || "Custom";
}
function _sizeToHeight(size) {
  const map = { "Small": "20–25", "Medium": "30–40", "Large": "45–55", "XL": "60–80" };
  return map[size] || "Custom";
}
function _sizeBestFor(size) {
  const map = {
    "Small"  : "Desks & shelves",
    "Medium" : "Bedrooms & offices",
    "Large"  : "Living rooms",
    "XL"     : "Feature walls"
  };
  return map[size] || "Contact us";
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
