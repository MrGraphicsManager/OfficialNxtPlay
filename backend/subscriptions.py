import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from pymongo.errors import DuplicateKeyError
from starlette.concurrency import run_in_threadpool

from core import (db, NO_ID, USER_PROJ, IST, DATE_RE, audit, iso, new_id, now_utc, require_roles, rzp, rzp_key_id, hash_pw,
                  subscription_plan, verify_webhook_signature, sub_state, enc, dec, lookup_hash, today_ist, log)
import emailer

router = APIRouter(prefix="/api/subscriptions")
admin_dep = require_roles("admin")
owner_dep = require_roles("owner")
STATUS_MAP = {"created": "authorization_pending", "authenticated": "authorization_pending", "active": "active",
              "pending": "past_due", "halted": "halted", "cancelled": "cancelled", "completed": "completed",
              "expired": "expired", "paused": "paused", "resumed": "active"}
LEASE_SECONDS = 300
PAY_PROJ = {"_id": 0, "ref_enc": 0, "ref_hash": 0, "invoice_enc": 0}


class CreateOwnerIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    mobile: str = Field(min_length=10, max_length=15)
    plan: str = Field(pattern="^(starter|growth)$")
    start_date: str
    expiry_date: str


class AssignIn(BaseModel):
    owner_id: str
    plan: str = Field(pattern="^(starter|growth)$")
    start_date: str
    expiry_date: str


class ManualRenewIn(BaseModel):
    paid_until: str
    note: str = Field(min_length=3, max_length=200)


class VerifyIn(BaseModel):
    razorpay_payment_id: str
    razorpay_subscription_id: str
    razorpay_signature: str


def ts_iso(ts):
    return iso(datetime.fromtimestamp(int(ts), tz=timezone.utc)) if ts else None


def months_between(start: str, end: str) -> int:
    a, b = datetime.strptime(start, "%Y-%m-%d"), datetime.strptime(end, "%Y-%m-%d")
    return max(1, min(120, (b.year - a.year) * 12 + b.month - a.month))


def add_months(d: str, n: int) -> str:
    dt = datetime.strptime(d, "%Y-%m-%d")
    m = dt.month - 1 + n
    return f"{dt.year + m // 12:04d}-{m % 12 + 1:02d}-{min(dt.day, 28):02d}"


def validate_dates(start: str, end: str):
    if not DATE_RE.match(start or "") or not DATE_RE.match(end or "") or end <= start:
        raise HTTPException(400, "Enter a valid start date and a later expiry date")


def plan_label(plan):
    return f"{plan['key'].title()} plan, ₹{plan['amount']}/month, up to {plan['court_limit']} courts per venue"


def view(sub):
    if not sub:
        return None
    out = {k: v for k, v in sub.items() if k not in ("rzp_sub_enc", "rzp_sub_hash", "previous_rzp_hashes")}
    out["has_provider_subscription"] = bool(sub.get("rzp_sub_enc"))
    return out


async def owner_subscription(owner_id):
    return await db.subscriptions.find_one({"owner_id": owner_id}, NO_ID)


async def require_operational_subscription(owner_id: str):
    st = sub_state(await owner_subscription(owner_id))
    if not st["operational"]:
        if st["state"] == "awaiting_authorization":
            raise HTTPException(403, "Authorize your NXTPLAY monthly plan to start operating your venue.")
        raise HTTPException(403, "Your subscription has expired. Renew to restore access. Your venue data is preserved.")
    return st


async def log_history(sub, action, by, details=None):
    await db.subscription_history.insert_one({"id": new_id(), "subscription_id": sub["id"], "owner_id": sub["owner_id"],
                                              "action": action, "by": by, "details": details or {}, "created_at": iso()})


def new_sub_doc(owner_id, plan, start, end):
    return {"id": new_id(), "owner_id": owner_id, "plan": plan["key"], "amount": plan["amount"], "court_limit": plan["court_limit"],
            "status": "pending_authorization", "start_date": start, "expiry_date": end, "paid_until": None,
            "current_period_start": None, "current_period_end": None, "next_billing_at": None, "provider_status": None,
            "rzp_sub_enc": None, "rzp_sub_hash": None, "previous_rzp_hashes": [], "short_url": None, "last_event_ts": 0,
            "last_payment_error": None, "reminder_sent_for": None, "expired_notice_for": None,
            "created_at": iso(), "updated_at": iso()}


