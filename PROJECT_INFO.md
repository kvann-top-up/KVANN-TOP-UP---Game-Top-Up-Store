# KVANN TOP UP

This is a personal game top-up store starter project based on the requested KVANN TOP UP branding.

Included:
- Responsive 3-column mobile game grid
- Game details and packages
- Register/login with hashed passwords and HTTP-only cookie
- Orders and order tracking
- Dynamic KHQR generation hooks
- Bakong Open API verification hooks
- Admin dashboard, order status, games and packages
- SQLite database
- Game top-up provider adapter hook

Before production:
1. Set a strong JWT_SECRET and ADMIN_PASSWORD.
2. Configure your own Bakong merchant account and API token.
3. Use HTTPS and a public BASE_URL.
4. Connect an authorized game top-up provider for automatic fulfillment.
5. Back up or migrate the SQLite database for production scale.
