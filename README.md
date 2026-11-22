# CaseArena

Full-stack starter for a CS-style case-opening platform. Includes Express, SQLite, session authentication, server-side item/balance operations, case opening, demo battles, upgrades, contracts, leaderboard and OWNER control panel.

## Run locally
1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Set `SESSION_SECRET` to a long random value.
4. Set `OWNER_USERNAME` and `OWNER_PASSWORD` before the first launch. The owner account is created automatically. Use a unique password of at least 10 characters.
5. For Google sign-in, create an OAuth 2.0 Web application credential in Google Cloud Console. Add the authorized redirect URI `http://localhost:3000/auth/google/callback` (and your production callback URL after deployment), then fill `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL` in `.env`. Google sign-in is hidden behind a configuration check and will return a setup message until credentials are provided.
6. Run:
   ```bash
   npm install
   npm start
   ```
7. Open http://localhost:3000

If the owner already exists, startup ensures the configured username has the `owner` role. The OWNER role is stored in SQLite and checked on the server for every owner endpoint. Do not share the owner password.

## Important before public launch
- This is a functional starter, not a production-audited gambling/commerce service.
- The battle endpoint is currently a demo entry/fee flow, not a real-time multiplayer battle engine.
- No deposits, withdrawals, payment processing, or real-money wagering are implemented.
- Upgrade and contract mechanics are demo virtual-item mechanics. Review local laws and platform rules before adding anything of monetary value.
- Use HTTPS, a strong SESSION_SECRET, secure backups, database migration/monitoring, CSRF protection, stricter rate limits, email verification, password reset, audit logging, and a production session store before public deployment.
- Add a trusted payment provider only after legal/compliance review. Never store card data yourself.
- The app uses a simplified visual inspired by case-opening sites; it does not copy CaseBattle branding or assets.

## Google sign-in flow
- Existing Google-linked accounts sign in directly.
- First-time Google users are asked to choose a unique public nickname (3–20 lowercase Latin letters, digits or underscore).
- The Google subject identifier is stored server-side; the app does not use the Google email as the public nickname.
- A Google account is not silently linked to an existing password account by matching email.