async def check_court_limit(owner_id, limit):
    async for v in db.venues.find({"owner_ids": owner_id}, NO_ID):
        n = await db.courts.count_documents({"venue_id": v["id"]})
        if n > limit:
            raise HTTPException(400, f"{v['name']} has {n} courts, above this plan's {limit}-court limit. "
                                     "Venues with more than 10 courts are handled manually by Super Admin.")


async def issue_invite(owner, plan):
    temp = "Nxp-" + secrets.token_urlsafe(9)
    token = secrets.token_urlsafe(32)
    await db.users.update_one({"id": owner["id"]}, {"$set": {
        "password_hash": hash_pw(temp), "must_change_password": True,
        "reset": {"hash": hashlib.sha256(token.encode()).hexdigest(), "expires": iso(now_utc() + timedelta(hours=72))}}})
    try:
        await emailer.send_owner_invite(owner, token, plan_label(plan) if plan else "NXTPLAY venue owner")
        sent = True
    except (HTTPException, ValueError):
        sent = False
    return temp, sent


async def cancel_provider(sub):
    client, sid = rzp(), dec(sub.get("rzp_sub_enc"))
    if not client or not sid:
        return
    try:
        await run_in_threadpool(client.subscription.cancel, sid, {"cancel_at_cycle_end": 1})
    except Exception as e:
        raise HTTPException(502, f"Razorpay cancellation failed: {str(e)[:120]}")


async def apply_entity(sub, entity, event_ts: int, current: bool = True):
    upd = {"provider_status": entity.get("status"), "updated_at": iso()}
    if not current:
        await db.subscriptions.update_one({"id": sub["id"]}, {"$set": {"updated_at": iso()}})
        return False
    newer = event_ts >= (sub.get("last_event_ts") or 0)
    if newer:
        mapped = STATUS_MAP.get(entity.get("status"))
        if mapped:
            upd["status"] = mapped
        upd["last_event_ts"] = event_ts
        if entity.get("charge_at"):
            upd["next_billing_at"] = ts_iso(entity["charge_at"])
    if entity.get("status") == "active" and entity.get("current_end"):
        end = ts_iso(entity["current_end"])
        if not sub.get("paid_until") or end > sub["paid_until"]:
            upd.update(paid_until=end, current_period_start=ts_iso(entity.get("current_start")), current_period_end=end)
        if newer:
            upd["last_payment_error"] = None
    await db.subscriptions.update_one({"id": sub["id"]}, {"$set": upd})
    return newer


async def record_payment(sub, pay, status, entity, event_id, error=None):
    ref = pay.get("id") or f"event:{event_id}"
    doc = {"id": new_id(), "subscription_id": sub["id"], "owner_id": sub["owner_id"], "ref_hash": lookup_hash(f"{ref}:{status}"),
           "ref_enc": enc(ref), "invoice_enc": enc(pay["invoice_id"]) if pay.get("invoice_id") else None,
           "amount": (pay.get("amount") or 0) / 100, "method": pay.get("method"), "status": status, "error": error,
           "period_start": ts_iso(entity.get("current_start")), "period_end": ts_iso(entity.get("current_end")), "created_at": iso()}
    try:
        await db.subscription_payments.insert_one(doc)
    except DuplicateKeyError:
        pass


async def notify(owner_id, kind, detail):
    owner = await db.users.find_one({"id": owner_id}, USER_PROJ)
    if not owner:
        return False
    try:
        await emailer.send_subscription_notice(owner, kind, detail)
        return True
    except (HTTPException, ValueError):
        log.warning("Subscription %s notice not delivered for owner %s", kind, owner_id)
        return False


