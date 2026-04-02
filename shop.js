// ============================================================
// ALVOR — Shop Page  (js/shop.js)
// "Where Thread Meets Tradition"
// ============================================================
// Handles all logic for shop.html:
//   • Load & render products from Firestore
//   • Category / price / size filters
//   • Live search
//   • Sort dropdown
//   • Pagination (12 per page)
//   • Wishlist heart toggle on cards
//   • "Add to Cart" from card
//   • URL param persistence (filters survive page refresh)
//   • Empty & error states
// ============================================================

import {
  getProducts
} from "./firebase-config.js";

import {
  addToCart
} from "./cart.js";

import {
  initUI,
  showToast,
  renderSkeletonCards,
  renderProductCard,
  formatPrice,
  getParam,
  setParam,
  debounce,
  toggleWishlist,
  isWishlisted,
  updateCartBadge
} from "./ui.js";

// ── Config ────────────────────────────────────────────────────
const PAGE_SIZE        = 12;
const WHATSAPP_NUMBER  = "919876543210"; // ⚠️ Replace before go-live
const INSTAGRAM_HANDLE = "alvor_emb";

// ── State ─────────────────────────────────────────────────────
let _allProducts   = [];   // full dataset fetched from Firestore
let _filtered      = [];   // after filters + search applied
let _currentPage   = 1;

const _filters = {
  category : "all",
  search   : "",
  priceMin : 0,
  priceMax : 10000,
  sizes    : [],           // multi-select
  sort     : "newest"
};

// ── DOM refs (populated in init) ─────────────────────────────
let _grid          = null;
let _resultCount   = null;
let _paginationEl  = null;
let _searchInput   = null;
let _sortSelect    = null;
let _priceMinInput = null;
let _priceMaxInput = null;
let _priceMinLabel = null;
let _priceMaxLabel = null;
let _clearBtn      = null;
let _sidebarToggle = null;
let _sidebar       = null;

// ============================================================
// ENTRY POINT
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  // ── Init global UI (navbar, footer, whatsapp btn, etc.) ──
  await initUI({
    isHeroPage      : false,
    whatsappNumber  : WHATSAPP_NUMBER,
    instagramHandle : INSTAGRAM_HANDLE
  });

  // ── Cache DOM refs ────────────────────────────────────────
  _grid          = document.getElementById("product-grid");
  _resultCount   = document.getElementById("result-count");
  _paginationEl  = document.getElementById("pagination");
  _searchInput   = document.getElementById("search-input");
  _sortSelect    = document.getElementById("sort-select");
  _priceMinInput = document.getElementById("price-min");
  _priceMaxInput = document.getElementById("price-max");
  _priceMinLabel = document.getElementById("price-min-label");
  _priceMaxLabel = document.getElementById("price-max-label");
  _clearBtn      = document.getElementById("clear-filters");
  _sidebarToggle = document.getElementById("sidebar-toggle");
  _sidebar       = document.getElementById("filter-sidebar");

  // ── Read URL params → pre-fill filters ───────────────────
  _readParamsIntoFilters();

  // ── Show skeleton while loading ───────────────────────────
  if (_grid) renderSkeletonCards(_grid, PAGE_SIZE);

  // ── Fetch products ────────────────────────────────────────
  await _loadProducts();

  // ── Wire up all controls ──────────────────────────────────
  _bindSearch();
  _bindSort();
  _bindCategoryCheckboxes();
  _bindSizeCheckboxes();
  _bindPriceRange();
  _bindClearFilters();
  _bindSidebarToggle();
  _bindGridEvents();

  // ── Sync filter UI to initial state ──────────────────────
  _syncFilterUI();
});

// ============================================================
// DATA LOADING
// ============================================================

async function _loadProducts() {
  try {
    _allProducts = await getProducts(); // fetch all visible products

    _applyFiltersAndRender();
  } catch (err) {
    console.error("shop._loadProducts error:", err);
    _renderError("Unable to load products. Please try again.");
  }
}

// ============================================================
// FILTER & SORT PIPELINE
// ============================================================

/**
 * Run the full filter → sort → paginate → render pipeline.
 * Call this whenever any filter value changes.
 */
