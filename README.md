# BreakMoney

**Split bills. Create group vaults. Settle up.**

BreakMoney is a shared-expense management web application for friends, roommates, families, trips and teams.

## Architecture

- **Web:** React + Vite + TypeScript, deployed on Vercel.
- **Identity and database:** Firebase Authentication + Cloud Firestore (Spark plan).
- **Backend:** Vercel Node.js Functions using Firebase Admin SDK. All privileged Firestore writes and payment verification run server-side.
- **Payments:** Razorpay Checkout with server-side order creation, signature verification and webhook processing.
- **Receipt storage:** Cloudinary signed uploads (backend signing endpoint is in place; receipt attachment UI is still to be built).
- **Push notifications:** Firebase Cloud Messaging; server delivery uses Firebase Admin.

Firebase Cloud Functions and Firebase Storage are not used by the Vercel architecture. Supabase and Capacitor are not part of the current stack.

## Implemented workflows

- Email/password authentication, email verification and password reset.
- User profiles and group membership directory.
- Group creation, hashed invite tokens, expiration and usage limits.
- Admin role changes, member removal, leave-group safeguards and invite revocation.
- Equal and custom expense splits with integer-paise validation.
- Live Firestore expense activity and vault summary.
- Append-only ledger entries, manual cash contributions and spends marked unverified.
- Settlement suggestions, participant-reported settlements and second-party confirmation.
- Razorpay order creation, server-side signature validation, provider capture check and idempotent `payment.captured` webhook.
- FCM device registration and group notifications.
- Deny-by-default Firestore rules.

## Local setup

1. Install Node.js 20 or later.
2. Clone the repository and run `npm install`.
3. Copy `.env.example` to `.env.local` and add the Firebase web app values (`VITE_FIREBASE_*`).
4. Run `npm run dev` for the frontend.
5. Configure a Firebase service account and the server-only environment variables listed below to run API routes locally with Vercel CLI.
6. Build the frontend with `npm run build`.

## Vercel environment variables

Set these in Vercel Project → Settings → Environment Variables.

**Client-visible Firebase configuration (VITE_ values):**
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_VAPID_KEY` (optional; for web push)

**Server-only secrets (never prefix these with VITE_):**
- `FIREBASE_SERVICE_ACCOUNT`: the complete Firebase service-account JSON, stored as a secret.
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Never commit service-account JSON, Razorpay secrets or Cloudinary API secrets to GitHub. Rotate any credential that has been exposed.

## Razorpay setup

1. Start with Razorpay test-mode keys.
2. Set the three Razorpay environment variables in Vercel.
3. Enable automatic capture in the Razorpay dashboard.
4. Register a webhook for `payment.captured` at `https://YOUR-VERCEL-DOMAIN/api/razorpay-webhook`.
5. Use test mode to verify success, failure, duplicate webhook delivery, mismatched amount and delayed capture before considering live mode.

The browser receives only the Razorpay key ID. The key secret and webhook secret remain server-side. A payment is credited only after server-side verification and provider capture confirmation.

## Receipt storage

Cloudinary is the planned external object store. The authenticated endpoint `POST /api/receipt-upload-signature` checks group membership and returns a short-lived upload signature. The client-side receipt upload and display experience remains to be implemented.

## Deployment

Connect `ayushmaurya995/BreakMoney` to Vercel with the repository root as the project root. Vercel should use `npm run build` and `dist` as the output directory. The included `vercel.json` routes API requests to serverless functions and sends non-API routes to the SPA.

Firebase Spark can continue to host Authentication and Firestore within their quotas. No Firebase Blaze billing account is needed for this architecture. Firebase Cloud Storage and Cloud Functions are intentionally not used.

## Financial and legal boundaries

- Monetary values are stored as integer paise.
- Privileged financial writes are performed by trusted Vercel Functions.
- A Firestore vault is an application accounting ledger; it is not custody of pooled customer funds.
- A captured Razorpay payment is provider-confirmed payment capture; it does not mean BreakMoney holds a regulated wallet balance or offers withdrawals.
- Manual cash entries and participant-reported settlements remain explicitly unverified.
- Settlement suggestions do not send money.
- UPI collection, escrow, stored value, pooled funds, payouts and other money movement can require provider approval and legal/compliance review. Do not describe the app as a wallet holding customer funds without that approval.

## Remaining work

- Configure Vercel project and environment variables, then verify a real deployment.
- Run CI/build and test API routes against Firebase.
- Complete receipt upload UI and receipt viewing.
- Complete security review, Firebase App Check strategy, emulator/integration tests and Razorpay test-mode verification.
- Build the planned Expo Android client after the web release is stable.

## Current limitations

- Numeric email OTP is not implemented; Firebase email verification uses a link.
- Receipt upload signing exists, but attachment UI is not yet connected.
- Razorpay cannot process a real payment until credentials, capture settings, webhook and provider test-mode checks are completed.
- A settlement report is a participant statement, not proof of transfer.
- Analytics, App Check hardening, full test coverage and the Expo Android client remain outstanding.