async def process_event(data, event_id):
    event = data.get("event", "")
    payload = data.get("payload", {})
    entity = payload.get("subscription", {}).get("entity", {})
    sid = entity.get("id")
    if not sid or not event.startswith("subscription."):
        return "ignored"
    h = lookup_hash(sid)
    sub = await db.subscriptions.find_one({"$or": [{"rzp_sub_hash": h}, {"previous_rzp_hashes": h}]}, NO_ID)
    if not sub:
        return "unknown_subscription"
    current = sub.get("rzp_sub_hash") == h
    newer = await apply_entity(sub, entity, int(data.get("created_at") or now_utc().timestamp()), current)
    pay = payload.get("payment", {}).get("entity") or {}
    if event == "subscription.charged" and pay:
        await record_payment(sub, pay, "captured", entity, event_id)
    elif event in ("subscription.pending", "subscription.halted"):
        err = pay.get("error_description") or ("Recurring payment failed. Razorpay will retry automatically."
                                               if event.endswith("pending") else "Payment retries were exhausted and the subscription is halted.")
        await record_payment(sub, pay, "failed", entity, event_id, err)
        if current and newer:
            await db.subscriptions.update_one({"id": sub["id"]}, {"$set": {"last_payment_error": err}})
            await notify(sub["owner_id"], "failed", f"{err} Please check your payment method from your dashboard.")
    await log_history(sub, event, "razorpay", {"provider_status": entity.get("status"), "current": current})
    return "ok"


async def claim_event(event_id: str) -> str:
    now = now_utc()
    try:
        await db.subscription_events.insert_one({"event_id": event_id, "status": "processing", "attempts": 1,
                                                 "received_at": iso(now), "processing_started_at": iso(now)})
        return "claimed"
    except DuplicateKeyError:
        ev = await db.subscription_events.find_one({"event_id": event_id}, NO_ID)
        if ev and ev.get("status") == "processed":
            return "processed"
    stale = iso(now - timedelta(seconds=LEASE_SECONDS))
    res = await db.subscription_events.update_one(
        {"event_id": event_id, "$or": [{"status": "failed"}, {"status": "processing", "processing_started_at": {"$lt": stale}}]},
        {"$set": {"status": "processing", "processing_started_at": iso(now)}, "$inc": {"attempts": 1}})
    return "claimed" if res.modified_count else "processing"


@router.post("/webhook")
async def webhook(request: Request):
    body = await request.body()
    if not verify_webhook_signature(body, request.headers.get("x-razorpay-signature", "")):
        raise HTTPException(400, "Invalid webhook signature")
    event_id = request.headers.get("x-razorpay-event-id")
    if not event_id:
        raise HTTPException(400, "Missing webhook event id")
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid webhook payload")
    claim = await claim_event(event_id)
    if claim == "processed":
        return {"status": "duplicate"}
    if claim == "processing":
        raise HTTPException(503, "Event is already being processed")
    try:
        result = await process_event(data, event_id)
    except Exception as e:
        log.exception("Subscription webhook failed")
        await db.subscription_events.update_one({"event_id": event_id}, {"$set": {"status": "failed", "error": str(e)[:300]}})
        raise HTTPException(503, "Webhook processing failed; Razorpay should retry")
    await db.subscription_events.update_one({"event_id": event_id}, {"$set": {"status": "processed", "result": result, "processed_at": iso()}})
    return {"status": result}


# ---------- Owner ----------
@router.get("/mine")
async def mine(user=Depends(owner_dep)):
    sub = await owner_subscription(user["id"])
    pays = await db.subscription_payments.find({"owner_id": user["id"]}, PAY_PROJ).sort("created_at", -1).to_list(50)
    plan = subscription_plan(sub["plan"]) if sub else None
    return {"subscription": view(sub), "access": sub_state(sub), "payments": pays,
            "must_change_password": bool(user.get("must_change_password")),
            "payments_configured": bool(rzp() and plan and os.environ.get(plan["env"]))}


