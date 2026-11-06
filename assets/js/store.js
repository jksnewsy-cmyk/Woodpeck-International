import {
  firebaseReady, signedInUser, onLoginChange,
  sendPhoneCode, confirmPhoneCode, logoutPhoneUser, registerCustomerName,
  resetPhoneSignIn, clearRecaptcha
} from './firebase-auth.js';
let phoneLoginStep = 'number';
let lastLoginPhone = '';
let authMode = 'login';
let registrationName = '';

import './products.js';

const products = window.WOODPECK_PRODUCTS || [];
const categories = window.WOODPECK_CATEGORIES || [];
const $ = (id) => document.getElementById(id);
const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money = (amount) => '₹' + Number(amount || 0).toLocaleString('en-IN');
const item = (id) => products.find((p) => p.id === id);
const categoryName = (id) => categories.find((c) => c.id === id)?.name || 'Furniture';
const asset = (path) => import.meta.env.BASE_URL + String(path).replace(/^\/+/, '');
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const state = {
  cart: read('woodpeck-demo-cart', {}),
  favs: read('woodpeck-demo-wishlist', []),
  addresses: read('woodpeck-demo-addresses', []),
  selectedAddress: read('woodpeck-demo-selected-address', null),
  search: '',
  sort: 'featured',
  payment: 'upi',
  addAddressForm: false,
  review: false,
};
if (!state.cart || typeof state.cart !== 'object' || Array.isArray(state.cart)) state.cart = {};
if (!Array.isArray(state.favs)) state.favs = [];
if (!Array.isArray(state.addresses)) state.addresses = [];
for (const key of Object.keys(state.cart)) {
  if (!item(key) || !Number.isInteger(state.cart[key]) || state.cart[key] < 1 || state.cart[key] > 99) delete state.cart[key];
}
const save = () => {
  try {
    localStorage.setItem('woodpeck-demo-cart', JSON.stringify(state.cart));
    localStorage.setItem('woodpeck-demo-wishlist', JSON.stringify(state.favs));
    localStorage.setItem('woodpeck-demo-addresses', JSON.stringify(state.addresses));
    localStorage.setItem('woodpeck-demo-selected-address', JSON.stringify(state.selectedAddress));
  } catch (err) { console.warn('Browser storage unavailable', err); }
};
const count = () => Object.values(state.cart).reduce((sum, qty) => sum + qty, 0);
const subtotal = () => Object.entries(state.cart).reduce((sum, [id,qty]) => sum + (item(id)?.price || 0) * qty, 0);
const currentAddress = () => state.addresses.find((address) => address.id === state.selectedAddress);
let toastTimer;
function toast(message) {
  const el = $('storeToast'); el.textContent = message; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}
function badge(id, count) {
  const el = $(id); if (!el) return; el.textContent = count; el.hidden = count === 0;
}
function updateBadges() {
  badge('cartBadge', count()); badge('favBadge', state.favs.length);
  document.querySelectorAll('[data-bottom]').forEach((el) => {
    const route = window.location.hash.split('/')[1] || 'shop';
    el.classList.toggle('active', el.dataset.bottom === route);
  });
}
function go(route) {
  const target = '#/' + route.replace(/^\/+/,'');
  if (location.hash !== target) location.hash = target;
  else render();
}
const breadcrumb = (parts) => '<div class="store-breadcrumb"><a href="index.html">Home</a><span>›</span>' +
  parts.map((part) => '<span>' + esc(part) + '</span>').join('<span>›</span>') + '</div>';
const head = (eyebrow, title, description='') => `<div class="store-page-header"><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1>${description ? '<p>' + esc(description) + '</p>' : ''}</div>`;
const empty = (title, description, action='#/shop', label='Explore furniture') =>
  `<div class="store-empty"><div class="empty-symbol">✦</div><h2>${esc(title)}</h2><p>${esc(description)}</p><a class="store-btn primary" href="${action}">${esc(label)} →</a></div>`;

