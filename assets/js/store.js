import QRCode from 'qrcode';
import {createUpiOrder,submitUpiReference,fetchUpiOrder,readCustomerAddresses,writeCustomerAddress,readDeliveryQuote,getBankSettings,uploadPaymentProof} from './checkout-api.js';
import {
  firebaseReady, signedInUser, onLoginChange,
  sendPhoneCode, confirmPhoneCode, logoutPhoneUser, registerCustomerName,
  resetPhoneSignIn, clearRecaptcha
} from './firebase-auth.js';
let phoneLoginStep = 'number';
let lastLoginPhone = '';
let authMode = 'login';
let registrationName = '';
let addressUid=null,addressStatus='idle',shippingQuote=null,authKnown=false,editingAddress=null,addressSaving=false;
const UPI_CHECKOUT_LIMIT=100000;
let paymentCreating=false,bankAvailable=false,bankChecked=false;
const exceedsUpiLimit=()=>subtotal()+(shippingQuote??0)>UPI_CHECKOUT_LIMIT;

import './products.js';
import { watchPublishedProducts } from './firebase-catalog.js';

const products = window.WOODPECK_PRODUCTS || [];
let catalogStatus='loading';
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
  addresses: [],
  selectedAddress: null,
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
  if (!Number.isInteger(state.cart[key]) || state.cart[key] < 1 || state.cart[key] > 99) delete state.cart[key];
}
const save = () => {
  try {
    localStorage.setItem('woodpeck-demo-cart', JSON.stringify(state.cart));
    localStorage.setItem('woodpeck-demo-wishlist', JSON.stringify(state.favs));
    if(addressUid && state.selectedAddress)localStorage.setItem('woodpeck-selected-address-'+addressUid,JSON.stringify(state.selectedAddress));
  } catch (err) { console.warn('Browser storage unavailable', err); }
};
const count = () => Object.entries(state.cart).filter(([id])=>!!item(id)).reduce((sum, [,qty]) => sum + qty, 0);
const subtotal = () => Object.entries(state.cart).reduce((sum, [id,qty]) => sum + (item(id)?.price || 0) * qty, 0);
const currentAddress = () => signedInUser?.uid===addressUid?state.addresses.find(address=>address.id===state.selectedAddress):null;
function chooseDefaultAddress(){
  if(!state.addresses.some(a=>a.id===state.selectedAddress))state.selectedAddress=state.addresses[0]?.id||null;
}
async function loadAddressBook(uid){
  addressStatus='loading';
  try{
    const list=await readCustomerAddresses(uid);
    if(addressUid!==uid||signedInUser?.uid!==uid)return;
    state.addresses=list.sort((a,b)=>(b.updatedAt?.seconds||0)-(a.updatedAt?.seconds||0));
    state.selectedAddress=read('woodpeck-selected-address-'+uid,null);
    chooseDefaultAddress();addressStatus='ready';
  }catch(e){if(addressUid!==uid)return;addressStatus='error';}
  if(location.hash.startsWith('#/address')||location.hash.startsWith('#/payment'))render();
}
async function loadDeliveryQuote(uid){
  try{const quote=await readDeliveryQuote();if(addressUid===uid)shippingQuote=quote;}catch(e){if(addressUid===uid)shippingQuote=null;}
  if(addressUid===uid){try{const b=await getBankSettings();if(addressUid===uid)bankAvailable=b?.enabled===true;}catch(e){if(addressUid===uid)bankAvailable=false;}if(addressUid===uid)bankChecked=true;}
  if(addressUid===uid&&$('deliverySummary'))$('deliverySummary').innerHTML=deliverySummaryContent();
  if(addressUid===uid&&location.hash.startsWith('#/payment')&&!state.activeOrder&&!paymentCreating)render();
}
let toastTimer;
function toast(message) {
  const el = $('storeToast'); el.textContent = message; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}
