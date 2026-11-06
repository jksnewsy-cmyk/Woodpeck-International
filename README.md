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


## New Registration (Firebase Authentication)

The **My Account** page has Customer Login and New Registration tabs. New Registration
collects full name and mobile number, sends the existing Firebase phone OTP, then uses
Firebase Auth's `updateProfile` to store the verified customer's display name.
Sign-in and registration share Firebase phone authentication (no password); Firebase
may create an account when a number first signs in. No phone-number directory or
server-side restriction on existing/new phone numbers is enforced. Real SMS may cost money.
A separate Firestore customer profile, admin approval workflow and order history are
not yet included.

## Product Admin Control Panel — secure setup required

**Admin page:** `https://www.woodpeckinternational.com/admin.html`

The Vite project has a separate Firebase-connected admin dashboard to add, edit and delete products, manage category, selling price, MRP, stock, description, listing visibility and photos. It signs in via Firebase Phone OTP, then authorizes only explicitly approved administrators by looking up `admins/{uid}`. Client code **cannot grant admin permissions**. Public catalog listings filter for `published == true`; drafts require administrator access.

### Firebase setup checklist (do in this order)

1. In Firebase Console, select **Woodpeck International** (`woodpeck-international`) -> **Firestore Database** -> **Create database**. Choose **Standard edition**, location appropriate for production, and **Production mode** (deny by default). Do not use test mode. Firestore has a billing impact on Blaze. Once created, open **Rules**, replace existing rules with the complete content of `firestore.rules`, click **Publish**. Alternatively deploy the same rules with `firebase deploy --only firestore:rules` after authenticating the Firebase CLI.
2. In Firebase Console -> **Storage** -> **Get started**, choose an appropriate bucket location. Open **Rules**, replace with the complete content of `storage.rules`, click **Publish**. Alternatively `firebase deploy --only storage`. Uploading an image before this step will fail by design.
3. Open `admin.html` and sign in with the intended administrator's *own* phone number and OTP. The unapproved account page displays its Firebase Auth **UID**. Copy it.
4. In **Firestore Database -> Data**, manually create a collection named `admins`; create a document whose **document ID is that exact UID**. Add field `active` of **Boolean** type with value **true**. Only a trusted Firebase project owner should perform this privileged setup in Console. The rules explicitly prohibit clients from granting or editing admin permissions.
5. Click **Check Access Again** on the unapproved account screen. The admin dashboard will then show, and products can be created. Never grant access to arbitrary customer UIDs or set `allow read, write: if true`.
6. When adding a product, upload JPG, PNG or WebP photo (max 5 MB), fill name/category/MRP/price/stock/description, and select **Publish this product on website**. Draft items remain private to admins. Check `store.html#/shop` and the home page for the new product. The original six demo products stay visible until explicitly replaced.

### Architecture / security

- Firestore collection `products/{autoId}` stores product inventory; Storage `products/{uuid}.{jpg|png|webp}` stores photos. Admin permissions are tested in Firestore Rules **and** Storage Rules, not only hidden in UI.
- Storefront reads **published** documents only and updates when Firestore snapshots change. Product photos use the Firebase Storage download URL. Both home page and Store listing display new published inventory alongside six clearly-labeled sample items.
- Authenticated non-admin users cannot write products. Firestore document `admins/{uid}` cannot be modified by client code.
- **No real orders, payment processing, server-validated stock decrements or customer profile database** are included. Those require a separate backend implementation.
- For a production release, set Firebase App Check, quota monitoring, storage cleanup for deleted records, duplicate SKU validation, and audit logging. ₹500 billing budget is an *alert*, not a hard cap.
