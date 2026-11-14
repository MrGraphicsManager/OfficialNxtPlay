# NXTPLAY — Independent Cloud Deployment

This application runs independently while preserving the sports booking experience.

## Backend — Render
- Root directory: `backend`
- Build: `pip install -r requirements.txt`
- Start: `uvicorn server:app --host 0.0.0.0 --port $PORT`
- Set variables from `backend/.env.example` in Render's environment settings. Do not commit real secrets.
- Set `MONGO_URL` to a MongoDB Atlas connection URI with a **rotated** password. Allow Render's network to reach Atlas.
- Set `CORS_ORIGINS` to the actual Vercel HTTPS origin, without trailing slash.
- Use `SEED_DEMO_DATA=false`. Real payments require Razorpay keys and webhook setup.

## Frontend — Vercel
- Root directory: `frontend`
- Framework: Create React App
- Install: `yarn install` (or `npm install`)
- Build: `yarn build` (or `npm run build`)
- Output: `build`
- Set `REACT_APP_BACKEND_URL` to Render's HTTPS origin, without `/api`.
- Deploy only after checking environment variables and backend health.

## Security and verification
- Rotate any MongoDB password previously shared in chat or elsewhere.
- Do not commit `.env` files or credentials.
- The backend regression suite is intentionally disabled unless every `NXTPLAY_E2E_*` variable is set. It creates and changes records, so point it only at a dedicated non-production environment.
- Test customer, owner, admin, bookings, QR check-in, cancellation, and Razorpay webhook flows before production.
- This branch is not a confirmed successful deployment or end-to-end test.
