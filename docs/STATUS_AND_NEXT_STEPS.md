# BreakMoney implementation status

## Implemented in the web codebase

- React, Vite and TypeScript responsive web client.
- Firebase email/password registration, email verification, sign-in, logout and password reset.
- User profile documents and verified-email sign-in enforcement.
- Group creation, membership directory and realtime group/vault/expense listeners.
- Admin-only invitation creation with cryptographically random tokens; only SHA-256 token hashes are stored.
- Invite expiry, usage limits, redemption, revocation and admin invite history.
- Group member role changes, member removal, leave-group safeguards and creator/last-admin protections.
- Equal and custom per-member expense splits with server-side paise and total validation.
- Expense voiding with a required reason and append-only correction ledger entry; original expense records are retained.
- Group ledger history, admin-recorded manual cash entries marked unverified.
- Admin-only vault spending with balance checks and configurable low-balance threshold.
- FCM web device registration, foreground/background notifications and group activity alerts.
- Settlement suggestions based on recorded expense shares and mutually confirmed settlement offsets.
- Settlement reports can be acknowledged by the other participant; the status remains party-confirmed, not provider-verified.
- Participant settlement reports marked unverified; reports do not alter balances or claim payment completion.
- Razorpay order creation with server-side credentials, checkout signature validation, provider payment-status lookup and payment.captured webhook verification.
- Idempotent payment finalization: duplicate webhook/callable delivery for the same captured payment does not credit the vault twice.
- Dashboard Razorpay Checkout integration and visible error handling.
- Deny-by-default Firestore rules, constrained user profile writes and member-only receipt Storage rules.
- Firebase Hosting SPA configuration.
- GitHub Actions workflow for web build and Cloud Functions unit tests.
- Unit tests for equal/custom split validation and settlement calculations.

## Required owner setup before payments can be used

- Enable Firebase Blaze billing and configure a budget alert.
- Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET in Firebase Secret Manager.
- Add VITE_FIREBASE_VAPID_KEY from Firebase Console to the web build environment to enable web push.
- Enable automatic capture in the Razorpay merchant dashboard.
- Register the deployed razorpayWebhook endpoint for payment.captured.
- Run Razorpay test-mode success, failure, duplicate-webhook and amount-mismatch tests.
- Deploy Cloud Functions and Hosting only after reviewing the target Firebase project.

## Remaining production and product work

- Run and fix the GitHub Actions build; dependency installation and compilation have not been locally verified in this environment.
- Firebase Emulator Suite tests for auth, rules, group lifecycle, splits, payments and webhook idempotency.
- App Check and production abuse/rate-limit controls.
- Extend push notifications to invite lifecycle and additional account events.
- Full edit workflow; corrections currently use append-only voiding and a replacement expense.
- Settlement recipient confirmation is implemented as a two-party acknowledgement; provider verification remains separate.
- Admin analytics and platform-level administration.
- Accessibility, security, performance and responsive device QA.
- Provider/legal review for any pooled funds, custody, escrow, stored value, withdrawals or payout features.
- Expo Android application (Phase 3).

## Financial safety boundaries

- All monetary values use integer paise.
- A Firestore vault is an application accounting ledger, not custody of pooled customer funds.
- Only provider-captured Razorpay payments are marked as verified digital contributions.
- Manual cash entries and participant-reported settlements remain unverified.
- Settlement suggestions do not initiate payment.
- Never expose Razorpay secrets, service-account credentials or other private keys in client code or Git.

## Build/deployment status

Source and workflow files have been pushed to GitHub. A successful CI build and Firebase deployment have not yet been confirmed. Payment processing is not active until the owner completes the setup above.
