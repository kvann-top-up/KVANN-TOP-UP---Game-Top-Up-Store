# KVANN TOP UP v2

A production-oriented game top-up store for Cambodia: storefront, accounts, checkout, dynamic KHQR, Bakong transaction verification, order tracking, admin dashboard, and a pluggable game top-up provider.

## Important
This project can perform **real KHQR payment verification only after you configure your own Bakong merchant account and Bakong Open API bearer token**. The National Bank of Cambodia documentation describes the flow: generate a KHQR, show it, let the customer scan/pay, then the merchant server checks the transaction status. See the official docs in the project notes below.

Automatic game fulfillment is provider-specific. No generic API can safely top-up every game. The project therefore has a provider interface; use `manual` until you have an authorized API/provider account, then implement the provider adapter.

## Install

1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Put your real Bakong details in `.env`.
4. Run:

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Admin: `http://localhost:3000/admin.html`

## First admin login
The server creates the admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD` on first start. Change the example password before exposing the site to the internet.

## Real KHQR payment
Required:
- `BAKONG_ACCOUNT_ID`
- merchant details matching your KHQR account
- `BAKONG_TOKEN`
- a public HTTPS `BASE_URL` for production

The backend creates a dynamic KHQR containing the order bill number, stores its MD5, renders the QR as PNG data, and polls Bakong's `check_transaction_by_md5` endpoint. The order is marked PAID only when the transaction response matches the expected amount/currency and the MD5 belongs to that order.

## Game fulfillment
Set `TOPUP_PROVIDER=manual` for safe operation. After payment, an admin can fulfill the order and set the status. For automatic fulfillment, edit `services/topupProvider.js` and connect an authorized provider API. Never put provider secrets in frontend code.

## Production checklist
- Use HTTPS.
- Set a long random `JWT_SECRET`.
- Use a strong admin password.
- Put SQLite on persistent storage, or migrate to PostgreSQL/MySQL for scale.
- Configure backups.
- Add rate limiting/WAF/reverse proxy.
- Configure your domain and `BASE_URL`.
- Obtain and protect the Bakong token.
- Test KHR/USD handling with your actual merchant account.
- Add an authorized game top-up provider before enabling automatic fulfillment.
- Review KHQR branding/merchant requirements with your bank/NBC.

## Official references
- Bakong Open API: https://api-bakong.nbc.gov.kh/
- NBC KHQR integration documentation: https://bakong.nbc.gov.kh/download/KHQR/integration/QR%20Payment%20Integration.pdf
