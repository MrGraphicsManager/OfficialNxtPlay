import re
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel, EmailStr, Field

from core import (db, NO_ID, USER_PROJ, iso, new_id, hash_pw, require_roles, court_price_for, today_ist, get_settings, audit,
                  call_refund_api, rzp, DATE_RE, TIME_RE)
from booking_routes import do_cancel
from starlette.concurrency import run_in_threadpool
from core import REFUND_STATUS

router = APIRouter(prefix="/api/admin")
admin_dep = require_roles("admin")


class NameIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    state: str | None = None
    active: bool = True


class OwnerIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    mobile: str = Field(min_length=10, max_length=15)
    password: str = Field(min_length=8, max_length=128)


class OwnerPatch(BaseModel):
    name: str | None = None
    mobile: str | None = None
    active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


class CourtIn(BaseModel):
    sport_id: str
    name: str = Field(min_length=1, max_length=40)
    slot_minutes: int = Field(ge=30, le=60)
    price: int = Field(ge=1)


class CourtPatch(BaseModel):
    name: str | None = None
    slot_minutes: int | None = None
    active: bool | None = None


class VenueCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    owner_id: str | None = None
    owner: OwnerIn | None = None
    city_id: str
    address: str = Field(min_length=3, max_length=300)
    open_time: str
    close_time: str
    rules: str = ""
    courts: list[CourtIn] = Field(min_length=1)
    image_ids: list[str] = []
    status: str = "active"


class VenuePatch(BaseModel):
    name: str | None = None
    address: str | None = None
    city_id: str | None = None
    open_time: str | None = None
    close_time: str | None = None
    rules: str | None = None
    status: str | None = Field(default=None, pattern="^(active|inactive)$")
    image_ids: list[str] | None = None
    owner_ids: list[str] | None = None
    is_demo: bool | None = None


class PriceReqIn(BaseModel):
    court_id: str
    proposed_price: int = Field(ge=1)
    effective_date: str


class CouponIn(BaseModel):
    code: str = Field(min_length=3, max_length=20)
    discount_type: str = Field(pattern="^(percent|flat)$")
    discount_value: int = Field(ge=1)
    max_discount: int | None = Field(default=None, ge=0)
    min_amount: int = Field(default=0, ge=0)
    start_date: str
    expiry_date: str
    usage_limit: int = Field(default=0, ge=0)
    active: bool = True


class SettingsIn(BaseModel):
    commission_pct: float = Field(ge=0, le=50)
    show_demo: bool


class SettleIn(BaseModel):
    venue_id: str
    reference: str = Field(min_length=2, max_length=100)
    note: str = ""


def check_times(o, c):
    if not TIME_RE.match(o) or not TIME_RE.match(c):
        raise HTTPException(400, "Times must be HH:MM")
    if c != "00:00" and c <= o:
        raise HTTPException(400, "Closing time must be after opening time")


async def create_owner_account(o: OwnerIn):
    email = o.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "An account with this email already exists")
    user = {"id": new_id(), "name": o.name.strip(), "email": email, "mobile": o.mobile.strip(), "role": "owner",
            "active": True, "must_change_password": True, "password_hash": hash_pw(o.password), "created_at": iso()}
    await db.users.insert_one(user)
    return user["id"]


# ---------- Overview ----------
@router.get("/overview")
async def overview(user=Depends(admin_dep)):
    captured = await db.payments.find({"status": "captured"}, NO_ID).to_list(100000)
    return {"venues": await db.venues.count_documents({}), "active_venues": await db.venues.count_documents({"status": "active"}),
            "owners": await db.users.count_documents({"role": "owner"}), "customers": await db.users.count_documents({"role": "customer"}),
            "confirmed_bookings": await db.bookings.count_documents({"status": "confirmed"}),
            "todays_bookings": await db.bookings.count_documents({"status": "confirmed", "date": today_ist()}),
            "online_collected": sum(p["amount"] for p in captured),
            "failed_refunds": await db.refunds.count_documents({"status": "failed"}),
            "pending_price_requests": await db.price_requests.count_documents({"status": "pending"}),
            "payments_enabled": rzp() is not None}


