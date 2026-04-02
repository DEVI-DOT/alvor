// ============================================================
// ALVOR — Admin Panel  (js/admin.js)
// "Where Thread Meets Tradition"
// ============================================================
// Tabs:
//   Dashboard | Products | Orders | Customers | Coupons | Settings
//
// Auth:
//   Firebase Google sign-in → verify email === ADMIN_EMAIL
//   If mismatch → "Access Denied" + auto sign-out
//
// All Firestore operations imported from firebase-config.js
// ============================================================

import {
  db,
  auth,
  storage,
  googleProvider,
  signInWithPopup,
  firebaseSignOut,
  onAuthStateChanged,
  collection, doc,
  getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit,
  serverTimestamp,
  onSnapshot,
  COLLECTIONS,
  SETTINGS_DOC_ID,
  getProducts,
  getProductById,
  addProduct,
  updateProduct,
  deleteProduct,
  getOrders,
  updateOrderStatus,
  getCustomers,
  getSettings,
  updateSettings,
  getCoupons,
  addCoupon,
  toggleCoupon,
  getAllReviews,
  uploadImage,
  deleteImage,
  sanitiseString,
  sanitiseNumber,
  listenToNewOrders
} from "./firebase-config.js";

import {
  showToast,
  showModal,
  hideModal,
  formatPrice,
  formatDate,
  confirmDialog
} from "./ui.js";

// ── Admin Config ──────────────────────────────────────────────
const ADMIN_EMAIL = "youremail@gmail.com"; // ⚠️ Replace before go-live

// ── State ─────────────────────────────────────────────────────
let _currentUser      = null;
let _products         = [];
let _orders           = [];
let _customers        = [];
let _coupons          = [];
let _settings         = {};
let _activeTab        = "dashboard";
let _editingProductId = null;
let _uploadedImageURLs= [];
let _unsubscribeOrders= null;   // real-time listener cleanup

// ── Upload queue tracking ─────────────────────────────────────
let _uploadQueue      = [];

// ============================================================
// ENTRY POINT
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  _initAuthWatcher();
  _bindSidebarNav();
  _bindMobileSidebarToggle();
});

// ============================================================
// AUTH
// ============================================================

function _initAuthWatcher() {
  const loginScreen   = document.getElementById("admin-login");
  const dashboard     = document.getElementById("admin-dashboard");
  const deniedScreen  = document.getElementById("admin-denied");

  onAuthStateChanged(auth, async user => {
    if (!user) {
      // Not logged in — show login screen
      _showScreen(loginScreen);
      _bindLoginButton();
      return;
    }

    if (user.email !== ADMIN_EMAIL) {
      // Wrong account — show denied screen + sign out
      _showScreen(deniedScreen);
      _currentUser = null;
      setTimeout(() => firebaseSignOut(auth), 3000);
      _bindDeniedLogout();
      return;
    }

    // ── Authorised ───────────────────────────────────────────
    _currentUser = user;
    _showScreen(dashboard);
    _renderAdminHeader(user);
    await _initDashboard();
    _bindLogoutButton();
  });
}

function _showScreen(el) {
  ["admin-login", "admin-dashboard", "admin-denied"].forEach(id => {
    const screen = document.getElementById(id);
    if (screen) screen.style.display = screen === el ? "" : "none";
  });
}

function _bindLoginButton() {
  const btn = document.getElementById("btn-admin-login");
  if (!btn || btn._bound) return;
  btn._bound = true;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Signing in…`;
    try {
      await signInWithPopup(auth, googleProvider);
      // onAuthStateChanged will handle the rest
    } catch (err) {
      if (err.code !== "auth/popup-closed-by-user") {
        showToast("Sign-in failed. Please try again.", "error");
      }
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-brands fa-google"></i> Sign in with Google`;
    }
  });
}

function _bindLogoutButton() {
  const btn = document.getElementById("btn-admin-logout");
  if (!btn || btn._bound) return;
  btn._bound = true;
  btn.addEventListener("click", async () => {
    if (_unsubscribeOrders) _unsubscribeOrders();
    await firebaseSignOut(auth);
  });
}

function _bindDeniedLogout() {
  const btn = document.getElementById("btn-denied-logout");
  if (!btn || btn._bound) return;
  btn._bound = true;
  btn.addEventListener("click", () => firebaseSignOut(auth));
}

