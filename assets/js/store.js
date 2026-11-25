import QRCode from 'qrcode';
import {createUpiOrder,submitUpiReference,fetchUpiOrder} from './checkout-api.js';
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
import { watchPublishedProducts } from './firebase-catalog.js';

const products = window.WOODPECK_PRODUCTS || [];
const categories = window.WOODPECK_CATEGORIES || [];
const $ = (id) => document.getElementById(id);
const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money = (amount) => '₹' + Number(amount || 0).toLocaleString('en-IN');
const item = (id) => products.find((p) => p.id === id);
const categoryName = (id) => categories.find((c) => c.id === id)?.name || 'Furniture';
const asset = (path) => /^https:\/\//i.test(String(path)) ? String(path) : import.meta.env.BASE_URL + String(path).replace(/^\/+/, '');
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
  activeOrder:null,
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
    <div class="store-security">🔒 Final payment amount is verified by the merchant backend before any UPI QR appears.</div>
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
let detailSelection = {id:null, photo:0, qty:1};
const detailIcons = {
  wood:'<path d="M12 22v-5m-5-7 5-8 5 8h-3l5 7H5l5-7Z"/>',
  shield:'<path d="M12 2 21 6v6c0 5-9 10-9 10S3 17 3 12V6Z"/><path d="m8 12 3 3 5-6"/>',
  sofa:'<path d="M5 12V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v5M5 18v3m14-3v3M3 11a2 2 0 0 1 2 2v2h14v-2a2 2 0 0 1 4 0v5H1v-5a2 2 0 0 1 2-2Z"/>',
  tool:'<path d="m3 21 12-12m-3-5 4 4 5-5v5l-4 4-5-1-8 10H1v-3l8-8-6-6 2-2 6 6"/>',
  truck:'<path d="M1 4h14v13H1m14-9h4l4 5v4h-8M1 8h6m-6 4h4"/><circle cx="6" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>',
  cart:'<path d="M2 3h3l3 13h12l3-10H6"/><circle cx="10" cy="21" r="1"/><circle cx="19" cy="21" r="1"/>',
  bolt:'<path d="m13 2-9 12h7l-1 8 10-13h-8Z"/>'
};
const di = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+detailIcons[name]+'</svg>';
const productPhotos = p => [...new Set([p.image,...(Array.isArray(p.images)?p.images:[])].filter(x=>typeof x==='string' && (/^https:\/\//i.test(x)||x.startsWith('assets/images/'))))].slice(0,10);
const maxDetailQty = p => Math.max(0,Math.min(99,Number.isInteger(p.stock)?p.stock:99) - (state.cart[p.id]||0));
function productDetail(id) {
  const p=item(id);
  if(!p)return '<div class="container store-page">'+empty('Product not found','This product is not in our catalog.')+'</div>';
  if(detailSelection.id!==id) detailSelection={id,photo:0,qty:1};
  const photos=productPhotos(p), max=maxDetailQty(p);
  detailSelection.photo=Math.min(detailSelection.photo,Math.max(0,photos.length-1));
  detailSelection.qty=Math.min(Math.max(1,detailSelection.qty),Math.max(1,max));
  const n=detailSelection.photo, qty=detailSelection.qty, loved=state.favs.includes(id);
  const related=products.filter(x=>x.category===p.category&&x.id!==id).slice(0,3);
  const saving=p.compareAt>p.price?Math.round(100*(p.compareAt-p.price)/p.compareAt):0;
  const materials=String(p.materials||'').split('·').map(x=>x.trim()).filter(Boolean);
  const features=[[ 'wood',materials[0]||categoryName(p.category)],['shield',typeof p.stock==='number'?(p.stock>0?'In stock':'Out of stock'):'Check availability'],['sofa',materials[1]||categoryName(p.category)],['tool',p.tag||'Furniture collection']];
  const variants=p.variantGroup?products.filter(x=>x.variantGroup===p.variantGroup&&x.category===p.category):[p];
  const variantOptions=(key,other,heading,withImage)=>{
    const options=[...new Set(variants.map(x=>x[key]).filter(x=>typeof x==='string'&&x.trim()))];
    if(!options.length)return '';
    return `<div class="pd-option"><h2>${heading}: <span>${esc(p[key]||'')}</span></h2><div class="pd-variants ${withImage?'pd-finishes':''}">${options.map(label=>{
      const match=variants.find(x=>x.id===p.id&&x[key]===label)||variants.find(x=>x[key]===label&&x[other]===p[other]);
      const preview=match||variants.find(x=>x[key]===label);
      return match?`<a href="#/product/${encodeURIComponent(match.id)}" class="${match.id===p.id?'selected':''}" ${match.id===p.id?'aria-current="true"':''}>${withImage?`<img src="${esc(asset(preview.image))}" alt="">`:''}<strong>${esc(label)}</strong></a>`:`<span class="unavailable" title="Unavailable in the selected option">${withImage?`<img src="${esc(asset(preview.image))}" alt="">`:''}<strong>${esc(label)}</strong></span>`;
    }).join('')}</div></div>`;
  };
  const thumbs=photos.length>1?'<div class="pd-thumbs" aria-label="Product photos">'+photos.map((url,i)=>`<button type="button" class="${i===n?'selected':''}" data-photo="${i}" aria-label="Photo ${i+1}" aria-pressed="${i===n}"><img src="${esc(asset(url))}" alt="${esc(p.name)} – view ${i+1}" loading="lazy"></button>`).join('')+'</div>':'';
  return `<div class="container store-page pd-page">
    ${breadcrumb(['Shop',categoryName(p.category),p.name])}
    <div class="store-detail pd-layout">
      <section class="pd-gallery">
        <div class="store-detail-photo pd-hero" id="pdHero"><img src="${esc(asset(photos[n]||p.image))}" alt="${esc(p.name)}" draggable="false"><button type="button" class="store-heart pd-heart ${loved?'active':''}" data-fav="${esc(id)}" aria-label="${loved?'Remove from wishlist':'Add to wishlist'}" aria-pressed="${loved}">${loved?'♥':'♡'}</button><span class="pd-counter">${n+1} / ${photos.length||1}</span></div>
        ${photos.length>1?'<div class="pd-dots">'+photos.map((_,i)=>`<button type="button" data-photo="${i}" aria-label="View photo ${i+1}" aria-pressed="${n===i}" class="${n===i?'selected':''}"></button>`).join('')+'</div>':''}
        ${thumbs}
      </section>
      <div class="store-detail-info pd-info">
        <h1>${esc(p.name)}</h1>
        <div class="pd-rating">${Number.isFinite(p.rating)&&p.rating>=1&&p.rating<=5?`<span class="pd-stars">★</span> <strong>${esc(p.rating)}</strong>${Number.isInteger(p.reviewCount)?' ('+esc(p.reviewCount)+' Reviews)':''}`:'<span class="pd-category">'+esc(categoryName(p.category))+'</span>'}</div>
        <div class="store-detail-price pd-price"><strong>${money(p.price)}</strong>${saving?`<del>${money(p.compareAt)}</del><span class="store-discount">${saving}% OFF</span>`:''}</div>
        <div class="pd-features">${features.map(([icon,label])=>`<div>${di(icon)}<span>${esc(label)}</span></div>`).join('')}</div>
        ${variantOptions('finish','configuration','Select Finish',true)}${variantOptions('configuration','finish','Select Configuration',false)}
        ${materials.length&&!p.finish?`<div class="pd-option"><h2>Material / Finish</h2><div class="pd-spec"><img src="${esc(asset(p.image))}" alt=""><strong>${esc(p.materials)}</strong></div></div>`:''}
        <div class="pd-quantity-row"><div class="pd-quantity"><h2>Quantity</h2><div class="qty-control"><button type="button" data-detail-qty="-1" aria-label="Decrease quantity" ${qty<=1?'disabled':''}>−</button><strong>${qty}</strong><button type="button" data-detail-qty="1" aria-label="Increase quantity" ${qty>=max?'disabled':''}>+</button></div></div><div class="pd-delivery">${di('truck')}<div><strong>Delivery</strong><small>Calculated at checkout</small></div></div></div>
        <section class="pd-description"><h2>Product details</h2><p>${esc(p.description||'Contact us for more details.')}</p></section>
        ${max===0?'<p class="pd-stock-note">No additional quantity available.</p>':''}
        <div class="pd-purchase"><button class="pd-action pd-add" data-add="${esc(id)}" data-detail-purchase ${max===0?'disabled':''}>${di('cart')}<span><strong>Add to Cart</strong><small>${money(p.price*qty)}</small></span></button><button class="pd-action pd-buy" data-buy="${esc(id)}" data-detail-purchase ${max===0?'disabled':''}>${di('bolt')}<span><strong>Buy Now</strong><small>at ${money(p.price*qty)}</small></span></button></div>
      </div>
    </div>
    <section class="store-related"><h2>You may also like</h2><div class="store-product-grid">${(related.length?related:products.filter(x=>x.id!==id).slice(0,3)).map(productCard).join('')}</div></section>
  </div>`;
}
function updateDetail() {
  const p=item(detailSelection.id);
  if(!p||!location.hash.startsWith('#/product/'))return;
  const scroll=window.scrollY;
  $('page').innerHTML=productDetail(p.id);
  window.scrollTo({top:scroll,behavior:'instant'});
}
function cartPage() {
  const lines = Object.entries(state.cart).filter(([id])=>!!item(id));
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
// UPI is intentionally the only live payment method. All payment statuses are
// server controlled; no buyer action can mark an order paid.
const MERCHANT_UPI='woodpeckinternational01@tmb';
function upiLink(order){
  const query=new URLSearchParams({
    pa:order.merchantUpi||MERCHANT_UPI,
    pn:order.merchantName||'WOODPECK INTERNATIONAL',
    am:Number(order.total).toFixed(2),cu:'INR',
    tn:'Woodpeck order '+order.id.slice(0,14)
  });
  return 'upi://pay?'+query.toString();
}
function orderSummary(order){
  return '<aside class="store-summary"><h2>Confirmed Order Amount</h2>'+
    '<div class="summary-line"><span>Products</span><strong>'+money(order.subtotal)+'</strong></div>'+
    '<div class="summary-line"><span>Shipping</span><strong>'+money(order.shipping)+'</strong></div>'+
    '<div class="summary-line summary-total"><span>Total payable</span><strong>'+money(order.total)+'</strong></div>'+
    '<p class="summary-note">Tax included. Never pay a different amount. Verify the receiver name in your UPI app before approving.</p></aside>';
}
function paymentPage(){
  if(!count()&&!state.activeOrder){go('cart');return '';}
  const address=currentAddress();
  if(!address&&!state.activeOrder){go('address');return '';}
  const order=state.activeOrder;
  const addressBlock=order?order.address:address;
  let content='';
  if(!signedInUser) {
    content='<div class="payment-preview-notice"><strong>Mobile OTP login required</strong><p>For secure orders, sign in using your mobile number before paying.</p></div><a class="store-btn primary" href="#/account">Sign in to continue →</a>';
  } else if(order) {
    const waiting=order.status==='payment_pending';
    const status=({
      payment_pending:'Awaiting UPI payment',
      verification_pending:'Payment reference submitted — checking with bank',
      paid:'Payment confirmed by Woodpeck International',
      rejected:'Payment could not be verified — contact the store',
      cancelled:'Order cancelled'
    })[order.status]||'Order status: '+order.status;
    content='<section class="upi-live-box">'+
      '<div class="upi-heading"><h2>'+esc(status)+'</h2><p>Order ID: <code>'+esc(order.id)+'</code></p></div>'+
      '<p>Pay <strong>'+money(order.total)+'</strong> only to <strong>'+esc(order.merchantName||'WOODPECK INTERNATIONAL')+'</strong>.</p>'+
      (waiting?'<div class="upi-qr-wrap"><img id="payQr" alt="UPI QR code for this order and exact payable amount"/><p>Scan with any UPI app</p></div>'+
       '<div class="upi-id">UPI ID: <strong>'+esc(order.merchantUpi||MERCHANT_UPI)+'</strong></div>'+
       '<a class="store-btn primary upi-pay-action" href="'+esc(upiLink(order))+'">Pay '+money(order.total)+' using UPI App →</a>'+
       '<p class="payment-safety">Check recipient name and amount inside your UPI app. Do not enter a PIN on this website.</p>'+
       '<form id="upiReferenceForm" class="upi-reference-form"><label for="upiUtr">After payment, enter your UPI transaction reference / UTR</label>'+
       '<input id="upiUtr" name="utr" type="text" inputmode="numeric" pattern="[0-9]{10,22}" minlength="10" maxlength="22" placeholder="UPI Transaction / UTR number" required/>'+
       '<button type="submit" class="store-btn primary">Submit for bank verification</button></form>':
       '<p class="payment-safety">Payment is only considered successful after the shop checks its bank statement. UTR alone is not proof of payment.</p>'+
       (order.utr?'<p>Submitted reference: <strong>'+esc(order.utr)+'</strong></p>':''))+
      '<div id="upiMessage" role="status"></div><button class="store-btn ghost" id="refreshUpiOrder">Refresh order status</button>'+
      '<button class="store-btn ghost" id="newUpiOrder">Start a new checkout</button>'+
      '</section>';
  } else {
    content='<h2 class="checkout-panel-title">UPI Payment</h2>'+
      '<div class="payment-options"><div class="payment-option active"><span class="pay-icon">₹</span><span class="pay-info"><strong>UPI — Google Pay, PhonePe, BHIM</strong><small>Money goes directly to Woodpeck International bank-linked UPI.</small></span></div></div>'+
      '<div class="payment-preview-notice"><strong>Secure order creation</strong><p>The server will verify published stock, calculate the exact item prices and merchant-approved delivery charge. Payment QR is shown only after the final amount is confirmed. If the merchant has not enabled checkout, no payment QR will be shown.</p></div>'+
      '<button class="store-btn primary" id="createUpiOrder">Generate order &amp; show exact UPI amount →</button>'+
      '<p class="payment-safety">Payment is manually verified against the merchant bank account, not automatically by a gateway.</p>'+
      '<div id="upiMessage" role="alert"></div>';
  }
  return '<div class="container store-page">'+breadcrumb(['Checkout','Payment'])+
    head('FINAL STEP','Payment Method','Pay directly to Woodpeck International by UPI.')+
    stepper('payment')+'<div class="store-checkout-layout"><section class="checkout-main">'+
    (addressBlock?'<div class="address-strip"><div><small>DELIVER TO</small><strong>'+esc(addressBlock.name)+' · '+esc(addressBlock.phone)+'</strong><span>'+esc(addressBlock.line1)+', '+esc(addressBlock.city)+', '+esc(addressBlock.state)+' - '+esc(addressBlock.pin)+'</span></div>'+(!order?'<a href="#/address">Change</a>':'')+'</div>':'')+
    content+'</section>'+(order?orderSummary(order):cartSummary('',null))+'</div></div>';
}
async function displayUpiQr(){
  const img=$('payQr');
  if(!img||!state.activeOrder)return;
  try{
    img.src=await QRCode.toDataURL(upiLink(state.activeOrder),{width:280,margin:2,errorCorrectionLevel:'M'});
  }catch(e){img.replaceWith(document.createTextNode('QR not available. Use the UPI App payment button.'));}
}
async function refreshCurrentUpiOrder(){
  const prior=state.activeOrder;
  if(!prior||!signedInUser)return;
  try{
    const current=await fetchUpiOrder(prior.id);
    if(current&&current.uid===signedInUser.uid){state.activeOrder=current;render();}
    else {state.activeOrder=null;localStorage.removeItem('woodpeck-current-order');render();}
  }catch(e){const msg=$('upiMessage');if(msg)msg.textContent='Could not refresh order: '+(e.code||e.message);}
}
async function restoreUpiOrder(){
  if(!signedInUser)return;
  const saved=read('woodpeck-current-order',null);
  if(saved?.uid===signedInUser.uid&&typeof saved.id==='string'){
    try{
      const order=await fetchUpiOrder(saved.id);
      if(order&&order.uid===signedInUser.uid){state.activeOrder=order;if(location.hash.startsWith('#/payment'))render();}
    }catch(e){console.warn('Unable to restore order',e.code||e.message);}
  }
}
function accountPage() {
  const isRegister = authMode === 'register';
  const phoneIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 2.8 5 2.4c-1.3-.2-2.5.6-2.8 2-1.4 7.9 7.5 16.9 15.4 17.5 1.4.1 2.4-.9 2.7-2.1l.5-2.3-5-2.6-2.5 2.1a16 16 0 0 1-6.4-6.4L9 8.1z"/></svg>`;
  const messageIcon = `<svg class="auth-main-icon" viewBox="0 0 100 115" fill="none" aria-hidden="true"><rect x="17" y="4" width="65" height="107" rx="13" stroke="currentColor" stroke-width="5"/><path d="M41 13h17M42 100h17" stroke="currentColor" stroke-linecap="round" stroke-width="5"/><path d="M36 40h46a10 10 0 0 1 10 10v16a10 10 0 0 1-10 10H63L51 87V76H36a10 10 0 0 1-10-10V50a10 10 0 0 1 10-10Z" fill="#E56C10"/><text x="58" y="64" text-anchor="middle" fill="white" font-size="25" font-weight="900" letter-spacing="2">****</text></svg>`;
  const tabs = `<div class="auth-tabs" role="group" aria-label="Customer account options">
    <button type="button" class="${!isRegister?'active':''}" data-auth-mode="login" aria-pressed="${!isRegister}"><span aria-hidden="true">⚿</span> Customer Login</button>
    <button type="button" class="${isRegister?'active':''}" data-auth-mode="register" aria-pressed="${isRegister}"><span aria-hidden="true">♙</span> New Registration</button>
  </div>`;
  let mainForm;
  if (!firebaseReady) {
    mainForm = `<h1>Customer Login</h1><h2>Login with Mobile OTP</h2><p>Secure mobile login is temporarily unavailable. Please check back soon.</p>`;
  } else if (signedInUser) {
    mainForm = `<h1>Welcome${signedInUser.displayName?', '+esc(signedInUser.displayName):''}!</h1><h2>Your Woodpeck account</h2><div class="auth-illustration">${messageIcon}</div><p>Your mobile number has been verified.</p><p><strong>${esc(signedInUser.phoneNumber || 'Verified customer')}</strong></p><button type="button" class="auth-submit" id="firebaseLogout">Sign Out</button>`;
  } else if (phoneLoginStep === 'code') {
    mainForm = `<h1>${isRegister?'New Registration':'Customer Login'}</h1><h2>Verify Your Mobile OTP</h2><div class="auth-illustration">${messageIcon}</div><p>Enter the 6-digit SMS code sent to +91 ${esc(lastLoginPhone.slice(0,2)+'••••••'+lastLoginPhone.slice(-2))}.</p><form id="firebaseCodeForm" class="login-form auth-form"><label for="firebaseOtp">Verification Code</label><input id="firebaseOtp" name="otp" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required placeholder="6-digit OTP"/><button class="auth-submit" type="submit">${isRegister?'Verify & Register':'Verify & Sign In'}</button></form><button type="button" class="login-link" id="firebaseGoBack">Change mobile number</button><p class="login-error" id="loginError" role="alert" hidden></p>`;
  } else {
    mainForm = `<h1>${isRegister?'New Registration':'Customer Login'}</h1><h2>${isRegister?'Create Your Woodpeck Account':'Login with Mobile OTP'}</h2><div class="auth-illustration">${messageIcon}</div><p>${isRegister?'Enter your name and mobile number to create your account with one-time SMS verification.':'No password required. Enter your mobile number and verify with a one-time SMS code.'}</p>
    <form id="firebasePhoneForm" class="login-form auth-form">${isRegister?'<label for="registrationName">Full Name</label><input type="text" id="registrationName" name="fullName" autocomplete="name" minlength="2" maxlength="70" required placeholder="Enter your full name"/>':''}<label for="firebasePhone">Mobile Number</label><div class="login-phone"><span>+91</span>${phoneIcon}<input type="tel" id="firebasePhone" name="phone" inputmode="numeric" autocomplete="tel-national" pattern="[6-9][0-9]{9}" minlength="10" maxlength="10" required placeholder="Enter 10-digit mobile number"/></div><div id="firebase-recaptcha"></div><button type="submit" class="auth-submit"><span aria-hidden="true">➤</span> ${isRegister?'Send Registration OTP':'Send OTP'}</button></form><p id="loginError" class="login-error" role="alert" hidden></p>
    <div class="auth-or"><span>or</span></div><p class="auth-join">${isRegister?'Already registered?':'New to Woodpeck International?'}</p><button type="button" class="auth-switch" data-auth-mode="${isRegister?'login':'register'}">${isRegister?'Customer Login':'♙  Create New Account'}</button>`;
  }
  return `<section class="auth-fullscreen" aria-label="Woodpeck customer account">
    <div class="auth-scene"><a class="auth-back" href="index.html" aria-label="Back to store">← Back to Store</a><div class="auth-brand"><img src="${asset('assets/images/woodpeck-brandmark.webp')}" alt="Woodpeck bird emblem"/><div class="auth-brand-name">Woodpeck</div><div class="auth-brand-sub"><span></span> INTERNATIONAL <span></span></div><p>Furniture &amp; Wood Products</p></div></div>
    <div class="auth-card"><div class="auth-card-content">${signedInUser?'':tabs}${mainForm}
      <div class="auth-benefits"><div><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 8 4v5c0 5-3 9-8 11-5-2-8-6-8-11V6zM8 12l3 3 5-6"/></svg><span>Secure<br/>Login</span></div><div><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 1-9 13h7l-1 9 10-14h-7z"/></svg><span>Quick<br/>Access</span></div><div><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="12" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v3"/></svg><span>Your Data<br/>is Safe</span></div></div>
      <small class="auth-legal">Phone authentication is provided by Firebase. Your verified phone number is used for sign-in. UPI payments require a confirmed merchant checkout configuration and manual bank verification.</small>
    </div><div class="auth-wood-wave" aria-hidden="true"></div></div>
  </section>`;
}
function contactPage() {
  return `<div class="container store-page">${breadcrumb(['Contact & Policies'])}${head('WOODPECK INTERNATIONAL','Contact & Policies','Details to be confirmed by the business owner.')}
    <div class="policy-grid"><section><h2>Contact Woodpeck International</h2><p>Official phone, email, office address and WhatsApp support links will be added after the client approves them.</p></section>
    <section><h2>Shipping & Delivery</h2><p>Delivery areas, shipping charges, lead time and installation costs are not yet configured. Final charges will be displayed before a live payment is allowed.</p></section>
    <section><h2>Returns & Refunds</h2><p>The store must publish its approved return, damage, cancellation and refund policy before accepting orders.</p></section>
    <section><h2>Privacy & Terms</h2><p>Cart, wishlist and saved delivery addresses are stored on this browser. When you place a real UPI order, your delivery and order details are securely saved in Firebase for merchant fulfilment.</p></section></div>
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
  document.body.classList.toggle('auth-view',kind==='account');
  document.body.classList.toggle('product-view',kind==='product');
  if(kind!=='product')detailSelection={id:null,photo:0,qty:1};
  $('page').innerHTML=body;
  document.title = (kind.charAt(0).toUpperCase()+kind.slice(1))+' | Woodpeck International';
  updateBadges();
  if(kind==='payment'&&state.activeOrder)void displayUpiQr();
  document.querySelector('.pd-menu')?.removeAttribute('open');
  window.scrollTo({top:0,behavior:'instant'});
}
function addToCart(id, buy=false, requested=1) {
  const p=item(id); if(!p)return;
  const available=maxDetailQty(p);
  if(available<requested){toast('Not enough stock available');return;}
  state.cart[id]=(state.cart[id]||0)+requested;
  save();updateBadges();
  if(buy)go('address'); else {toast(p.name+' added to cart');if(location.hash.startsWith('#/product/'))updateDetail();else render();}
}
function changeQuantity(id,delta) {
  if(!state.cart[id])return;
  state.cart[id]=Math.max(1,Math.min(99,state.cart[id]+delta));save();render();
}
function toggleFavorite(id) {
  if (!item(id))return;
  state.favs=state.favs.includes(id)?state.favs.filter(x=>x!==id):[...state.favs,id];
  save();updateBadges();if(location.hash.startsWith('#/product/'))updateDetail();else render();toast(state.favs.includes(id)?'Saved to wishlist':'Removed from wishlist');
}
document.addEventListener('click',(event)=>{
  const btn=event.target.closest('[data-photo],[data-detail-qty],[data-add],[data-buy],[data-fav],[data-qty],[data-remove],[data-address-new],[data-address-next]');
  if(!btn)return;
  if(btn.hasAttribute('data-photo')){detailSelection.photo=Number(btn.dataset.photo);updateDetail();return;}
  if(btn.hasAttribute('data-detail-qty')){detailSelection.qty+=Number(btn.dataset.detailQty);updateDetail();return;}
  const qty=btn.hasAttribute('data-detail-purchase')?detailSelection.qty:1;
  if(btn.dataset.add){addToCart(btn.dataset.add,false,qty);return;}
  if(btn.dataset.buy){addToCart(btn.dataset.buy,true,qty);return;}
  if(btn.dataset.fav){toggleFavorite(btn.dataset.fav);return;}
  if(btn.dataset.qty){changeQuantity(btn.dataset.id,Number(btn.dataset.qty));return;}
  if(btn.dataset.remove){delete state.cart[btn.dataset.remove];save();render();toast('Product removed');return;}
  if(btn.hasAttribute('data-address-new')){state.addAddressForm=true;render();return;}
  if(btn.hasAttribute('data-address-next')){
    if(!currentAddress()) {toast('Select an address or add a new one');return;}
    go('payment');return;
  }

});
document.addEventListener('change',(event)=>{
  if(event.target.id==='storeSort'){state.sort=event.target.value;render();}
  if(event.target.name==='savedAddress'){state.selectedAddress=event.target.value;save();render();}
});
document.addEventListener('submit',async (event)=>{
  if(event.target.id==='storeSearchForm'){
    event.preventDefault();state.search=$('storeSearch').value.trim();
    if(location.hash==='#/shop')render();else go('shop');
    return;
  }
  if(event.target.id==='upiReferenceForm'){
    event.preventDefault();
    if(!state.activeOrder||!event.target.reportValidity())return;
    const btn=event.target.querySelector('button');btn.disabled=true;
    try{
      await submitUpiReference({orderId:state.activeOrder.id,utr:event.target.elements.utr.value.trim()});
      await refreshCurrentUpiOrder();
    }catch(err){$('upiMessage').textContent='Reference could not be submitted: '+(err.message||err.code);}
    finally{if(btn.isConnected)btn.disabled=false;}
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
document.addEventListener('click',async event=>{
  const create=event.target.closest('#createUpiOrder');
  if(create){
    if(!signedInUser){go('account');return;}
    create.disabled=true;
    try{
      const result=await createUpiOrder({address:currentAddress(),
        items:Object.entries(state.cart).map(([id,qty])=>({id,qty}))});
      state.activeOrder={...result,id:result.orderId,address:currentAddress(),status:'payment_pending',uid:signedInUser.uid};
      localStorage.setItem('woodpeck-current-order',JSON.stringify({id:result.orderId,uid:signedInUser.uid}));
      render();
    }catch(err){
      const el=$('upiMessage');
      if(el)el.textContent='Cannot begin payment: '+(err.message||err.code)+'. No money has been taken.';
    }finally{if(create.isConnected)create.disabled=false;}
    return;
  }
  if(event.target.closest('#refreshUpiOrder')){await refreshCurrentUpiOrder();return;}
  if(event.target.closest('#newUpiOrder')){
    state.activeOrder=null;localStorage.removeItem('woodpeck-current-order');render();
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
onLoginChange(user => {
  // Do not expose a previous signed-in customer's name, address, or order.
  if (!user || (state.activeOrder && state.activeOrder.uid !== user.uid)) {
    state.activeOrder = null;
  }
  if (window.location.hash.startsWith('#/account') || window.location.hash.startsWith('#/payment')) render();
  if (user) void restoreUpiOrder();
});

// Cloud catalog updates are published by authorised admins and loaded read-only for customers.
// A blank/unavailable Firestore collection leaves the existing clearly-labeled demo products visible.
const initialDemoProducts = products.slice();
watchPublishedProducts(cloudItems => {
  const validated = cloudItems.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' &&
    typeof p.image === 'string' && p.image.startsWith('https://') &&
    Number.isFinite(p.price) && p.price >= 0);
  // Never mix demonstrator furniture or example prices into a live published catalogue.
  // Keep clearly documented demo stock only while the business catalogue is empty.
  products.splice(0,products.length,...(validated.length?validated:initialDemoProducts));
  const route=location.hash.replace(/^#\/?/,'').split('/')[0];
  if (['shop','product','wishlist','cart'].includes(route) || !route) render();
}, error => {
  console.warn('Cloud product catalog is not available; displaying demo inventory.', error.code || error.message);
});