# ---------- Cities & sports ----------
def make_crud(coll: str):
    @router.get(f"/{coll}")
    async def list_items(user=Depends(admin_dep)):
        items = await db[coll].find({}, {"_id": 0}).sort("name", 1).to_list(500)
        return items

    @router.post(f"/{coll}")
    async def create_item(body: NameIn, user=Depends(admin_dep)):
        if await db[coll].find_one({"name": {"$regex": f"^{re.escape(body.name.strip())}$", "$options": "i"}}):
            raise HTTPException(400, "Already exists")
        doc = {"id": new_id(), "name": body.name.strip(), "active": body.active, "created_at": iso()}
        if coll == "cities":
            doc["state"] = body.state or ""
        await db[coll].insert_one(doc)
        doc.pop("_id", None)
        return doc

    @router.patch(f"/{coll}/{{item_id}}")
    async def update_item(item_id: str, body: NameIn, user=Depends(admin_dep)):
        upd = {"name": body.name.strip(), "active": body.active}
        if coll == "cities":
            upd["state"] = body.state or ""
        res = await db[coll].update_one({"id": item_id}, {"$set": upd})
        if not res.matched_count:
            raise HTTPException(404, "Not found")
        item = await db[coll].find_one({"id": item_id}, {"_id": 0})
        return item


make_crud("cities")
make_crud("sports")


# ---------- Images ----------
@router.post("/images")
async def upload_image(file: UploadFile = File(...), user=Depends(admin_dep)):
    if file.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(400, "Only JPG, PNG or WEBP images")
    data = await file.read()
    if len(data) > 3 * 1024 * 1024:
        raise HTTPException(400, "Image must be under 3MB")
    img_id = new_id()
    await db.images.insert_one({"id": img_id, "data": data, "content_type": file.content_type, "created_at": iso()})
    return {"id": img_id}


# ---------- Owners ----------
@router.get("/owners")
async def list_owners(user=Depends(admin_dep)):
    owners = await db.users.find({"role": "owner"}, USER_PROJ).sort("created_at", -1).to_list(500)
    for o in owners:
        o["venues"] = [v["name"] async for v in db.venues.find({"owner_ids": o["id"]}, {"_id": 0, "name": 1})]
    return owners


@router.post("/owners")
async def create_owner(body: OwnerIn, user=Depends(admin_dep)):
    oid = await create_owner_account(body)
    owner = await db.users.find_one({"id": oid}, USER_PROJ)
    await audit(user["id"], "owner.created", "owner", oid)
    return owner


@router.patch("/owners/{owner_id}")
async def update_owner(owner_id: str, body: OwnerPatch, user=Depends(admin_dep)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None and k != "password"}
    if body.password:
        upd["password_hash"] = hash_pw(body.password)
        upd["must_change_password"] = True
    res = await db.users.update_one({"id": owner_id, "role": "owner"}, {"$set": upd})
    if not res.matched_count:
        raise HTTPException(404, "Owner not found")
    owner = await db.users.find_one({"id": owner_id}, USER_PROJ)
    await audit(user["id"], "owner.updated", "owner", owner_id, {"fields": sorted(upd)})
    return owner


# ---------- Venues & courts ----------
@router.get("/venues")
async def list_venues(user=Depends(admin_dep)):
    venues = await db.venues.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    cities = {c["id"]: c["name"] async for c in db.cities.find({}, NO_ID)}
    for v in venues:
        v["city"] = cities.get(v["city_id"], "")
        v["court_count"] = await db.courts.count_documents({"venue_id": v["id"]})
        v["owners"] = [u["name"] async for u in db.users.find({"id": {"$in": v.get("owner_ids", [])}}, {"_id": 0, "name": 1})]
    return venues


@router.post("/venues")
async def create_venue(body: VenueCreate, user=Depends(admin_dep)):
    check_times(body.open_time, body.close_time)
    if not await db.cities.find_one({"id": body.city_id}):
        raise HTTPException(400, "City not found")
    sport_ids = {s["id"] async for s in db.sports.find({}, NO_ID)}
    for c in body.courts:
        if c.sport_id not in sport_ids or c.slot_minutes not in (30, 60):
            raise HTTPException(400, "Invalid court configuration")
    if body.owner_id:
        if not await db.users.find_one({"id": body.owner_id, "role": "owner"}):
            raise HTTPException(400, "Owner not found")
        owner_id = body.owner_id
    elif body.owner:
        owner_id = await create_owner_account(body.owner)
    else:
        raise HTTPException(400, "Owner details are required")
    venue = {"id": new_id(), "name": body.name.strip(), "city_id": body.city_id, "address": body.address.strip(),
             "open_time": body.open_time, "close_time": body.close_time, "rules": body.rules, "image_ids": body.image_ids,
             "status": body.status if body.status in ("active", "inactive") else "active", "owner_ids": [owner_id],
             "is_demo": False, "created_at": iso()}
    await db.venues.insert_one(venue)
    for c in body.courts:
        await db.courts.insert_one({"id": new_id(), "venue_id": venue["id"], "sport_id": c.sport_id, "name": c.name.strip(),
                                    "slot_minutes": c.slot_minutes, "active": True, "created_at": iso(),
                                    "prices": [{"price": c.price, "effective_from": "2000-01-01", "approved_at": iso()}]})
    venue.pop("_id", None)
    return venue


