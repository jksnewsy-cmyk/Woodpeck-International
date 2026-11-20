"use strict";
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();
const REGION = "asia-south1";
const MERCHANT_UPI = "woodpeckinternational01@tmb";
const MERCHANT_NAME = "WOODPECK INTERNATIONAL";
const opts = {region:REGION, maxInstances:10, memory:"256MiB", enforceAppCheck:false};
const err = (code,msg) => { throw new HttpsError(code,msg); };
const validNum = (n,min,max) => Number.isSafeInteger(n)&&n>=min&&n<=max;
async function authorizedAdmin(request){
  if (!request.auth) err("unauthenticated","Admin login required.");
  const phone=request.auth.token.phone_number;
  if (!["+918754344229","+919659650202"].includes(phone)) err("permission-denied","Not an approved administrator.");
  const snap=await db.doc("admins/"+request.auth.uid).get();
  if (!snap.exists||snap.get("active")!==true) err("permission-denied","Administrator not activated.");
}
function validAddress(a){
  if(!a || typeof a!=="object" || Array.isArray(a)) err("invalid-argument","A delivery address is required.");
  const fields={name:80,phone:10,line1:150,line2:100,city:70,state:70,pin:6};
  const clean={};
  for (const [key,max] of Object.entries(fields)) {
    const val=String(a[key]??"").trim();
    if (val.length>max || (key!=="line2"&&val.length<2)) err("invalid-argument","Please verify the delivery address.");
    clean[key]=val;
  }
  if (!/^[6-9][0-9]{9}$/.test(clean.phone)||!/^[1-9][0-9]{5}$/.test(clean.pin)) err("invalid-argument","Invalid phone or PIN.");
  return clean;
}
exports.createUpiOrder=onCall(opts,async request=>{
  if (!request.auth || !request.auth.token.phone_number) err("unauthenticated","Sign in with mobile OTP before ordering.");
  const raw=request.data||{};
  const address=validAddress(raw.address);
  const cart=raw.items;
  if (!Array.isArray(cart)||cart.length<1||cart.length>15) err("invalid-argument","Cart must contain 1–15 products.");
  const checkout=await db.doc("settings/checkout").get();
  const settings=checkout.data()||{};
  if(settings.enabled!==true||settings.taxIncluded!==true||!validNum(settings.shippingCharge,0,100000)) {
    err("failed-precondition","Checkout not enabled by merchant. Shipping, tax and bank verification must be confirmed.");
  }
  let subtotal=0;const lines=[],used=new Set();
  for(const entry of cart) {
    const id=entry&&entry.id, qty=entry&&entry.qty;
    if(typeof id!=="string"||!/^[A-Za-z0-9_-]{1,100}$/.test(id)||!validNum(qty,1,20)||used.has(id))err("invalid-argument","Invalid cart item.");
    used.add(id);
    const snap=await db.doc("products/"+id).get();
    const p=snap.data();
    if(!p||p.published!==true||!validNum(p.price,1,10000000)||!validNum(p.stock,qty,100000)) err("failed-precondition","Product unavailable or out of stock; refresh your cart.");
    subtotal+=p.price*qty;
    lines.push({id,qty,name:String(p.name).slice(0,120),price:p.price});
  }
  const shipping=settings.shippingCharge;
  const total=subtotal+shipping;
  if(!validNum(total,1,100000))err("failed-precondition","This amount exceeds the single-transaction UPI checkout limit. Please contact the shop for a bank-transfer quote.");
  const ref=db.collection("orders").doc();
  const data={uid:request.auth.uid,customerPhone:request.auth.token.phone_number,
    customerName:String(request.auth.token.name||address.name).slice(0,80),
    address,items:lines,subtotal,shipping,total,
    taxIncluded:true,method:"upi",status:"payment_pending",
    merchantUpi:MERCHANT_UPI,merchantName:MERCHANT_NAME,utr:null,
    createdAt:admin.firestore.FieldValue.serverTimestamp(),updatedAt:admin.firestore.FieldValue.serverTimestamp()};
  await ref.create(data);
  const params=new URLSearchParams({pa:MERCHANT_UPI,pn:MERCHANT_NAME,am:total.toFixed(2),cu:"INR",tn:"Woodpeck order "+ref.id.slice(0,14)});
  return {orderId:ref.id,total,subtotal,shipping,upiId:MERCHANT_UPI,merchantName:MERCHANT_NAME,upiUri:"upi://pay?"+params.toString()};
});
exports.submitUpiReference=onCall(opts,async request=>{
  if(!request.auth)err("unauthenticated","Sign in required.");
  const orderId=request.data?.orderId,utr=String(request.data?.utr||"").trim();
  if(typeof orderId!=="string"||!/^[A-Za-z0-9]{15,40}$/.test(orderId)||!/^[0-9]{10,22}$/.test(utr))err("invalid-argument","Enter a valid numeric UPI transaction reference.");
  const ref=db.doc("orders/"+orderId);
  const unique=db.doc("paymentReferences/"+utr);
  await db.runTransaction(async t=>{
    const [snap,already]=await Promise.all([t.get(ref),t.get(unique)]);
    if (!snap.exists||snap.get("uid")!==request.auth.uid)err("permission-denied","Order not found.");
    if(snap.get("status")!=="payment_pending")err("failed-precondition","Reference has already been submitted.");
    if(already.exists)err("already-exists","This transaction reference has already been used.");
    t.create(unique,{orderId,createdAt:admin.firestore.FieldValue.serverTimestamp()});
    t.update(ref,{utr,status:"verification_pending",updatedAt:admin.firestore.FieldValue.serverTimestamp()});
  });
  return {status:"verification_pending"};
});
exports.reviewUpiOrder=onCall(opts,async request=>{
  await authorizedAdmin(request);
  const orderId=request.data?.orderId,status=request.data?.status;
  if(typeof orderId!=="string"||!/^[A-Za-z0-9]{15,40}$/.test(orderId)||!["paid","rejected"].includes(status))err("invalid-argument","Invalid order review request.");
  const orderRef=db.doc("orders/"+orderId);
  await db.runTransaction(async t=>{
    const snap=await t.get(orderRef);
    if(!snap.exists||snap.get("status")!=="verification_pending"||!snap.get("utr"))err("failed-precondition","Order not ready for verification.");
    const items=snap.get("items");
    const reads=status==="paid"?await Promise.all(items.map(p=>t.get(db.doc("products/"+p.id)))):[];
    if(status==="paid"){
      for(let i=0;i<items.length;i++){
        const p=reads[i].data();
        if(!p||!validNum(p.stock,items[i].qty,100000))err("failed-precondition","Stock insufficient: "+items[i].name);
      }
      items.forEach((line,i)=>t.update(reads[i].ref,{stock:reads[i].get("stock")-line.qty}));
    }
    t.update(orderRef,{status,reviewedBy:request.auth.uid,reviewedAt:admin.firestore.FieldValue.serverTimestamp(),updatedAt:admin.firestore.FieldValue.serverTimestamp()});
  });
  return {status};
});
