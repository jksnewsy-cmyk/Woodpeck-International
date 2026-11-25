import {getFunctions,httpsCallable} from 'firebase/functions';
import {getFirestore, doc, getDoc, getDocsFromServer, getDocFromServer, collection, query, orderBy, limit, onSnapshot, setDoc, serverTimestamp} from 'firebase/firestore';
import {auth} from './firebase-catalog.js';
import {getStorage,ref,uploadBytes,getBlob} from 'firebase/storage';

const app=auth.app;
const db=getFirestore(app);
const functions=getFunctions(app,'asia-south1');
const call = name => httpsCallable(functions,name);
export const createUpiOrder = data => call('createUpiOrder')(data).then(r=>r.data);
export const submitUpiReference = data => call('submitUpiReference')(data).then(r=>r.data);
export const reviewUpiOrder = data => call('reviewUpiOrder')(data).then(r=>r.data);
export async function fetchUpiOrder(id){
  const result=await getDoc(doc(db,'orders',id));
  return result.exists()?{id:result.id,...result.data()}:null;
}
export function watchUpiOrders(onData,onError){
  return onSnapshot(query(collection(db,'orders'),orderBy('createdAt','desc')),
    snapshot=>onData(snapshot.docs.map(d=>({id:d.id,...d.data()}))),onError);
}
export async function getCheckoutSettings(){
  const result=await getDoc(doc(db,'settings/checkout'));
  return result.exists()?result.data():null;
}
export function updateCheckoutSettings({enabled,shippingCharge}){
  return setDoc(doc(db,'settings/checkout'),{
    enabled:Boolean(enabled),shippingCharge:Number(shippingCharge),taxIncluded:true,updatedAt:serverTimestamp()
  });
}

export async function readCustomerAddresses(uid){
  if(auth.currentUser?.uid!==uid)throw new Error('Sign in required.');
  const result=await getDocsFromServer(collection(db,'customers',uid,'addresses'));
  return result.docs.map(d=>({...d.data(),id:d.id}));
}
export async function writeCustomerAddress(uid,id,data){
  if(auth.currentUser?.uid!==uid)throw new Error('Sign in required.');
  await setDoc(doc(db,'customers',uid,'addresses',id),{...data,updatedAt:serverTimestamp()});
}
export async function readDeliveryQuote(){
  const result=await getDocFromServer(doc(db,'settings/checkout'));
  const data=result.data();
  return data?.enabled===true&&data.taxIncluded===true&&Number.isSafeInteger(data.shippingCharge)&&data.shippingCharge>=0&&data.shippingCharge<=100000?data.shippingCharge:null;
}

export async function getBankSettings(){
  const snap=await getDocFromServer(doc(db,'settings/bankTransfer'));
  return snap.exists()?snap.data():null;
}
export function saveBankSettings(data){
  return setDoc(doc(db,'settings/bankTransfer'),{...data,updatedAt:serverTimestamp()});
}

export async function uploadPaymentProof(order,file){
  if(auth.currentUser?.uid!==order.uid||order.status!=='payment_pending')throw new Error('Order not eligible for proof upload.');
  if(!['image/jpeg','image/png','application/pdf'].includes(file.type)||file.size>5*1024*1024)throw new Error('Choose JPG, PNG or PDF up to 5 MB.');
  await uploadBytes(ref(getStorage(app),'paymentEvidence/'+order.uid+'/'+order.id+'/proof'),file,{contentType:file.type,contentDisposition:'attachment'});
}
export async function downloadPaymentProof(uid,id){
  return getBlob(ref(getStorage(app),'paymentEvidence/'+uid+'/'+id+'/proof'),5*1024*1024);
}
