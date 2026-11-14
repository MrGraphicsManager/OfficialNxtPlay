import json
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError
from starlette.concurrency import run_in_threadpool

from core import (db, NO_ID, iso, now_utc, now_ist, new_id, gen_code, require_roles, get_current_user, prepare_booking,
                  evaluate_coupon, reserve_slots, rzp, rzp_key_id, verify_checkout_signature, verify_webhook_signature,
                  confirm_paid_order, initiate_refund, owner_venue_ids, HOLD_MINUTES, CANCEL_CUTOFF_HOURS, REFUND_STATUS,
                  slot_dt, log)

router = APIRouter(prefix="/api")


class QuoteIn(BaseModel):
    court_id: str
    date: str
    start_min: int = Field(ge=0, le=1440)
    end_min: int = Field(ge=0, le=1440)
    coupon_code: str | None = None


class VerifyIn(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


async def compute_quote(body: QuoteIn):
    snap = await prepare_booking(body.court_id, body.date, body.start_min, body.end_min)
    discount, coupon = 0, None
    if body.coupon_code:
        coupon, discount = await evaluate_coupon(body.coupon_code, snap["gross_amount"])
    return snap, coupon, discount


@router.post("/bookings/quote")
async def quote(body: QuoteIn, user=Depends(require_roles("customer"))):
    snap, coupon, discount = await compute_quote(body)
    return {**snap, "discount": discount, "coupon_code": coupon["code"] if coupon else None,
            "final_amount": snap["gross_amount"] - discount}


async def create_pending_with_order(base: dict, notes: dict):
    client_ = rzp()
    if not client_:
        raise HTTPException(503, "Online payments are not configured yet")
    booking = {**base, "id": new_id(), "code": gen_code(), "status": "pending_payment",
               "hold_expires_at": iso(now_utc() + timedelta(minutes=HOLD_MINUTES)), "created_at": iso(), "updated_at": iso()}
    await db.bookings.insert_one(booking)
    if not await reserve_slots(booking["id"], booking["court_id"], booking["date"], booking["slot_starts"]):
        await db.bookings.update_one({"id": booking["id"]}, {"$set": {"status": "expired", "cancel_reason": "Slot conflict"}})
        raise HTTPException(409, "One or more selected slots were just booked. Please choose another time.")
    amount_paise = int(booking["final_amount"]) * 100
    try:
        order = await run_in_threadpool(client_.order.create, {"amount": amount_paise, "currency": "INR",
                                                               "receipt": booking["code"], "payment_capture": 1, "notes": notes})
    except Exception as e:
        log.error("Razorpay order creation failed: %s", e)
        await db.booking_slots.delete_many({"booking_id": booking["id"]})
        await db.bookings.update_one({"id": booking["id"]}, {"$set": {"status": "expired", "cancel_reason": "Payment order failed"}})
        raise HTTPException(502, "Could not start payment. Please try again.")
    await db.payments.insert_one({"id": new_id(), "booking_id": booking["id"], "booking_code": booking["code"],
                                  "venue_id": booking["venue_id"], "razorpay_order_id": order["id"], "razorpay_payment_id": None,
                                  "amount": booking["final_amount"], "amount_paise": amount_paise, "status": "created",
                                  "method": None, "created_at": iso()})
    booking.pop("_id", None)
    return {"booking": booking, "order": {"id": order["id"], "amount": amount_paise, "currency": "INR", "key_id": rzp_key_id()}}


@router.post("/bookings")
async def create_booking(body: QuoteIn, user=Depends(require_roles("customer"))):
    if not rzp():
        raise HTTPException(503, "Online payments are not configured yet")
    snap, coupon, discount = await compute_quote(body)
    base = {**snap, "user_id": user["id"], "customer_name": user["name"], "customer_mobile": user.get("mobile"),
            "source": "online", "payment_method": "razorpay", "discount": discount,
            "coupon_code": coupon["code"] if coupon else None, "final_amount": snap["gross_amount"] - discount}
    return await create_pending_with_order(base, {"customer": user["id"]})


async def load_booking_for(booking_id: str, user):
    b = await db.bookings.find_one({"id": booking_id}, NO_ID)
    if not b:
        raise HTTPException(404, "Booking not found")
    if user["role"] == "admin":
        return b
    if user["role"] == "owner" and b["venue_id"] in await owner_venue_ids(user):
        return b
    if user["role"] == "customer" and b.get("user_id") == user["id"]:
        return b
    raise HTTPException(404, "Booking not found")


@router.post("/payments/verify")
async def verify_payment(body: VerifyIn, user=Depends(get_current_user)):
    pay = await db.payments.find_one({"razorpay_order_id": body.razorpay_order_id}, NO_ID)
    if not pay:
        raise HTTPException(404, "Payment order not found")
    await load_booking_for(pay["booking_id"], user)
    if not verify_checkout_signature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature):
        raise HTTPException(400, "Payment signature verification failed")
    return await confirm_paid_order(body.razorpay_order_id, body.razorpay_payment_id)