function productCard(p) {
  const loved = state.favs.includes(p.id);
  return `<article class="store-product-card">
    <div class="store-card-media"><a href="#/product/${encodeURIComponent(p.id)}"><img loading="lazy" src="${asset(p.image)}" alt="${esc(p.name)}"/></a>
      <span class="product-tag">${esc(p.tag)}</span>
      <button type="button" class="store-heart ${loved?'active':''}" data-fav="${esc(p.id)}" aria-label="${loved?'Remove from wishlist':'Add to wishlist'}">${loved?'♥':'♡'}</button>
    </div>
    <div class="store-card-body"><small>${esc(categoryName(p.category))}</small><a class="store-card-title" href="#/product/${encodeURIComponent(p.id)}">${esc(p.name)}</a>
      <p class="store-material">${esc(p.materials)}</p>
      <div class="store-price"><strong>${money(p.price)}</strong><del>${money(p.compareAt)}</del></div>
      <div class="store-card-actions"><button type="button" class="store-btn primary" data-add="${p.id}">Add to Cart</button><a class="store-btn ghost" href="#/product/${p.id}">View Details</a></div>
    </div>
  </article>`;
}
function cartSummary(buttonLabel = 'Continue to Delivery', target = '#/address') {
  return `<aside class="store-summary">
    <h2>Order Summary</h2>
    <div class="summary-line"><span>Items (${count()})</span><strong>${money(subtotal())}</strong></div>
    <div class="summary-line"><span>Shipping</span><strong class="small-normal">Not calculated</strong></div>
    <div class="summary-line summary-total"><span>Subtotal</span><strong>${money(subtotal())}</strong></div>
    <p class="summary-note">Final shipping charge, taxes and product availability must be confirmed before real checkout.</p>
    ${target ? `<a href="${target}" class="store-btn primary full">${esc(buttonLabel)} →</a>` : ''}
    <div class="store-security">🔒 Payment is disabled in this preview. No charge will be made.</div>
  </aside>`;
}
function shop(route) {
  const cat = route[1] || 'all';
  const title = cat === 'all' ? 'Shop All Furniture' : categoryName(cat);
  let list = products.filter((p) => (cat === 'all' || p.category === cat) &&
    (p.name + ' ' + p.materials + ' ' + categoryName(p.category)).toLowerCase().includes(state.search.toLowerCase()));
  if (state.sort === 'low') list = list.sort((a,b)=>a.price-b.price);
  if (state.sort === 'high') list = list.sort((a,b)=>b.price-a.price);
  if (state.sort === 'az') list = list.sort((a,b)=>a.name.localeCompare(b.name));
  return `<div class="container store-page">
    ${breadcrumb(['Shop', ...(cat==='all'?[]:[title])])}
    ${head('THE WOOD COLLECTION', title, 'Find beautifully crafted pieces for your home.')}
    <div class="store-shop-layout"><aside class="store-filters"><h2>Categories</h2>
      <a href="#/shop" class="${cat==='all'?'active':''}">All Furniture <span>${products.length}</span></a>
      ${categories.map(c=>`<a href="#/shop/${c.id}" class="${cat===c.id?'active':''}">${esc(c.name)} <span>${products.filter(p=>p.category===c.id).length}</span></a>`).join('')}
      <div class="filter-help">Natural materials · Beautiful living · Every room</div>
    </aside>
    <section class="store-listing"><div class="listing-tools"><span>Showing ${list.length} product${list.length===1?'':'s'}</span>
      <label>Sort by <select id="storeSort"><option value="featured" ${state.sort==='featured'?'selected':''}>Featured</option><option value="low" ${state.sort==='low'?'selected':''}>Price: Low to High</option><option value="high" ${state.sort==='high'?'selected':''}>Price: High to Low</option><option value="az" ${state.sort==='az'?'selected':''}>Name: A-Z</option></select></label></div>
      ${list.length ? `<div class="store-product-grid">${list.map(productCard).join('')}</div>` : empty('No matching furniture','Try another keyword or category.')}
    </section></div></div>`;
}
function productDetail(id) {
  const p = item(id);
  if (!p) return `<div class="container store-page">${empty('Product not found', 'This product is not in our demo catalog.')}</div>`;
  const related = products.filter(other=>other.category===p.category && other.id!==p.id).slice(0,3);
  const loved = state.favs.includes(p.id);
  const saving = p.compareAt > p.price ? Math.round(100*(p.compareAt-p.price)/p.compareAt) : 0;
  return `<div class="container store-page">
    ${breadcrumb(['Shop',categoryName(p.category),p.name])}
    <div class="store-detail">
      <div class="store-detail-photo"><img src="${asset(p.image)}" alt="${esc(p.name)}"/><div class="detail-photo-label">WOODPECK · FURNITURE COLLECTION</div></div>
      <div class="store-detail-info"><p class="eyebrow">${esc(categoryName(p.category))} / PREMIUM COLLECTION</p>
        <h1>${esc(p.name)}</h1><div class="store-detail-rating">✦ Handpicked furniture for your home</div>
        <div class="store-detail-price"><strong>${money(p.price)}</strong><del>${money(p.compareAt)}</del>${saving?`<span class="store-discount">${saving}% OFF</span>`:''}</div>
        <p class="product-description">${esc(p.description)}</p>
        <div class="detail-meta"><div><span>Material / Finish</span><strong>${esc(p.materials)}</strong></div><div><span>Availability</span><strong>Confirm with seller</strong></div><div><span>Delivery</span><strong>Calculated after shipping setup</strong></div></div>
        <div class="store-detail-actions"><button class="store-btn primary" data-add="${p.id}">Add to Cart</button><button class="store-btn secondary" data-buy="${p.id}">Buy Now</button><button class="store-btn ghost" data-fav="${p.id}">${loved?'♥ Saved':'♡ Wishlist'}</button></div>
        <div class="detail-caution">Demo product: photo, materials, discount and price must be approved by Woodpeck International.</div>
      </div>
    </div>
    <section class="store-related"><h2>You may also like</h2><div class="store-product-grid">${(related.length?related:products.filter(x=>x.id!==id).slice(0,3)).map(productCard).join('')}</div></section>
  </div>`;
}
function cartPage() {
  const lines = Object.entries(state.cart);
  return `<div class="container store-page">${breadcrumb(['Shopping Cart'])}${head('YOUR SELECTION','Shopping Cart','Review your favorite furniture before checkout.')}
    ${lines.length?`<div class="store-checkout-layout"><div class="store-cart-list">
      ${lines.map(([id,qty])=>{const p=item(id);return `<article class="store-cart-item">
        <a href="#/product/${id}"><img src="${asset(p.image)}" alt="${esc(p.name)}"/></a><div class="cart-item-detail">
          <span>${esc(categoryName(p.category))}</span><a href="#/product/${id}"><h2>${esc(p.name)}</h2></a><p>${esc(p.materials)}</p>
          <div class="cart-item-bottom"><div class="qty-control"><button data-qty="-1" data-id="${id}" aria-label="Decrease quantity" ${qty===1?'disabled':''}>−</button><strong>${qty}</strong><button data-qty="1" data-id="${id}" aria-label="Increase quantity" ${qty===99?'disabled':''}>+</button></div><button type="button" data-remove="${id}" class="text-remove">Remove</button></div>
        </div><strong class="cart-item-cost">${money(p.price*qty)}</strong>
      </article>`;}).join('')}
      <a href="#/shop" class="continue-link">← Continue Shopping</a>
    </div>${cartSummary()}</div>` : empty('Your cart is empty','Add a piece you love and it will appear here.')}
  </div>`;
}
function wishlistPage() {
  const list=products.filter(p=>state.favs.includes(p.id));
  return `<div class="container store-page">${breadcrumb(['Wishlist'])}${head('SAVED FOR LATER','My Wishlist','Your favorite furniture pieces in one place.')}
  ${list.length?`<div class="store-product-grid">${list.map(productCard).join('')}</div>`:empty('Nothing saved yet','Tap the heart on a product to add it to your wishlist.')}</div>`;
}
function stepper(which) {
  return `<nav class="checkout-steps" aria-label="Checkout steps">
    <div class="done"><span>1</span> Shopping Cart</div><i></i><div class="${which==='address'?'current':'done'}"><span>2</span> Delivery Address</div><i></i><div class="${which==='payment'?'current':''}"><span>3</span> Payment</div>
  </nav>`;
}
function addressPage() {
  if (!count()) return cartPage();
  const hasAddresses=state.addresses.length>0;
  const showForm=state.addAddressForm || !hasAddresses;
  return `<div class="container store-page">${breadcrumb(['Checkout','Delivery Address'])}${head('CHECKOUT','Delivery Address','Where should we deliver your furniture?')}
    ${stepper('address')}<div class="store-checkout-layout"><section class="checkout-main">
    <h2 class="checkout-panel-title">Select Delivery Address</h2>
    <p class="inline-disclaimer">Preview only. Address details are saved in this browser, not sent to Woodpeck International.</p>
    ${hasAddresses?`<div class="address-grid">${state.addresses.map(a=>`<label class="address-card ${state.selectedAddress===a.id?'active':''}">
      <input type="radio" name="savedAddress" value="${a.id}" ${state.selectedAddress===a.id?'checked':''}/>
      <strong>${esc(a.name)}</strong><span>${esc(a.line1)}${a.line2?', '+esc(a.line2):''}</span>
      <span>${esc(a.city)}, ${esc(a.state)} - ${esc(a.pin)}</span><span>Mobile: ${esc(a.phone)}</span>
    </label>`).join('')}</div><div class="address-buttons"><button class="store-btn ghost" data-address-new>+ Add New Address</button><button class="store-btn primary" data-address-next>Continue to Payment →</button></div>`:''}
    ${showForm?`<form id="deliveryForm" class="address-form">
      <h2>${hasAddresses?'Add another address':'Add Delivery Address'}</h2>
      <div class="form-pair"><label>Full Name <input name="name" autocomplete="name" required minlength="2" maxlength="80" placeholder="Full name"/></label>
      <label>Mobile Number <input name="phone" inputmode="numeric" autocomplete="tel" pattern="[0-9]{10}" minlength="10" maxlength="10" required placeholder="10-digit number"/></label></div>
      <label>House No. / Street Address <input name="line1" autocomplete="address-line1" required minlength="5" maxlength="150" placeholder="House number, road, area"/></label>
      <label>Landmark (Optional) <input name="line2" maxlength="100" placeholder="Near landmark"/></label>
      <div class="form-pair"><label>City / Town <input name="city" autocomplete="address-level2" required maxlength="70" placeholder="City"/></label>
      <label>State <select name="state" required><option value="">Select State</option><option>Tamil Nadu</option><option>Kerala</option><option>Karnataka</option><option>Andhra Pradesh</option><option>Telangana</option><option>Maharashtra</option><option>Delhi</option><option>Other State / UT</option></select></label></div>
      <label>PIN Code <input name="pin" inputmode="numeric" autocomplete="postal-code" pattern="[1-9][0-9]{5}" minlength="6" maxlength="6" required placeholder="6-digit PIN code"/></label>
      <button class="store-btn primary" type="submit">Save Address & Continue →</button>
    </form>`:''}
    </section>${cartSummary('Back to Cart','#/cart')}</div></div>`;
}
const payOptions=[
  {id:'upi',icon:'₹',name:'UPI Payment',desc:'Google Pay, PhonePe, Paytm and other UPI apps'},
  {id:'card',icon:'▣',name:'Credit / Debit Card',desc:'Visa, Mastercard, RuPay and supported cards'},
  {id:'net',icon:'⌘',name:'Net Banking',desc:'Pay using your bank account'},
  {id:'cod',icon:'▤',name:'Cash on Delivery',desc:'Only if enabled by the store for your PIN code'},
];
function paymentPage() {
  if (!count()) { go('cart'); return ''; }
  const address=currentAddress();
  if (!address) { go('address'); return ''; }
  return `<div class="container store-page">${breadcrumb(['Checkout','Payment'])}${head('FINAL STEP','Payment Method','Choose how you would like to pay for your furniture.')}
    ${stepper('payment')}<div class="store-checkout-layout"><section class="checkout-main">
      <div class="address-strip"><div><small>DELIVER TO</small><strong>${esc(address.name)} · ${esc(address.phone)}</strong><span>${esc(address.line1)}, ${esc(address.city)}, ${esc(address.state)} - ${esc(address.pin)}</span></div><a href="#/address">Change</a></div>
      <h2 class="checkout-panel-title">Select Payment Method</h2>
      <div class="payment-options">${payOptions.map(p=>`<label class="payment-option ${state.payment===p.id?'active':''}">
        <input type="radio" name="payment" value="${p.id}" ${state.payment===p.id?'checked':''}/>
        <span class="pay-icon">${p.icon}</span><span class="pay-info"><strong>${esc(p.name)}</strong><small>${esc(p.desc)}</small></span><span class="pay-radio"></span>
      </label>`).join('')}</div>
      <div class="payment-preview-notice"><strong>🔒 Payment gateway not yet connected</strong><p>This is a demonstration payment selection screen. Never enter real UPI PIN, card number, CVV, or bank password here. No payment will be charged and no order will be placed.</p></div>
      <label class="demo-confirm"><input type="checkbox" id="previewConsent"/> I understand this is a website demo and no real order or payment will be processed.</label>
      <button class="store-btn primary payment-review-btn" id="paymentReview" ${state.review?'':''}>View Demo Checkout Summary →</button>
      <div id="paymentReviewResult" class="payment-review-result" ${state.review?'':'hidden'}>
        <h3>Demo checkout summary</h3>
        <p>Selected payment: <strong>${esc(payOptions.find(p=>p.id===state.payment)?.name)}</strong></p>
        <p>Sample subtotal: <strong>${money(subtotal())}</strong></p>
        <p><strong>No payment collected. No order created.</strong> The real gateway, verified charges, live product inventory and delivery rules must be configured before taking customer orders.</p>
        <a class="store-btn ghost" href="#/shop">Return to shopping</a>
      </div>
    </section>${cartSummary('',null)}</div></div>`;
}
function accountPage() {
  const isRegister = authMode === 'register';
  const modeTabs = `<div class="auth-tabs" role="group" aria-label="Customer account options">
    <button type="button" class="${!isRegister?'active':''}" data-auth-mode="login" aria-pressed="${!isRegister}">Customer Login</button>
    <button type="button" class="${isRegister?'active':''}" data-auth-mode="register" aria-pressed="${isRegister}">New Registration</button>
  </div>`;
  const loginSection = !firebaseReady
    ? `<div class="login-panel"><p class="eyebrow">SECURE CUSTOMER ACCESS</p><h2>Mobile OTP Login</h2><p>Firebase account setup is being completed. Please check back soon.</p></div>`
    : signedInUser
    ? `<div class="login-panel"><p class="eyebrow">YOUR WOODPECK ACCOUNT</p><h2>Welcome${signedInUser.displayName?', '+esc(signedInUser.displayName):''}!</h2><p>Verified mobile number: <strong>${esc(signedInUser.phoneNumber || 'Verified customer')}</strong></p><button type="button" class="store-btn ghost" id="firebaseLogout">Sign Out</button><p class="login-hint">Orders are not live yet. Cart and addresses are saved on this device.</p></div>`
    : phoneLoginStep === 'code'
    ? `<div class="login-panel">${modeTabs}<p class="eyebrow">MOBILE VERIFICATION</p><h2>Enter your OTP</h2><p>Enter the 6-digit SMS code sent to +91 ${esc(lastLoginPhone.slice(0,2) + '••••••' + lastLoginPhone.slice(-2))}.</p><form id="firebaseCodeForm" class="login-form"><label for="firebaseOtp">Verification code</label><input type="text" id="firebaseOtp" name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required placeholder="6-digit OTP"/><button type="submit" class="store-btn primary">${isRegister?'Verify & Register':'Verify & Sign In'}</button></form><button type="button" class="login-link" id="firebaseGoBack">Change mobile number</button><p id="loginError" class="login-error" role="alert" hidden></p></div>`
    : `<div class="login-panel">${modeTabs}<p class="eyebrow">${isRegister?'JOIN WOODPECK INTERNATIONAL':'SECURE CUSTOMER LOGIN'}</p><h2>${isRegister?'Create your account':'Login with Mobile OTP'}</h2><p>${isRegister?'Register with your name and mobile number. We will send a one-time code to verify your number.':'No password required. Enter your mobile number and verify with a one-time SMS code.'}</p><form id="firebasePhoneForm" class="login-form">${isRegister?'<label for="registrationName">Full Name</label><input type="text" id="registrationName" name="fullName" autocomplete="name" minlength="2" maxlength="70" required placeholder="Enter your full name"/>':''}<label for="firebasePhone">Mobile Number</label><div class="login-phone"><span>+91</span><input type="tel" id="firebasePhone" name="phone" inputmode="numeric" autocomplete="tel-national" pattern="[6-9][0-9]{9}" minlength="10" maxlength="10" required placeholder="10-digit mobile number"/></div><div id="firebase-recaptcha"></div><button type="submit" class="store-btn primary">${isRegister?'Send Registration OTP':'Send OTP'}</button></form><p id="loginError" class="login-error" role="alert" hidden></p><p class="login-hint">SMS verification uses Firebase. Your name and verified number will be associated with your account. Standard messaging and privacy terms apply.</p></div>`;
  return `<div class="container store-page">${breadcrumb(['My Account'])}${head('HELLO THERE','My Account','Your Woodpeck International shopping space.')}
   ${loginSection}
   <div class="account-links">
     <a href="#/wishlist"><span>♡</span><strong>My Wishlist</strong><small>See your saved furniture</small><b>→</b></a>
     <a href="#/cart"><span>▤</span><strong>My Cart</strong><small>View selected furniture</small><b>→</b></a>
     <a href="#/address"><span>⌂</span><strong>Saved Addresses</strong><small>Delivery address book on this device</small><b>→</b></a>
     <a href="#/contact"><span>✉</span><strong>Contact & Policies</strong><small>Business information and policies</small><b>→</b></a>
   </div><div class="account-alert"><strong>Checkout is a demo</strong><p>Customer order history and live order tracking still require a secure backend. This website does not accept payments or create real orders.</p></div>
  </div>`;
}
function contactPage() {
  return `<div class="container store-page">${breadcrumb(['Contact & Policies'])}${head('WOODPECK INTERNATIONAL','Contact & Policies','Details to be confirmed by the business owner.')}
    <div class="policy-grid"><section><h2>Contact Woodpeck International</h2><p>Official phone, email, office address and WhatsApp support links will be added after the client approves them.</p></section>
    <section><h2>Shipping & Delivery</h2><p>Delivery areas, shipping charges, lead time and installation costs are not yet configured. Final charges will be displayed before a live payment is allowed.</p></section>
    <section><h2>Returns & Refunds</h2><p>The store must publish its approved return, damage, cancellation and refund policy before accepting orders.</p></section>
    <section><h2>Privacy & Terms</h2><p>This local demonstration stores sample cart, wishlist and delivery-address data in your browser only. It does not send any details to a server.</p></section></div>
  </div>`;
}
function render() {
  const route=(location.hash.replace(/^#\/?/,'') || 'shop').split('/').map(decodeURIComponent);
  if (route[0]==='checkout') route[0]='address';
  const kind=route[0];
  let body;
  switch(kind) {
    case 'shop': body=shop(route);break;
    case 'product': body=productDetail(route[1]);break;
    case 'cart': body=cartPage();break;
    case 'wishlist': body=wishlistPage();break;
    case 'address': body=addressPage();break;
    case 'payment': body=paymentPage();break;
    case 'account': body=accountPage();break;
    case 'contact': body=contactPage();break;
    default: body=`<div class="container store-page">${empty('Page not found','Explore our furniture collection.')}</div>`;
  }
  clearRecaptcha();
  $('page').innerHTML=body;
  document.title = (kind.charAt(0).toUpperCase()+kind.slice(1))+' | Woodpeck International';
  updateBadges();
  window.scrollTo({top:0,behavior:'instant'});
}
function addToCart(id, buy=false) {
  const p=item(id); if(!p)return;
  state.cart[id]=Math.min(99,(state.cart[id]||0)+1);
  save();updateBadges();
  if(buy)go('address'); else {toast(p.name+' added to cart');render();}
}
function changeQuantity(id,delta) {
  if(!state.cart[id])return;
  state.cart[id]=Math.max(1,Math.min(99,state.cart[id]+delta));save();render();
}
function toggleFavorite(id) {
  if (!item(id))return;
  state.favs=state.favs.includes(id)?state.favs.filter(x=>x!==id):[...state.favs,id];
  save();render();toast(state.favs.includes(id)?'Saved to wishlist':'Removed from wishlist');
}
document.addEventListener('click',(event)=>{
  const btn=event.target.closest('[data-add],[data-buy],[data-fav],[data-qty],[data-remove],[data-address-new],[data-address-next],#paymentReview');
  if(!btn)return;
  if(btn.dataset.add){addToCart(btn.dataset.add);return;}
  if(btn.dataset.buy){addToCart(btn.dataset.buy,true);return;}
  if(btn.dataset.fav){toggleFavorite(btn.dataset.fav);return;}
  if(btn.dataset.qty){changeQuantity(btn.dataset.id,Number(btn.dataset.qty));return;}
  if(btn.dataset.remove){delete state.cart[btn.dataset.remove];save();render();toast('Product removed');return;}
  if(btn.hasAttribute('data-address-new')){state.addAddressForm=true;render();return;}
  if(btn.hasAttribute('data-address-next')){
    if(!currentAddress()) {toast('Select an address or add a new one');return;}
    go('payment');return;
  }
  if(btn.id==='paymentReview'){
    if(!$('previewConsent')?.checked){toast('Please confirm this is a demonstration first');return;}
    state.review=true;
    const result=$('paymentReviewResult');
    result.hidden=false;
    result.querySelector('p').innerHTML='Selected payment: <strong>'+esc(payOptions.find(p=>p.id===state.payment)?.name)+'</strong>';
    result.scrollIntoView({behavior:'smooth',block:'center'});
  }
});
document.addEventListener('change',(event)=>{
  if(event.target.id==='storeSort'){state.sort=event.target.value;render();}
  if(event.target.name==='savedAddress'){state.selectedAddress=event.target.value;save();render();}
  if(event.target.name==='payment'){state.payment=event.target.value;state.review=false;render();}
});
document.addEventListener('submit',(event)=>{
  if(event.target.id==='storeSearchForm'){
    event.preventDefault();state.search=$('storeSearch').value.trim();
    if(location.hash==='#/shop')render();else go('shop');
    return;
  }
  if(event.target.id==='deliveryForm'){
    event.preventDefault();
    const form=event.target;
    if(!form.reportValidity())return;
    const data=Object.fromEntries(new FormData(form).entries());
    data.name=data.name.trim();data.phone=data.phone.trim();data.line1=data.line1.trim();
    data.city=data.city.trim();data.pin=data.pin.trim();data.line2=(data.line2||'').trim();
    if(data.name.length<2||data.line1.length<5||!/^([0-9]{10})$/.test(data.phone)||!/^[1-9][0-9]{5}$/.test(data.pin)){
      toast('Please check name, mobile, street and PIN code');return;
    }
    const address={...data,id:'address-'+Date.now()};
    state.addresses.push(address);
    state.selectedAddress=address.id;state.addAddressForm=false;save();
    toast('Address saved on this device');go('payment');
  }
});
window.addEventListener('hashchange',()=>{state.review=false;render();});
window.addEventListener('storage',(event)=>{
  if(['woodpeck-demo-cart','woodpeck-demo-wishlist'].includes(event.key)){
    state.cart=read('woodpeck-demo-cart',{});
    state.favs=read('woodpeck-demo-wishlist',[]);
    render();
  }
});
$('storeYear').textContent=new Date().getFullYear();
if(!location.hash)location.replace('#/shop');
render();

function displayLoginError(error) {
  const el = $('loginError');
  if (!el) return;
  const code = error?.code || '';
  const safeMessage = ({
    'auth/invalid-phone-number': 'Enter a valid mobile number.',
    'auth/invalid-verification-code': 'Incorrect OTP. Check the SMS and retry.',
    'auth/code-expired': 'Your OTP has expired. Request a new code.',
    'auth/too-many-requests': 'Too many attempts. Please try again later.',
    'auth/captcha-check-failed': 'Security verification failed. Please retry.',
    'auth/billing-not-enabled': 'SMS OTP requires a Firebase billing-enabled project.',
    'auth/operation-not-allowed': 'Phone login is not enabled in Firebase Console.',
    'auth/unauthorized-domain': 'This website domain is not yet authorized in Firebase.',
  })[code] || error?.message || 'Unable to sign in. Please retry.';
  el.textContent = safeMessage;
  el.hidden = false;
}
document.addEventListener('submit', async event => {
  const form = event.target;
  if (!['firebasePhoneForm','firebaseCodeForm'].includes(form.id)) return;
  event.preventDefault();
  if (!form.reportValidity()) return;
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    if (form.id === 'firebasePhoneForm') {
      const phone = form.elements.phone.value.trim();
      if (authMode === 'register') {
        registrationName = form.elements.fullName.value.trim().replace(/\s+/g, ' ');
        if (registrationName.length < 2 || registrationName.length > 70) throw new Error('Enter your full name (2-70 characters).');
      }
      await sendPhoneCode(phone);
      lastLoginPhone = phone;
      phoneLoginStep = 'code';
    } else {
      const verifiedUser = await confirmPhoneCode(form.elements.otp.value.trim());
      if (authMode === 'register' && registrationName) {
        try { await registerCustomerName(verifiedUser, registrationName); }
        catch (profileError) { toast('Mobile verified; name could not be saved. Please retry later.'); }
      }
      registrationName = '';
      phoneLoginStep = 'number';
    }
    render();
  } catch (error) {
    displayLoginError(error);
  } finally {
    if (btn.isConnected) btn.disabled = false;
  }
});
document.addEventListener('click', async event => {
  const modeButton = event.target.closest('[data-auth-mode]');
  if (modeButton) {
    resetPhoneSignIn();
    phoneLoginStep = 'number';
    authMode = modeButton.dataset.authMode === 'register' ? 'register' : 'login';
    registrationName = '';
    render();
    return;
  }
  if (event.target.closest('#firebaseGoBack')) {
    resetPhoneSignIn();
    phoneLoginStep = 'number';
    render();
  }
  if (event.target.closest('#firebaseLogout')) {
    try {
      await logoutPhoneUser();
      phoneLoginStep = 'number';
      render();
    } catch (error) {
      toast('Unable to sign out. Please retry.');
    }
  }
});
onLoginChange(() => {
  if (window.location.hash.startsWith('#/account')) render();
});
