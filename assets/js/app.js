(function () {
  'use strict';
  const products = window.WOODPECK_PRODUCTS || [];
  const categories = window.WOODPECK_CATEGORIES || [];
  const el = id => document.getElementById(id);
  const productById = id => products.find(product => product.id === id);
  const money = amount => '₹' + Number(amount).toLocaleString('en-IN');
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
  const svgCart = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.2 11.5h11.5L21 7H6M10 20h.01M18 20h.01"/></svg>';
  const svgHeart = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.4c0 4.5-8.8 10.2-8.8 10.2S3.2 12.9 3.2 8.4a4.9 4.9 0 0 1 8.8-2.9 4.9 4.9 0 0 1 8.8 2.9Z"/></svg>';

  function readSaved(key, fallback) {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      return saved === null ? fallback : saved;
    } catch (_) { return fallback; }
  }
  let cart = readSaved('woodpeck-demo-cart', {});
  if (!cart || typeof cart !== 'object' || Array.isArray(cart)) cart = {};
  for (const id of Object.keys(cart)) if (!productById(id) || !Number.isInteger(cart[id]) || cart[id] < 1 || cart[id] > 99) delete cart[id];
  let wishlist = readSaved('woodpeck-demo-wishlist', []);
  if (!Array.isArray(wishlist)) wishlist = [];
  wishlist = wishlist.filter(id => !!productById(id));
  let selectedCategory = 'all';
  let searchTerm = '';
  let showWishlistOnly = false;
  let sortOrder = 'featured';
  let toastTimeout;
  let lastFocus = null;

  function saveState() {
    try {
      localStorage.setItem('woodpeck-demo-cart', JSON.stringify(cart));
      localStorage.setItem('woodpeck-demo-wishlist', JSON.stringify(wishlist));
    } catch (_) { /* Private browsing: demo still works for this session. */ }
  }
  function quantity() { return Object.values(cart).reduce((sum, n) => sum + n, 0); }
  function subtotal() { return Object.entries(cart).reduce((sum, [id, qty]) => sum + (productById(id)?.price || 0) * qty, 0); }
  function badgeCount(node, count) { if (node) { node.textContent = count; node.hidden = count === 0; } }
  function refreshCounts() {
    badgeCount(el('cartCount'), quantity());
    badgeCount(el('mobileCartCount'), quantity());
    badgeCount(el('wishlistCount'), wishlist.length);
    el('bagCountLabel').textContent = '(' + quantity() + ')';
    el('subtotal').textContent = money(subtotal());
  }
  function toast(message) {
    const node = el('toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => { node.hidden = true; }, 2700);
  }
  function categoryName(id) { return categories.find(category => category.id === id)?.name || 'Furniture'; }
  function renderCategories() {
    el('categoryGrid').innerHTML = categories.map(category => `
      <button class="category-card ${selectedCategory === category.id ? 'selected' : ''}" data-category="${category.id}" type="button" aria-pressed="${selectedCategory === category.id}">
        <span class="category-image"><img src="${category.image}" alt="" loading="lazy" /></span>
        <strong>${escapeHtml(category.name)}</strong><span>${escapeHtml(category.count)}</span>
      </button>`).join('');
  }
  function productCard(product) {
    const loved = wishlist.includes(product.id);
    return `<article class="product-card">
      <div class="product-image-wrap">
        <button class="product-image-btn" data-view="${product.id}" aria-label="View ${escapeHtml(product.name)} details"><img src="${product.image}" alt="${escapeHtml(product.name)}" loading="lazy" /></button>
        <span class="product-tag">${escapeHtml(product.tag)}</span>
        <button class="favorite ${loved ? 'active' : ''}" data-wishlist="${product.id}" aria-label="${loved ? 'Remove from' : 'Add to'} wishlist: ${escapeHtml(product.name)}" aria-pressed="${loved}">${svgHeart}</button>
      </div>
      <div class="product-info"><p class="product-sub">${escapeHtml(categoryName(product.category))}</p><h3 class="product-name"><button data-view="${product.id}">${escapeHtml(product.name)}</button></h3>
        <div class="price-row"><div><strong class="product-price">${money(product.price)}</strong><span class="compare-price">${money(product.compareAt)}</span></div>
        <button class="cart-add" data-add="${product.id}" aria-label="Add ${escapeHtml(product.name)} to shopping bag">${svgCart}</button></div></div>
    </article>`;
  }
  function filteredProducts() {
    let list = products.filter(product => {
      const catMatch = selectedCategory === 'all' || selectedCategory === product.category;
      const searchMatch = (product.name + ' ' + product.materials + ' ' + categoryName(product.category)).toLowerCase().includes(searchTerm);
      const wishlistMatch = !showWishlistOnly || wishlist.includes(product.id);
      return catMatch && searchMatch && wishlistMatch;
    });
    if (sortOrder === 'price-low') list.sort((a, b) => a.price - b.price);
    if (sortOrder === 'price-high') list.sort((a, b) => b.price - a.price);
    if (sortOrder === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }
  function renderProducts() {
    const list = filteredProducts();
    el('featuredGrid').innerHTML = list.map(productCard).join('');
    el('emptyState').hidden = list.length > 0;
    el('resultsLabel').textContent = list.length + (list.length === 1 ? ' selected piece' : ' selected pieces');
    const hasFilter = selectedCategory !== 'all' || searchTerm !== '' || showWishlistOnly;
    el('activeFilter').hidden = !hasFilter;
    const parts = [];
    if (showWishlistOnly) parts.push('Wishlist');
    if (selectedCategory !== 'all') parts.push(categoryName(selectedCategory));
    if (searchTerm) parts.push('Search: ' + searchTerm);
    el('filterText').textContent = parts.join(' · ');
    renderCategories();
    refreshCounts();
  }
  function renderBestSellers() {
    el('bestGrid').innerHTML = products.filter(product => product.bestseller).map(product => `
      <button class="best-card" data-view="${product.id}"><img src="${product.image}" alt="${escapeHtml(product.name)}" loading="lazy" /><div><strong>${escapeHtml(product.name)}</strong><span>${money(product.price)} ↗</span></div></button>`).join('');
  }
  function selectCategory(id) {
    selectedCategory = id;
    showWishlistOnly = false;
    renderProducts();
    scrollToFeatured();
  }
  function scrollToFeatured() { el('featured').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function resetFilters() {
    selectedCategory = 'all'; searchTerm = ''; showWishlistOnly = false;
    el('mobileSearch').value = '';
    el('desktopSearch').value = '';
    renderProducts();
  }
  function toggleWishlist(id) {
    const product = productById(id); if (!product) return;
    if (wishlist.includes(id)) { wishlist = wishlist.filter(x => x !== id); toast('Removed from wishlist'); }
    else { wishlist.push(id); toast('Added to wishlist'); }
    saveState(); renderProducts();
  }
  function openWishlist() {
    showWishlistOnly = true; selectedCategory = 'all'; searchTerm = '';
    el('mobileSearch').value = ''; el('desktopSearch').value = '';
    renderProducts(); scrollToFeatured(); closeMenu();
  }
  function addToCart(id) {
    const product = productById(id); if (!product) return;
    cart[id] = Math.min(99, (cart[id] || 0) + 1);
    saveState(); refreshCounts(); renderCart();
    toast(product.name + ' added to bag');
  }
  function updateCart(id, delta) {
    if (!cart[id]) return;
    cart[id] += delta;
    if (cart[id] < 1) delete cart[id];
    if (cart[id] > 99) cart[id] = 99;
    saveState(); refreshCounts(); renderCart();
  }
  function renderCart() {
    const pairs = Object.entries(cart);
    if (!pairs.length) {
      el('cartItems').innerHTML = `<div class="cart-empty">${svgCart}<h3>Your bag is empty</h3><p>Find something lovely for your space.</p><button type="button" class="btn btn-outline" data-close="drawer">Explore furniture</button></div>`;
    } else {
      el('cartItems').innerHTML = pairs.map(([id, qty]) => {
        const product = productById(id); if (!product) return '';
        return `<div class="cart-item"><img src="${product.image}" alt="${escapeHtml(product.name)}"/><div><h3>${escapeHtml(product.name)}</h3><div class="item-price">${money(product.price)}</div><div class="cart-item-foot"><div class="quantity"><button data-qty="-1" data-id="${id}" aria-label="Decrease ${escapeHtml(product.name)} quantity">−</button><output>${qty}</output><button data-qty="1" data-id="${id}" aria-label="Increase ${escapeHtml(product.name)} quantity">+</button></div><button class="remove-item" data-remove="${id}">Remove</button></div></div></div>`;
      }).join('');
    }
    el('checkoutBtn').disabled = pairs.length === 0;
    el('checkoutBtn').style.opacity = pairs.length ? '1' : '.48';
    refreshCounts();
  }
  function anyDialogOpen() { return !el('cartDrawer').hidden || !el('productModal').hidden || !el('checkoutModal').hidden; }
  function openDialog(id) {
    lastFocus = document.activeElement;
    ['cartDrawer', 'productModal', 'checkoutModal'].forEach(name => { el(name).hidden = name !== id; });
    el('overlay').hidden = false;
    document.body.classList.add('dialog-open');
    const close = el(id).querySelector('[data-close]');
    if (close) close.focus();
  }
  function closeDialogs() {
    ['cartDrawer', 'productModal', 'checkoutModal'].forEach(name => { el(name).hidden = true; });
    el('overlay').hidden = true;
    document.body.classList.remove('dialog-open');
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }
  function openCart() { renderCart(); openDialog('cartDrawer'); }
  function openProduct(id) {
    const product = productById(id); if (!product) return;
    el('productModalBody').innerHTML = `<div class="detail-layout"><img src="${product.image}" alt="${escapeHtml(product.name)}" /><div class="detail-info"><p class="eyebrow">${escapeHtml(categoryName(product.category))} / WOODPECK</p><h2 id="detailTitle">${escapeHtml(product.name)}</h2><div class="price-row"><strong class="product-price">${money(product.price)}</strong><span class="compare-price">${money(product.compareAt)}</span></div><p>${escapeHtml(product.description)}</p><p class="detail-material">${escapeHtml(product.materials)}</p><p class="muted">Demo listing. Final specifications, prices, product photos and availability require client confirmation.</p><button class="btn btn-primary full" data-add="${product.id}">Add to shopping bag ${svgCart}</button></div></div>`;
    openDialog('productModal');
  }
  function openCheckout() {
    if (!quantity()) { toast('Add a product first'); return; }
    el('checkoutForm').hidden = false;
    el('orderPreview').hidden = true;
    el('checkoutSubtotal').textContent = money(subtotal());
    openDialog('checkoutModal');
  }
  function closeMenu() { el('mobileMenu').hidden = true; el('menuToggle').setAttribute('aria-expanded', 'false'); }
  function handleSearch(value, source) {
    searchTerm = value.trim().toLowerCase();
    const other = source === 'mobile' ? el('desktopSearch') : el('mobileSearch');
    other.value = value;
    showWishlistOnly = false;
    renderProducts();
  }
  // Important: Demo checkout intentionally does not create an order or collect payment.
  el('checkoutForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = el('checkoutForm');
    if (!form.reportValidity()) return;
    const customer = el('fullName').value.trim();
    const phone = el('phoneNumber').value.trim();
    if (!/^[0-9]{10}$/.test(phone)) { toast('Enter a 10-digit mobile number'); return; }
    const preview = el('orderPreview');
    preview.innerHTML = `<div class="order-success"><span class="big-check">✓</span><h3>Order preview prepared</h3><p>Thank you, ${escapeHtml(customer)}.<br/>Your sample order subtotal is <strong>${money(subtotal())}</strong> (${quantity()} item${quantity() > 1 ? 's' : ''}).<br/><strong>No order has been placed, and no details have been sent.</strong><br/>The live checkout will be connected after client approval.</p><button class="btn btn-outline" type="button" data-close="modal">Continue browsing</button></div>`;
    form.hidden = true; preview.hidden = false;
  });
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-add],[data-view],[data-wishlist],[data-category],[data-qty],[data-remove],[data-close]');
    if (target) {
      if (target.dataset.add) { addToCart(target.dataset.add); return; }
      if (target.dataset.view) { openProduct(target.dataset.view); return; }
      if (target.dataset.wishlist) { toggleWishlist(target.dataset.wishlist); return; }
      if (target.dataset.category) { selectCategory(target.dataset.category); return; }
      if (target.dataset.qty) { updateCart(target.dataset.id, Number(target.dataset.qty)); return; }
      if (target.dataset.remove) { delete cart[target.dataset.remove]; saveState(); renderCart(); return; }
      if (target.dataset.close) { closeDialogs(); return; }
    }
    if (event.target.closest('#menuToggle')) {
      const menu = el('mobileMenu'); menu.hidden = !menu.hidden;
      el('menuToggle').setAttribute('aria-expanded', String(!menu.hidden)); return;
    }
    if (event.target.closest('#cartHeader,#cartMobile')) { openCart(); return; }
    if (event.target.closest('#wishlistHeader,#wishlistMobile')) { openWishlist(); return; }
    if (event.target.closest('#accountBtn,#accountMobile')) { toast('Customer accounts will be connected in the full version.'); return; }
    if (event.target.closest('#checkoutBtn')) { openCheckout(); return; }
    if (event.target.closest('#showAllCats,#resetSearch,#clearFilter')) { resetFilters(); scrollToFeatured(); return; }
    if (event.target.closest('#seeBestSellers')) {
      resetFilters(); showWishlistOnly = false;
      el('featuredGrid').innerHTML = products.filter(p => p.bestseller).map(productCard).join('');
      el('resultsLabel').textContent = 'Popular favorites'; scrollToFeatured(); return;
    }
    if (event.target.closest('#mobileMenu a')) closeMenu();
  });
  el('overlay').addEventListener('click', closeDialogs);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { if (anyDialogOpen()) closeDialogs(); else closeMenu(); }
    if (event.key === 'Tab' && anyDialogOpen()) {
      const dialog = ['cartDrawer','productModal','checkoutModal'].map(el).find(node => !node.hidden);
      const focusables = [...dialog.querySelectorAll('button:not([disabled]),input,textarea,select,a[href]')].filter(node => node.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  el('desktopSearch').addEventListener('input', event => handleSearch(event.target.value, 'desktop'));
  el('mobileSearch').addEventListener('input', event => handleSearch(event.target.value, 'mobile'));
  el('sortProducts').addEventListener('change', event => { sortOrder = event.target.value; renderProducts(); });
  el('year').textContent = new Date().getFullYear();
  renderCategories(); renderProducts(); renderBestSellers(); renderCart();
  window.addEventListener('woodpeck-catalog-updated',()=>{renderProducts();renderBestSellers();renderCart();});
})();
