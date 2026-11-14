# NXTPLAY — PRD

## Original problem statement
NXTPLAY — complete multi-venue sports booking marketplace (launch city Navsari, Gujarat). Roles: Customer, Venue Owner (admin-created), Super Admin (env bootstrap). Venue discovery, courts with 30/60-min dynamic slots, multi-slot consecutive booking, Razorpay payments with server verification + webhook + refunds, booking QR (opaque token, single check-in), owner dashboard (overview, bookings, walk-in cash/online, price approvals, QR scanner), admin dashboard (venue wizard 12 steps, owners, cities/sports, courts, bookings/payments/refunds, price proposals, coupons, finance + settlement ledger, commission settings). 24h cancellation cutoff, coupons, Asia/Kolkata timezone.
Update (2): rebrand to official logo colors — bg #080808, lime #C8FF00, purple #B000FF, text #FFFFFF / #A1A1AA, surface #151515; premium Gen-Z landing at "/" with NO booking UI ("THE GAME STARTS HERE."); booking discovery moved to "/book"; all Book buttons → /book.

## Architecture
- Backend FastAPI: core.py (db, auth, slots, holds, Razorpay helpers), auth_routes, public_routes, booking_routes, owner_routes, admin_routes, server.py (indexes + seeding)
- Mongo collections: users, cities, sports, venues, courts (prices[] history), price_requests, bookings, booking_slots (unique court/date/start → DB-level double-booking prevention), payments, refunds, coupons, coupon_redemptions, checkins, settlements, settings, images, webhook_events
- Frontend React + Tailwind + shadcn; JWT bearer auth; qrcode.react; html5-qrcode

## Implemented
- 2026-11-11: Full MVP (all customer/owner/admin pages & APIs), demo venue labelled DEMO, admin bootstrap from env
- 2026-11-11: Rebrand to lime/purple/black tokens across all pages; new Landing page (/), booking hub moved to /book
- 2026-11-11: Walk-in bookings (cash & online) show booking code + QR to owner after booking and in booking details; Download QR + WhatsApp share (WalkinTicket component)
- 2026-11-11: Removed all demo/test data (demo venue + owner, TEST_ venues/users/coupons/city/sport/price requests); SEED_DEMO_DATA=false
- 2026-11-14: Baseline synced from GitHub main (incl. PR #4; PR #3 left unmerged). Owner subscriptions completed: Starter ₹399/5 courts, Growth ₹699/10 courts; admin create-owner + plan + dates + one-time temp password + emailed setup link (Emergent managed Resend); forced password change; Razorpay Subscriptions authorize/verify/webhook (signed, event-id idempotent, out-of-order safe, encrypted provider refs); payment history; 7-day grace; daily cron endpoint for reminders/expiry; access gating (legacy owners keep working until a plan is assigned, new owners require a plan); owner self-service settings (profile, venue config, operating days, courts/pricing, holidays); court limits on owner+admin paths; 3-step customer email OTP signup; 0% booking commission; audit logs. Tests: backend/tests/test_subscriptions.py (19 pass, isolated DB, mocked Razorpay/email).
- Pending dependencies: Razorpay live keys + Subscriptions feature enabled on merchant account + plan IDs (RAZORPAY_PLAN_399/699) + webhook to /api/subscriptions/webhook; daily cron on Render; EMERGENT_EMAIL_KEY/APP_PUBLIC_URL/DATA_ENCRYPTION_KEY/CRON_SECRET on Render.

## Status / limitations
- Razorpay keys NOT set → online checkout disabled (cash walk-ins work). User has live keys only.
- Password-reset email not sent (no email provider) — admin can reset owner passwords.
- End-to-end testing agent run not yet performed.

## Backlog
- P0: Add Razorpay live keys + webhook secret; run full E2E test pass
- P1: Email provider for password reset & booking confirmations
- P2: Automated venue payouts, more cities/sports
