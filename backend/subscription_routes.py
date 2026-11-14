import json
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from core import (db, NO_ID, audit, iso, new_id, now_utc, require_roles, rzp,
                  subscription_plan, verify_webhook_signature)

router = APIRouter(prefix="/api/subscriptions")
admin_dep = require_roles("admin")
owner_dep = require_roles("owner")
GRACE_DAYS = 7


class AssignPlanIn(BaseModel):
    owner_id: str
    plan: str


async def owner_subscription(owner_id):
    return await db.subscriptions.find_one({"owner_id": owner_id}, NO_ID)


async def require_operational_subscription(owner_id: str):
    sub = await owner_subscription(owner_id)
    if not sub:
        raise HTTPException(403, "A subscription must be assigned before operating this venue")
    status = sub.get("status")
    if status == "active":
        return sub
    if status == "past_due" and sub.get("grace_until", "") >= iso():
        return sub
    raise HTTPException(403, "Subscription access is suspended. Renew to restore your existing venue data.")


@router.post("/assign")
async def assign_plan(body: AssignPlanIn, user=Depends(admin_dep)):
    owner = await db.users.find_one({"id": body.owner_id, "role": "owner"}, NO_ID)
    if not owner:
        raise HTTPException(404, "Owner not found")
    plan = subscription_plan(body.plan)
    doc = {"id": new_id(), "owner_id": owner["id"], "plan": plan["key"], "amount": plan["amount"],
           "court_limit": plan["court_limit"], "status": "pending_authorization", "razorpay_subscription_id": None,
           "current_period_end": None, "grace_until": None, "created_at": iso(), "updated_at": iso()}
    await db.subscriptions.update_one({"owner_id": owner["id"]}, {"$set": doc, "$setOnInsert": {"id": doc["id"], "created_at": doc["created_at"]}}, upsert=True)
    await audit(user["id"], "subscription.assigned", "owner", owner["id"], {"plan": plan["key"]})
    return await owner_subscription(owner["id"])


@router.post("/authorize")
async def authorize(user=Depends(owner_dep)):
    sub = await owner_subscription(user["id"])
    if not sub:
        raise HTTPException(404, "No subscription has been assigned")
    plan = subscription_plan(sub["plan"])
    plan_id = os.environ.get(plan["env"])
    client = rzp()
    if not client or not plan_id:
        raise HTTPException(503, "Subscription payments are not configured")
    if sub.get("razorpay_subscription_id"):
        return {"subscription_id": sub["razorpay_subscription_id"], "key_id": os.environ.get("RAZORPAY_KEY_ID", "")}
    provider = await run_in_threadpool(client.subscription.create, {"plan_id": plan_id, "total_count": 120,
        "customer_notify": 1, "notes": {"owner_id": user["id"], "nxtplay_subscription_id": sub["id"]}})
    await db.subscriptions.update_one({"id": sub["id"]}, {"$set": {"razorpay_subscription_id": provider["id"], "status": "authorization_pending", "updated_at": iso()}})
    return {"subscription_id": provider["id"], "key_id": os.environ.get("RAZORPAY_KEY_ID", "")}


@router.get("/mine")
async def mine(user=Depends(owner_dep)):
    return await owner_subscription(user["id"])


async def process_event(data):
    event = data.get("event", "")
    entity = data.get("payload", {}).get("subscription", {}).get("entity", {})
    provider_id = entity.get("id")
    if not provider_id:
        return
    sub = await db.subscriptions.find_one({"razorpay_subscription_id": provider_id}, NO_ID)
    if not sub:
        return
    status = entity.get("status", "")
    update = {"provider_status": status, "updated_at": iso()}
    if event in ("subscription.activated", "subscription.charged"):
        end = entity.get("current_end")
        update.update(status="active", current_period_end=iso(datetime.fromtimestamp(end, tz=timezone.utc)) if end else None, grace_until=None)
    elif event in ("subscription.pending", "subscription.halted"):
        update.update(status="past_due", grace_until=iso(now_utc() + timedelta(days=GRACE_DAYS)))
    elif event in ("subscription.cancelled", "subscription.completed"):
        update["status"] = "cancelled"
    await db.subscriptions.update_one({"id": sub["id"]}, {"$set": update})


@router.post("/webhook")
async def webhook(request: Request):
    body = await request.body()
    if not verify_webhook_signature(body, request.headers.get("x-razorpay-signature", "")):
        raise HTTPException(400, "Invalid webhook signature")
    event_id = request.headers.get("x-razorpay-event-id")
    if not event_id:
        raise HTTPException(400, "Missing webhook event id")
    try:
        await db.subscription_events.insert_one({"event_id": event_id, "received_at": iso(), "status": "processing"})
    except Exception:
        return {"status": "duplicate"}
    try:
        await process_event(json.loads(body))
        await db.subscription_events.update_one({"event_id": event_id}, {"$set": {"status": "processed", "processed_at": iso()}})
    except Exception as exc:
        await db.subscription_events.update_one({"event_id": event_id}, {"$set": {"status": "failed", "error": str(exc)[:300]}})
        raise HTTPException(503, "Webhook processing failed")
    return {"status": "ok"}
