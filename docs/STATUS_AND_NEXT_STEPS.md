# BreakMoney implementation status

## Current baseline
- React, Vite and TypeScript web client.
- Firebase Authentication email/password registration, sign-in and password reset.
- Firestore group membership, expense activity and vault summary listeners.
- Callable Cloud Functions for group creation and equal-split expense recording.
- Server-side integer-paise validation and deterministic remainder allocation.
- Deny-by-default Firestore rules and member-scoped receipt storage rules.
- Firebase Hosting SPA configuration.

## Remaining work
- Invite links, join flow, membership administration and leave/remove member workflows.
- Contributions, vault credit/debit operations and low-balance notifications.
- Settlement calculations and verified settlement records.
- Custom/percentage splits, expense editing and deletion policy.
- Numeric email OTP (requires a secure server-side OTP delivery provider; Firebase email verification is link-based).
- Razorpay order creation, signature verification and webhook idempotency.
- FCM notifications, analytics, platform administration and audit tooling.
- Automated tests, App Check, accessibility/performance review and deployment.
- Expo Android client (Phase 3).

## Safety boundaries
A Firestore vault balance is an application ledger, not custody of pooled funds. Do not show a payment as successful until verified server-side. Never commit local environment files, service-account keys, SMTP credentials or Razorpay secrets.

## Build verification
Run `npm install` then `npm run build`. Deploy Cloud Functions only after enabling the required Firebase billing plan and configuring secrets.
