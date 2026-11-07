# BreakMoney implementation status

## Implemented baseline
- React, Vite and TypeScript web client with responsive dashboard.
- Firebase Authentication email/password registration, sign-in and password reset.
- Firestore group membership, expense activity and vault summary listeners.
- Callable Cloud Functions for group creation and equal-split expense recording.
- Server-side integer-paise validation and deterministic remainder allocation.
- Admin-only invite creation with a cryptographically random token; only its SHA-256 hash is stored.
- Invite redemption with expiry, use-count and group-size checks; group membership updates are transactional.
- Admin-only manual cash contribution ledger entry, explicitly marked `manual_unverified`.
- Deny-by-default Firestore rules and member-scoped receipt storage rules.
- Firebase Hosting SPA configuration.

## Remaining work
- Invite sharing/join screens and membership administration UI.
- Verified digital contributions, vault credit/debit operations and low-balance notifications.
- Settlement calculations and verified settlement records.
- Custom/percentage splits, expense editing and deletion policy.
- Numeric email OTP (requires a secure server-side OTP delivery provider; Firebase email verification is link-based).
- Razorpay order creation, signature verification and webhook idempotency.
- FCM notifications, analytics, platform administration and audit tooling.
- Automated tests, App Check, accessibility/performance review and deployment.
- Expo Android client (Phase 3).

## Safety boundaries
A Firestore vault balance is an application ledger, not custody of pooled funds. Manual contributions are explicitly unverified and must not be represented as verified payments. Do not show a digital payment as successful until verified server-side. Never commit local environment files, service-account keys, SMTP credentials or Razorpay secrets.

## Build verification
Dependency installation timed out in the current build environment, so a successful TypeScript/Vite build has not yet been confirmed. Run `npm install` then `npm run build`. Deploy Cloud Functions only after enabling the required Firebase billing plan and configuring secrets.
