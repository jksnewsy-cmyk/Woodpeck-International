// Load only merchant-published products, never sample inventory.
import './products.js';
import './app.js';
import './home-bridge.js';
import { watchPublishedProducts } from './firebase-catalog.js';
watchPublishedProducts((items, fromCache) => {
  const valid=items.filter(p=>p && typeof p.id==='string' && typeof p.name==='string' &&
    typeof p.image==='string' && p.image.startsWith('https://') && Number.isFinite(p.price) && p.price>=0);
  window.WOODPECK_PRODUCTS.splice(0,window.WOODPECK_PRODUCTS.length,...valid);
  window.dispatchEvent(new CustomEvent('woodpeck-catalog-updated',{detail:{fromCache}}));
},error=>{
  console.warn('Cloud products unavailable.',error.code || error.message);
  window.dispatchEvent(new Event('woodpeck-catalog-error'));
});
