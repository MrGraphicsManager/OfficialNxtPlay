from fastapi import APIRouter, HTTPException, Response
from core import db, NO_ID, get_settings, court_price_for, court_slots, today_ist, rzp_key_id, rzp, DATE_RE

router = APIRouter(prefix="/api")


@router.get("/")
async def root():
    return {"app": "NXTPLAY", "ok": True}


@router.get("/meta")
async def meta():
    cities = await db.cities.find({"active": True}, NO_ID).sort("name", 1).to_list(200)
    sports = await db.sports.find({"active": True}, NO_ID).sort("name", 1).to_list(200)
    return {"cities": cities, "sports": sports, "payments_enabled": rzp() is not None, "razorpay_key_id": rzp_key_id(),
            "today": today_ist()}


async def public_venue_query(extra=None):
    s = await get_settings()
    q = {"status": "active", **(extra or {})}
    if not s.get("show_demo", True):
        q["is_demo"] = {"$ne": True}
    return q


async def venue_card(v, sport_id=None):
    courts = await db.courts.find({"venue_id": v["id"], "active": True}, NO_ID).to_list(100)
    today = today_ist()
    relevant = [c for c in courts if not sport_id or c["sport_id"] == sport_id]
    city = await db.cities.find_one({"id": v["city_id"]}, NO_ID)
    sports = await db.sports.find({"id": {"$in": list({c["sport_id"] for c in courts})}}, NO_ID).to_list(50)
    prices = [(court_price_for(c, today), c["slot_minutes"]) for c in relevant]
    start = min(prices, key=lambda p: p[0]) if prices else None
    return {"id": v["id"], "name": v["name"], "address": v.get("address", ""), "city": city["name"] if city else "",
            "sports": [s["name"] for s in sports], "image_ids": v.get("image_ids", []), "is_demo": v.get("is_demo", False),
            "starting_price": start[0] if start else None, "starting_slot_minutes": start[1] if start else None,
            "court_count": len(courts)}


@router.get("/venues")
async def list_venues(city_id: str | None = None, sport_id: str | None = None):
    extra = {}
    if city_id:
        extra["city_id"] = city_id
    q = await public_venue_query(extra)
    venues = await db.venues.find(q, NO_ID).sort("created_at", -1).to_list(200)
    out = []
    for v in venues:
        if sport_id and not await db.courts.find_one({"venue_id": v["id"], "sport_id": sport_id, "active": True}):
            continue
        out.append(await venue_card(v, sport_id))
    return out


async def get_public_venue(venue_id):
    v = await db.venues.find_one(await public_venue_query({"id": venue_id}), NO_ID)
    if not v:
        raise HTTPException(404, "Venue not found")
    return v


@router.get("/venues/{venue_id}")
async def venue_detail(venue_id: str):
    v = await get_public_venue(venue_id)
    courts = await db.courts.find({"venue_id": venue_id, "active": True}, NO_ID).sort("name", 1).to_list(100)
    sports = {s["id"]: s["name"] async for s in db.sports.find({}, NO_ID)}
    city = await db.cities.find_one({"id": v["city_id"]}, NO_ID)
    today = today_ist()
    return {"id": v["id"], "name": v["name"], "address": v.get("address", ""), "city": city["name"] if city else "",
            "open_time": v["open_time"], "close_time": v["close_time"], "rules": v.get("rules", ""),
            "image_ids": v.get("image_ids", []), "is_demo": v.get("is_demo", False),
            "courts": [{"id": c["id"], "name": c["name"], "sport_id": c["sport_id"], "sport_name": sports.get(c["sport_id"], ""),
                        "slot_minutes": c["slot_minutes"], "price": court_price_for(c, today)} for c in courts]}


@router.get("/venues/{venue_id}/slots")
async def venue_slots(venue_id: str, date: str):
    if not DATE_RE.match(date):
        raise HTTPException(400, "Invalid date")
    v = await get_public_venue(venue_id)
    courts = await db.courts.find({"venue_id": venue_id, "active": True}, NO_ID).sort("name", 1).to_list(100)
    return [{"court_id": c["id"], "slots": await court_slots(v, c, date)} for c in courts]


@router.get("/images/{image_id}")
async def get_image(image_id: str):
    img = await db.images.find_one({"id": image_id})
    if not img:
        raise HTTPException(404, "Image not found")
    return Response(content=img["data"], media_type=img["content_type"], headers={"Cache-Control": "public, max-age=86400"})