function _applyFiltersAndRender() {
  let results = [..._allProducts];

  // 1. Category
  if (_filters.category && _filters.category !== "all") {
    results = results.filter(p =>
      (p.category || "").toLowerCase() === _filters.category.toLowerCase()
    );
  }

  // 2. Search (title + description + tags)
  if (_filters.search.trim()) {
    const q = _filters.search.trim().toLowerCase();
    results = results.filter(p => {
      const inTitle = (p.title || "").toLowerCase().includes(q);
      const inDesc  = (p.description || "").toLowerCase().includes(q);
      const inTags  = Array.isArray(p.tags) && p.tags.some(t => t.toLowerCase().includes(q));
      return inTitle || inDesc || inTags;
    });
  }

  // 3. Price range
  results = results.filter(p => {
    const price = p.price || 0;
    return price >= _filters.priceMin && price <= _filters.priceMax;
  });

  // 4. Size filter (product must include ALL selected sizes)
  if (_filters.sizes.length > 0) {
    results = results.filter(p => {
      const productSizes = Array.isArray(p.sizes) ? p.sizes : [];
      return _filters.sizes.every(s => productSizes.includes(s));
    });
  }

  // 5. Sort
  results = _sortProducts(results, _filters.sort);

  _filtered    = results;
  _currentPage = 1;

  _renderResultCount();
  _renderPage();
  _renderPagination();
  _updateURL();
}

function _sortProducts(products, sort) {
  const arr = [...products];
  switch (sort) {
    case "price-asc":
      return arr.sort((a, b) => (a.price || 0) - (b.price || 0));
    case "price-desc":
      return arr.sort((a, b) => (b.price || 0) - (a.price || 0));
    case "popular":
      // Sort by number of reviews or a "popular" tag — fall back to newest
      return arr.sort((a, b) => {
        const aScore = (Array.isArray(a.tags) && a.tags.includes("bestseller")) ? 1 : 0;
        const bScore = (Array.isArray(b.tags) && b.tags.includes("bestseller")) ? 1 : 0;
        return bScore - aScore;
      });
    case "newest":
    default:
      return arr.sort((a, b) => {
        const aTime = a.createdAt?.seconds || 0;
        const bTime = b.createdAt?.seconds || 0;
        return bTime - aTime;
      });
  }
}

// ============================================================
// RENDERING
// ============================================================

