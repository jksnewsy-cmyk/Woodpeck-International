import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, onSnapshot, query, where, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyArHb47cGLDcWqfg2snf0EvunGJPXcYI1U',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'woodpeck-international.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'woodpeck-international',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:1050322816369:web:9aa54d1741fb750af63ad0',
  storageBucket: 'woodpeck-international.firebasestorage.app',
};
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const productCol = collection(db, 'products');
export const CATEGORIES = [
  {id:'sofas',name:'Sofas'}, {id:'chairs',name:'Chairs'}, {id:'tables',name:'Tables'},
  {id:'beds',name:'Beds'}, {id:'wardrobes',name:'Wardrobes'}, {id:'decor',name:'Home Decor'},
];

const ADMIN_PHONES = new Set(['+918754344229', '+919659650202']);
export async function checkAdmin(user) {
  if (!user || !ADMIN_PHONES.has(user.phoneNumber)) return false;
  const snapshot = await getDoc(doc(db,'admins', user.uid));
  return snapshot.exists() && snapshot.data().active === true;
}
export function watchPublishedProducts(onProducts, onError) {
  // Firestore rules permit listing only published products, never unpublished ones.
  return onSnapshot(query(productCol,where('published','==',true)), snapshot => {
    onProducts(snapshot.docs.map(d => ({...d.data(),id:d.id})))
  }, onError);
}
export function watchAllProducts(onProducts,onError) {
  return onSnapshot(productCol, snapshot => {
    onProducts(snapshot.docs.map(d=>({...d.data(),id:d.id})))
  },onError);
}
export async function saveProduct(data, id) {
  const target = id ? doc(productCol,id) : doc(productCol);
  const payload = {
    name:data.name.trim(), category:data.category, description:data.description.trim(),
    materials:data.materials.trim(), tag:data.tag.trim(),
    price:Number(data.price),compareAt:Number(data.compareAt),stock:Number(data.stock),
    image:data.image.trim(),published:data.published===true,bestseller:data.bestseller===true,
    updatedAt:serverTimestamp(),
  };
  if (!id) payload.createdAt = serverTimestamp();
  await setDoc(target,payload,{merge:!!id});
  return target.id;
}
export async function removeProduct(id) {
  await deleteDoc(doc(productCol,id));
}
export function uploadProductImage(file,onProgress=()=>{}) {
  if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Upload JPG, PNG or WebP only.');
  if (file.size > 5*1024*1024) throw new Error('Image must be smaller than 5 MB.');
  if (!auth.currentUser) throw new Error('Sign in as administrator first.');
  const extension = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[file.type];
  const location = ref(storage,`products/${crypto.randomUUID()}.${extension}`);
  const task = uploadBytesResumable(location,file,{contentType:file.type});
  return new Promise((resolve,reject)=>{
    task.on('state_changed',s=>onProgress(Math.round(s.bytesTransferred*100/s.totalBytes)), reject, async ()=>{
      try{resolve(await getDownloadURL(task.snapshot.ref));}catch(error){reject(error)}
    });
  });
}
