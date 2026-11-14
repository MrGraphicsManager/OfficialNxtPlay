from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import (db, NO_ID, iso, new_id, gen_code, require_roles, owner_venue_ids, court_slots, court_price_for, today_ist,
                  prepare_booking, reserve_slots, finalize_booking_confirmation, DATE_RE, hm_to_min, TIME_RE)
from booking_routes import create_pending_with_order
from subscription_routes import require_operational_subscription

router = APIRouter(prefix="/api/owner")
owner_dep = require_roles("owner")


class CheckinIn(BaseModel):
    token: str | None = None
    code: str | None = None


class WalkinIn(BaseModel):
    court_id: str
    date: str
    start_time: str
    end_time: str
    customer_name: str = Field(min_length=2, max_length=80)
    customer_mobile: str = Field(min_length=10, max_length=15)
    payment_method: str = Field(pattern="^(cash|online)$")
    custom_price: int | None = Field(default=None, ge=0)


class DecisionIn(BaseModel):
    approve: bool


async def ensure_venue(user, venue_id):
    if user.get("must_change_password"):
        raise HTTPException(403, "Change your temporary password before using owner operations")
    await require_operational_subscription(user["id"])
    ids = await owner_venue_ids(user)
    if venue_id not in ids:
        raise HTTPException(404, "Venue not found")
    return await db.venues.find_one({"id": venue_id}, NO_ID)


@router.get("/venues")
async def my_venues(user=Depends(owner_dep)):
    venues = await db.venues.find({"owner_ids": user["id"]}, NO_ID).to_list(50)
    sports = {s["id"]: s["name"] async for s in db.sports.find({}, NO_ID)}
    today = today_ist()
    for v in venues:
        v.pop("owner_ids", None)
        courts = await db.courts.find({"venue_id": v["id"]}, NO_ID).sort("name", 1).to_list(100)
        v["courts"] = [{**c, "sport_name": sports.get(c["sport_id"], ""), "current_price": court_price_for(c, today)} for c in courts]
    return venues


@router.get("/overview")
async def overview(venue_id: str, user=Depends(owner_dep)):
    v = await ensure_venue(user, venue_id)
    today = today_ist()
    todays = await db.bookings.find({"venue_id": venue_id, "date": today, "status": "confirmed"}, NO_ID).to_list(1000)
    upcoming = await db.bookings.count_documents({"venue_id": venue_id, "status": "confirmed", "start_at": {"$gt": iso()}})
    available = occupied = 0
    for c in await db.courts.find({"venue_id": venue_id, "active": True}, NO_ID).to_list(100):
        for s in await court_slots(v, c, today):
            if s["status"] == "booked":
                occupied += 1
            elif s["status"] == "available":
                available += 1
    pending = await db.price_requests.count_documents({"venue_id": venue_id, "status": "pending"})
    return {"todays_bookings": len(todays), "upcoming_bookings": upcoming, "available_slots": available,
            "occupied_slots": occupied, "todays_revenue": sum(b["final_amount"] for b in todays),
            "todays_cash": sum(b["final_amount"] for b in todays if b["payment_method"] == "cash"),
            "pending_price_approvals": pending}


@router.get("/slots")
async def owner_slots(venue_id: str, date: str, user=Depends(owner_dep)):
    v = await ensure_venue(user, venue_id)
    if not DATE_RE.match(date):
        raise HTTPException(400, "Invalid date")
    courts = await db.courts.find({"venue_id": venue_id, "active": True}, NO_ID).sort("name", 1).to_list(100)
    return [{"court_id": c["id"], "slots": await court_slots(v, c, date)} for c in courts]


OWNER_HIDE = {"_id": 0, "qr_token": 0, "user_id": 0}


@router.get("/bookings")
async def owner_bookings(venue_id: str, date: str | None = None, court_id: str | None = None, user=Depends(owner_dep)):
    await ensure_venue(user, venue_id)
    q = {"venue_id": venue_id, "status": {"$in": ["confirmed", "cancelled"]}}
    if date:
        q["date"] = date
    if court_id:
        q["court_id"] = court_id
    return await db.bookings.find(q, OWNER_HIDE).sort([("date", -1), ("start_min", 1)]).to_list(1000)