function _renderPage() {
  if (!_grid) return;

  const start    = (_currentPage - 1) * PAGE_SIZE;
  const end      = start + PAGE_SIZE;
  const pageData = _filtered.slice(start, end);

  if (pageData.length === 0) {
    _renderEmpty();
    return;
  }

  _grid.innerHTML = pageData.map(product => _buildProductCardHTML(product)).join("");

  // Scroll grid into view on page change (but not on first load)
  if (_currentPage > 1) {
    _grid.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/**
 * Build product card HTML for the shop grid.
 * Extends ui.js renderProductCard with shop-specific controls.
 */
function _buildProductCardHTML(product) {
  const {
    id,
    title       = "Untitled",
    price       = 0,
    originalPrice,
    mainImage   = "",
    images      = [],
    tags        = [],
    category    = "",
    stock       = 0,
    sizes       = []
  } = product;

  const imgSrc       = mainImage || (images[0] || "");
  const isBestseller = tags.includes("bestseller");
  const isNew        = tags.includes("new");
  const isWished     = isWishlisted(id);
  const isOutOfStock = stock !== undefined && stock <= 0;
  const discount     = originalPrice && originalPrice > price
    ? Math.round(((originalPrice - price) / originalPrice) * 100)
    : 0;

  const badge = isBestseller
    ? `<span class="product-card__badge product-card__badge--bestseller">Bestseller</span>`
    : isNew
    ? `<span class="product-card__badge product-card__badge--new">New</span>`
    : "";

  const discountBadge = discount > 0
    ? `<span class="product-card__badge product-card__badge--discount">${discount}% OFF</span>`
    : "";

  const originalPriceHTML = originalPrice && originalPrice > price
    ? `<s class="product-card__original-price">${formatPrice(originalPrice)}</s>`
    : "";

  const outOfStockOverlay = isOutOfStock
    ? `<div class="product-card__oos-overlay"><span>Out of Stock</span></div>`
    : "";

  // If product has sizes, show a mini size selector on the card
  const sizeSelector = sizes.length > 0
    ? `<div class="product-card__sizes">
        ${sizes.map(s => `<button class="product-card__size-btn" data-size="${s}">${s}</button>`).join("")}
       </div>`
    : "";

  return `
    <article class="product-card fade-up" data-product-id="${id}">
      <a href="product.html?id=${id}" class="product-card__image-link" aria-label="${_escapeHtml(title)}">
        <div class="product-card__image-wrap">
          ${imgSrc
            ? `<img src="${_escapeHtml(imgSrc)}"
                    alt="${_escapeHtml(title)}"
                    class="product-card__image"
                    loading="lazy"
                    onerror="this.parentElement.classList.add('product-card__image-wrap--placeholder')">`
            : `<div class="product-card__image-placeholder">
                 <i class="fa-regular fa-image"></i>
               </div>`
          }
          ${outOfStockOverlay}
          <div class="product-card__badges">
            ${badge}
            ${discountBadge}
          </div>
          <div class="product-card__actions">
            <button
              class="product-card__action-btn product-card__wishlist ${isWished ? "wishlisted" : ""}"
              data-action="wishlist"
              data-product-id="${id}"
              aria-label="${isWished ? "Remove from wishlist" : "Add to wishlist"}"
              title="${isWished ? "Remove from wishlist" : "Add to wishlist"}">
              <i class="${isWished ? "fa-solid" : "fa-regular"} fa-heart"></i>
            </button>
            <a href="product.html?id=${id}"
               class="product-card__action-btn"
               aria-label="Quick view ${_escapeHtml(title)}"
               title="View details">
              <i class="fa-regular fa-eye"></i>
            </a>
          </div>
        </div>
      </a>

      <div class="product-card__body">
        <p class="product-card__category">${_escapeHtml(category)}</p>
        <a href="product.html?id=${id}" class="product-card__title-link">
          <h3 class="product-card__title">${_escapeHtml(title)}</h3>
        </a>

        ${sizeSelector}

        <div class="product-card__footer">
          <div class="product-card__price-wrap">
            <span class="product-card__price">${formatPrice(price)}</span>
            ${originalPriceHTML}
          </div>
          <button
            class="product-card__cart-btn btn btn-primary btn-sm ${isOutOfStock ? "btn--disabled" : ""}"
            data-action="add-to-cart"
            data-product-id="${id}"
            data-title="${_escapeHtml(title)}"
            data-price="${price}"
            data-original-price="${originalPrice || ""}"
            data-image="${_escapeHtml(imgSrc)}"
            data-sizes="${_escapeHtml(JSON.stringify(sizes))}"
            ${isOutOfStock ? "disabled aria-disabled='true'" : ""}
            aria-label="Add ${_escapeHtml(title)} to cart">
            <i class="fa-solid fa-bag-shopping"></i>
            ${isOutOfStock ? "Out of Stock" : "Add to Cart"}
          </button>
        </div>
      </div>
    </article>
  `;
}

function _renderResultCount() {
  if (!_resultCount) return;
  const total = _filtered.length;
  const q     = _filters.search.trim();
  _resultCount.textContent = q
    ? `${total} result${total !== 1 ? "s" : ""} for "${q}"`
    : `${total} product${total !== 1 ? "s" : ""}`;
}

function _renderEmpty() {
  if (!_grid) return;
  _grid.innerHTML = `
    <div class="shop-empty">
      <div class="shop-empty__icon">
        <i class="fa-regular fa-face-frown-open"></i>
      </div>
      <h3 class="shop-empty__title">No products found</h3>
      <p class="shop-empty__text">
        Try adjusting your filters or search term.
      </p>
      <button class="btn btn-primary" id="empty-clear-btn">
        Clear All Filters
      </button>
    </div>
  `;
  // Wire up clear button inside empty state
  document.getElementById("empty-clear-btn")?.addEventListener("click", _clearAllFilters);

  if (_paginationEl) _paginationEl.innerHTML = "";
}

function _renderError(message) {
  if (!_grid) return;
  _grid.innerHTML = `
    <div class="shop-empty">
      <div class="shop-empty__icon" style="color:var(--color-error)">
        <i class="fa-solid fa-triangle-exclamation"></i>
      </div>
      <h3 class="shop-empty__title">Something went wrong</h3>
      <p class="shop-empty__text">${_escapeHtml(message)}</p>
      <button class="btn btn-primary" onclick="window.location.reload()">
        Try Again
      </button>
    </div>
  `;
}

// ============================================================
// PAGINATION
// ============================================================

function _renderPagination() {
  if (!_paginationEl) return;

  const totalPages = Math.ceil(_filtered.length / PAGE_SIZE);

  if (totalPages <= 1) {
    _paginationEl.innerHTML = "";
    return;
  }

  let html = `<div class="pagination">`;

  // Prev button
  html += `
    <button
      class="pagination__btn pagination__btn--prev ${_currentPage === 1 ? "disabled" : ""}"
      data-page="${_currentPage - 1}"
      ${_currentPage === 1 ? "disabled" : ""}
      aria-label="Previous page">
      <i class="fa-solid fa-chevron-left"></i>
    </button>
  `;

  // Page numbers — show max 5 around current
  const pages = _getPageNumbers(totalPages, _currentPage);
  pages.forEach(p => {
    if (p === "...") {
      html += `<span class="pagination__ellipsis">…</span>`;
    } else {
      html += `
        <button
          class="pagination__btn ${p === _currentPage ? "active" : ""}"
          data-page="${p}"
          aria-label="Page ${p}"
          ${p === _currentPage ? 'aria-current="page"' : ""}>
          ${p}
        </button>
      `;
    }
  });

  // Next button
  html += `
    <button
      class="pagination__btn pagination__btn--next ${_currentPage === totalPages ? "disabled" : ""}"
      data-page="${_currentPage + 1}"
      ${_currentPage === totalPages ? "disabled" : ""}
      aria-label="Next page">
      <i class="fa-solid fa-chevron-right"></i>
    </button>
  `;

  html += `</div>`;
  _paginationEl.innerHTML = html;

  // Bind page button clicks
  _paginationEl.querySelectorAll(".pagination__btn:not(.disabled)").forEach(btn => {
    btn.addEventListener("click", () => {
      const page = parseInt(btn.dataset.page, 10);
      if (!isNaN(page) && page !== _currentPage) {
        _currentPage = page;
        _renderPage();
        _renderPagination();
        window.scrollTo({ top: _grid?.offsetTop - 100 || 0, behavior: "smooth" });
      }
    });
  });
}

/** Generate page numbers array with ellipsis. e.g. [1, '...', 4, 5, 6, '...', 12] */
function _getPageNumbers(total, current) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = [1];
  if (current > 3) pages.push("...");

  const start = Math.max(2, current - 1);
  const end   = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  if (current < total - 2) pages.push("...");
  pages.push(total);

  return pages;
}

// ============================================================
// EVENT BINDING
// ============================================================

/** Live search with 300ms debounce */
function _bindSearch() {
  if (!_searchInput) return;

  // Pre-fill from URL
  _searchInput.value = _filters.search;

  _searchInput.addEventListener("input", debounce(e => {
    _filters.search = e.target.value.trim();
    _applyFiltersAndRender();
  }, 300));

  // Clear on Escape
  _searchInput.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      _searchInput.value = "";
      _filters.search = "";
      _applyFiltersAndRender();
    }
  });
}

