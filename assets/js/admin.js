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
let products = [], unsubscribe = null, orderUnsubscribe = null, currentUser = null, isAdmin = false, checking = false;
const form = $('productForm');
let editorBusy=false;
const editor=$('productDialog');
const setView = name => {
  ['loading','authGate','restricted','dashboard'].forEach(id=>$(id).hidden=id!==name);
  $('signOut').hidden=name==='loading'||name==='authGate';
  if(name!=='dashboard'&&editor.open)editor.close();
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
      setView('dashboard');
      unsubscribe=watchAllProducts(data=>{products=data;displayProducts();},e=>alertMessage('status',`Cannot access products: ${e.code||e.message}. Check Firestore Security Rules.`,true));
      orderUnsubscribe=watchUpiOrders(displayUpiOrders,e=>alertMessage('orderStatus','Could not access orders: '+(e.code||e.message),true));
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
function displayProducts() {
  $('totalCount').textContent=products.length;
  $('liveCount').textContent=products.filter(p=>p.published).length;
  $('outCount').textContent=products.filter(p=>p.stock===0).length;
  const term=$('productSearch').value.toLowerCase(); const filter=$('productFilter').value;
  const visible=products.filter(p=>p.name.toLowerCase().includes(term)&&
     (filter==='all'||filter==='published'&&p.published||filter==='draft'&&!p.published||filter==='out'&&p.stock===0));
  $('productsTable').innerHTML=visible.length?visible.map(p=>`<tr><td><div class="item"><img alt="" src="${esc(p.image||'')}" loading="lazy"/><span>${esc(p.name)}</span></div></td><td>${esc(p.category)}</td><td>₹${Number(p.price).toLocaleString('en-IN')}</td><td>${Number(p.stock)}</td><td><span class="pill ${p.published?'live':''}">${p.published?'Published':'Draft'}</span></td><td><button data-edit="${esc(p.id)}">Edit</button><button data-delete="${esc(p.id)}">Delete</button></td></tr>`).join(''):'<tr><td colspan="6">No products yet. Click Add Product.</td></tr>';
}
$('productSearch').addEventListener('input',displayProducts);
$('productFilter').addEventListener('change',displayProducts);
function openForm(id=''){
  if(!isAdmin||editorBusy)return;
  form.reset();$('mainPhotoFilename').textContent='Upload product photo';$('extraPhotoProgress').textContent='';$('editingId').value=id;$('imagePreview').hidden=true;$('uploadProgress').textContent='';$('formError').textContent='';
  $('dialogTitle').textContent=id?'Edit Product':'Add Product';
  $('dialogSubtitle').textContent=id?'Update product details for your store':'Create a new product for your store';
  const p=products.find(p=>p.id===id);
  if(p){for(const key of ['name','category','price','compareAt','stock','description','materials','tag','image','variantGroup','finish','configuration'])form.elements[key].value=p[key]??'';
    form.elements.images.value=Array.isArray(p.images)?p.images.join('\n'):'';form.elements.published.checked=!!p.published;form.elements.bestseller.checked=!!p.bestseller;previewImage();}
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
  const edit=e.target.closest('[data-edit]'); const del=e.target.closest('[data-delete]');
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