@router.post("/checkin")
async def checkin(body: CheckinIn, user=Depends(owner_dep)):
    if body.token:
        b = await db.bookings.find_one({"qr_token": body.token.strip()}, NO_ID)
    elif body.code:
        b = await db.bookings.find_one({"code": body.code.strip().upper()}, NO_ID)
    else:
        raise HTTPException(400, "Provide a QR token or booking code")
    if not b or b["venue_id"] not in await owner_venue_ids(user):
        return {"valid": False, "reason": "Booking not found for your venue"}
    summary = {k: b.get(k) for k in ("id", "code", "customer_name", "venue_name", "court_name", "sport_name", "date",
                                     "start_time", "end_time", "final_amount", "status", "checked_in_at", "payment_method")}
    if b["status"] != "confirmed":
        return {"valid": False, "reason": f"Booking is {b['status'].replace('_', ' ')}", "booking": summary}
    if b.get("checked_in_at"):
        return {"valid": False, "reason": "Already checked in", "booking": summary}
    res = await db.bookings.update_one({"id": b["id"], "status": "confirmed", "checked_in_at": None},
                                       {"$set": {"checked_in_at": iso(), "checked_in_by": user["id"]}})
    if not res.modified_count:
        return {"valid": False, "reason": "Already checked in", "booking": summary}
    await db.qr_checkins.insert_one({"id": new_id(), "booking_id": b["id"], "owner_id": user["id"], "created_at": iso()})
    summary["checked_in_at"] = iso()
    return {"valid": True, "reason": "Checked in", "booking": summary}


@router.post("/walkin")
async def walkin(body: WalkinIn, user=Depends(owner_dep)):
    court = await db.courts.find_one({"id": body.court_id}, NO_ID)
    if not court:
        raise HTTPException(404, "Court not found")
    await ensure_venue(user, court["venue_id"])
    if not TIME_RE.match(body.start_time) or not (TIME_RE.match(body.end_time) or body.end_time == "24:00"):
        raise HTTPException(400, "Invalid time")
    snap = await prepare_booking(body.court_id, body.date, hm_to_min(body.start_time), hm_to_min(body.end_time), require_active=False)
    final = snap["gross_amount"]
    if body.payment_method == "cash" and body.custom_price is not None:
        final = body.custom_price
    base = {**snap, "user_id": None, "customer_name": body.customer_name.strip(), "customer_mobile": body.customer_mobile.strip(),
            "source": "walkin", "created_by": user["id"], "discount": 0, "coupon_code": None, "final_amount": final,
            "price_overridden": final != snap["gross_amount"]}
    if body.payment_method == "online":
        if final < 1:
            raise HTTPException(400, "Amount must be at least ₹1")
        return await create_pending_with_order({**base, "payment_method": "razorpay"}, {"walkin_by": user["id"]})
    booking = {**base, "payment_method": "cash", "id": new_id(), "code": gen_code(), "status": "pending_cash",
               "created_at": iso(), "updated_at": iso(), "checked_in_at": None}
    await db.bookings.insert_one(booking)
    if not await reserve_slots(booking["id"], booking["court_id"], booking["date"], booking["slot_starts"]):
        await db.bookings.delete_one({"id": booking["id"]})
        raise HTTPException(409, "One or more selected slots are already booked")
    confirmed = await finalize_booking_confirmation(booking, {})
    confirmed.pop("qr_token", None)
    return {"booking": confirmed}


@router.get("/price-requests")
async def price_requests(venue_id: str, user=Depends(owner_dep)):
    await ensure_venue(user, venue_id)
    return await db.price_requests.find({"venue_id": venue_id}, NO_ID).sort("created_at", -1).to_list(200)


@router.post("/price-requests/{req_id}/decision")
async def decide(req_id: str, body: DecisionIn, user=Depends(owner_dep)):
    pr = await db.price_requests.find_one({"id": req_id}, NO_ID)
    if not pr or pr["venue_id"] not in await owner_venue_ids(user):
        raise HTTPException(404, "Request not found")
    status = "approved" if body.approve else "rejected"
    res = await db.price_requests.update_one({"id": req_id, "status": "pending"},
                                             {"$set": {"status": status, "decided_at": iso(), "decided_by": user["id"]}})
    if not res.modified_count:
        raise HTTPException(400, "Request already decided")
    if body.approve:
        await db.courts.update_one({"id": pr["court_id"]}, {"$push": {"prices": {
            "price": pr["proposed_price"], "effective_from": pr["effective_date"], "approved_at": iso(), "request_id": req_id}}})
    return await db.price_requests.find_one({"id": req_id}, NO_ID)
