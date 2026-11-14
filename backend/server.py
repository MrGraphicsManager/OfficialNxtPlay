import os
import logging
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI  # noqa: E402
from starlette.middleware.cors import CORSMiddleware  # noqa: E402

from core import db, client, iso, new_id, hash_pw, verify_pw  # noqa: E402
import auth_routes, public_routes, booking_routes, owner_routes, admin_routes, subscription_routes  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
log = logging.getLogger("nxtplay")

app = FastAPI(title="NXTPLAY API")
for r in (auth_routes, public_routes, booking_routes, owner_routes, admin_routes, subscription_routes):
    app.include_router(r.router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[origin.strip() for origin in os.environ.get("CORS_ORIGINS", "").split(",") if origin.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


async def ensure_indexes():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    for coll in ("cities", "sports", "venues", "courts", "bookings", "payments", "coupons", "price_requests", "images", "settlements"):
        await db[coll].create_index("id", unique=True)
    await db.courts.create_index("venue_id")
    await db.venues.create_index("owner_ids")
    await db.booking_slots.create_index([("court_id", 1), ("date", 1), ("start", 1)], unique=True)
    await db.booking_slots.create_index("booking_id")
    await db.bookings.create_index("code", unique=True)
    await db.bookings.create_index("qr_token", unique=True, partialFilterExpression={"qr_token": {"$type": "string"}})
    await db.bookings.create_index([("venue_id", 1), ("date", 1)])
    await db.bookings.create_index([("user_id", 1), ("start_at", -1)])
    await db.bookings.create_index([("status", 1), ("hold_expires_at", 1)])
    await db.payments.create_index("razorpay_order_id", unique=True)
    await db.refunds.create_index("booking_id", unique=True)
    await db.refunds.create_index("razorpay_refund_id")
    await db.coupons.create_index("code", unique=True)
    await db.coupon_redemptions.create_index("booking_id", unique=True)
    await db.qr_checkins.create_index("booking_id", unique=True)
    await db.webhook_events.create_index("event_id", unique=True)
    await db.subscription_events.create_index("event_id", unique=True)
    await db.subscriptions.create_index("owner_id", unique=True)
    await db.email_otps.create_index([("email", 1), ("purpose", 1)])
    await db.email_otps.create_index("expires_at", expireAfterSeconds=0)
    await db.audit_logs.create_index([("target_id", 1), ("created_at", -1)])
    await db.venue_closures.create_index([("venue_id", 1), ("date", 1)])
    await db.price_requests.create_index([("court_id", 1), ("status", 1)])


async def upsert_user(email, password, name, role):
    email = email.lower()
    u = await db.users.find_one({"email": email})
    if not u:
        await db.users.insert_one({"id": new_id(), "name": name, "email": email, "mobile": None, "role": role, "active": True,
                                   "password_hash": hash_pw(password), "created_at": iso()})
    elif not verify_pw(password, u["password_hash"]) or u["role"] != role:
        await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_pw(password), "role": role, "active": True}})
    return (await db.users.find_one({"email": email}))["id"]


async def seed():
    if not await db.settings.find_one({"id": "global"}):
        await db.settings.insert_one({"id": "global", "commission_pct": 10, "show_demo": True})
    if not await db.cities.find_one({"name": "Navsari"}):
        await db.cities.insert_one({"id": new_id(), "name": "Navsari", "state": "Gujarat", "active": True, "created_at": iso()})
    for s in ("Box Cricket", "Pickleball"):
        if not await db.sports.find_one({"name": s}):
            await db.sports.insert_one({"id": new_id(), "name": s, "active": True, "created_at": iso()})
    if os.environ.get("ADMIN_EMAIL") and os.environ.get("ADMIN_PASSWORD"):
        await upsert_user(os.environ["ADMIN_EMAIL"], os.environ["ADMIN_PASSWORD"], os.environ.get("ADMIN_NAME", "Super Admin"), "admin")
    if os.environ.get("SEED_DEMO_DATA") == "true" and os.environ.get("DEMO_OWNER_EMAIL") and os.environ.get("DEMO_OWNER_PASSWORD"):
        owner_id = await upsert_user(os.environ["DEMO_OWNER_EMAIL"], os.environ["DEMO_OWNER_PASSWORD"], "Demo Owner", "owner")
        if not await db.venues.find_one({"is_demo": True}):
            city = await db.cities.find_one({"name": "Navsari"})
            sports = {s["name"]: s["id"] async for s in db.sports.find({})}
            vid = new_id()
            await db.venues.insert_one({"id": vid, "name": "[DEMO] NXTPLAY Test Arena", "city_id": city["id"],
                                        "address": "Development test venue — not a real listing", "open_time": "06:00",
                                        "close_time": "23:00", "rules": "Demo venue for testing only. Non-marking shoes required.",
                                        "image_ids": [], "status": "active", "owner_ids": [owner_id], "is_demo": True, "created_at": iso()})
            for name, sport, dur, price in (("Turf A", "Box Cricket", 60, 1000), ("Court 1", "Pickleball", 30, 300)):
                await db.courts.insert_one({"id": new_id(), "venue_id": vid, "sport_id": sports[sport], "name": name,
                                            "slot_minutes": dur, "active": True, "created_at": iso(),
                                            "prices": [{"price": price, "effective_from": "2000-01-01", "approved_at": iso()}]})


@app.on_event("startup")
async def startup():
    await ensure_indexes()
    await seed()
    log.info("NXTPLAY backend ready")


@app.on_event("shutdown")
async def shutdown():
    client.close()
