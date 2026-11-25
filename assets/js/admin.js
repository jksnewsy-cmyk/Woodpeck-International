import {watchUpiOrders,reviewUpiOrder,getCheckoutSettings,updateCheckoutSettings} from './checkout-api.js';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, checkAdmin, watchAllProducts, saveProduct, removeProduct, uploadProductImage } from './firebase-catalog.js';
import { sendPhoneCode, confirmPhoneCode, logoutPhoneUser, resetPhoneSignIn } from './firebase-auth.js';

// The admin screen never sends OTP to numbers outside this exact allowlist.
// Firebase Firestore / Storage rules MUST enforce the same list server-side;
// front-end validation alone cannot protect an API.
const ADMIN_PHONES = new Set(['+918754344229', '+919659650202']);
const canUseAdmin = user => Boolean(user && ADMIN_PHONES.has(user.phoneNumber));
const $ = id => document.getElementById(id);
const esc = s => String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&quot;'}[ch]));
let sellerOrders=[],ordersLoaded=false,productsLoaded=false,activeSection='dashboard';
let products = [], unsubscribe = null, orderUnsubscribe = null, currentUser = null, isAdmin = false, checking = false;
const form = $('productForm');
let editorBusy=false;
const editor=$('productDialog');
const setView = name => {
  ['loading','authGate','restricted','dashboard'].forEach(id=>$(id).hidden=id!==name);
  $('signOut').hidden=name==='loading'||name==='authGate';
  document.body.classList.toggle('seller-active',name==='dashboard');
  for(const id of ['sellerMenu','sellerNotifications','sellerBottom'])$(id).hidden=name!=='dashboard';
  if(name!=='dashboard'){if(editor.open)editor.close();$('sellerMenuPanel').hidden=true;products=[];sellerOrders=[];productsLoaded=false;ordersLoaded=false;for(const id of ['totalCount','liveCount','outCount','totalOrders','myProductsCount','recentOrderCount','todayOrders','todaySales','todayRevenue'])$(id).textContent='—';$('productsTable').innerHTML='<tr><td colspan="6">Loading products…</td></tr>';$('recentOrderList').textContent='Loading orders…';$('upiOrdersTable').innerHTML='<tr><td colspan="5">Loading orders…</td></tr>';setOrderBadge(0);}
};
function alertMessage(id, text, bad=false) {
  const el=$(id);el.textContent=text;el.style.color=bad?'#af3022':'#32794b';
}
async function determineAccess(user) {
  if(checking) return;
  checking=true;
  if (unsubscribe){unsubscribe();unsubscribe=null;}
  if(orderUnsubscribe){orderUnsubscribe();orderUnsubscribe=null;}
  isAdmin=false;currentUser=user;
  setView('loading');
  if(!user){setView('authGate');checking=false;return;}
  if (!canUseAdmin(user)) {
    setView('authGate');
    alertMessage('authInfo', 'This mobile number is not authorised for Woodpeck Admin. Sign out and use an approved admin number.', true);
    checking=false;
    return;
  }
  try {
    isAdmin=await checkAdmin(user);
    if(!isAdmin){$('userUid').textContent=user.uid;setView('restricted');}
    else {
      setView('dashboard');showSellerSection('dashboard',false);
      unsubscribe=watchAllProducts(data=>{products=data;productsLoaded=true;displayProducts();renderOrderSummary();},e=>alertMessage('status',`Cannot access products: ${e.code||e.message}. Check Firestore Security Rules.`,true));
      orderUnsubscribe=watchUpiOrders(displayUpiOrders,e=>{alertMessage('orderStatus','Could not access orders: '+(e.code||e.message),true);$('recentOrderList').textContent='Orders unavailable. Please refresh.';});
      void loadCheckoutSettings();
    }
  }catch(error){$('userUid').textContent=user.uid;setView('restricted');}
  checking=false;
}
// Do not leave the administrator staring at a permanent loading message when
// browser storage or Firebase Auth's initial state check is delayed.
let authStateReceived = false;
const authInitialTimeout = setTimeout(() => {
  if (!authStateReceived) {
    setView('authGate');
    alertMessage('authInfo', 'Firebase sign-in is taking longer than expected. You can try signing in below or refresh this page.', true);
  }
}, 8500);
onAuthStateChanged(auth, user => {
  authStateReceived = true;
  clearTimeout(authInitialTimeout);
  void determineAccess(user);
}, error => {
  authStateReceived = true;
  clearTimeout(authInitialTimeout);
  setView('authGate');
  alertMessage('authInfo', 'Unable to check Firebase login: ' + (error.code || error.message), true);
});
$('signOut').addEventListener('click',()=>logoutPhoneUser().catch(e=>alertMessage('authInfo',e.message,true)));
$('retryAccess').addEventListener('click',()=>determineAccess(auth.currentUser));
$('copyUid').addEventListener('click',()=>navigator.clipboard.writeText($('userUid').textContent).then(()=>$('copyUid').textContent='Copied'));
$('adminPhoneForm').addEventListener('submit',async e=>{
  e.preventDefault();const number=$('adminPhone').value.trim();if(!/^[6-9]\d{9}$/.test(number))return;
  if (!ADMIN_PHONES.has('+91'+number)) {
    alertMessage('authInfo', 'This mobile number is not permitted to access the Admin Panel. OTP was not requested.', true);
    return;
  }
  const btn=e.target.querySelector('[type=submit]');btn.disabled=true;alertMessage('authInfo','Checking reCAPTCHA and sending SMS…');
  try{await sendPhoneCode(number);$('adminPhoneForm').hidden=true;$('adminOtpForm').hidden=false;alertMessage('authInfo','SMS code sent. Enter the 6-digit OTP.');}
  catch(error){alertMessage('authInfo',error.message,true)}finally{btn.disabled=false;}
});
$('adminOtpForm').addEventListener('submit',async e=>{
  e.preventDefault();const btn=e.target.querySelector('[type=submit]');btn.disabled=true;
  try{
    const verified = await confirmPhoneCode($('adminOtp').value.trim());
    if (!canUseAdmin(verified)) {
      await logoutPhoneUser();
      throw new Error('This verified mobile number is not authorised for administrator access.');
    }
    alertMessage('authInfo','Mobile verified. Checking admin access…');
  }
  catch(error){alertMessage('authInfo',error.message,true)}finally{btn.disabled=false;}
});
$('changeNumber').addEventListener('click',()=>{resetPhoneSignIn();$('adminOtpForm').hidden=true;$('adminPhoneForm').hidden=false;alertMessage('authInfo','')});
const sellerMoney=value=>'₹'+Number(value||0).toLocaleString('en-IN');
const sellerDate=value=>{const d=value?.toDate?.();return d instanceof Date&&!isNaN(d)?d:null;};
const istDate=d=>d?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(d):'';
const orderStatusLabels={paid:'Paid',verification_pending:'Verify payment',payment_pending:'Awaiting payment',rejected:'Rejected'};
const actionSvg=(path)=>'<svg class="sd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path+'</svg>';
const editIcon=actionSvg('<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>');
const copyIcon=actionSvg('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>');
const deleteIcon=actionSvg('<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>');
const categoryLabels={sofas:'Sofas',chairs:'Chairs',tables:'Tables',beds:'Beds',wardrobes:'Wardrobes',decor:'Home Decor'};
function setOrderBadge(n){for(const id of ['notificationCount','orderShortcutBadge']){$(id).textContent=n;$(id).hidden=n===0;}}
function showSellerSection(section,scroll=true){
  if(!isAdmin)return;
  activeSection=section;
  const dashboard=section==='dashboard';
  $('sellerOverview').hidden=!dashboard;
  document.querySelector('.sd-stats').hidden=!dashboard;
  document.querySelector('.sd-shortcuts').hidden=!dashboard;
  $('sellerProducts').hidden=!(dashboard||section==='products');
  document.querySelector('.sd-lower').hidden=!(dashboard||section==='reports'||section==='payments');
  $('recentOrders').hidden=!dashboard;
  $('sellerPayments').hidden=!(dashboard||section==='payments');
  $('sellerReports').hidden=!(dashboard||section==='reports');
  document.querySelector('.sd-lower').classList.toggle('sd-single',!dashboard);
  $('sellerOrders').hidden=section!=='orders';
  $('sellerSettings').hidden=section!=='settings';
  document.querySelectorAll('#sellerBottom button').forEach(btn=>{const selected=btn.dataset.section===section;btn.classList.toggle('active',selected);if(selected)btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current');});
  $('sellerMenuPanel').hidden=true;$('sellerMenu').setAttribute('aria-expanded','false');
  displayProducts();if(scroll)window.scrollTo({top:0,behavior:'instant'});
}
document.addEventListener('click',e=>{const target=e.target.closest('[data-section]');if(target)showSellerSection(target.dataset.section);});
$('sellerMenu').addEventListener('click',()=>{const open=$('sellerMenuPanel').hidden;$('sellerMenuPanel').hidden=!open;$('sellerMenu').setAttribute('aria-expanded',String(open));});
$('sellerNotifications').addEventListener('click',()=>showSellerSection('orders'));
function displayProducts(){
  if(!productsLoaded)return;
  $('totalCount').textContent=products.length;
  $('liveCount').textContent=products.filter(p=>p.published).length;
  $('outCount').textContent=products.filter(p=>p.stock===0).length;
  $('myProductsCount').textContent=products.length;
  const term=$('productSearch').value.trim().toLowerCase(),filter=$('productFilter').value,cat=$('categoryFilter').value;
  const visible=products.filter(p=>String(p.name||'').toLowerCase().includes(term)&&(cat==='all'||p.category===cat)&&(filter==='all'||filter==='published'&&p.published||filter==='draft'&&!p.published||filter==='out'&&p.stock===0));
  const rows=activeSection==='dashboard'&&!term&&cat==='all'&&filter==='all'?visible.slice(0,5):visible;
  $('productsTable').innerHTML=rows.length?rows.map(p=>`<tr><td><div class="item"><img alt="" src="${esc(p.image||'')}" loading="lazy"/><span>${esc(p.name)}${p.finish||p.configuration?`<small>${esc([p.finish,p.configuration].filter(Boolean).join(' · '))}</small>`:''}</span></div></td><td>${esc(categoryLabels[p.category]||p.category)}</td><td><strong>${sellerMoney(p.price)}</strong></td><td>${esc(p.stock)}</td><td><span class="pill ${p.published?'live':''}">${p.published?'✓ Published':'Draft'}</span></td><td><div class="sd-row-actions"><button data-edit="${esc(p.id)}" title="Edit" aria-label="Edit product">${editIcon}</button><button data-copy="${esc(p.id)}" title="Duplicate as draft" aria-label="Duplicate as draft">${copyIcon}</button><button data-delete="${esc(p.id)}" title="Delete" aria-label="Delete product">${deleteIcon}</button></div></td></tr>`).join(''):'<tr><td colspan="6">'+(products.length?'No matching products.':'No products yet. Click Add Product.')+'</td></tr>';
}
$('productSearch').addEventListener('input',displayProducts);
$('productFilter').addEventListener('change',displayProducts);
$('categoryFilter').addEventListener('change',displayProducts);
function renderOrderSummary(){
  if(!ordersLoaded)return;
  const today=istDate(new Date()),created=sellerOrders.filter(o=>istDate(sellerDate(o.createdAt))===today),paid=sellerOrders.filter(o=>o.status==='paid'&&istDate(sellerDate(o.reviewedAt))===today);
  $('totalOrders').textContent=sellerOrders.length;$('recentOrderCount').textContent=sellerOrders.length;
  $('todayOrders').textContent=created.length;$('todaySales').textContent=sellerMoney(paid.reduce((sum,o)=>sum+Number(o.subtotal||0),0));$('todayRevenue').textContent=sellerMoney(paid.reduce((sum,o)=>sum+Number(o.total||0),0));
  setOrderBadge(sellerOrders.filter(o=>o.status==='verification_pending').length);
  $('recentOrderList').innerHTML=sellerOrders.length?sellerOrders.slice(0,4).map(o=>{
    const first=o.items?.[0],p=products.find(x=>x.id===first?.id),date=sellerDate(o.createdAt);
    const media=p?.image?`<img src="${esc(p.image)}" alt="" loading="lazy">`:'<div class="sd-order-icon">'+actionSvg('<path d="m12 2 9 5v10l-9 5-9-5V7Z M3 7l9 5 9-5m-9 5v10"/>')+'</div>';
    const status=orderStatusLabels[o.status]||'Unknown';
    return `<div class="sd-order">${media}<div class="sd-order-text"><strong title="${esc(o.id)}">#${esc(String(o.id).slice(0,12))}</strong><small>${date?esc(date.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})):'Date unavailable'}</small><small>${esc(first?.name||'')}</small></div><div class="sd-order-value"><strong>${sellerMoney(o.total)}</strong><span class="sd-order-status ${esc(o.status)}">${esc(status)}</span></div></div>`;
  }).join(''):'<p class="sd-empty">No real orders yet.</p>';
}
function openForm(id='',copy=false){
  if(!isAdmin||editorBusy)return;
  form.reset();$('mainPhotoFilename').textContent='Upload product photo';$('extraPhotoProgress').textContent='';$('editingId').value=copy?'':id;$('imagePreview').hidden=true;$('uploadProgress').textContent='';$('formError').textContent='';
  $('dialogTitle').textContent=copy?'Duplicate Product':id?'Edit Product':'Add Product';
  $('dialogSubtitle').textContent=copy?'Save a new draft with reviewed stock and details':id?'Update product details for your store':'Create a new product for your store';
  const p=products.find(p=>p.id===id);
  if(p){for(const key of ['name','category','price','compareAt','stock','description','materials','tag','image','variantGroup','finish','configuration'])form.elements[key].value=p[key]??'';
    form.elements.images.value=Array.isArray(p.images)?p.images.join('\n'):'';form.elements.published.checked=!!p.published;form.elements.bestseller.checked=!!p.bestseller;previewImage();}
  if(copy){form.elements.name.value=String(p?.name||'').slice(0,113)+' (Copy)';form.elements.stock.value=0;form.elements.published.checked=false;form.elements.bestseller.checked=false;}
  previewImage();renderExtraPhotos();updateStockButtons();
  editor.showModal();editor.scrollTop=0;
}
function previewImage(){
  const url=form.elements.image.value.trim(),img=$('imagePreview');
  const valid=/^https:\/\//i.test(url);
  img.hidden=!valid;$('imagePlaceholder').hidden=valid;
  if(valid)img.src=url;else img.removeAttribute('src');
}
const extraUrls=()=>form.elements.images.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
function renderExtraPhotos(){
  const urls=extraUrls(), thumbs=$('extraPhotoThumbs');
  thumbs.replaceChildren();
  urls.forEach((url,i)=>{
    if(!/^https:\/\//i.test(url))return;
    const tile=document.createElement('div');tile.className='pf-thumb';
    const img=document.createElement('img');img.src=url;img.alt='Additional product photo '+(i+1);
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove photo '+(i+1));remove.disabled=editorBusy;
    remove.addEventListener('click',()=>{if(editorBusy)return;const current=extraUrls();current.splice(i,1);form.elements.images.value=current.join('\n');renderExtraPhotos();});
    tile.append(img,remove);thumbs.append(tile);
  });
  $('extraPhotoCount').textContent='('+urls.length+'/9)';
  $('extraPhotoFiles').disabled=editorBusy||urls.length>=9;
  document.querySelector('.pf-add-more').setAttribute('aria-disabled',String($('extraPhotoFiles').disabled));
}
function updateStockButtons(){
  const n=Number(form.elements.stock.value);
  $('stockMinus').disabled=n<=0;
  $('stockPlus').disabled=n>=100000;
}
function stepStock(delta){
  const n=Number(form.elements.stock.value);
  form.elements.stock.value=Math.max(0,Math.min(100000,(Number.isFinite(n)?Math.trunc(n):0)+delta));updateStockButtons();
}
function setEditorBusy(busy){
  editorBusy=busy;
  for(const id of ['saveProduct','cancelForm','closeDialog','photoFile'])$(id).disabled=busy;
  form.elements.images.readOnly=busy;
  form.elements.image.readOnly=busy;
  renderExtraPhotos();
}
$('stockMinus').addEventListener('click',()=>stepStock(-1));
$('stockPlus').addEventListener('click',()=>stepStock(1));
form.elements.stock.addEventListener('input',updateStockButtons);
form.elements.images.addEventListener('input',renderExtraPhotos);
$('imagePreview').addEventListener('error',()=>{$('imagePreview').hidden=true;$('imagePlaceholder').hidden=false;});
$('addProduct').addEventListener('click',()=>openForm());
$('imageUrl').addEventListener('input',previewImage);
function closeDialog(){if(!editorBusy)editor.close();}
editor.addEventListener('cancel',e=>{if(editorBusy)e.preventDefault();});
$('closeDialog').addEventListener('click',closeDialog);
$('cancelForm').addEventListener('click',closeDialog);
$('productsTable').addEventListener('click',async e=>{
  const edit=e.target.closest('[data-edit]'); const del=e.target.closest('[data-delete]');const copy=e.target.closest('[data-copy]');
  if(copy){openForm(copy.dataset.copy,true);return;}
  if(edit){openForm(edit.dataset.edit);return;}
  if(del){const p=products.find(p=>p.id===del.dataset.delete);if(!p)return;
    if(!confirm(`Delete ${p.name}? This removes its product record from the shop.`))return;
    try{await removeProduct(p.id);alertMessage('status','Product deleted.');}catch(err){alertMessage('status',err.message,true);}
  }
});
$('photoFile').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file||editorBusy||!isAdmin)return;
  const session=auth.currentUser?.uid;
  $('mainPhotoFilename').textContent=file.name;
  $('uploadProgress').textContent='Uploading photo…';setEditorBusy(true);
  try{
    const url=await uploadProductImage(file,n=>$('uploadProgress').textContent='Uploading '+n+'%');
    if(!editor.open||auth.currentUser?.uid!==session)return;
    $('imageUrl').value=url;previewImage();$('uploadProgress').textContent='Photo uploaded successfully.';
  }catch(error){$('uploadProgress').textContent='Upload failed: '+error.message;}
  finally{setEditorBusy(false);e.target.value='';}
});
$('extraPhotoFiles').addEventListener('change',async e=>{
  const files=Array.from(e.target.files||[]),field=form.elements.images,status=$('extraPhotoProgress');
  if(!files.length||editorBusy||!isAdmin)return;
  const urls=extraUrls(),session=auth.currentUser?.uid;
  if(urls.length+files.length>9){status.textContent='Maximum 9 additional photos.';e.target.value='';return;}
  setEditorBusy(true);
  try{
    for(const [i,file] of files.entries()){
      const url=await uploadProductImage(file,n=>status.textContent='Photo '+(i+1)+' / '+files.length+' – '+n+'%');
      if(!editor.open||auth.currentUser?.uid!==session)return;
      urls.push(url);field.value=urls.join('\n');renderExtraPhotos();
    }
    status.textContent='Photos uploaded.';
  }catch(err){status.textContent='Upload failed: '+err.message;}
  finally{setEditorBusy(false);e.target.value='';}
});
form.addEventListener('submit',async e=>{
  e.preventDefault();if(!isAdmin||!auth.currentUser||editorBusy)return;
  $('formError').textContent='';
  const data=Object.fromEntries(new FormData(form).entries());
  setEditorBusy(true);
  try{
    data.published=form.elements.published.checked;data.bestseller=form.elements.bestseller.checked;
    data.images=String(data.images||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    if(data.images.length>9||data.images.some(x=>!/^https:\/\//i.test(x)||x.length>2000))throw new Error('Enter up to 9 valid HTTPS image URLs.');
    if(!/^https:\/\//i.test(data.image))throw new Error('Upload a photo or enter an HTTPS image URL.');
    if(!Number.isInteger(Number(data.stock))||Number(data.stock)<0)throw new Error('Stock must be a whole number of 0 or more.');
    if(Number(data.compareAt)<Number(data.price))throw new Error('MRP should be equal to or above selling price.');
    await saveProduct(data,$('editingId').value||undefined);
    editor.close();alertMessage('status','Product saved successfully. Published products appear in the storefront.');
  }catch(err){alertMessage('formError',err.message,true);$('formError').scrollIntoView({block:'nearest'});}
  finally{setEditorBusy(false);}
});

// Merchant settings must be explicitly confirmed and saved before the
// server-side checkout function permits even one real payment request.
async function loadCheckoutSettings(){
  try{
    const data=await getCheckoutSettings();
    $('shippingCharge').value=data?.shippingCharge??0;
    $('checkoutEnabled').checked=data?.enabled===true;
    // A fresh confirmation is required at each save, never pre-check it.
    $('taxConfirmed').checked=false;
    $('merchantConfirmed').checked=false;
    $('policyConfirmed').checked=false;
    alertMessage('checkoutSettingsStatus', data?.enabled?'Live UPI checkout enabled with merchant settings.':'Live checkout is disabled until merchant approval.');
  }catch(e){alertMessage('checkoutSettingsStatus','Settings unavailable: '+(e.code||e.message),true);}
}
$('checkoutSettingsForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!isAdmin||!auth.currentUser)return;
  const input=Number($('shippingCharge').value);
  if(!Number.isSafeInteger(input)||input<0||input>100000){
    alertMessage('checkoutSettingsStatus','Shipping charge must be a whole number between ₹0 and ₹100,000.',true);return;
  }
  const enabled=$('checkoutEnabled').checked;
  if(enabled&&(!($('merchantConfirmed').checked&&$('taxConfirmed').checked&&$('policyConfirmed').checked))){
    alertMessage('checkoutSettingsStatus','Confirm the business bank, tax, shipping and approved policies before enabling checkout.',true);return;
  }
  if(enabled&&!confirm('Enable payment QR for real customer orders? You must verify UPI receipts manually and honor the shown final total, tax and shipping charges.'))return;
  const btn=e.target.querySelector('button[type=submit]');btn.disabled=true;
  try{
    await updateCheckoutSettings({shippingCharge:input,enabled});
    alertMessage('checkoutSettingsStatus',enabled?'UPI checkout enabled. Verify every payment in the bank before approving.':'UPI checkout disabled.');
    $('taxConfirmed').checked=false;$('merchantConfirmed').checked=false;$('policyConfirmed').checked=false;
  }catch(err){alertMessage('checkoutSettingsStatus','Unable to save: '+(err.code||err.message),true);}
  finally{btn.disabled=false;}
});
function displayUpiOrders(orders){
  sellerOrders=orders;ordersLoaded=true;renderOrderSummary();
  const table=$('upiOrdersTable');
  if(!orders.length){table.innerHTML='<tr><td colspan="5">No real UPI orders yet.</td></tr>';return;}
  table.innerHTML=orders.map(o=>{
    const pending=o.status==='verification_pending';
    return '<tr><td><strong>'+esc(o.id)+'</strong><br/>'+esc(o.address?.name||'')+' · '+esc(o.customerPhone||'')+
      '<br/>PIN '+esc(o.address?.pin||'')+'</td><td>₹'+Number(o.total).toLocaleString('en-IN')+
      '</td><td>'+esc(o.utr||'Not submitted')+'</td><td>'+esc(o.status)+
      '</td><td>'+(pending?'<button data-review-id="'+esc(o.id)+'" data-review-status="paid">Mark PAID after bank check</button> '+
      '<button data-review-id="'+esc(o.id)+'" data-review-status="rejected">Reject</button>':'—')+'</td></tr>';
  }).join('');
}
$('upiOrdersTable').addEventListener('click',async e=>{
  const btn=e.target.closest('[data-review-id]');
  if(!btn||!isAdmin)return;
  const orderId=btn.dataset.reviewId,status=btn.dataset.reviewStatus;
  const prompt=status==='paid'?
    'Have you personally confirmed the exact order amount and UTR are credited in the WOODPECK INTERNATIONAL TMB bank account? Mark PAID only after bank verification.':
    'Reject this payment reference? You should contact the customer to reconcile the transaction.';
  if(!confirm(prompt))return;
  btn.disabled=true;
  try{
    await reviewUpiOrder({orderId,status});
    alertMessage('orderStatus','Order '+orderId+' updated to '+status+'.');
  }catch(err){alertMessage('orderStatus','Review failed: '+(err.code||err.message),true);}
  finally{if(btn.isConnected)btn.disabled=false;}
});