function badge(id, count) {
  const el = $(id); if (!el) return; el.textContent = count; el.hidden = count === 0;
}
function updateBadges() {
  badge('cartBadge', count()); badge('favBadge', state.favs.filter(id=>!!item(id)).length);
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
    <div class="summary-line"><span>Shipping</span><strong class="small-normal">${shippingQuote===null?'To be confirmed':money(shippingQuote)}</strong></div>
    <div class="summary-line summary-total"><span>${shippingQuote===null?'Subtotal':'Estimated Total Payable'}</span><strong>${money(subtotal()+(shippingQuote??0))}</strong></div>
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
      ${list.length ? `<div class="store-product-grid">${list.map(productCard).join('')}</div>` : empty(products.length?'No matching furniture':'New products coming soon',products.length?'Try another keyword or category.':'Our latest collection will appear here when available.')}
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
    <div class="done"><span>✓</span> Cart</div><i></i><div class="${which==='address'?'current':'done'}"><span>${which==='payment'?'✓':'2'}</span> Delivery Address</div><i></i><div class="${which==='payment'?'current':''}"><span>3</span> Payment</div>
  </nav>`;
}
const addrIcon=(name)=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+({
 pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
 book:'<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M2 5v14m7-3c0-3 6-3 6 0"/><circle cx="12" cy="9" r="2"/>',
 cart:'<path d="M2 3h3l3 13h12l3-10H6"/><circle cx="10" cy="21" r="1"/><circle cx="19" cy="21" r="1"/>',
 plus:'<circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10"/>',
 edit:'<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>',
 phone:'<path d="M5 3 2 6c0 8 8 16 16 16l4-4-5-4-3 3c-4-2-6-4-8-8l3-3Z"/>'
}[name]||'')+'</svg>';
const indianStates=['Andaman and Nicobar Islands','Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chandigarh','Chhattisgarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jammu and Kashmir','Jharkhand','Karnataka','Kerala','Ladakh','Lakshadweep','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Puducherry','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal'];
function deliverySummaryContent(){
  return `<h2>${addrIcon('cart')} Order Summary</h2><div class="da-items">${Object.entries(state.cart).filter(([id])=>item(id)).map(([id,qty])=>{const p=item(id);return `<div class="da-item"><img src="${esc(asset(p.image))}" alt=""><div><strong>${esc(p.name)}</strong><small>Qty: ${qty}</small></div><b>${money(p.price*qty)}</b></div>`;}).join('')}</div><div class="da-total-line"><span>Item Total</span><strong>${money(subtotal())}</strong></div><div class="da-total-line"><span>Shipping</span><strong>${shippingQuote===null?'To be confirmed':money(shippingQuote)}</strong></div><div class="da-payable"><span>${shippingQuote===null?'Item Subtotal':'Total Payable'}</span><strong>${money(subtotal()+(shippingQuote??0))}</strong></div><p class="da-fine">Final amount and stock verified before UPI payment.</p>`;
}
function addressPage(){
  if(!count())return cartPage();
  const logged=!!signedInUser&&addressUid===signedInUser.uid,ready=logged&&addressStatus==='ready';
  const hasAddresses=ready&&state.addresses.length>0,showForm=ready&&(state.addAddressForm||!hasAddresses);
  const a=editingAddress?state.addresses.find(x=>x.id===editingAddress)||{}:{};
  const field=(key,fallback='')=>esc(a[key]??fallback);
  const cards=hasAddresses?state.addresses.map(a=>`<div class="da-address ${state.selectedAddress===a.id?'selected':''}"><label><input type="radio" name="savedAddress" value="${esc(a.id)}" ${state.selectedAddress===a.id?'checked':''}><div class="da-address-text"><strong>${esc(a.name)}</strong><span>${esc(a.line1)}${a.line2?', '+esc(a.line2):''}</span><span>${esc(a.city)}, ${esc(a.state)} - ${esc(a.pin)}</span><span class="da-phone">${addrIcon('phone')} +91 ${esc(a.phone)}</span></div></label><div class="da-address-actions"><span class="da-address-type">${esc(a.label||'Home')}</span><button type="button" data-address-edit="${esc(a.id)}" aria-label="Edit address">${addrIcon('edit')}</button></div></div>`).join(''):'';
  const addressForm=showForm?`<form id="deliveryForm" class="address-form da-form"><h3>${editingAddress?'Edit Address':'Add New Address'}</h3>
    <div class="form-pair"><label>Full Name *<input name="name" autocomplete="name" required minlength="2" maxlength="80" value="${field('name',signedInUser?.displayName||'')}" placeholder="Enter full name"></label><label>Mobile Number *<input name="phone" inputmode="numeric" autocomplete="tel-national" pattern="[6-9][0-9]{9}" minlength="10" maxlength="10" required value="${field('phone',String(signedInUser?.phoneNumber||'').replace(/^\+91/,''))}" placeholder="10-digit number"></label></div>
    <label>House No. / Street Address *<input name="line1" autocomplete="address-line1" required minlength="5" maxlength="150" value="${field('line1')}" placeholder="House number, street, area"></label>
    <label>Landmark (Optional)<input name="line2" autocomplete="address-line2" maxlength="100" value="${field('line2')}" placeholder="Nearby landmark"></label>
    <div class="form-pair"><label>City / Town *<input name="city" autocomplete="address-level2" required minlength="2" maxlength="70" value="${field('city')}" placeholder="City / town"></label><label>PIN Code *<input name="pin" inputmode="numeric" autocomplete="postal-code" pattern="[1-9][0-9]{5}" maxlength="6" minlength="6" required value="${field('pin')}" placeholder="6-digit PIN code"></label></div>
    <div class="form-pair"><label>State / Union Territory *<select name="state" autocomplete="address-level1" required><option value="">Select State</option>${indianStates.map(st=>`<option ${a.state===st?'selected':''}>${esc(st)}</option>`).join('')}</select></label><label>Address Type<select name="label">${['Home','Work','Other'].map(t=>`<option ${(a.label||'Home')===t?'selected':''}>${t}</option>`).join('')}</select></label></div>
    <p class="da-fine">Saved to your verified mobile account for future orders.</p><div class="da-form-actions">${hasAddresses?'<button type="button" class="da-outline" data-address-cancel>Cancel</button>':''}<button type="submit" class="da-primary" ${addressSaving?'disabled':''}>Save Address</button></div><p id="addressError" role="alert"></p></form>`:'';
  return `<div class="container store-page da-page">${stepper('address')}<header class="da-title">${addrIcon('pin')}<div><h1>Delivery Address</h1><p>Choose a delivery address for your order.</p></div></header>
   <section class="da-card"><h2>${addrIcon('book')} Saved Addresses</h2>
    ${!authKnown?'<p>Checking your account…</p>':!logged?'<p>Sign in with your mobile number to save and reuse delivery addresses securely.</p><a href="#/account" class="da-primary" data-address-login>Sign In with OTP →</a>':addressStatus==='loading'?'<p>Loading your saved addresses…</p>':addressStatus==='error'?'<p>Could not load your saved addresses.</p><button type="button" class="da-outline" data-address-retry>Try Again</button>':cards+(hasAddresses&&!showForm?`<button type="button" class="da-outline da-add-address" data-address-new>${addrIcon('plus')} Add New Address</button>`:'')+addressForm}
   </section><section class="da-card da-summary" id="deliverySummary">${deliverySummaryContent()}</section>
   ${ready&&currentAddress()&&!showForm?'<button class="da-primary da-next" data-address-next>Continue to Payment <span>→</span></button>':''}
  </div>`;
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
const payIcon=(key)=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+({
 upi:'<path d="m6 3 12 9-12 9 4-9Z"/><path d="m3 3 4 9-4 9"/>',bank:'<path d="m2 8 10-6 10 6H2Zm1 13h18M5 10v8m5-8v8m4-8v8m5-8v8"/>',card:'<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 9h20M6 15h4"/>',net:'<rect x="4" y="3" width="16" height="13" rx="2"/><path d="m4 16-3 5h22l-3-5M8 9h8"/>',wallet:'<rect x="2" y="5" width="19" height="15" rx="3"/><path d="M21 10h-6a3 3 0 0 0 0 6h6M16 13h1"/>',emi:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 10h18m-13 4h1m4 0h1m4 0h1m-11 3h1m4 0h1"/>',cod:'<path d="M2 4h13v14H2m13-9h4l3 4v5h-7"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>',shield:'<path d="m12 2 9 4v6c0 5-9 10-9 10s-9-5-9-10V6Z"/><path d="m8 12 3 3 5-6"/>',copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',lock:'<rect x="4" y="10" width="16" height="12" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v3"/>',list:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8m-8 4h8m-8 4h5"/>'
}[key]||'')+'</svg>';
function paymentPrices(order){
  const amount=order?order.subtotal:subtotal(),shipping=order?order.shipping:shippingQuote,total=order?order.total:(shipping===null?null:amount+shipping);
  const lines=order?order.items||[]:Object.entries(state.cart).filter(([id])=>item(id)).map(([id,qty])=>({id,qty,name:item(id).name,price:item(id).price}));
  return `<section class="pm-card"><h2>${addrIcon('cart')} Order Summary</h2>${lines.length?lines.map(line=>{const p=item(line.id);return `<div class="da-item pm-item">${p?.image?`<img src="${esc(asset(p.image))}" alt="">`:'<span class="pm-item-placeholder">'+addrIcon('cart')+'</span>'}<div><strong>${esc(line.name)}</strong><small>Qty: ${line.qty}</small></div><b>${money(line.price*line.qty)}</b></div>`;}).join(''):'<p>Order details saved.</p>'}</section><section class="pm-card"><h2>${payIcon('list')} Price Details</h2><div class="pm-line"><span>Product Amount</span><strong>${money(amount)}</strong></div><div class="pm-line"><span>Delivery Charge</span><strong>${shipping===null?'To be confirmed':money(shipping)}</strong></div><div class="da-payable"><span>${total===null?'Item Subtotal':'Total Payable Amount'}</span><strong>${money(total??amount)}</strong></div></section>`;
}
function paymentOptions(){
  if(exceedsUpiLimit()&&bankAvailable)state.payment='bank';
  const rows=[['upi','Pay with UPI','Google Pay, PhonePe, Paytm, BHIM & more',!exceedsUpiLimit()&&shippingQuote!==null],['bank','Bank Transfer (NEFT / IMPS / RTGS)','Pay using your bank account',bankAvailable&&shippingQuote!==null],['card','Debit / Credit Card','Payment gateway required',false],['net','Net Banking','Payment gateway required',false],['wallet','Wallets','Payment gateway required',false],['emi','EMI','Financing provider required',false],['cod','Cash on Delivery (COD)','Not enabled by store',false]];
  return `<section class="pm-card pm-methods"><h2>${payIcon('card')} Choose Payment Method</h2>${rows.map(([id,title,sub,enabled])=>`<button type="button" class="pm-method ${state.payment===id&&enabled?'selected':''}" data-payment-method="${id}" ${enabled?'':'disabled'} aria-pressed="${state.payment===id&&enabled}"><span class="pm-radio"></span><span class="pm-method-icon">${payIcon(id)}</span><span class="pm-method-text"><strong>${title}</strong><small>${sub}</small>${id==='upi'&&state.payment==='upi'&&enabled?'<span class="pm-apps"><b>G Pay</b><b>PhonePe</b><b>Paytm</b><b>BHIM</b></span>':''}</span><span class="pm-method-end">${enabled?'›':id==='bank'&&!bankChecked?'Checking…':'Unavailable'}</span></button>`).join('')}</section>`;
}
function bankDetails(bank){
  return bank?`<div class="pm-bank"><h3>${payIcon('bank')} Bank Account (Transfer / NEFT / RTGS)</h3>${[['Bank',bank.bankName],['Account Name',bank.accountName],['Account Number',bank.accountNumber],['IFSC',bank.ifsc]].map(([label,value])=>`<div class="pm-bank-row"><span>${label}</span><strong>${esc(value)}</strong><button type="button" data-copy-pay="${esc(value)}" aria-label="Copy ${label}">${payIcon('copy')}</button></div>`).join('')}</div>`:'<p>Bank details are not available for this order. Contact the store before paying.</p>';
}
function paymentPage(){
  if(!authKnown)return '<div class="container store-page">'+head('CHECKOUT','Checking account…')+'</div>';
  if(!count()&&!state.activeOrder){go('cart');return '';}
  if(signedInUser&&addressStatus==='loading'&&!state.activeOrder)return '<div class="container store-page">'+head('CHECKOUT','Loading your address…')+'</div>';
  if(!currentAddress()&&!state.activeOrder){go('address');return '';}
  const order=state.activeOrder,bank=order?.method==='bank',waiting=order?.status==='payment_pending';
  let content='';
  if(order){
    const status=({payment_pending:bank?'Awaiting Bank Transfer':'Awaiting UPI Payment',verification_pending:'Payment submitted — bank verification pending',paid:'Payment confirmed by Woodpeck International',rejected:'Payment could not be verified',cancelled:'Order cancelled'})[order.status]||'Order status unavailable';
    content=`<section class="pm-card pm-details"><h2>${payIcon(bank?'bank':'upi')} ${esc(status)}</h2><p class="pm-order-id">Order ID: ${esc(order.id)}</p>${waiting?(bank?bankDetails(order.bank):`<div class="pm-upi"><div class="upi-qr-wrap"><img id="payQr" alt="UPI QR code for exact order amount"><p>Scan & Pay with any UPI app</p></div><div><h3>UPI ID</h3><div class="pm-copy"><strong>${esc(order.merchantUpi||MERCHANT_UPI)}</strong><button type="button" data-copy-pay="${esc(order.merchantUpi||MERCHANT_UPI)}" aria-label="Copy UPI ID">${payIcon('copy')}</button></div><p>Receiver: ${esc(order.merchantName||'WOODPECK INTERNATIONAL')}</p></div></div>`):''}<p class="pm-note">${waiting?'Transfer exactly '+money(order.total)+' to the displayed merchant account. Confirm the beneficiary before payment.':'The shop checks the actual bank receipt before marking a payment confirmed.'}</p></section>${waiting?`<section class="pm-card"><h2>${payIcon('list')} After Payment</h2><form id="upiReferenceForm" class="upi-reference-form"><label for="upiUtr">Enter UTR / Transaction Reference Number</label><input id="upiUtr" name="utr" type="text" inputmode="${bank?'text':'numeric'}" pattern="${bank?'[A-Za-z0-9]{8,30}':'[0-9]{10,22}'}" minlength="${bank?8:10}" maxlength="${bank?30:22}" placeholder="Enter UTR / Transaction ID" required><label for="paymentProof">Upload Payment Screenshot (Optional)</label><div class="pm-proof"><input type="file" name="proof" id="paymentProof" accept="image/jpeg,image/png,application/pdf"><small>JPG, PNG or PDF · Max 5 MB</small></div><button type="submit" class="store-btn primary">Submit for bank verification</button></form></section>`:order.utr?`<section class="pm-card">Submitted reference: <strong>${esc(order.utr)}</strong></section>`:''}<div id="upiMessage" role="status"></div><button class="store-btn ghost pm-refresh" id="refreshUpiOrder">Refresh order status</button><button class="store-btn ghost pm-refresh" id="newUpiOrder">Start a new checkout</button>${waiting&&!bank?`<div class="pm-footer"><a class="pm-pay" href="${esc(upiLink(order))}">${payIcon('lock')} Pay ${money(order.total)} →</a></div>`:''}`;
  }else{

    // paymentOptions may select bank for larger orders; compute eligibility after it.
    const options=paymentOptions();
    const enabled=shippingQuote!==null&&(state.payment==='bank'?bankAvailable:!exceedsUpiLimit());
    content=options+`<section class="pm-card pm-details"><h2>${payIcon(state.payment==='bank'?'bank':'upi')} ${state.payment==='bank'?'Bank Transfer Details':'UPI Payment Details'}</h2><p>${enabled?'Confirm your order to generate the exact payment instructions.':exceedsUpiLimit()?'This order exceeds the ₹1,00,000 UPI checkout limit. Bank transfer requires verified merchant settings.':'Payment is unavailable until the delivery charge and merchant settings are confirmed.'}</p>${exceedsUpiLimit()&&!bankAvailable?'<a class="store-btn ghost" href="#/cart">Edit Cart</a>':''}</section><div id="upiMessage" role="alert"></div><div class="pm-footer"><button class="pm-pay" id="createUpiOrder" ${!enabled||paymentCreating?'disabled':''}>${payIcon('lock')} ${paymentCreating?'Creating secure order…':state.payment==='bank'?'Create Bank Transfer Order':shippingQuote===null?'Confirm Order':'Continue to Pay '+money(subtotal()+shippingQuote)} →</button></div>`;
  }
  const address=order?.address||currentAddress();
  return `<div class="container store-page pm-page">${stepper('payment')}${paymentPrices(order)}${address?`<section class="pm-card pm-deliver"><div><small>DELIVER TO</small><strong>${esc(address.name)}</strong><span>${esc(address.line1)}, ${esc(address.city)} – ${esc(address.pin)}</span></div>${!order?'<a href="#/address">Change</a>':''}</section>`:''}${content}<div class="pm-safe">${payIcon('shield')}<div><strong>Bank-verified payment</strong><small>Never share your UPI PIN or card details here. Payment is confirmed only after checking the bank receipt.</small></div></div></div>`;
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
    <section><h2>Privacy & Terms</h2><p>Cart and wishlist are stored in this browser. Saved delivery addresses are stored in your verified customer account and are not shared with other customers. When you place a real UPI order, your delivery and order details are securely saved in Firebase for merchant fulfilment.</p></section></div>
  </div>`;
}
function render() {
  const route=(location.hash.replace(/^#\/?/,'') || 'shop').split('/').map(decodeURIComponent);
  if (route[0]==='checkout') route[0]='address';
  const kind=route[0];
  let body;
  if(['shop','product','cart','wishlist','address','payment'].includes(kind)&&catalogStatus==='loading')body='<div class="container store-page">'+head('WOODPECK INTERNATIONAL','Loading furniture…')+'</div>';
  else if(['shop','product','cart','wishlist','address','payment'].includes(kind)&&catalogStatus==='error'&&!products.length)body='<div class="container store-page">'+empty('Products temporarily unavailable','Please refresh the page to try again.')+'</div>';
  else switch(kind) {
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
  document.body.classList.toggle('address-view',kind==='address');
  document.body.classList.toggle('payment-view',kind==='payment');
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
  const btn=event.target.closest('[data-photo],[data-detail-qty],[data-add],[data-buy],[data-fav],[data-qty],[data-remove],[data-address-new],[data-address-next],[data-address-edit],[data-address-cancel],[data-address-login],[data-address-retry]');
  if(!btn)return;
  if(btn.hasAttribute('data-photo')){detailSelection.photo=Number(btn.dataset.photo);updateDetail();return;}
  if(btn.hasAttribute('data-detail-qty')){detailSelection.qty+=Number(btn.dataset.detailQty);updateDetail();return;}
  const qty=btn.hasAttribute('data-detail-purchase')?detailSelection.qty:1;
  if(btn.dataset.add){addToCart(btn.dataset.add,false,qty);return;}
  if(btn.dataset.buy){addToCart(btn.dataset.buy,true,qty);return;}
  if(btn.dataset.fav){toggleFavorite(btn.dataset.fav);return;}
  if(btn.dataset.qty){changeQuantity(btn.dataset.id,Number(btn.dataset.qty));return;}
  if(btn.dataset.remove){delete state.cart[btn.dataset.remove];save();render();toast('Product removed');return;}
  if(btn.hasAttribute('data-address-login')){sessionStorage.setItem('woodpeck-return-address','1');return;}
  if(btn.hasAttribute('data-address-retry')){if(addressUid){void loadAddressBook(addressUid);render();}return;}
  if(addressSaving)return;
  if(btn.hasAttribute('data-address-edit')){editingAddress=btn.dataset.addressEdit;state.addAddressForm=true;render();$('deliveryForm')?.scrollIntoView({block:'start'});return;}
  if(btn.hasAttribute('data-address-cancel')){editingAddress=null;state.addAddressForm=false;render();return;}
  if(btn.hasAttribute('data-address-new')){editingAddress=null;state.addAddressForm=true;render();$('deliveryForm')?.scrollIntoView({block:'start'});return;}
  if(btn.hasAttribute('data-address-next')){
    if(!currentAddress()) {toast('Select an address or add a new one');return;}
    go('payment');return;
  }

});
document.addEventListener('change',(event)=>{
  if(event.target.id==='storeSort'){state.sort=event.target.value;render();}
  if(event.target.name==='savedAddress'&&!addressSaving){state.selectedAddress=event.target.value;save();document.querySelectorAll('.da-address').forEach(card=>card.classList.toggle('selected',card.querySelector('input')?.checked===true));}
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
      const order=state.activeOrder,proof=event.target.elements.proof?.files?.[0],utr=event.target.elements.utr.value.trim();
      if(proof){btn.textContent='Uploading payment proof…';await uploadPaymentProof(order,proof);}
      btn.textContent='Submitting reference…';
      await submitUpiReference({orderId:order.id,utr});
      await refreshCurrentUpiOrder();
    }catch(err){const msg=$('upiMessage');if(msg)msg.textContent='Reference could not be submitted: '+(err.message||err.code);}
    finally{if(btn.isConnected){btn.disabled=false;btn.textContent='Submit for bank verification';}}
    return;
  }
  if(event.target.id==='deliveryForm'){
    event.preventDefault();
    const form=event.target,uid=signedInUser?.uid;
    if(!uid||uid!==addressUid||addressSaving||!form.reportValidity())return;
    const data=Object.fromEntries(new FormData(form).entries());
    for(const key of Object.keys(data))data[key]=String(data[key]).trim();
    if(data.name.length<2||data.line1.length<5||data.city.length<2||!(/^[6-9][0-9]{9}$/).test(data.phone)||!(/^[1-9][0-9]{5}$/).test(data.pin)){
      $('addressError').textContent='Please check name, mobile, street, city and PIN code.';return;
    }
    const id=editingAddress||crypto.randomUUID();
    addressSaving=true;const button=form.querySelector('[type=submit]');button.disabled=true;button.textContent='Saving…';
    try{
      await writeCustomerAddress(uid,id,data);
      if(uid!==addressUid||uid!==signedInUser?.uid)return;
      state.addresses=[{...data,id},...state.addresses.filter(a=>a.id!==id)];
      state.selectedAddress=id;state.addAddressForm=false;editingAddress=null;save();
      toast('Address saved to your account');render();
    }catch(e){const error=$('addressError');if(error)error.textContent='Unable to save address. Please retry. '+(e.code||'');}
    finally{addressSaving=false;if(button.isConnected){button.disabled=false;button.textContent='Save Address';}}
  }
});
document.addEventListener('click',async event=>{
  const method=event.target.closest('[data-payment-method]');if(method&&!method.disabled&&!state.activeOrder&&!paymentCreating){state.payment=method.dataset.paymentMethod;render();return;}
  const copy=event.target.closest('[data-copy-pay]');if(copy){try{await navigator.clipboard.writeText(copy.dataset.copyPay);toast('Copied');}catch(e){toast('Unable to copy. Select and copy the value.');}return;}
  const create=event.target.closest('#createUpiOrder');
  if(create){
    if(!signedInUser){go('account');return;}
    if(!currentAddress()){go('address');return;}
    if(paymentCreating)return;
    if(shippingQuote===null||(state.payment==='upi'&&exceedsUpiLimit())||(state.payment==='bank'&&!bankAvailable)){render();return;}
    const buyerUid=signedInUser.uid, delivery=currentAddress(),method=state.payment;
    paymentCreating=true;create.disabled=true;create.textContent='Creating secure order…';
    try{
      const result=await createUpiOrder({address:delivery,method,
        items:Object.entries(state.cart).filter(([id])=>!!item(id)).map(([id,qty])=>({id,qty}))});
      if(signedInUser?.uid!==buyerUid)return;
      if((result.method||'upi')!==method)throw new Error('Payment method unavailable. Do not pay this order.');
      state.activeOrder={...result,id:result.orderId,address:delivery,status:'payment_pending',uid:buyerUid};
      localStorage.setItem('woodpeck-current-order',JSON.stringify({id:result.orderId,uid:signedInUser.uid}));
      render();
    }catch(err){
      const el=$('upiMessage');
      if(el){const code=String(err.code||'');el.textContent=(code.endsWith('/internal')||code.endsWith('/unavailable')?'Payment server temporarily unavailable. Please try again.':(err.message||'Could not create the order.'))+' No payment was initiated.';}
    }finally{paymentCreating=false;const button=$('createUpiOrder');if(button){button.disabled=false;button.textContent=state.payment==='bank'?'Create Bank Transfer Order →':'Continue to Pay '+money(subtotal()+(shippingQuote??0))+' →';}}
    return;
  }
  if(event.target.closest('#refreshUpiOrder')){await refreshCurrentUpiOrder();return;}
  if(event.target.closest('#newUpiOrder')){
    if(['payment_pending','verification_pending'].includes(state.activeOrder?.status)&&!confirm('This order is still pending. Do not pay twice. If you have already transferred money, submit the reference or contact the store. Start a different checkout?'))return;
    state.activeOrder=null;localStorage.removeItem('woodpeck-current-order');render();
  }
});
window.addEventListener('hashchange',()=>{state.review=false;render();if((location.hash.startsWith('#/address')||location.hash.startsWith('#/payment'))&&addressUid)void loadDeliveryQuote(addressUid);});
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
    if(form.id==='firebaseCodeForm'&&sessionStorage.getItem('woodpeck-return-address')){sessionStorage.removeItem('woodpeck-return-address');go('address');}else render();
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
  authKnown=true;
  const uid=user?.uid||null;
  const changed=uid!==addressUid;
  if(changed){
    addressUid=uid;state.addresses=[];state.selectedAddress=null;state.addAddressForm=false;editingAddress=null;shippingQuote=null;bankAvailable=false;bankChecked=false;state.payment='upi';addressStatus=uid?'loading':'idle';
    if(uid){void loadAddressBook(uid);void loadDeliveryQuote(uid);}
  }
  if(!user||(state.activeOrder&&state.activeOrder.uid!==uid))state.activeOrder=null;
  if(['#/account','#/payment','#/address'].some(route=>location.hash.startsWith(route))&&(changed||!$('deliveryForm')))render();
  if(user)void restoreUpiOrder();
});