@router.post("/authorize")
async def authorize(user=Depends(owner_dep)):
    if user.get("must_change_password"):
        raise HTTPException(403, "Change your temporary password first")
    sub = await owner_subscription(user["id"])
    if not sub:
        raise HTTPException(404, "No subscription plan has been assigned yet")
    plan = subscription_plan(sub["plan"])
    client, plan_id = rzp(), os.environ.get(plan["env"])
    if not client or not plan_id:
        raise HTTPException(503, "Subscription payments are not configured yet. Please contact NXTPLAY.")
    if sub.get("rzp_sub_enc") and sub.get("status") in ("authorization_pending", "active", "past_due"):
        return {"subscription_id": dec(sub["rzp_sub_enc"]), "key_id": rzp_key_id(), "short_url": sub.get("short_url")}
    st = sub_state(sub)
    today = today_ist()
    start = max(sub["start_date"], today)
    expiry = sub["expiry_date"] if sub["expiry_date"] > start else add_months(start, 12)
    payload = {"plan_id": plan_id, "total_count": months_between(start, expiry), "customer_notify": 1, "quantity": 1,
               "notes": {"owner_id": user["id"], "nxtplay_subscription_id": sub["id"]}}
    if st["operational"] and sub.get("paid_until"):
        payload["start_at"] = int(datetime.fromisoformat(sub["paid_until"]).timestamp())
    elif start > today:
        payload["start_at"] = int(datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=IST).timestamp())
    try:
        provider = await run_in_threadpool(client.subscription.create, payload)
    except Exception as e:
        raise HTTPException(502, f"Razorpay could not create the subscription: {str(e)[:150]}")
    prev = sub.get("previous_rzp_hashes", []) + ([sub["rzp_sub_hash"]] if sub.get("rzp_sub_hash") else [])
    await db.subscriptions.update_one({"id": sub["id"]}, {"$set": {
        "rzp_sub_enc": enc(provider["id"]), "rzp_sub_hash": lookup_hash(provider["id"]), "short_url": provider.get("short_url"),
        "status": "authorization_pending", "provider_status": provider.get("status"), "expiry_date": expiry,
        "previous_rzp_hashes": prev, "last_event_ts": 0, "updated_at": iso()}})
    await log_history(sub, "renewal_started" if sub.get("paid_until") else "authorization_started", user["id"],
                      {"term_extended": expiry != sub["expiry_date"]})
    return {"subscription_id": provider["id"], "key_id": rzp_key_id(), "short_url": provider.get("short_url")}


@router.post("/verify")
async def verify(body: VerifyIn, user=Depends(owner_dep)):
    sub = await owner_subscription(user["id"])
    if not sub or sub.get("rzp_sub_hash") != lookup_hash(body.razorpay_subscription_id):
        raise HTTPException(400, "Subscription does not match your account")
    secret = os.environ.get("RAZORPAY_KEY_SECRET", "")
    expected = hmac.new(secret.encode(), f"{body.razorpay_payment_id}|{body.razorpay_subscription_id}".encode(), hashlib.sha256).hexdigest()
    if not secret or not hmac.compare_digest(expected, body.razorpay_signature):
        raise HTTPException(400, "Invalid payment signature")
    entity = await run_in_threadpool(rzp().subscription.fetch, body.razorpay_subscription_id)
    await apply_entity(sub, entity, int(now_utc().timestamp()))
    await log_history(sub, "authorization_verified", user["id"], {"provider_status": entity.get("status")})
    return await mine(user)


# ---------- Super Admin ----------
@router.get("/admin/owners")
async def admin_owners(user=Depends(admin_dep)):
    out = []
    for o in await db.users.find({"role": "owner"}, USER_PROJ).sort("created_at", -1).to_list(1000):
        sub = await owner_subscription(o["id"])
        venues = [{"id": v["id"], "name": v["name"], "courts": await db.courts.count_documents({"venue_id": v["id"]})}
                  async for v in db.venues.find({"owner_ids": o["id"]}, NO_ID)]
        out.append({"owner": o, "subscription": view(sub), "access": sub_state(sub), "venues": venues})
    return out


