# BreakMoney

**Split bills. Create group vaults. Settle up.**

BreakMoney is a shared-expense management web application for friends, roommates, families, trips and teams.

## What is implemented

- Firebase email/password authentication with email verification and password reset.
- User profile documents and group membership directory.
- Create groups, invite links with hashed tokens, expiry and usage limits.
- Admin role changes, member removal, leave-group safeguards and invite revocation.
- Record expenses with equal or custom per-member splits (integer paise validation).
- Live vault summary and expense activity.
- Group ledger history, manual cash entries clearly marked unverified.
- Settlement suggestions and unverified settlement reports.
- Razorpay order creation, server-side signature verification, payment status confirmation and idempotent payment.captured webhook processing.
- Firestore and Storage security rules.
- GitHub Actions build/type-check workflow for web and Cloud Functions.

## Technology

- React + Vite + TypeScript
- Firebase Authentication, Cloud Firestore, Cloud Functions, Storage and Hosting
- Razorpay Checkout (UPI/payment methods supported by the merchant account)
- Planned Phase 3: Expo + React Native + TypeScript

Firebase is the selected backend. Supabase and Capacitor are not part of the current architecture.

## Local setup

1. Install Node.js 20 or later.
2. Clone the repository and run npm install.
3. Copy .env.example to .env.local and add the Firebase web app configuration values.
4. Run npm run dev.
5. Build the web client with npm run build.
6. Build Cloud Functions with cd functions && npm install && npm run build.

## Razorpay setup (server-side secrets only)

The web app does not contain a Razorpay secret. Before enabling payments:

1. Enable the Firebase Blaze plan and configure a budget alert.
2. Create/activate a Razorpay account and obtain test keys first.
3. Configure these Firebase Functions secrets using the Firebase CLI:

```bash
firebase functions:secrets:set RAZORPAY_KEY_ID
firebase functions:secrets:set RAZORPAY_KEY_SECRET
firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
```

4. Enable automatic payment capture in the Razorpay dashboard. BreakMoney credits the group ledger only after Razorpay reports a captured payment.
5. Deploy Cloud Functions. Configure a Razorpay webhook for the payment.captured event at:

https://asia-south1-break-a01f4.cloudfunctions.net/razorpayWebhook

6. Use Razorpay test mode and verify success, failure, duplicate webhook delivery and mismatched amount scenarios before live mode.

Never place payment secrets in .env.local, browser code, GitHub or a public repository. The Razorpay key ID is returned to the checkout client; the key secret and webhook secret remain in Firebase Secret Manager.

## Firebase deployment

```bash
firebase use break-a01f4
firebase deploy --only firestore:rules,storage
firebase deploy --only functions
npm run build
firebase deploy --only hosting
```

Cloud Functions deployment requires an eligible billing plan. Hosting and rules should only be deployed after reviewing the Firebase project and rules in the target environment.

## Financial and legal boundaries

- Monetary values are stored as integer paise.
- All financial writes are performed by trusted Cloud Functions.
- A Firestore vault is an application accounting ledger; it is not custody of pooled customer funds.
- A verified Razorpay contribution means the provider confirmed capture; it does not mean BreakMoney holds a regulated wallet balance or offers withdrawals.
- Manual cash entries and participant-reported settlements remain explicitly unverified.
- Settlement suggestions do not send money.
- UPI collection, escrow, stored value, pooled funds, payouts and other money movement can require provider approval and legal/compliance review. Do not describe the app as a wallet holding customer funds without that approval.

## Project phases

1. Phase 1 — Web application: web workflows and payment integration code; configure secrets and verify with Razorpay test mode.
2. Phase 2 — Production hardening: run CI, Firebase Emulator tests, security review, App Check, accessibility/performance review, payment webhook tests and deploy.
3. Phase 3 — Android: Expo + React Native + TypeScript client using the same Firebase backend.

## Current limitations

- Razorpay cannot process a real payment until the owner configures Firebase secrets, enables capture, registers the webhook and completes provider test-mode checks.
- A settlement report is a participant statement, not proof of transfer and does not change calculated balances.
- Numeric email OTP is not implemented; Firebase email verification uses a link. Phone OTP is a separate Firebase Auth flow.
- FCM push notifications, analytics, full expense edit/delete policy, Firebase App Check, emulator/security tests and the Expo Android client remain outstanding.
- Build status must be confirmed by the GitHub Actions workflow before release.