function _renderAdminHeader(user) {
  const nameEl  = document.getElementById("admin-user-name");
  const photoEl = document.getElementById("admin-user-photo");
  if (nameEl)  nameEl.textContent = user.displayName || user.email;
  if (photoEl && user.photoURL) {
    photoEl.src = user.photoURL;
    photoEl.style.display = "";
  }
}

// ============================================================
// SIDEBAR NAVIGATION
// ============================================================

function _bindSidebarNav() {
  document.querySelectorAll(".admin-sidebar__link[data-tab]").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const tab = link.dataset.tab;
      _switchTab(tab);
    });
  });
}

function _bindMobileSidebarToggle() {
  const toggle  = document.getElementById("admin-sidebar-toggle");
  const sidebar = document.getElementById("admin-sidebar");
  if (!toggle || !sidebar) return;

  toggle.addEventListener("click", () => {
    sidebar.classList.toggle("admin-sidebar--open");
  });

  // Close on outside click
  document.addEventListener("click", e => {
    if (sidebar.classList.contains("admin-sidebar--open") &&
        !sidebar.contains(e.target) && e.target !== toggle) {
      sidebar.classList.remove("admin-sidebar--open");
    }
  });
}

async function _switchTab(tab) {
  _activeTab = tab;

  // Update sidebar active state
  document.querySelectorAll(".admin-sidebar__link[data-tab]").forEach(l => {
    l.classList.toggle("active", l.dataset.tab === tab);
  });

  // Show correct panel
  document.querySelectorAll(".admin-panel").forEach(p => {
    p.style.display = p.dataset.panel === tab ? "" : "none";
  });

  // Close mobile sidebar
  document.getElementById("admin-sidebar")?.classList.remove("admin-sidebar--open");

  // Load data for tab
  switch (tab) {
    case "dashboard": await _initDashboard();  break;
    case "products":  await _loadProducts();   break;
    case "orders":    await _loadOrders();     break;
    case "customers": await _loadCustomers();  break;
    case "coupons":   await _loadCoupons();    break;
    case "settings":  await _loadSettings();   break;
  }
}

// ============================================================
// DASHBOARD TAB
// ============================================================

async function _initDashboard() {
  try {
    // Load stats in parallel
    const [products, orders, settings] = await Promise.all([
      getProducts(),
      getOrders(),
      getSettings()
    ]);

    _products = products;
    _orders   = orders;
    _settings = settings || {};

    // ── Stat cards ───────────────────────────────────────────
    _setText("stat-total-products", _products.length);
    _setText("stat-total-orders",   _orders.length);

    const today     = new Date();
    today.setHours(0, 0, 0, 0);
    const todayOrders = _orders.filter(o => {
      const ts = o.createdAt?.seconds * 1000 || 0;
      return ts >= today.getTime();
    });
    _setText("stat-today-orders", todayOrders.length);

    const weekAgo    = new Date(today.getTime() - 7 * 86400000);
    const weekOrders = _orders.filter(o => {
      const ts = o.createdAt?.seconds * 1000 || 0;
      return ts >= weekAgo.getTime();
    });
    _setText("stat-week-orders", weekOrders.length);

    // ── Recent orders table ──────────────────────────────────
    _renderRecentOrders(_orders.slice(0, 5));

    // ── Start real-time new orders listener ──────────────────
    _startNewOrdersListener();

  } catch (err) {
    console.error("Dashboard init error:", err);
    showToast("Failed to load dashboard data.", "error");
  }
}