function _bindSort() {
  if (!_sortSelect) return;
  _sortSelect.value = _filters.sort;
  _sortSelect.addEventListener("change", e => {
    _filters.sort = e.target.value;
    _applyFiltersAndRender();
  });
}

function _bindCategoryCheckboxes() {
  const checkboxes = document.querySelectorAll(".filter-category");
  checkboxes.forEach(cb => {
    cb.checked = _filters.category === cb.value;
    cb.addEventListener("change", () => {
      if (cb.checked) {
        _filters.category = cb.value;
        // Uncheck siblings
        checkboxes.forEach(other => {
          if (other !== cb) other.checked = false;
        });
      } else {
        _filters.category = "all";
      }
      _applyFiltersAndRender();
    });
  });
}

function _bindSizeCheckboxes() {
  const checkboxes = document.querySelectorAll(".filter-size");
  checkboxes.forEach(cb => {
    cb.checked = _filters.sizes.includes(cb.value);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        if (!_filters.sizes.includes(cb.value)) {
          _filters.sizes.push(cb.value);
        }
      } else {
        _filters.sizes = _filters.sizes.filter(s => s !== cb.value);
      }
      _applyFiltersAndRender();
    });
  });
}

function _bindPriceRange() {
  if (!_priceMinInput || !_priceMaxInput) return;

  _priceMinInput.value = _filters.priceMin;
  _priceMaxInput.value = _filters.priceMax;
  _updatePriceLabels();

  const handler = debounce(() => {
    const min = parseInt(_priceMinInput.value, 10) || 0;
    const max = parseInt(_priceMaxInput.value, 10) || 10000;
    _filters.priceMin = Math.min(min, max);
    _filters.priceMax = Math.max(min, max);
    _updatePriceLabels();
    _applyFiltersAndRender();
  }, 250);

  _priceMinInput.addEventListener("input", handler);
  _priceMaxInput.addEventListener("input", handler);
}

