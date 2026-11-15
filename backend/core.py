import os
import re
import hmac
import hashlib
import secrets
import string
import uuid
import logging
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

import bcrypt
import jwt
import razorpay
from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import BulkWriteError, DuplicateKeyError
from starlette.concurrency import run_in_threadpool

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
IST = ZoneInfo("Asia/Kolkata")
JWT_SECRET = os.environ["JWT_SECRET"]
HOLD_MINUTES = 10
CANCEL_CUTOFF_HOURS = 24
MAX_ADVANCE_DAYS = 60
log = logging.getLogger("nxtplay")
NO_ID = {"_id": 0}
USER_PROJ = {"_id": 0, "password_hash": 0, "reset": 0, "login_fail": 0}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def now_utc():
    return datetime.now(timezone.utc)


def iso(dt=None):
    return (dt or now_utc()).isoformat()


def new_id():
    return str(uuid.uuid4())


def now_ist():
    return datetime.now(IST)


def today_ist():
    return now_ist().strftime("%Y-%m-%d")


def gen_code():
    alphabet = string.ascii_uppercase + string.digits
    return "NXP-" + "".join(secrets.choice(alphabet) for _ in range(7))


def hm_to_min(hm: str) -> int:
    h, m = hm.split(":")
    return int(h) * 60 + int(m)


def min_to_hm(m: int) -> str:
    m = m % 1440 if m != 1440 else 1440
    return "24:00" if m == 1440 else f"{m // 60:02d}:{m % 60:02d}"


def venue_hours(venue):
    o = hm_to_min(venue["open_time"])
    c = hm_to_min(venue["close_time"])
    if c <= o:
        c += 1440 if c == 0 else 0
    return o, c


def slot_dt(date: str, minutes: int) -> datetime:
    return datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=IST) + timedelta(minutes=minutes)


