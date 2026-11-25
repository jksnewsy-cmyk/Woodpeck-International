import {getFunctions,httpsCallable} from 'firebase/functions';
import {getFirestore, doc, getDoc, collection, query, orderBy, limit, onSnapshot, setDoc, serverTimestamp} from 'firebase/firestore';
import {auth} from './firebase-catalog.js';

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