@router.get("/venues/{venue_id}")
async def get_venue(venue_id: str, user=Depends(admin_dep)):
    v = await db.venues.find_one({"id": venue_id}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Venue not found")
    today = today_ist()
    courts = await db.courts.find({"venue_id": venue_id}, NO_ID).sort("name", 1).to_list(100)
    v["courts"] = [{**c, "current_price": court_price_for(c, today)} for c in courts]
    return v


@router.patch("/venues/{venue_id}")
async def update_venue(venue_id: str, body: VenuePatch, user=Depends(admin_dep)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    v = await db.venues.find_one({"id": venue_id}, NO_ID)
    if not v:
        raise HTTPException(404, "Venue not found")
    if "open_time" in upd or "close_time" in upd:
        check_times(upd.get("open_time", v["open_time"]), upd.get("close_time", v["close_time"]))
    if "owner_ids" in upd:
        n = await db.users.count_documents({"id": {"$in": upd["owner_ids"]}, "role": "owner"})
        if n != len(set(upd["owner_ids"])):
            raise HTTPException(400, "Invalid owner list")
    await db.venues.update_one({"id": venue_id}, {"$set": upd})
    return await get_venue(venue_id, user)


@router.post("/venues/{venue_id}/courts")
async def add_court(venue_id: str, body: CourtIn, user=Depends(admin_dep)):
    if not await db.venues.find_one({"id": venue_id}):
        raise HTTPException(404, "Venue not found")
    if body.slot_minutes not in (30, 60) or not await db.sports.find_one({"id": body.sport_id}):
        raise HTTPException(400, "Invalid court configuration")
    await db.courts.insert_one({"id": new_id(), "venue_id": venue_id, "sport_id": body.sport_id, "name": body.name.strip(),
                                "slot_minutes": body.slot_minutes, "active": True, "created_at": iso(),
                                "prices": [{"price": body.price, "effective_from": "2000-01-01", "approved_at": iso()}]})
    return await get_venue(venue_id, user)


@router.patch("/courts/{court_id}")
async def update_court(court_id: str, body: CourtPatch, user=Depends(admin_dep)):
    c = await db.courts.find_one({"id": court_id}, NO_ID)
    if not c:
        raise HTTPException(404, "Court not found")
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "slot_minutes" in upd and upd["slot_minutes"] != c["slot_minutes"]:
        if upd["slot_minutes"] not in (30, 60):
            raise HTTPException(400, "Slot duration must be 30 or 60")
        if await db.bookings.find_one({"court_id": court_id, "status": {"$in": ["confirmed", "pending_payment"]}, "start_at": {"$gt": iso()}}):
            raise HTTPException(400, "Court has upcoming bookings; slot duration cannot change now")
    await db.courts.update_one({"id": court_id}, {"$set": upd})
    return await get_venue(c["venue_id"], user)


# ---------- Bookings, payments, refunds ----------
@router.get("/bookings")
async def all_bookings(status: str | None = None, venue_id: str | None = None, date: str | None = None, user=Depends(admin_dep)):
    q = {"status": {"$in": ["confirmed", "cancelled", "payment_failed", "expired"]}}
    if status:
        q["status"] = status
    if venue_id:
        q["venue_id"] = venue_id
    if date:
        q["date"] = date
    items = await db.bookings.find(q, {"_id": 0, "qr_token": 0}).sort("created_at", -1).to_list(1000)
    return items


@router.post("/bookings/{booking_id}/cancel")
async def admin_cancel(booking_id: str, user=Depends(admin_dep)):
    b = await db.bookings.find_one({"id": booking_id}, NO_ID)
    if not b or b["status"] != "confirmed":
        raise HTTPException(400, "Only confirmed bookings can be cancelled")
    return await do_cancel(b, "Cancelled by NXTPLAY admin")


@router.get("/payments")
async def payments(user=Depends(admin_dep)):
    items = await db.payments.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return items


@router.get("/refunds")
async def refunds(user=Depends(admin_dep)):
    items = await db.refunds.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return items


@router.post("/refunds/{refund_id}/refresh")
async def refresh_refund(refund_id: str, user=Depends(admin_dep)):
    r = await db.refunds.find_one({"id": refund_id}, NO_ID)
    if not r:
        raise HTTPException(404, "Refund not found")
    client_ = rzp()
    if r.get("razorpay_refund_id") and client_:
        data = await run_in_threadpool(client_.refund.fetch, r["razorpay_refund_id"])
        status = REFUND_STATUS.get(data.get("status"), "initiated")
        await db.refunds.update_one({"id": refund_id}, {"$set": {"status": status, "updated_at": iso()}})
        await db.bookings.update_one({"id": r["booking_id"]}, {"$set": {"refund_status": status}})
    refund = await db.refunds.find_one({"id": refund_id}, {"_id": 0})
    return refund


@router.post("/refunds/{refund_id}/retry")
async def retry_refund(refund_id: str, user=Depends(admin_dep)):
    r = await db.refunds.find_one({"id": refund_id, "status": "failed", "razorpay_refund_id": None}, NO_ID)
    if not r:
        raise HTTPException(400, "Only failed refunds that never reached Razorpay can be retried")
    return await call_refund_api(r)


# ---------- Pricing ----------
@router.get("/price-requests")
async def list_price_requests(user=Depends(admin_dep)):
    items = await db.price_requests.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items


@router.post("/price-requests")
async def propose_price(body: PriceReqIn, user=Depends(admin_dep)):
    if not DATE_RE.match(body.effective_date) or body.effective_date < today_ist():
        raise HTTPException(400, "Effective date must be today or later")
    c = await db.courts.find_one({"id": body.court_id}, NO_ID)
    if not c:
        raise HTTPException(404, "Court not found")
    if await db.price_requests.find_one({"court_id": body.court_id, "status": "pending"}):
        raise HTTPException(400, "This court already has a pending proposal")
    v = await db.venues.find_one({"id": c["venue_id"]}, NO_ID)
    doc = {"id": new_id(), "court_id": c["id"], "court_name": c["name"], "venue_id": v["id"], "venue_name": v["name"],
           "slot_minutes": c["slot_minutes"], "current_price": court_price_for(c, today_ist()), "proposed_price": body.proposed_price,
           "effective_date": body.effective_date, "status": "pending", "created_by": user["id"], "created_at": iso()}
    await db.price_requests.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ---------- Coupons ----------
@router.get("/coupons")
async def list_coupons(user=Depends(admin_dep)):
    items = await db.coupons.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items


def validate_coupon_body(body: CouponIn):
    if not DATE_RE.match(body.start_date) or not DATE_RE.match(body.expiry_date) or body.expiry_date < body.start_date:
        raise HTTPException(400, "Invalid date range")
    if body.discount_type == "percent" and body.discount_value > 100:
        raise HTTPException(400, "Percent discount cannot exceed 100")
    if not re.match(r"^[A-Za-z0-9_-]+$", body.code):
        raise HTTPException(400, "Code may only contain letters, numbers, - and _")


@router.post("/coupons")
async def create_coupon(body: CouponIn, user=Depends(admin_dep)):
    validate_coupon_body(body)
    code = body.code.upper()
    if await db.coupons.find_one({"code": code}):
        raise HTTPException(400, "Coupon code already exists")
    doc = {**body.model_dump(), "code": code, "id": new_id(), "used_count": 0, "created_at": iso()}
    await db.coupons.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/coupons/{coupon_id}")
async def update_coupon(coupon_id: str, body: CouponIn, user=Depends(admin_dep)):
    validate_coupon_body(body)
    upd = body.model_dump()
    upd.pop("code")
    res = await db.coupons.update_one({"id": coupon_id}, {"$set": upd})
    if not res.matched_count:
        raise HTTPException(404, "Coupon not found")
    coupon = await db.coupons.find_one({"id": coupon_id}, {"_id": 0})
    return coupon


# ---------- Settings ----------
@router.get("/settings")
async def read_settings(user=Depends(admin_dep)):
    return await get_settings()


@router.put("/settings")
async def write_settings(body: SettingsIn, user=Depends(admin_dep)):
    await db.settings.update_one({"id": "global"}, {"$set": body.model_dump()}, upsert=True)
    return await get_settings()


# ---------- Finance ----------
@router.get("/finance")
async def finance(user=Depends(admin_dep)):
    online = await db.bookings.find({"payment_method": "razorpay", "payment_id": {"$exists": True}}, NO_ID).sort("date", -1).to_list(100000)
    refunds = {r["booking_id"]: r async for r in db.refunds.find({}, NO_ID)}
    cash = await db.bookings.find({"payment_method": "cash", "status": "confirmed"}, NO_ID).to_list(100000)
    venues = {v["id"]: v["name"] async for v in db.venues.find({}, NO_ID)}
    settlements = await db.settlements.find({}, NO_ID).sort("created_at", -1).to_list(1000)
    ledger, per_venue = [], {}
    for b in online:
        r = refunds.get(b["id"])
        refunded = r["amount"] if r and r["status"] == "processed" else 0
        refund_open = bool(r and r["status"] != "processed")
        net = b["final_amount"] - refunded
        fee = 0 if refund_open else round(net * b.get("commission_pct", 0) / 100)
        payable = 0 if refund_open else net - fee
        row = {"booking_id": b["id"], "booking_code": b["code"], "venue_id": b["venue_id"], "venue_name": venues.get(b["venue_id"], b["venue_name"]),
               "date": b["date"], "status": b["status"], "gross_amount": b["gross_amount"], "discount": b.get("discount", 0),
               "paid": b["final_amount"], "refund": refunded, "refund_status": r["status"] if r else None, "platform_fee": fee,
               "net_venue_payable": payable, "settlement_status": b.get("settlement_status", "unsettled"),
               "settlement_date": b.get("settlement_date")}
        ledger.append(row)
        pv = per_venue.setdefault(b["venue_id"], {"venue_id": b["venue_id"], "venue_name": row["venue_name"], "collected": 0,
                                                  "refunded": 0, "platform_fee": 0, "payable": 0, "settled": 0, "outstanding": 0, "cash_total": 0})
        pv["collected"] += b["final_amount"]
        pv["refunded"] += refunded
        pv["platform_fee"] += fee
        pv["payable"] += payable
        if row["settlement_status"] == "settled":
            pv["settled"] += payable
        elif not refund_open:
            pv["outstanding"] += payable
    for b in cash:
        pv = per_venue.setdefault(b["venue_id"], {"venue_id": b["venue_id"], "venue_name": venues.get(b["venue_id"], b["venue_name"]),
                                                  "collected": 0, "refunded": 0, "platform_fee": 0, "payable": 0, "settled": 0,
                                                  "outstanding": 0, "cash_total": 0})
        pv["cash_total"] += b["final_amount"]
    totals = {k: sum(v[k] for v in per_venue.values()) for k in ("collected", "refunded", "platform_fee", "payable", "settled", "outstanding", "cash_total")}
    s = await get_settings()
    return {"totals": totals, "venues": list(per_venue.values()), "ledger": ledger, "settlements": settlements,
            "commission_pct": s.get("commission_pct", 0)}


@router.post("/settlements")
async def record_settlement(body: SettleIn, user=Depends(admin_dep)):
    fin = await finance(user)
    rows = [r for r in fin["ledger"] if r["venue_id"] == body.venue_id and r["settlement_status"] == "unsettled"
            and r["net_venue_payable"] > 0 and r["refund_status"] in (None, "processed")]
    if not rows:
        raise HTTPException(400, "Nothing outstanding for this venue")
    sid = new_id()
    amount = sum(r["net_venue_payable"] for r in rows)
    doc = {"id": sid, "venue_id": body.venue_id, "venue_name": rows[0]["venue_name"], "amount": amount, "booking_count": len(rows),
           "reference": body.reference, "note": body.note, "created_by": user["id"], "created_at": iso()}
    await db.settlements.insert_one(doc)
    await db.bookings.update_many({"id": {"$in": [r["booking_id"] for r in rows]}},
                                  {"$set": {"settlement_status": "settled", "settlement_id": sid, "settlement_date": iso()}})
    doc.pop("_id", None)
    return doc