function _updatePriceLabels() {
  if (_priceMinLabel) _priceMinLabel.textContent = formatPrice(_filters.priceMin);
  if (_priceMaxLabel) _priceMaxLabel.textContent = formatPrice(_filters.priceMax);
}

function _bindClearFilters() {
  if (!_clearBtn) return;
  _clearBtn.addEventListener("click", _clearAllFilters);
}

function _clearAllFilters() {
  _filters.category = "all";
  _filters.search   = "";
  _filters.priceMin = 0;
  _filters.priceMax = 10000;
  _filters.sizes    = [];
  _filters.sort     = "newest";

  _syncFilterUI();
  _applyFiltersAndRender();
}

/** Mobile sidebar toggle */
function _bindSidebarToggle() {
  if (!_sidebarToggle || !_sidebar) return;

  _sidebarToggle.addEventListener("click", () => {
    const isOpen = _sidebar.classList.toggle("sidebar--open");
    _sidebarToggle.setAttribute("aria-expanded", String(isOpen));
    document.body.classList.toggle("sidebar-open", isOpen);
  });

  // Close sidebar when clicking outside on mobile
  document.addEventListener("click", e => {
    if (
      _sidebar.classList.contains("sidebar--open") &&
      !_sidebar.contains(e.target) &&
      e.target !== _sidebarToggle
    ) {
      _sidebar.classList.remove("sidebar--open");
      _sidebarToggle.setAttribute("aria-expanded", "false");
      document.body.classList.remove("sidebar-open");
    }
  });
}

/**
 * Delegate card-level button clicks:
 * - "add-to-cart"
 * - "wishlist"
 */