@router.get("/admin/owners/{owner_id}")
async def admin_owner_detail(owner_id: str, user=Depends(admin_dep)):
    owner = await db.users.find_one({"id": owner_id, "role": "owner"}, USER_PROJ)
    if not owner:
        raise HTTPException(404, "Owner not found")
    sub = await owner_subscription(owner_id)
    pays = []
    async for p in db.subscription_payments.find({"owner_id": owner_id}, {"_id": 0, "ref_hash": 0}).sort("created_at", -1):
        p["payment_ref"], p["invoice_ref"] = dec(p.pop("ref_enc", None)), dec(p.pop("invoice_enc", None))
        pays.append(p)
    targets = [owner_id] + ([sub["id"]] if sub else [])
    return {"owner": owner, "subscription": view(sub), "access": sub_state(sub), "payments": pays,
            "provider_subscription_id": dec(sub.get("rzp_sub_enc")) if sub else None,
            "history": await db.subscription_history.find({"owner_id": owner_id}, NO_ID).sort("created_at", -1).to_list(200),
            "audit": await db.audit_logs.find({"target_id": {"$in": targets}}, NO_ID).sort("created_at", -1).to_list(200),
            "venues": await db.venues.find({"owner_ids": owner_id}, {"_id": 0, "id": 1, "name": 1, "status": 1, "address": 1}).to_list(50)}


@router.post("/admin/owners")
async def create_owner(body: CreateOwnerIn, user=Depends(admin_dep)):
    validate_dates(body.start_date, body.expiry_date)
    plan = subscription_plan(body.plan)
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "An account with this email already exists")
    owner = {"id": new_id(), "name": body.name.strip(), "email": email, "mobile": body.mobile.strip(), "role": "owner",
             "active": True, "must_change_password": True, "password_hash": hash_pw(secrets.token_urlsafe(16)), "created_at": iso()}
    await db.users.insert_one(owner)
    sub = new_sub_doc(owner["id"], plan, body.start_date, body.expiry_date)
    await db.subscriptions.insert_one(sub)
    await log_history(sub, "assigned", user["id"], {"plan": plan["key"]})
    await audit(user["id"], "owner.created_with_plan", "owner", owner["id"], {"plan": plan["key"]})
    temp, sent = await issue_invite(owner, plan)
    return {"owner": {k: owner[k] for k in ("id", "name", "email", "mobile")}, "temporary_password": temp,
            "email_sent": sent, "subscription": view(await owner_subscription(owner["id"]))}


@router.post("/admin/owners/{owner_id}/resend-invite")
async def resend_invite(owner_id: str, user=Depends(admin_dep)):
    owner = await db.users.find_one({"id": owner_id, "role": "owner"}, USER_PROJ)
    if not owner:
        raise HTTPException(404, "Owner not found")
    sub = await owner_subscription(owner_id)
    temp, sent = await issue_invite(owner, subscription_plan(sub["plan"]) if sub else None)
    await audit(user["id"], "owner.invite_reissued", "owner", owner_id)
    return {"temporary_password": temp, "email_sent": sent}


@router.post("/admin/assign")
async def assign(body: AssignIn, user=Depends(admin_dep)):
    validate_dates(body.start_date, body.expiry_date)
    plan = subscription_plan(body.plan)
    if not await db.users.find_one({"id": body.owner_id, "role": "owner"}):
        raise HTTPException(404, "Owner not found")
    await check_court_limit(body.owner_id, plan["court_limit"])
    sub = await owner_subscription(body.owner_id)
    if not sub:
        sub = new_sub_doc(body.owner_id, plan, body.start_date, body.expiry_date)
        await db.subscriptions.insert_one(sub)
        await log_history(sub, "assigned", user["id"], {"plan": plan["key"]})
    else:
        upd = {"plan": plan["key"], "amount": plan["amount"], "court_limit": plan["court_limit"],
               "start_date": body.start_date, "expiry_date": body.expiry_date, "updated_at": iso()}
        if sub.get("rzp_sub_enc") and sub["plan"] != plan["key"]:
            await cancel_provider(sub)
            upd.update(rzp_sub_enc=None, rzp_sub_hash=None, short_url=None, status="pending_authorization",
                       previous_rzp_hashes=sub.get("previous_rzp_hashes", []) + [sub["rzp_sub_hash"]])
        await db.subscriptions.update_one({"id": sub["id"]}, {"$set": upd})
        await log_history(sub, "plan_changed" if sub["plan"] != plan["key"] else "dates_updated", user["id"],
                          {"from": sub["plan"], "to": plan["key"], "start_date": body.start_date, "expiry_date": body.expiry_date})
    await audit(user["id"], "subscription.assigned", "owner", body.owner_id, {"plan": plan["key"]})
    return view(await owner_subscription(body.owner_id))


