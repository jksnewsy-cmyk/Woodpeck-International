# Woodpeck International - Single Seller Furniture Website

A responsive e-commerce **frontend demo** for Woodpeck International, running on Vite. The website includes the complete customer shopping journey through the Payment Method screen.

## Run locally (Mac / VS Code)

1. Open folder: ~/Desktop/Woodpeck-International
2. Run npm install (first setup only)
3. Run npm run dev
4. Visit http://127.0.0.1:5173/

The Vite server refreshes automatically on code changes. Press Ctrl+C in the terminal to stop it.

## Pages and navigation

- index.html - premium Home Page with furniture categories, featured pieces and brand story
- store.html#/shop - complete product listing with categories, sorting and search
- store.html#/product/sofa-01 - dedicated product detail, price, descriptions, Buy Now and Add to Cart
- store.html#/wishlist - saved products
- store.html#/cart - persistent shopping cart, increase/decrease quantities, remove product, price summary
- store.html#/address - delivery address form and multiple saved addresses
- store.html#/payment - UPI, Cards, Net Banking, COD selection and demo checkout summary
- store.html#/account - customer account section preview; real OTP login not yet connected
- store.html#/contact - contact and policy placeholders needing business verification

## Test the checkout flow

1. Visit the Home Page or Shop All.
2. Open a product and click Add to Cart.
3. Open Cart; adjust quantities and select Continue to Delivery.
4. Enter sample address details (not sensitive information), then Save & Continue.
5. Select payment method. Tick demo acknowledgement and click View Demo Checkout Summary.
6. No actual payment is taken. No real order is created or sent.

## Technical structure

- assets/css/styles.css - Home Page styles
- assets/css/store.css - Shopping and Checkout styles
- assets/js/products.js - Demo products and categories
- assets/js/app.js - Home Page interactions
- assets/js/home-bridge.js - Home Page to Shopping Pages navigation
- assets/js/store.js - Shop, Product, Wishlist, Cart, Address and Payment workflows
- assets/images - furniture images and approved Woodpeck logo
- vite.config.js - Vite multipage build (index.html and store.html)
- .backups - original code and smoke test screenshots

## Build

Run npm run build. Output is in dist/ and includes both index.html and store.html. The existing postbuild script copies local product images.

## Before launch - important

**This is a frontend demo, not a production commerce system.**

- Current product prices, product images, offers and descriptions are examples and require client approval.
- Payment options are visual only. Never collect actual card numbers, CVV, PIN or passwords in this demo.
- Cart, wishlist and delivery addresses are stored locally in this browser; the latter are not sent to a server.
- OTP login, real customer accounts, admin inventory, actual orders, shipping fees, GST calculation and stock verification need a backend.
- Razorpay/UPI/card payments require the client's payment merchant account, a secure server, server-side signature/webhook verification, and refund support.
- Official delivery areas, store address, contacts, terms, privacy policy, returns and refunds need approval.
- Do not put payment gateway secrets or credentials in browser-facing code.

Existing other projects were not changed.
## GitHub Pages demo

A public, static frontend preview is automatically built from `main` and published via GitHub Actions to:

https://jksnewsy-cmyk.github.io/Woodpeck-International/

The workflow sets `GITHUB_PAGES=true` during the Vite build to use the project base path. Real payments, orders and login are not enabled.


## Firebase phone OTP login (staged integration)

The account page includes a Firebase phone OTP login UI with the public Web SDK configuration from the Woodpeck International Firebase app. This is a feature branch: it is **not live** until reviewed and merged.

1. Create a **separate** Firebase project for Woodpeck International at https://console.firebase.google.com/ (do not reuse CricketStar/JKS Shoppe).
2. Web app **Woodpeck Website** is registered. Its public config is already included in `assets/js/firebase-auth.js`. Vercel environment variables (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`) remain optional overrides for staging. Never put service-account secrets or private keys in this frontend.
3. In Firebase Authentication -> Sign-in method, enable **Phone**.
4. In Authentication -> Settings -> Authorized domains, add `www.woodpeckinternational.com`,
   `woodpeckinternational.com`, and `woodpeck-international.vercel.app`.
5. Set an SMS region policy appropriate to where customers reside (e.g. India only); new projects may block all regions until configured.
6. **Real SMS phone verification is billed per SMS and requires Firebase Blaze / a linked Cloud Billing account.**
   Set billing budgets/alerts and use Firebase fictitious test numbers before enabling real SMS.
7. Test the OTP flow on a trusted preview domain; merge the approved feature branch into `main` to deploy through Vercel. Do not go live until phone provider, authorized domains and SMS budget are confirmed.

Phone login provides authentication only. It does not create a secure order database,
customer profile store, payment processing, or access-controlled address storage.
Do not take live payments with this demo; use Firestore security rules and a verified
server-side order/payment flow for real commerce. Existing cart/address data is browser-only.
