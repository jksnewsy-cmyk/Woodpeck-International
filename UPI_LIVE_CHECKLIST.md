# WOODPECK INTERNATIONAL — Direct UPI Checkout

Merchant UPI ID taken from the supplied TMB business QR image:
`woodpeckinternational01@tmb`
Merchant display name: `WOODPECK INTERNATIONAL`

## How the new checkout works

1. Customer selects products and a delivery address and signs in with verified
   Firebase mobile OTP.
2. `createUpiOrder` verifies each product in **published Firestore inventory**,
   stock, server-side selling price, and configured flat shipping fee. It refuses
   demo-only items and orders over ₹100,000. Client prices are never trusted.
3. Server creates `orders/{orderId}` with `status=payment_pending`, then
   returns the exact amount and UPI payment URI for dynamic QR and UPI app link.
4. Customer pays **in an external bank / UPI app** and submits a numeric UTR.
   `submitUpiReference` validates ownership and prevents UTR reuse. Order is
   `verification_pending`, NOT paid.
5. A verified, approved administrator checks the actual TMB business bank
   statement for the exact amount and UTR, then uses Admin → UPI Orders to
   mark the order paid or reject the reference. Marking paid decrements stock.
6. No API or browser field auto-confirms that the bank received money.

## CRITICAL — Do not enable merchant checkout until all checks are complete

- Owner makes a low-value real UPI test and independently verifies that the
  money reached **the intended WOODPECK INTERNATIONAL TMB bank account**.
  The photograph alone cannot verify UPI account ownership or routing.
- Approve accurate product prices, taxes / GST included, photographs, actual
  inventory, permitted delivery regions, any installation charges and a flat
  shipping fee that applies to **all** accepted PIN codes.
- Publish client-approved shipping, privacy, cancellation, refund and return
  policies with support phone/email. The contact page still contains
  placeholders that must be replaced before taking payments.
- Confirm the store uses customer mobile OTP for checkout; verify Firebase
  phone Auth, authorized domains, and any SMS/billing prerequisites.
- Confirm authorized admin user exists under `admins/{uid}` with `active:true`,
  and sign in as an approved Woodpeck admin.
- Confirm that Cloud Functions, Firestore security rules, website deployment
  and actual bank test all work before enabling payment.
- In `admin.html`, enter a merchant-approved flat shipping charge, tick all
  merchant confirmations and then tick **Allow real UPI payments** → Save.
  The backend **fails closed** when `settings/checkout.enabled` is not true.
- Large furniture orders exceeding ₹100,000 must use a separately arranged
  bank transfer / merchant-approved method. Do not split automatically.
- UPI Intent/QR does **not** send authoritative payment status to this site.
  Administrators MUST verify the bank, not screenshots/UTR alone.
- Firebase Functions and phone OTP can incur cloud/SMS charges.

## Architecture

- Frontend: Vite, `assets/js/store.js`, `assets/js/checkout-api.js`,
  `assets/js/admin.js`, QR generated locally with the `qrcode` package.
- Server: Firebase callable Cloud Functions in `functions/index.js` in
  `asia-south1`; Node.js 22 runtime.
- Security: `firestore.rules` denies direct order writes and limits reads to
  the order owner or approved admin. Settings are admin-write only.
- Website: Vercel; Firebase deploy handles only functions and rules, not HTML.
- Order fields: customer contact, delivery address, product snapshot,
  verified total, merchant account, UTR, verification status, reviewer, audit times.

## Deployment

```bash
npm ci
npm run build
npm --prefix functions ci
firebase deploy --only firestore:rules,functions --project woodpeck-international
```

Deploy the Vite frontend separately through its existing Vercel/Git workflow.
Never add backend secrets to Vite public environment variables. Do not release
the UPI checkout solely because its visual QR appears; verify bank routing,
business policy, inventory, Firebase authentication, and manual admin review.