function _renderRecentOrders(orders) {
  const tbody = document.getElementById("recent-orders-tbody");
  if (!tbody) return;

  if (!orders.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No orders yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map(o => `
    <tr>
      <td><code class="order-id">${_esc(o.id || "—")}</code></td>
      <td>${_esc(o.customerName || "—")}</td>
      <td>${_esc(o.customerPhone || "—")}</td>
      <td>${formatPrice(o.totalAmount || 0)}</td>
      <td><span class="badge status-${_esc(o.status || "new")}">${_esc(_formatStatus(o.status))}</span></td>
      <td>${o.createdAt ? formatDate(o.createdAt) : "—"}</td>
    </tr>
  `).join("");
}

function _startNewOrdersListener() {
  if (_unsubscribeOrders) _unsubscribeOrders(); // clean up old listener

  _unsubscribeOrders = listenToNewOrders(newOrders => {
    const badge = document.getElementById("new-orders-badge");
    if (badge) {
      badge.textContent = newOrders.length || "";
      badge.style.display = newOrders.length ? "inline-flex" : "none";
    }
  });
}

// ============================================================
// PRODUCTS TAB
// ============================================================

async function _loadProducts() {
  const container = document.getElementById("products-tbody");
  if (container) container.innerHTML = _skeletonRows(6, 8);

  try {
    _products = await getProducts();
    _renderProductsTable(_products);
    _bindAddProductButton();
  } catch (err) {
    console.error("Load products error:", err);
    showToast("Failed to load products.", "error");
  }
}

function _renderProductsTable(products) {
  const tbody = document.getElementById("products-tbody");
  if (!tbody) return;

  if (!products.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">No products yet. Click "Add Product" to get started.</td></tr>`;
    return;
  }

  tbody.innerHTML = products.map(p => {
    const img = p.mainImage || (p.images?.[0] || "");
    return `
      <tr data-product-id="${p.id}">
        <td>
          <div class="product-table-img-wrap">
            ${img
              ? `<img src="${_esc(img)}" alt="${_esc(p.title)}" class="product-table-img" loading="lazy">`
              : `<div class="product-table-img-placeholder"><i class="fa-regular fa-image"></i></div>`
            }
          </div>
        </td>
        <td class="td-title">${_esc(p.title || "—")}</td>
        <td>${_esc(p.category || "—")}</td>
        <td>${formatPrice(p.price || 0)}</td>
        <td>${p.stock ?? "—"}</td>
        <td>
          <label class="admin-toggle" title="${p.visible ? "Visible" : "Hidden"}">
            <input type="checkbox"
                   class="product-visible-toggle"
                   data-id="${p.id}"
                   ${p.visible ? "checked" : ""}
                   aria-label="Toggle visibility">
            <span class="admin-toggle__track"></span>
          </label>
        </td>
        <td>
          <div class="table-actions">
            <button class="btn-table-action btn-table-edit"
                    data-action="edit-product"
                    data-id="${p.id}"
                    title="Edit product">
              <i class="fa-regular fa-pen-to-square"></i>
            </button>
            <button class="btn-table-action btn-table-delete"
                    data-action="delete-product"
                    data-id="${p.id}"
                    title="Delete product">
              <i class="fa-regular fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  // Bind visibility toggles
  tbody.querySelectorAll(".product-visible-toggle").forEach(chk => {
    chk.addEventListener("change", async () => {
      try {
        await updateProduct(chk.dataset.id, { visible: chk.checked });
        showToast(`Product ${chk.checked ? "visible" : "hidden"}.`, "success");
      } catch (_) {
        showToast("Failed to update visibility.", "error");
        chk.checked = !chk.checked; // revert
      }
    });
  });

  // Bind edit/delete buttons
  tbody.addEventListener("click", async e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;

    const id     = btn.dataset.id;
    const action = btn.dataset.action;

    if (action === "edit-product") {
      await _openProductModal(id);
    }

    if (action === "delete-product") {
      const confirmed = await confirmDialog(
        "Delete Product",
        "Are you sure you want to permanently delete this product? This cannot be undone.",
        "Delete",
        "Cancel"
      );
      if (!confirmed) return;

      try {
        await deleteProduct(id);
        showToast("Product deleted.", "success");
        await _loadProducts();
      } catch (_) {
        showToast("Failed to delete product.", "error");
      }
    }
  });
}

function _bindAddProductButton() {
  const btn = document.getElementById("btn-add-product");
  if (!btn || btn._bound) return;
  btn._bound = true;
  btn.addEventListener("click", () => _openProductModal(null));
}

// ── Product Modal ─────────────────────────────────────────────

async function _openProductModal(productId) {
  _editingProductId  = productId || null;
  _uploadedImageURLs = [];
  _uploadQueue       = [];

  const overlay = document.getElementById("product-modal-overlay");
  const title   = document.getElementById("product-modal-title");
  if (!overlay) return;

  if (title) title.textContent = productId ? "Edit Product" : "Add Product";

  // Reset form
  const form = document.getElementById("product-form");
  form?.reset();
  _clearImagePreviews();

  // If editing — pre-fill
  if (productId) {
    try {
      const p = await getProductById(productId);
      if (p) {
        _fillProductForm(p);
        _uploadedImageURLs = [...(p.images || [])];
        if (p.mainImage && !_uploadedImageURLs.includes(p.mainImage)) {
          _uploadedImageURLs.unshift(p.mainImage);
        }
        _renderImagePreviews(_uploadedImageURLs);
      }
    } catch (err) {
      showToast("Failed to load product data.", "error");
      return;
    }
  }

  _bindImageUpload();
  _bindProductFormSubmit();
  showModal(overlay);
}

function _fillProductForm(p) {
  _setField("pf-title",          p.title          || "");
  _setField("pf-category",       p.category       || "");
  _setField("pf-description",    p.description    || "");
  _setField("pf-price",          p.price          || "");
  _setField("pf-original-price", p.originalPrice  || "");
  _setField("pf-stock",          p.stock          ?? "");
  _setField("pf-estimated-days", p.estimatedDays  || "");

  // Sizes — comma-separated
  const sizesInput = document.getElementById("pf-sizes");
  if (sizesInput) sizesInput.value = Array.isArray(p.sizes) ? p.sizes.join(", ") : "";

  // Tags checkboxes
  ["bestseller", "new", "featured"].forEach(tag => {
    const chk = document.getElementById(`pf-tag-${tag}`);
    if (chk) chk.checked = Array.isArray(p.tags) && p.tags.includes(tag);
  });

  // Visible toggle
  const visChk = document.getElementById("pf-visible");
  if (visChk) visChk.checked = p.visible !== false;
}

function _bindProductFormSubmit() {
  const form = document.getElementById("product-form");
  if (!form || form._bound) return;
  form._bound = true;

  form.addEventListener("submit", async e => {
    e.preventDefault();
    await _submitProductForm();
  });
}

async function _submitProductForm() {
  const saveBtn = document.getElementById("btn-save-product");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving…`;
  }

  try {
    // ── Upload any pending files first ───────────────────────
    if (_uploadQueue.length) {
      showToast(`Uploading ${_uploadQueue.length} image(s)…`, "info", 0);
      for (const file of _uploadQueue) {
        const url = await uploadImage(file, "products", pct => {
          if (saveBtn) saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Uploading… ${pct}%`;
        });
        _uploadedImageURLs.push(url);
      }
      _uploadQueue = [];
    }

    // ── Build sizes array ────────────────────────────────────
    const sizesRaw = (_getField("pf-sizes") || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    // ── Build tags array ─────────────────────────────────────
    const tags = ["bestseller", "new", "featured"].filter(tag => {
      return document.getElementById(`pf-tag-${tag}`)?.checked;
    });

    const productData = {
      title         : sanitiseString(_getField("pf-title")),
      category      : sanitiseString(_getField("pf-category")),
      description   : sanitiseString(_getField("pf-description")),
      price         : sanitiseNumber(_getField("pf-price")),
      originalPrice : sanitiseNumber(_getField("pf-original-price")),
      sizes         : sizesRaw,
      stock         : sanitiseNumber(_getField("pf-stock")),
      estimatedDays : sanitiseString(_getField("pf-estimated-days")),
      tags,
      visible       : document.getElementById("pf-visible")?.checked ?? true,
      images        : _uploadedImageURLs,
      mainImage     : _uploadedImageURLs[0] || ""
    };

    // ── Validate required fields ──────────────────────────────
    if (!productData.title) { showToast("Product title is required.", "error"); return; }
    if (!productData.category) { showToast("Category is required.", "error"); return; }
    if (!productData.price || productData.price <= 0) { showToast("Valid price is required.", "error"); return; }

    if (_editingProductId) {
      await updateProduct(_editingProductId, productData);
      showToast("Product updated successfully!", "success");
    } else {
      await addProduct(productData);
      showToast("Product added successfully!", "success");
    }

    hideModal(document.getElementById("product-modal-overlay"));
    await _loadProducts();

  } catch (err) {
    console.error("Save product error:", err);
    showToast("Failed to save product. Please try again.", "error");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i class="fa-regular fa-floppy-disk"></i> Save Product`;
    }
  }
}

// ── Image Upload ──────────────────────────────────────────────

function _bindImageUpload() {
  const input = document.getElementById("pf-images");
  if (!input || input._bound) return;
  input._bound = true;

  input.addEventListener("change", e => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    const maxSize    = 5 * 1024 * 1024; // 5MB

    files.forEach(file => {
      if (!validTypes.includes(file.type)) {
        showToast(`${file.name}: Invalid file type. Use JPG, PNG or WebP.`, "error");
        return;
      }
      if (file.size > maxSize) {
        showToast(`${file.name}: File too large (max 5MB).`, "error");
        return;
      }
      _uploadQueue.push(file);

      // Local preview
      const reader = new FileReader();
      reader.onload = ev => {
        _addImagePreview(ev.target.result, null, true); // isPending = true
      };
      reader.readAsDataURL(file);
    });

    input.value = ""; // reset input so same file can be re-added
  });
}

function _addImagePreview(src, url, isPending = false) {
  const wrap = document.getElementById("image-preview-list");
  if (!wrap) return;

  const item = document.createElement("div");
  item.className = `image-preview-item ${isPending ? "image-preview-item--pending" : ""}`;
  item.innerHTML = `
    <img src="${_esc(src)}" alt="Product image" class="image-preview-img">
    ${isPending ? `<span class="image-preview-badge">Pending</span>` : ""}
    <button type="button" class="image-preview-remove" aria-label="Remove image">
      <i class="fa-solid fa-xmark"></i>
    </button>
    ${!isPending ? `<button type="button" class="image-preview-set-main" title="Set as main image">
      <i class="fa-solid fa-star"></i>
    </button>` : ""}
  `;

  // Remove button
  item.querySelector(".image-preview-remove").addEventListener("click", () => {
    if (!isPending && url) {
      _uploadedImageURLs = _uploadedImageURLs.filter(u => u !== url);
    } else if (isPending) {
      const idx = _uploadQueue.findIndex(f => {
        /* approximate match via preview src */
        return true; // remove first pending — simplification
      });
      if (idx !== -1) _uploadQueue.splice(idx, 1);
    }
    item.remove();
  });

  // Set as main image
  item.querySelector(".image-preview-set-main")?.addEventListener("click", () => {
    if (url) {
      _uploadedImageURLs = [url, ..._uploadedImageURLs.filter(u => u !== url)];
      wrap.prepend(item);
      showToast("Main image updated.", "success");
    }
  });

  wrap.appendChild(item);
}

function _renderImagePreviews(urls) {
  _clearImagePreviews();
  urls.forEach(url => _addImagePreview(url, url, false));
}

function _clearImagePreviews() {
  const wrap = document.getElementById("image-preview-list");
  if (wrap) wrap.innerHTML = "";
}

// ============================================================
// ORDERS TAB
// ============================================================

async function _loadOrders(statusFilter = "") {
  const container = document.getElementById("orders-tbody");
  if (container) container.innerHTML = _skeletonRows(5, 7);

  try {
    _orders = await getOrders(statusFilter ? { status: statusFilter } : {});
    _renderOrdersTable(_orders);
    _bindOrderFilters();
  } catch (err) {
    console.error("Load orders error:", err);
    showToast("Failed to load orders.", "error");
  }
}

function _renderOrdersTable(orders) {
  const tbody = document.getElementById("orders-tbody");
  if (!tbody) return;

  if (!orders.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">No orders found.</td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map(o => `
    <tr data-order-doc-id="${o.docId}">
      <td><code class="order-id">${_esc(o.id || "—")}</code></td>
      <td>${_esc(o.customerName  || "—")}</td>
      <td>
        <a href="https://wa.me/${(o.customerPhone || "").replace(/\D/g,"")}"
           target="_blank" rel="noopener"
           class="link-whatsapp"
           title="Open WhatsApp">
          <i class="fa-brands fa-whatsapp"></i> ${_esc(o.customerPhone || "—")}
        </a>
      </td>
      <td>${formatPrice(o.totalAmount || 0)}</td>
      <td>
        <select class="order-status-select form-select form-select--sm"
                data-doc-id="${o.docId}"
                aria-label="Order status">
          ${["new","contacted","in-progress","completed","cancelled"].map(s => `
            <option value="${s}" ${o.status === s ? "selected" : ""}>${_formatStatus(s)}</option>
          `).join("")}
        </select>
      </td>
      <td>${o.createdAt ? formatDate(o.createdAt) : "—"}</td>
      <td>
        <button class="btn-table-action btn-table-view"
                data-action="view-order"
                data-doc-id="${o.docId}"
                title="View order details">
          <i class="fa-regular fa-eye"></i>
        </button>
      </td>
    </tr>
  `).join("");

  // Status change
  tbody.querySelectorAll(".order-status-select").forEach(sel => {
    sel.addEventListener("change", async () => {
      try {
        await updateOrderStatus(sel.dataset.docId, sel.value);
        showToast(`Order status updated to "${_formatStatus(sel.value)}".`, "success");
        sel.closest("tr")?.querySelector(".badge")?.setAttribute("class", `badge status-${sel.value}`);
      } catch (_) {
        showToast("Failed to update status.", "error");
      }
    });
  });

  // View order detail
  tbody.addEventListener("click", e => {
    const btn = e.target.closest("[data-action='view-order']");
    if (!btn) return;
    const order = _orders.find(o => o.docId === btn.dataset.docId);
    if (order) _openOrderDetailModal(order);
  });
}

function _openOrderDetailModal(order) {
  const overlay = document.getElementById("order-modal-overlay");
  const body    = document.getElementById("order-modal-body");
  if (!overlay || !body) return;

  const items = Array.isArray(order.items) ? order.items : [];

  body.innerHTML = `
    <div class="order-detail">
      <div class="order-detail__row">
        <span class="order-detail__label">Order ID</span>
        <strong class="order-detail__value">#${_esc(order.id)}</strong>
      </div>
      <div class="order-detail__row">
        <span class="order-detail__label">Status</span>
        <span class="badge status-${_esc(order.status)}">${_esc(_formatStatus(order.status))}</span>
      </div>
      <div class="order-detail__row">
        <span class="order-detail__label">Date</span>
        <span>${order.createdAt ? formatDate(order.createdAt) : "—"}</span>
      </div>
      <hr class="order-detail__divider">
      <div class="order-detail__row">
        <span class="order-detail__label">Customer</span>
        <span>${_esc(order.customerName || "—")}</span>
      </div>
      <div class="order-detail__row">
        <span class="order-detail__label">WhatsApp</span>
        <a href="https://wa.me/${(order.customerPhone||"").replace(/\D/g,"")}"
           target="_blank" rel="noopener" class="link-gold">
          ${_esc(order.customerPhone || "—")}
        </a>
      </div>
      ${order.customerEmail ? `
        <div class="order-detail__row">
          <span class="order-detail__label">Email</span>
          <span>${_esc(order.customerEmail)}</span>
        </div>` : ""}
      <div class="order-detail__row">
        <span class="order-detail__label">Address</span>
        <span>${_esc(order.address || "—")}, ${_esc(order.city || "")} – ${_esc(order.pincode || "")}</span>
      </div>
      ${order.landmark ? `
        <div class="order-detail__row">
          <span class="order-detail__label">Landmark</span>
          <span>${_esc(order.landmark)}</span>
        </div>` : ""}
      ${order.notes ? `
        <div class="order-detail__row">
          <span class="order-detail__label">Notes</span>
          <span>${_esc(order.notes)}</span>
        </div>` : ""}
      <hr class="order-detail__divider">
      <div class="order-detail__items">
        ${items.map(item => `
          <div class="order-detail__item">
            ${item.imageURL
              ? `<img src="${_esc(item.imageURL)}" alt="${_esc(item.title)}" class="order-detail__item-img" loading="lazy">`
              : `<div class="order-detail__item-img-placeholder"></div>`
            }
            <div class="order-detail__item-info">
              <span class="order-detail__item-title">${_esc(item.title || "—")}</span>
              ${item.size ? `<span class="order-detail__item-size">Size: ${_esc(item.size)}</span>` : ""}
              <span class="order-detail__item-qty">Qty: ${item.quantity || 1}</span>
            </div>
            <span class="order-detail__item-price">${formatPrice((item.price || 0) * (item.quantity || 1))}</span>
          </div>
        `).join("")}
      </div>
      <hr class="order-detail__divider">
      <div class="order-detail__row">
        <span class="order-detail__label">Subtotal</span>
        <span>${formatPrice(order.totalAmount + (order.discountAmount || 0))}</span>
      </div>
      ${order.discountAmount ? `
        <div class="order-detail__row">
          <span class="order-detail__label">Discount (${_esc(order.couponCode || "")})</span>
          <span class="text-success">−${formatPrice(order.discountAmount)}</span>
        </div>` : ""}
      <div class="order-detail__row order-detail__row--total">
        <span class="order-detail__label"><strong>Total</strong></span>
        <strong class="text-gold">${formatPrice(order.totalAmount || 0)}</strong>
      </div>
    </div>
  `;

  showModal(overlay);
}

function _bindOrderFilters() {
  // Status filter tabs
  document.querySelectorAll(".order-filter-tab").forEach(btn => {
    if (btn._bound) return;
    btn._bound = true;
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".order-filter-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      await _loadOrders(btn.dataset.status || "");
    });
  });

  // Search by name/phone/orderId
  const searchInput = document.getElementById("orders-search");
  if (searchInput && !searchInput._bound) {
    searchInput._bound = true;
    searchInput.addEventListener("input", _debounce(e => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) {
        _renderOrdersTable(_orders);
        return;
      }
      const filtered = _orders.filter(o =>
        (o.id             || "").toLowerCase().includes(q) ||
        (o.customerName   || "").toLowerCase().includes(q) ||
        (o.customerPhone  || "").toLowerCase().includes(q)
      );
      _renderOrdersTable(filtered);
    }, 300));
  }
}

// ============================================================
// CUSTOMERS TAB
// ============================================================

async function _loadCustomers() {
  const container = document.getElementById("customers-tbody");
  if (container) container.innerHTML = _skeletonRows(4, 5);

  try {
    _customers = await getCustomers();
    _renderCustomersTable(_customers);
  } catch (err) {
    console.error("Load customers error:", err);
    showToast("Failed to load customers.", "error");
  }
}

function _renderCustomersTable(customers) {
  const tbody = document.getElementById("customers-tbody");
  if (!tbody) return;

  if (!customers.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">No customers yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = customers.map(c => `
    <tr>
      <td>${_esc(c.name  || "—")}</td>
      <td>${_esc(c.phone || "—")}</td>
      <td>${_esc(c.email || "—")}</td>
      <td>${Array.isArray(c.orderHistory) ? c.orderHistory.length : 0}</td>
      <td>${c.createdAt ? formatDate(c.createdAt) : "—"}</td>
    </tr>
  `).join("");
}

// ============================================================
// COUPONS TAB
// ============================================================

async function _loadCoupons() {
  const container = document.getElementById("coupons-tbody");
  if (container) container.innerHTML = _skeletonRows(3, 6);

  try {
    _coupons = await getCoupons();
    _renderCouponsTable(_coupons);
    _bindAddCouponForm();
  } catch (err) {
    console.error("Load coupons error:", err);
    showToast("Failed to load coupons.", "error");
  }
}

function _renderCouponsTable(coupons) {
  const tbody = document.getElementById("coupons-tbody");
  if (!tbody) return;

  if (!coupons.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No coupons yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = coupons.map(c => `
    <tr>
      <td><code class="coupon-code">${_esc(c.code || "—")}</code></td>
      <td>${c.discountPercent || 0}%</td>
      <td>${formatPrice(c.minOrder || 0)}</td>
      <td>${c.expiryDate ? new Date(c.expiryDate).toLocaleDateString("en-IN") : "No expiry"}</td>
      <td>
        <label class="admin-toggle">
          <input type="checkbox"
                 class="coupon-active-toggle"
                 data-id="${c.id}"
                 ${c.active ? "checked" : ""}
                 aria-label="Toggle coupon">
          <span class="admin-toggle__track"></span>
        </label>
      </td>
      <td>
        <button class="btn-table-action btn-table-delete"
                data-action="delete-coupon"
                data-id="${c.id}"
                title="Delete coupon">
          <i class="fa-regular fa-trash-can"></i>
        </button>
      </td>
    </tr>
  `).join("");

  // Toggle active
  tbody.querySelectorAll(".coupon-active-toggle").forEach(chk => {
    chk.addEventListener("change", async () => {
      try {
        await toggleCoupon(chk.dataset.id, chk.checked);
        showToast(`Coupon ${chk.checked ? "activated" : "deactivated"}.`, "success");
      } catch (_) {
        showToast("Failed to update coupon.", "error");
        chk.checked = !chk.checked;
      }
    });
  });

  // Delete coupon
  tbody.addEventListener("click", async e => {
    const btn = e.target.closest("[data-action='delete-coupon']");
    if (!btn) return;

    const confirmed = await confirmDialog(
      "Delete Coupon",
      "Delete this coupon permanently?",
      "Delete", "Cancel"
    );
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, COLLECTIONS.COUPONS, btn.dataset.id));
      showToast("Coupon deleted.", "success");
      await _loadCoupons();
    } catch (_) {
      showToast("Failed to delete coupon.", "error");
    }
  });
}

function _bindAddCouponForm() {
  const form = document.getElementById("add-coupon-form");
  if (!form || form._bound) return;
  form._bound = true;

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const saveBtn = form.querySelector("[type=submit]");

    const code     = (_getField("coupon-code") || "").toUpperCase();
    const percent  = sanitiseNumber(_getField("coupon-percent"));
    const minOrder = sanitiseNumber(_getField("coupon-min-order"));
    const expiry   = _getField("coupon-expiry") || null;

    if (!code)           { showToast("Coupon code is required.", "error"); return; }
    if (!percent || percent <= 0 || percent > 100) {
      showToast("Discount % must be between 1 and 100.", "error"); return;
    }

    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Adding…"; }

    try {
      await addCoupon({ code, discountPercent: percent, minOrder, expiryDate: expiry, active: true });
      showToast(`Coupon "${code}" added!`, "success");
      form.reset();
      await _loadCoupons();
    } catch (_) {
      showToast("Failed to add coupon.", "error");
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Add Coupon"; }
    }
  });
}

// ============================================================
// SETTINGS TAB
// ============================================================

async function _loadSettings() {
  try {
    _settings = await getSettings() || {};
    _fillSettingsForm(_settings);
    _bindSettingsForm();
  } catch (err) {
    console.error("Load settings error:", err);
    showToast("Failed to load settings.", "error");
  }
}

function _fillSettingsForm(s) {
  _setField("setting-hero-heading",    s.heroHeading       || "");
  _setField("setting-hero-subheading", s.heroSubheading    || "");
  _setField("setting-about-text",      s.aboutText         || "");
  _setField("setting-whatsapp",        s.whatsappNumber    || "");
  _setField("setting-instagram",       s.instagramHandle   || "");
  _setField("setting-delivery-days",   s.deliveryDays      || "");
  _setField("setting-announcement",    s.announcementBar   || "");

  const annToggle = document.getElementById("setting-announcement-active");
  if (annToggle) annToggle.checked = s.announcementActive !== false;
}

function _bindSettingsForm() {
  const form = document.getElementById("settings-form");
  if (!form || form._bound) return;
  form._bound = true;

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const saveBtn = document.getElementById("btn-save-settings");
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving…`; }

    try {
      const updates = {
        heroHeading        : sanitiseString(_getField("setting-hero-heading")),
        heroSubheading     : sanitiseString(_getField("setting-hero-subheading")),
        aboutText          : sanitiseString(_getField("setting-about-text")),
        whatsappNumber     : sanitiseString(_getField("setting-whatsapp")),
        instagramHandle    : sanitiseString(_getField("setting-instagram")),
        deliveryDays       : sanitiseString(_getField("setting-delivery-days")),
        announcementBar    : sanitiseString(_getField("setting-announcement")),
        announcementActive : document.getElementById("setting-announcement-active")?.checked ?? true
      };

      await updateSettings(updates);
      showToast("Settings saved successfully!", "success");
    } catch (err) {
      console.error("Save settings error:", err);
      showToast("Failed to save settings.", "error");
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = `<i class="fa-regular fa-floppy-disk"></i> Save Settings`; }
    }
  });
}

// ============================================================
// HELPERS
// ============================================================

function _formatStatus(status) {
  const map = {
    "new"         : "New",
    "contacted"   : "Contacted",
    "in-progress" : "In Progress",
    "completed"   : "Completed",
    "cancelled"   : "Cancelled"
  };
  return map[status] || status || "—";
}

function _skeletonRows(cols, rows) {
  return Array.from({ length: rows }, () =>
    `<tr>${Array.from({ length: cols }, () =>
      `<td><div class="skeleton skeleton--text"></div></td>`
    ).join("")}</tr>`
  ).join("");
}

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

function _esc(str) {
  if (typeof str !== "string") return String(str ?? "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function _debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