def hash_pw(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_pw(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except ValueError:
        return False


def make_token(user) -> str:
    payload = {"sub": user["id"], "role": user["role"], "exp": now_utc() + timedelta(days=7), "type": "access"}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


async def get_current_user(request: Request):
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(auth[7:], JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired session")
    user = await db.users.find_one({"id": payload.get("sub")}, USER_PROJ)
    if not user or not user.get("active", True):
        raise HTTPException(401, "Account unavailable")
    return user


def require_roles(*roles):
    async def dep(user=Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, "Not allowed")
        return user
    return dep


async def get_settings():
    s = await db.settings.find_one({"id": "global"}, NO_ID)
    return s or {"id": "global", "commission_pct": 10, "show_demo": True}


# ---------- Razorpay ----------
def rzp_key_id():
    return os.environ.get("RAZORPAY_KEY_ID", "")


def rzp():
    kid, ks = os.environ.get("RAZORPAY_KEY_ID"), os.environ.get("RAZORPAY_KEY_SECRET")
    if not kid or not ks:
        return None
    return razorpay.Client(auth=(kid, ks))


SUBSCRIPTION_PLANS = {
    "starter": {"amount": 399, "court_limit": 5, "env": "RAZORPAY_PLAN_399"},
    "growth": {"amount": 699, "court_limit": 10, "env": "RAZORPAY_PLAN_699"},
}


def subscription_plan(key: str):
    plan = SUBSCRIPTION_PLANS.get(key)
    if not plan:
        raise HTTPException(400, "Invalid subscription plan")
    return {"key": key, **plan}


async def audit(actor_id: str, action: str, target_type: str, target_id: str, details: dict | None = None):
    await db.audit_logs.insert_one({"id": new_id(), "actor_id": actor_id, "action": action,
                                    "target_type": target_type, "target_id": target_id,
                                    "details": details or {}, "created_at": iso()})


# ---------- Encryption & subscription access ----------
GRACE_DAYS = 7
REMINDER_DAYS = 7


def _fernet():
    key = os.environ.get("DATA_ENCRYPTION_KEY")
    if not key:
        import base64
        key = base64.urlsafe_b64encode(hashlib.sha256((JWT_SECRET or "nxtplay-encryption-secret").encode()).digest()).decode()
    return Fernet(key.encode())


def enc(value):
    return None if value is None else _fernet().encrypt(str(value).encode()).decode()


def dec(value):
    if not value:
        return None
    try:
        return _fernet().decrypt(value.encode()).decode()
    except Exception:
        return None


def lookup_hash(value: str) -> str:
    return hmac.new(JWT_SECRET.encode(), f"lookup:{value}".encode(), hashlib.sha256).hexdigest()


def sub_state(sub, requires_plan: bool = False):
    base = {"paid_until": None, "days_left": None, "expiring_soon": False, "payment_issue": False, "grace_until": None}
    if not sub:
        if requires_plan:
            return {**base, "state": "awaiting_plan", "operational": False}
        return {**base, "state": "legacy", "operational": True}
    now = now_utc()
    paid = datetime.fromisoformat(sub["paid_until"]) if sub.get("paid_until") else None
    status = sub.get("status")
    issue = status in ("past_due", "halted")
    if not paid:
        return {**base, "state": "awaiting_authorization", "operational": False, "payment_issue": issue}
    info = {**base, "paid_until": sub["paid_until"], "days_left": max(0, (paid - now).days), "payment_issue": issue}
    if now <= paid:
        return {**info, "state": "cancelling" if status == "cancelled" else "active", "operational": True,
                "expiring_soon": (paid - now) <= timedelta(days=REMINDER_DAYS)}
    grace = paid + timedelta(days=GRACE_DAYS)
    if status in ("active", "past_due") and now <= grace:
        return {**info, "state": "grace", "operational": True, "expiring_soon": True, "payment_issue": True, "grace_until": iso(grace)}
    return {**info, "state": "expired", "operational": False}


async def venue_subs(venue):
    return await db.subscriptions.find({"owner_id": {"$in": venue.get("owner_ids", [])}}, NO_ID).to_list(20)


async def venue_operational(venue) -> bool:
    subs = await venue_subs(venue)
    if not subs:
        return not await db.users.find_one({"id": {"$in": venue.get("owner_ids", [])}, "requires_plan": True}, {"_id": 0, "id": 1})
    return any(sub_state(s)["operational"] for s in subs)


async def court_limit_for_venue(venue):
    subs = await venue_subs(venue)
    return max(s["court_limit"] for s in subs) if subs else None


async def enforce_court_limit(venue, adding: int = 1):
    limit = await court_limit_for_venue(venue)
    if limit is None:
        return
    count = await db.courts.count_documents({"venue_id": venue["id"]})
    if count + adding > limit:
        raise HTTPException(400, f"Plan limit reached: up to {limit} courts per venue. Contact NXTPLAY Super Admin to upgrade your plan.")


def day_open(venue, date: str) -> bool:
    days = venue.get("operating_days")
    return not days or datetime.strptime(date, "%Y-%m-%d").weekday() in days


def verify_checkout_signature(order_id, payment_id, signature) -> bool:
    secret = os.environ.get("RAZORPAY_KEY_SECRET", "")
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def verify_webhook_signature(body: bytes, signature: str) -> bool:
    secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


# ---------- Pricing / slots ----------
def court_price_for(court, date: str) -> int:
    prices = sorted(court.get("prices", []), key=lambda p: p["effective_from"])
    current = prices[0]["price"] if prices else 0
    for p in prices:
        if p["effective_from"] <= date:
            current = p["price"]
    return current


async def release_expired_holds(court_id=None):
    q = {"status": "pending_payment", "hold_expires_at": {"$lt": iso()}}
    if court_id:
        q["court_id"] = court_id
    async for b in db.bookings.find(q, {"_id": 0, "id": 1}):
        res = await db.bookings.update_one({"id": b["id"], "status": "pending_payment"},
                                           {"$set": {"status": "expired", "updated_at": iso()}})
        if res.modified_count:
            await db.booking_slots.delete_many({"booking_id": b["id"]})
            await db.payments.update_many({"booking_id": b["id"], "status": "created"}, {"$set": {"status": "expired"}})


async def taken_starts(court_id: str, date: str) -> set:
    await release_expired_holds(court_id)
    return {s["start"] async for s in db.booking_slots.find({"court_id": court_id, "date": date}, {"_id": 0, "start": 1})}


async def court_slots(venue, court, date: str):
    o, c = venue_hours(venue)
    dur = court["slot_minutes"]
    taken = await taken_starts(court["id"], date)
    price = court_price_for(court, date)
    now = now_ist()
    closed = await db.venue_closures.find_one({"venue_id": venue["id"], "date": date,
                                                "$or": [{"court_id": None}, {"court_id": court["id"]}]}, NO_ID)
    closed = closed or not day_open(venue, date)
    out = []
    for s in range(o, c - dur + 1, dur):
        status = "available"
        if closed:
            status = "unavailable"
        elif s in taken:
            status = "booked"
        elif slot_dt(date, s) <= now:
            status = "past"
        out.append({"start": s, "end": s + dur, "label": f"{min_to_hm(s)} - {min_to_hm(s + dur)}",
                    "price": price, "status": status})
    return out


async def reserve_slots(booking_id, court_id, date, starts) -> bool:
    docs = [{"court_id": court_id, "date": date, "start": s, "booking_id": booking_id, "created_at": iso()} for s in starts]
    try:
        await db.booking_slots.insert_many(docs, ordered=True)
        return True
    except (BulkWriteError, DuplicateKeyError):
        await db.booking_slots.delete_many({"booking_id": booking_id})
        return False


async def prepare_booking(court_id: str, date: str, start_min: int, end_min: int, require_active=True):
    court = await db.courts.find_one({"id": court_id}, NO_ID)
    if not court or not court.get("active", True):
        raise HTTPException(404, "Court not available")
    venue = await db.venues.find_one({"id": court["venue_id"]}, NO_ID)
    if not venue or (require_active and venue["status"] != "active"):
        raise HTTPException(400, "Venue is not accepting bookings")
    if not DATE_RE.match(date or ""):
        raise HTTPException(400, "Invalid date")
    if await db.venue_closures.find_one({"venue_id": venue["id"], "date": date,
                                          "$or": [{"court_id": None}, {"court_id": court_id}]}, NO_ID):
        raise HTTPException(400, "This venue or court is unavailable on the selected date")
    if not day_open(venue, date):
        raise HTTPException(400, "The venue is closed on this day")
    if require_active and not await venue_operational(venue):
        raise HTTPException(400, "Venue is not accepting bookings")
    d = datetime.strptime(date, "%Y-%m-%d").date()
    if d > (now_ist().date() + timedelta(days=MAX_ADVANCE_DAYS)):
        raise HTTPException(400, f"Bookings open up to {MAX_ADVANCE_DAYS} days in advance")
    o, c = venue_hours(venue)
    dur = court["slot_minutes"]
    if end_min <= start_min or start_min < o or end_min > c:
        raise HTTPException(400, "Selected time is outside operating hours")
    if (start_min - o) % dur or (end_min - start_min) % dur:
        raise HTTPException(400, "Selected time does not match the court's slot schedule")
    if (end_min - start_min) > 12 * 60:
        raise HTTPException(400, "Booking too long")
    if slot_dt(date, start_min) <= now_ist():
        raise HTTPException(400, "Cannot book a past time slot")
    starts = list(range(start_min, end_min, dur))
    unit = court_price_for(court, date)
    sport = await db.sports.find_one({"id": court["sport_id"]}, NO_ID)
    city = await db.cities.find_one({"id": venue["city_id"]}, NO_ID)
    snapshot = {
        "venue_id": venue["id"], "venue_name": venue["name"], "court_id": court["id"], "court_name": court["name"],
        "sport_id": court["sport_id"], "sport_name": sport["name"] if sport else "", "city_name": city["name"] if city else "",
        "date": date, "start_min": start_min, "end_min": end_min, "slot_starts": starts, "slot_minutes": dur,
        "start_time": min_to_hm(start_min), "end_time": min_to_hm(end_min),
        "start_at": iso(slot_dt(date, start_min).astimezone(timezone.utc)),
        "unit_price": unit, "gross_amount": unit * len(starts),
    }
    return snapshot


async def evaluate_coupon(code: str, gross: int):
    c = await db.coupons.find_one({"code": (code or "").strip().upper()}, NO_ID)
    today = today_ist()
    if not c or not c.get("active"):
        raise HTTPException(400, "Invalid coupon code")
    if c.get("start_date") and today < c["start_date"]:
        raise HTTPException(400, "Coupon is not active yet")
    if c.get("expiry_date") and today > c["expiry_date"]:
        raise HTTPException(400, "Coupon has expired")
    if c.get("usage_limit") and c.get("used_count", 0) >= c["usage_limit"]:
        raise HTTPException(400, "Coupon usage limit reached")
    if gross < (c.get("min_amount") or 0):
        raise HTTPException(400, f"Minimum booking amount is ₹{c['min_amount']}")
    if c["discount_type"] == "percent":
        disc = round(gross * c["discount_value"] / 100)
        if c.get("max_discount"):
            disc = min(disc, c["max_discount"])
    else:
        disc = int(c["discount_value"])
    disc = max(0, min(disc, gross - 1))
    return c, disc


# ---------- Payment confirmation & refunds ----------
async def finalize_booking_confirmation(booking, extra: dict):
    final = booking["final_amount"]
    online = booking["payment_method"] in ("razorpay",)
    pct = 0  # NXTPLAY earns from owner subscriptions only; no booking commission
    fee = 0
    update = {"status": "confirmed", "qr_token": secrets.token_urlsafe(24), "confirmed_at": iso(), "updated_at": iso(),
              "commission_pct": pct, "platform_fee": fee, "venue_payable": final - fee if online else 0,
              "settlement_status": "unsettled" if online else "not_applicable", **extra}
    await db.bookings.update_one({"id": booking["id"]}, {"$set": update})
    if booking.get("coupon_code"):
        try:
            await db.coupon_redemptions.insert_one({"id": new_id(), "booking_id": booking["id"], "coupon_code": booking["coupon_code"],
                                                    "user_id": booking.get("user_id"), "discount": booking.get("discount", 0), "created_at": iso()})
            await db.coupons.update_one({"code": booking["coupon_code"]}, {"$inc": {"used_count": 1}})
        except DuplicateKeyError:
            pass
    return await db.bookings.find_one({"id": booking["id"]}, NO_ID)


async def confirm_paid_order(order_id: str, payment_id: str):
    pay = await db.payments.find_one({"razorpay_order_id": order_id}, NO_ID)
    if not pay:
        raise HTTPException(404, "Payment order not found")
    booking = await db.bookings.find_one({"id": pay["booking_id"]}, NO_ID)
    if pay["status"] == "captured":
        return booking
    client_ = rzp()
    if not client_:
        raise HTTPException(503, "Payments are not configured")
    p = await run_in_threadpool(client_.payment.fetch, payment_id)
    if p.get("order_id") != order_id or int(p.get("amount", 0)) != pay["amount_paise"]:
        raise HTTPException(400, "Payment does not match this order")
    if p.get("status") == "authorized":
        p = await run_in_threadpool(client_.payment.capture, payment_id, pay["amount_paise"], {"currency": "INR"})
    if p.get("status") != "captured":
        raise HTTPException(400, f"Payment not captured (status: {p.get('status')})")
    res = await db.payments.find_one_and_update(
        {"id": pay["id"], "status": {"$ne": "captured"}},
        {"$set": {"status": "captured", "razorpay_payment_id": payment_id, "method": p.get("method"), "captured_at": iso()}})
    if res is None:
        return await db.bookings.find_one({"id": pay["booking_id"]}, NO_ID)
    if booking["status"] == "confirmed":
        return booking
    held = await db.booking_slots.count_documents({"booking_id": booking["id"]})
    if held != len(booking["slot_starts"]):
        await db.booking_slots.delete_many({"booking_id": booking["id"]})
        if not await reserve_slots(booking["id"], booking["court_id"], booking["date"], booking["slot_starts"]):
            await db.bookings.update_one({"id": booking["id"]}, {"$set": {
                "status": "cancelled", "cancel_reason": "Slot no longer available after payment; automatic refund", "cancelled_at": iso(),
                "payment_id": pay["id"], "paid_via": p.get("method")}})
            b = await db.bookings.find_one({"id": booking["id"]}, NO_ID)
            await initiate_refund(b, "Slot conflict after payment")
            return await db.bookings.find_one({"id": booking["id"]}, NO_ID)
    return await finalize_booking_confirmation(booking, {"payment_id": pay["id"], "paid_via": p.get("method")})


REFUND_STATUS = {"processed": "processed", "pending": "initiated", "failed": "failed", "created": "initiated"}


async def initiate_refund(booking, reason: str):
    pay = await db.payments.find_one({"booking_id": booking["id"], "status": "captured"}, NO_ID)
    if not pay:
        return None
    refund = {"id": new_id(), "booking_id": booking["id"], "booking_code": booking["code"], "venue_id": booking["venue_id"],
              "payment_id": pay["id"], "razorpay_payment_id": pay["razorpay_payment_id"], "amount": booking["final_amount"],
              "status": "pending", "reason": reason, "razorpay_refund_id": None, "error": None, "created_at": iso(), "updated_at": iso()}
    try:
        await db.refunds.insert_one(refund)
    except DuplicateKeyError:
        return await db.refunds.find_one({"booking_id": booking["id"]}, NO_ID)
    await db.bookings.update_one({"id": booking["id"]}, {"$set": {"refund_status": "pending", "refund_id": refund["id"]}})
    return await call_refund_api(refund)


async def call_refund_api(refund):
    client_ = rzp()
    update = {"updated_at": iso()}
    if not client_:
        update.update(status="failed", error="Payments are not configured")
    else:
        opts = {"amount": int(refund["amount"]) * 100, "notes": {"booking": refund["booking_code"]}}
        if await db.payments.find_one({"razorpay_payment_id": refund["razorpay_payment_id"], "route": {"$exists": True}}, {"_id": 0, "id": 1}):
            opts["reverse_all"] = 1
        try:
            r = await run_in_threadpool(client_.payment.refund, refund["razorpay_payment_id"], opts)
            update.update(razorpay_refund_id=r.get("id"), status=REFUND_STATUS.get(r.get("status"), "initiated"), error=None)
        except Exception as e:  # provider error must be visible to admins
            update.update(status="failed", error=str(e)[:300])
    await db.refunds.update_one({"id": refund["id"]}, {"$set": update})
    await db.bookings.update_one({"id": refund["booking_id"]}, {"$set": {"refund_status": update["status"]}})
    return await db.refunds.find_one({"id": refund["id"]}, NO_ID)


async def owner_venue_ids(user) -> list:
    return [v["id"] async for v in db.venues.find({"owner_ids": user["id"]}, {"_id": 0, "id": 1})]