@router.post("/payments/{booking_id}/abandon")
async def abandon_payment(booking_id: str, user=Depends(get_current_user)):
    b = await load_booking_for(booking_id, user)
    res = await db.bookings.update_one({"id": b["id"], "status": "pending_payment"},
                                       {"$set": {"status": "payment_failed", "updated_at": iso()}})
    if res.modified_count:
        await db.booking_slots.delete_many({"booking_id": b["id"]})
        await db.payments.update_many({"booking_id": b["id"], "status": "created"}, {"$set": {"status": "failed"}})
    return {"ok": True}


WEBHOOK_PROCESSING_LEASE_SECONDS = 300


async def claim_webhook_event(event_id: str) -> str:
    now = now_utc()
    try:
        await db.webhook_events.insert_one({
            "event_id": event_id,
            "status": "processing",
            "attempts": 1,
            "received_at": iso(now),
            "processing_started_at": iso(now),
        })
        return "claimed"
    except DuplicateKeyError:
        event = await db.webhook_events.find_one({"event_id": event_id}, NO_ID)
        if event and event.get("status") == "processed":
            return "processed"

    stale_before = iso(now - timedelta(seconds=WEBHOOK_PROCESSING_LEASE_SECONDS))
    result = await db.webhook_events.update_one(
        {
            "event_id": event_id,
            "$or": [
                {"status": "failed"},
                {"status": "processing", "processing_started_at": {"$lt": stale_before}},
            ],
        },
        {
            "$set": {
                "status": "processing",
                "processing_started_at": iso(now),
                "last_error": None,
            },
            "$inc": {"attempts": 1},
        },
    )
    return "claimed" if result.modified_count else "processing"


async def mark_webhook_event(event_id: str, status: str, error: str | None = None):
    update = {"status": status, "updated_at": iso()}
    if status == "processed":
        update["processed_at"] = iso()
    if error:
        update["last_error"] = error[:500]
    await db.webhook_events.update_one({"event_id": event_id}, {"$set": update})