// Only published merchant inventory is shown. No fallback or sample products.
watchPublishedProducts((cloudItems, fromCache) => {
  const validated=cloudItems.filter(p=>p && typeof p.id==='string' && typeof p.name==='string' &&
    typeof p.image==='string' && p.image.startsWith('https://') && Number.isFinite(p.price) && p.price>=0);
  products.splice(0,products.length,...validated);
  catalogStatus=validated.length||!fromCache?'ready':'loading';
  if(!fromCache){
    const oldDemoIds=['sofa-01','table-01','bed-01','wardrobe-01','decor-01','chair-01'];
    for(const id of oldDemoIds)if(!item(id))delete state.cart[id];
    state.favs=state.favs.filter(id=>!oldDemoIds.includes(id)||!!item(id));
    save();
  }
  const route=location.hash.replace(/^#\/?/,'').split('/')[0];
  if(route==='payment'&&$('upiReferenceForm'))return;
  if(route==='address'&&$('deliveryForm')){if($('deliverySummary'))$('deliverySummary').innerHTML=deliverySummaryContent();}else if(['shop','product','wishlist','cart','address','payment'].includes(route)||!route)render();
},error=>{
  catalogStatus='error';
  console.warn('Cloud product catalog is not available.',error.code||error.message);
  render();
});
