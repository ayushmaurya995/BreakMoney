# BreakMoney

**Split bills. Create group vaults. Settle up.**

BreakMoney is a shared-expense management application for friends, roommates, families, trips, and teams.

## Current implementation

This repository is being developed in three phases:

1. **Phase 1 — Complete web application:** authentication, groups, invitations, vault ledger, contributions, expenses, splitting, balances, settlements, notifications, analytics, and payment integration.
2. **Phase 2 — Production hardening:** security review, Firebase rules, App Check, financial-integrity checks, automated tests, payment/webhook verification, accessibility, performance, and deployment.
3. **Phase 3 — Android application:** Expo + React Native + TypeScript, integrated with the same Firebase backend.

## Current technology direction

- React + Vite + TypeScript
- Firebase Authentication
- Cloud Firestore
- Firebase Cloud Functions
- Firebase Storage
- Firebase Cloud Messaging
- Firebase Hosting
- Razorpay for payment flows (server-side verification required)
- Expo + React Native for the planned Android phase

> Firebase is the selected backend. Supabase and Capacitor are not part of the current architecture.

## Financial safety

- Monetary values are represented in integer paise.
- Financial writes must be performed by trusted server-side functions.
- A vault ledger is an accounting record; it does not itself hold pooled customer funds.
- Razorpay secrets must never be placed in client code. Payment success must be verified server-side, including webhook/signature validation.
- Manual cash entries must remain clearly distinguishable from verified digital payments.
- Never use demo balances or fabricate successful transactions.

## Local development

1. Install Node.js (LTS).
2. Install dependencies with npm install.
3. Copy .env.example to .env.local and add your Firebase web app configuration.
4. Start the web app with npm run dev.

Cloud Functions require Firebase project configuration and appropriate billing/plan eligibility before deployment. Payment features also require server-side provider configuration.

## Security notes

Do not commit .env.local, service-account JSON files, private keys, SMTP credentials, or Razorpay secrets. Only public Firebase web-app configuration belongs in the browser environment.

## Project status

The implementation is in progress. Features are not considered production-ready until their tests, security rules, and deployment checks pass.