@router.post("/payments/webhook")
async def razorpay_webhook(request: Request):
    body = await request.body()
    if not verify_webhook_signature(body, request.headers.get("x-razorpay-signature", "")):
        raise HTTPException(400, "Invalid webhook signature")
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid webhook payload")
    event_id = request.headers.get("x-razorpay-event-id") or new_id()
    claim = await claim_webhook_event(event_id)
    if claim == "processed":
        return {"status": "duplicate"}
    if claim == "processing":
        raise HTTPException(503, "Webhook event is already being processed")

    event = data.get("event", "")
    payload = data.get("payload", {})
    try:
        if event in ("payment.captured", "order.paid"):
            p = payload.get("payment", {}).get("entity", {})
            if p.get("order_id"):
                await confirm_paid_order(p["order_id"], p["id"])
        elif event == "payment.failed":
            p = payload.get("payment", {}).get("entity", {})
            pay = await db.payments.find_one({"razorpay_order_id": p.get("order_id")}, NO_ID)
            if pay and pay.get("status") != "captured":
                await db.payments.update_one({"id": pay["id"], "status": {"$ne": "captured"}},
                                             {"$set": {"status": "failed", "error": p.get("error_description")}})
                res = await db.bookings.update_one({"id": pay["booking_id"], "status": "pending_payment"},
                                                   {"$set": {"status": "payment_failed"}})
                if res.modified_count:
                    await db.booking_slots.delete_many({"booking_id": pay["booking_id"]})
        elif event.startswith("refund."):
            r = payload.get("refund", {}).get("entity", {})
            status = REFUND_STATUS.get(r.get("status"), "initiated")
            ref = await db.refunds.find_one_and_update({"razorpay_refund_id": r.get("id")}, {"$set": {"status": status, "updated_at": iso()}})
            if ref:
                await db.bookings.update_one({"id": ref["booking_id"]}, {"$set": {"refund_status": status}})
        await mark_webhook_event(event_id, "processed")
    except HTTPException as e:
        log.warning("Webhook %s processing issue: %s", event, e.detail)
        await mark_webhook_event(event_id, "failed", e.detail)
        if e.status_code in (404, 409) or e.status_code >= 500:
            raise HTTPException(503, "Webhook processing should be retried")
        raise
    except Exception as e:
        log.exception("Webhook %s processing failed", event)
        await mark_webhook_event(event_id, "failed", str(e))
        raise HTTPException(500, "Webhook processing failed")
    return {"status": "ok"}


@router.get("/bookings/mine")
async def my_bookings(user=Depends(require_roles("customer"))):
    items = await db.bookings.find({"user_id": user["id"], "status": {"$in": ["confirmed", "cancelled"]}}, NO_ID).sort("start_at", -1).to_list(500)
    now = iso()
    for b in items:
        b["is_upcoming"] = b["status"] == "confirmed" and b["start_at"] > now
    return items


@router.get("/bookings/{booking_id}")
async def booking_detail(booking_id: str, user=Depends(get_current_user)):
    b = await load_booking_for(booking_id, user)
    owner_walkin = user["role"] == "owner" and b.get("source") == "walkin"
    if user["role"] != "customer" and not owner_walkin:
        b.pop("qr_token", None)
    if user["role"] == "owner":
        b.pop("user_id", None)
    start = slot_dt(b["date"], b["start_min"])
    b["can_cancel"] = (user["role"] == "customer" and b["status"] == "confirmed" and not b.get("checked_in_at")
                       and start - now_ist() >= timedelta(hours=CANCEL_CUTOFF_HOURS))
    return b


@router.post("/bookings/{booking_id}/cancel")
async def cancel_booking(booking_id: str, user=Depends(require_roles("customer"))):
    b = await load_booking_for(booking_id, user)
    if b["status"] != "confirmed" or b.get("checked_in_at"):
        raise HTTPException(400, "This booking cannot be cancelled")
    if slot_dt(b["date"], b["start_min"]) - now_ist() < timedelta(hours=CANCEL_CUTOFF_HOURS):
        raise HTTPException(400, f"Cancellations close {CANCEL_CUTOFF_HOURS} hours before the start time")
    return await do_cancel(b, "Cancelled by customer")


async def do_cancel(b, reason):
    res = await db.bookings.update_one({"id": b["id"], "status": "confirmed"},
                                       {"$set": {"status": "cancelled", "cancel_reason": reason, "cancelled_at": iso(), "updated_at": iso()}})
    if not res.modified_count:
        raise HTTPException(400, "Booking already cancelled")
    await db.booking_slots.delete_many({"booking_id": b["id"]})
    if b["payment_method"] == "razorpay":
        await initiate_refund(b, reason)
    return await db.bookings.find_one({"id": b["id"]}, NO_ID)
