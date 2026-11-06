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
let products = [], unsubscribe = null, currentUser = null, isAdmin = false, checking = false;
const form = $('productForm');
const setView = name => {
  ['loading','authGate','restricted','dashboard'].forEach(id=>$(id).hidden=id!==name);
  $('signOut').hidden=name==='loading'||name==='authGate';
};
function alertMessage(id, text, bad=false) {
  const el=$(id);el.textContent=text;el.style.color=bad?'#af3022':'#32794b';
}
async function determineAccess(user) {
  if(checking) return;
  checking=true;
  if (unsubscribe){unsubscribe();unsubscribe=null;}
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
    else {setView('dashboard');unsubscribe=watchAllProducts(data=>{products=data;displayProducts();},e=>alertMessage('status',`Cannot access products: ${e.code||e.message}. Check Firestore Security Rules.`,true));}
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
  form.reset();$('editingId').value=id;$('imagePreview').hidden=true;$('uploadProgress').textContent='';$('formError').textContent='';
  $('dialogTitle').textContent=id?'Edit Product':'Add Product';
  const p=products.find(p=>p.id===id);
  if(p){for(const key of ['name','category','price','compareAt','stock','description','materials','tag','image'])form.elements[key].value=p[key]??'';
    form.elements.published.checked=!!p.published;form.elements.bestseller.checked=!!p.bestseller;previewImage();}
  $('productDialog').showModal();
}
function previewImage(){const url=form.elements.image.value.trim();const img=$('imagePreview');img.hidden=!/^https:\/\//i.test(url);if(!img.hidden)img.src=url;}
$('addProduct').addEventListener('click',()=>openForm());
$('imageUrl').addEventListener('input',previewImage);
function closeDialog(){$('productDialog').close();}
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
  const file=e.target.files?.[0];if(!file)return;
  $('uploadProgress').textContent='Uploading photo…';
  try{const url=await uploadProductImage(file,n=>$('uploadProgress').textContent=`Uploading ${n}%`);
    $('imageUrl').value=url;previewImage();$('uploadProgress').textContent='Photo uploaded successfully.';
  }catch(error){$('uploadProgress').textContent=`Upload failed: ${error.message}`;}
});
form.addEventListener('submit',async e=>{
  e.preventDefault();if(!isAdmin || !auth.currentUser)return;
  const btn=$('saveProduct');btn.disabled=true;$('formError').textContent='';
  try{
    const data=Object.fromEntries(new FormData(form).entries());
    data.published=form.elements.published.checked;data.bestseller=form.elements.bestseller.checked;
    if(!/^https:\/\//i.test(data.image)) throw new Error('Upload a photo or enter an HTTPS image URL.');
    if(!Number.isInteger(Number(data.stock))||Number(data.stock)<0)throw new Error('Stock must be a whole number of 0 or more.');
    if(Number(data.compareAt)<Number(data.price))throw new Error('MRP should be equal to or above selling price.');
    await saveProduct(data,$('editingId').value||undefined);
    closeDialog();alertMessage('status','Product saved successfully. Published products appear in the storefront.');
  }catch(err){alertMessage('formError',err.message,true)}finally{btn.disabled=false;}
});