async def admin_sub(owner_id):
    sub = await owner_subscription(owner_id)
    if not sub:
        raise HTTPException(404, "No subscription assigned")
    return sub


@router.post("/admin/owners/{owner_id}/manual-renewal")
async def manual_renewal(owner_id: str, body: ManualRenewIn, user=Depends(admin_dep)):
    sub = await admin_sub(owner_id)
    if not DATE_RE.match(body.paid_until):
        raise HTTPException(400, "Invalid date")
    paid = datetime.strptime(body.paid_until, "%Y-%m-%d").replace(hour=23, minute=59, tzinfo=IST).astimezone(timezone.utc)
    if paid <= now_utc():
        raise HTTPException(400, "Paid-until date must be in the future")
    await db.subscriptions.update_one({"id": sub["id"]}, {"$set": {
        "paid_until": iso(paid), "status": "active", "last_payment_error": None, "manual_renewal": True, "updated_at": iso()}})
    await log_history(sub, "manual_renewal", user["id"], {"paid_until": iso(paid), "note": body.note})
    await audit(user["id"], "subscription.manual_renewal", "owner", owner_id, {"paid_until": iso(paid), "note": body.note})
    return view(await owner_subscription(owner_id))


@router.post("/admin/owners/{owner_id}/cancel")
async def cancel(owner_id: str, user=Depends(admin_dep)):
    sub = await admin_sub(owner_id)
    await cancel_provider(sub)
    await db.subscriptions.update_one({"id": sub["id"]}, {"$set": {"status": "cancelled", "updated_at": iso()}})
    await log_history(sub, "cancelled", user["id"])
    await audit(user["id"], "subscription.cancelled", "owner", owner_id)
    return view(await owner_subscription(owner_id))


@router.post("/admin/owners/{owner_id}/sync")
async def sync(owner_id: str, user=Depends(admin_dep)):
    sub = await admin_sub(owner_id)
    sid, client = dec(sub.get("rzp_sub_enc")), rzp()
    if not sid or not client:
        raise HTTPException(400, "No Razorpay subscription to sync")
    entity = await run_in_threadpool(client.subscription.fetch, sid)
    await apply_entity(sub, entity, int(now_utc().timestamp()))
    await log_history(sub, "synced", user["id"], {"provider_status": entity.get("status")})
    return view(await owner_subscription(owner_id))


@router.post("/cron/daily")
async def daily(request: Request):
    secret = os.environ.get("CRON_SECRET", "")
    given = request.headers.get("authorization", "")[7:]
    if not secret or not hmac.compare_digest(given, secret):
        raise HTTPException(401, "Unauthorized")
    reminders = expired = 0
    async for sub in db.subscriptions.find({}, NO_ID):
        st = sub_state(sub)
        if st["operational"] and st["expiring_soon"] and sub.get("reminder_sent_for") != sub.get("paid_until"):
            if await notify(sub["owner_id"], "reminder", f"your plan is paid until {sub['paid_until'][:10]}. "
                            "If auto-pay is active it renews automatically; otherwise renew from your dashboard."):
                await db.subscriptions.update_one({"id": sub["id"]}, {"$set": {"reminder_sent_for": sub.get("paid_until")}})
                reminders += 1
        if st["state"] == "expired" and sub.get("expired_notice_for") != sub.get("paid_until"):
            if await notify(sub["owner_id"], "expired", "your dashboard is paused until you renew. Nothing has been deleted."):
                await db.subscriptions.update_one({"id": sub["id"]}, {"$set": {"expired_notice_for": sub.get("paid_until")}})
                expired += 1
    return {"reminders_sent": reminders, "expiry_notices_sent": expired}
