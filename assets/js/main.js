// Vite entry point. Load demo catalog before app behavior.
import './products.js';
import './app.js';
import './home-bridge.js';

import { watchPublishedProducts } from './firebase-catalog.js';
const demoProducts = window.WOODPECK_PRODUCTS.slice();
watchPublishedProducts(items => {
  const valid=items.filter(p=>p && typeof p.id==='string' && typeof p.name==='string' &&
    typeof p.image==='string' && p.image.startsWith('https://') && Number.isFinite(p.price));
  const ids=new Set(valid.map(p=>p.id));
  window.WOODPECK_PRODUCTS.splice(0,window.WOODPECK_PRODUCTS.length,...valid,...demoProducts.filter(p=>!ids.has(p.id)));
  window.dispatchEvent(new Event('woodpeck-catalog-updated'));
},error=>console.warn('Cloud products unavailable; showing demo products.',error.code || error.message));
