import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, RecaptchaVerifier,
  signInWithPhoneNumber, signOut
} from 'firebase/auth';

// Public Firebase web app settings (not service account keys). Never put admin credentials here.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
export const firebaseReady = Object.values(config).every(Boolean);
const auth = firebaseReady ? getAuth(initializeApp(config)) : null;
if (auth) auth.languageCode = 'en';

export let signedInUser = null;
const listeners = new Set();
let confirmation = null;
let verifier = null;

if (auth) onAuthStateChanged(auth, user => {
  signedInUser = user;
  listeners.forEach(listener => listener(user));
});

export function onLoginChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearRecaptcha() {
  if (verifier) {
    try { verifier.clear(); } catch (error) { console.warn('reCAPTCHA cleanup:', error); }
    verifier = null;
  }
  const container = document.getElementById('firebase-recaptcha');
  if (container) container.replaceChildren();
}

export function resetPhoneSignIn() {
  confirmation = null;
  clearRecaptcha();
}

export async function sendPhoneCode(phone) {
  if (!auth) throw new Error('Firebase has not been connected yet.');
  if (!/^[6-9][0-9]{9}$/.test(phone)) throw new Error('Enter a valid 10-digit Indian mobile number.');
  clearRecaptcha();
  verifier = new RecaptchaVerifier(auth, 'firebase-recaptcha', { size: 'normal' });
  await verifier.render();
  try {
    confirmation = await signInWithPhoneNumber(auth, '+91' + phone, verifier);
  } catch (error) {
    clearRecaptcha();
    throw error;
  }
}

export async function confirmPhoneCode(code) {
  if (!confirmation) throw new Error('Please request a new verification code.');
  if (!/^[0-9]{6}$/.test(code)) throw new Error('Enter the 6-digit SMS code.');
  const result = await confirmation.confirm(code);
  resetPhoneSignIn();
  return result.user;
}

export async function logoutPhoneUser() {
  if (auth) await signOut(auth);
  resetPhoneSignIn();
}