function _bindGridEvents() {
  if (!_grid) return;

  _grid.addEventListener("click", async e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;

    const action    = btn.dataset.action;
    const productId = btn.dataset.productId;

    // ── Add to Cart ────────────────────────────────────────
    if (action === "add-to-cart") {
      e.preventDefault();

      // Resolve selected size (if product has sizes, find selected btn)
      const card         = btn.closest(".product-card");
      const activeSizeBtn = card?.querySelector(".product-card__size-btn.active");
      const sizesRaw     = btn.dataset.sizes;
      let sizes = [];
      try { sizes = JSON.parse(sizesRaw); } catch (_) {}

      // If product has sizes but none selected, prompt user
      if (sizes.length > 0 && !activeSizeBtn) {
        showToast("Please select a size first.", "info");
        // Navigate to product page for full size selection
        window.location.href = `product.html?id=${productId}`;
        return;
      }

      const selectedSize = activeSizeBtn?.dataset.size || "";
      const title        = btn.dataset.title    || "";
      const price        = parseFloat(btn.dataset.price) || 0;
      const originalPrice= parseFloat(btn.dataset.originalPrice) || null;
      const imageURL     = btn.dataset.image    || "";

      const result = addToCart(productId, title, price, selectedSize, 1, imageURL, originalPrice);

      if (result.success) {
        showToast(`"${title}" added to cart!`, "success");
        updateCartBadge(result.cart.reduce((s, i) => s + i.quantity, 0));

        // Visual feedback on button
        btn.innerHTML = `<i class="fa-solid fa-check"></i> Added!`;
        btn.classList.add("btn--success");
        setTimeout(() => {
          btn.innerHTML = `<i class="fa-solid fa-bag-shopping"></i> Add to Cart`;
          btn.classList.remove("btn--success");
        }, 2000);
      } else {
        showToast(result.message || "Could not add to cart.", "error");
      }
    }

    // ── Wishlist ───────────────────────────────────────────
    if (action === "wishlist") {
      e.preventDefault();
      const isNowWished = toggleWishlist(productId);
      const icon        = btn.querySelector("i");

      if (icon) {
        icon.className = isNowWished ? "fa-solid fa-heart" : "fa-regular fa-heart";
      }
      btn.classList.toggle("wishlisted", isNowWished);
      btn.setAttribute("aria-label", isNowWished ? "Remove from wishlist" : "Add to wishlist");

      showToast(
        isNowWished ? "Added to wishlist ♥" : "Removed from wishlist",
        isNowWished ? "success" : "info"
      );
    }
  });

  // Size button selection within cards
  _grid.addEventListener("click", e => {
    const sizeBtn = e.target.closest(".product-card__size-btn");
    if (!sizeBtn) return;
    e.preventDefault();

    const card = sizeBtn.closest(".product-card");
    card?.querySelectorAll(".product-card__size-btn").forEach(b => b.classList.remove("active"));
    sizeBtn.classList.add("active");
  });
}

// ============================================================
// URL PARAM PERSISTENCE
// ============================================================

/** Write current filter state to URL without page reload. */
function _updateURL() {
  const params = new URLSearchParams();

  if (_filters.category !== "all")   params.set("category", _filters.category);
  if (_filters.search)               params.set("search",   _filters.search);
  if (_filters.priceMin > 0)         params.set("pmin",     _filters.priceMin);
  if (_filters.priceMax < 10000)     params.set("pmax",     _filters.priceMax);
  if (_filters.sizes.length)         params.set("sizes",    _filters.sizes.join(","));
  if (_filters.sort !== "newest")    params.set("sort",     _filters.sort);

  const newURL = params.toString()
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname;

  window.history.replaceState(null, "", newURL);
}

/** Read URL params and populate _filters before first render. */
function _readParamsIntoFilters() {
  _filters.category = getParam("category") || "all";
  _filters.search   = getParam("search")   || "";
  _filters.priceMin = parseInt(getParam("pmin"), 10) || 0;
  _filters.priceMax = parseInt(getParam("pmax"), 10) || 10000;
  _filters.sort     = getParam("sort")     || "newest";

  const sizesParam  = getParam("sizes");
  _filters.sizes    = sizesParam ? sizesParam.split(",").filter(Boolean) : [];
}

// ============================================================
// UI SYNC — keep filter controls in sync with _filters state
// ============================================================

function _syncFilterUI() {
  // Search
  if (_searchInput) _searchInput.value = _filters.search;

  // Sort
  if (_sortSelect) _sortSelect.value = _filters.sort;

  // Category checkboxes
  document.querySelectorAll(".filter-category").forEach(cb => {
    cb.checked = cb.value === _filters.category;
  });

  // Size checkboxes
  document.querySelectorAll(".filter-size").forEach(cb => {
    cb.checked = _filters.sizes.includes(cb.value);
  });

  // Price range
  if (_priceMinInput) _priceMinInput.value = _filters.priceMin;
  if (_priceMaxInput) _priceMaxInput.value = _filters.priceMax;
  _updatePriceLabels();
}

// ============================================================
// HELPERS
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
