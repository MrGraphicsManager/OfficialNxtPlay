# NXTPLAY backend regression: auth, roles, venues, courts, walk-in, check-in, pricing, coupons, cancel cutoff, finance, settings
# All tests are module-level functions sharing state sequentially (xdist loadscope pins module to one worker).
import os
import uuid
import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
import requests
from dotenv import dotenv_values

FE_ENV = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or FE_ENV["REACT_APP_BACKEND_URL"]).rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = {"email": "nxtplayindia@gmail.com", "password": "Nxp-Admin-IQYxyQ1CvCW4"}
DEMO_OWNER = {"email": "demo.owner@nxtplay.dev", "password": "Nxp-Owner-GmFd9JmYSG5s"}
IST = ZoneInfo("Asia/Kolkata")
UID = uuid.uuid4().hex[:6].upper()
S = {}  # shared state


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


def mongo():
    from pymongo import MongoClient
    env = dotenv_values(Path("/app/backend/.env"))
    return MongoClient(env["MONGO_URL"])[env["DB_NAME"]]


def today():
    return datetime.now(IST).strftime("%Y-%m-%d")


def plus_days(n):
    return (datetime.now(IST) + timedelta(days=n)).strftime("%Y-%m-%d")


# ---------- Health / meta ----------
def test_health_and_meta():
    r = requests.get(f"{API}/")
    assert r.status_code == 200 and r.json()["ok"] is True
    m = requests.get(f"{API}/meta").json()
    assert m["payments_enabled"] is False
    S["city"] = next(c for c in m["cities"] if c["name"] == "Navsari")["id"]
    S["sports"] = {s["name"]: s["id"] for s in m["sports"]}
    assert "Box Cricket" in S["sports"] and "Pickleball" in S["sports"]


# ---------- Auth ----------
def test_register_duplicate_login_me():
    email = f"test_cust_{UID.lower()}@example.com"
    body = {"name": "TEST_Customer", "email": email, "password": "TestPass123", "age": 25}
    r = requests.post(f"{API}/auth/register", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "customer" and "password_hash" not in r.json()["user"]
    assert requests.post(f"{API}/auth/register", json=body).status_code == 400
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": "TestPass123"})
    assert r.status_code == 200
    S["cust_tok"] = r.json()["token"]
    S["cust_id"] = r.json()["user"]["id"]
    me = requests.get(f"{API}/auth/me", headers=H(S["cust_tok"]))
    assert me.status_code == 200 and me.json()["email"] == email
    assert requests.post(f"{API}/auth/login", json={"email": email, "password": "wrongpass1"}).status_code == 401
    adm = requests.post(f"{API}/auth/login", json=ADMIN)
    assert adm.status_code == 200 and adm.json()["user"]["role"] == "admin"
    S["admin_tok"] = adm.json()["token"]
    own = requests.post(f"{API}/auth/login", json=DEMO_OWNER)
    assert own.status_code == 200 and own.json()["user"]["role"] == "owner"
    S["demo_owner_tok"] = own.json()["token"]


def test_role_protection():
    for path in ("/admin/overview", "/admin/venues", "/owner/venues"):
        assert requests.get(f"{API}{path}").status_code == 401, path
        assert requests.get(f"{API}{path}", headers=H(S["cust_tok"])).status_code == 403, path
    assert requests.get(f"{API}/admin/overview", headers=H(S["demo_owner_tok"])).status_code == 403


# ---------- Admin venue creation ----------
def test_admin_overview_and_create_venue():
    ov = requests.get(f"{API}/admin/overview", headers=H(S["admin_tok"])).json()
    assert ov["payments_enabled"] is False
    S["owner_email"] = f"test_owner_{UID.lower()}@example.com"
    body = {"name": f"TEST_Venue_{UID}", "city_id": S["city"], "address": "TEST address Navsari",
            "open_time": "06:00", "close_time": "23:00", "rules": "TEST rules",
            "owner": {"name": "TEST_Owner", "email": S["owner_email"], "mobile": "9876543210", "password": "OwnerPass123"},
            "courts": [{"sport_id": S["sports"]["Box Cricket"], "name": "TEST Turf", "slot_minutes": 60, "price": 800}],
            "status": "active"}
    r = requests.post(f"{API}/admin/venues", json=body, headers=H(S["admin_tok"]))
    assert r.status_code == 200, r.text
    S["venue"] = r.json()["id"]
    # duplicate owner email rejected
    body2 = {**body, "name": "TEST_dupe"}
    assert requests.post(f"{API}/admin/venues", json=body2, headers=H(S["admin_tok"])).status_code == 400
    vs = requests.get(f"{API}/admin/venues", headers=H(S["admin_tok"])).json()
    assert any(v["id"] == S["venue"] for v in vs)
    pub = requests.get(f"{API}/venues", params={"city_id": S["city"], "sport_id": S["sports"]["Box Cricket"]}).json()
    assert any(v["id"] == S["venue"] for v in pub)
    det = requests.get(f"{API}/venues/{S['venue']}").json()
    assert len(det["courts"]) == 1 and det["courts"][0]["price"] == 800
    S["court"] = det["courts"][0]["id"]


def test_venue_status_toggle_hides_publicly():
    h = H(S["admin_tok"])
    r = requests.patch(f"{API}/admin/venues/{S['venue']}", json={"status": "inactive"}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "inactive"
    assert requests.get(f"{API}/venues/{S['venue']}").status_code == 404
    assert not any(v["id"] == S["venue"] for v in requests.get(f"{API}/venues").json())
    assert requests.patch(f"{API}/admin/venues/{S['venue']}", json={"status": "active"}, headers=h).status_code == 200
    assert requests.get(f"{API}/venues/{S['venue']}").status_code == 200


def test_admin_add_court_change_duration_disable():
    h = H(S["admin_tok"])
    r = requests.post(f"{API}/admin/venues/{S['venue']}/courts",
                      json={"sport_id": S["sports"]["Pickleball"], "name": "TEST PB", "slot_minutes": 30, "price": 300}, headers=h)
    assert r.status_code == 200, r.text
    pb = next(c for c in r.json()["courts"] if c["name"] == "TEST PB")
    S["court2"] = pb["id"]
    r = requests.patch(f"{API}/admin/courts/{pb['id']}", json={"slot_minutes": 60}, headers=h)
    assert r.status_code == 200
    assert next(c for c in r.json()["courts"] if c["id"] == pb["id"])["slot_minutes"] == 60
    assert requests.patch(f"{API}/admin/courts/{pb['id']}", json={"slot_minutes": 45}, headers=h).status_code == 400
    r = requests.patch(f"{API}/admin/courts/{pb['id']}", json={"active": False}, headers=h)
    assert r.status_code == 200
    det = requests.get(f"{API}/venues/{S['venue']}").json()
    assert all(c["id"] != pb["id"] for c in det["courts"])


# ---------- Owner ----------
def test_new_owner_login_and_isolation():
    r = requests.post(f"{API}/auth/login", json={"email": S["owner_email"], "password": "OwnerPass123"})
    assert r.status_code == 200 and r.json()["user"]["role"] == "owner"
    S["owner_tok"] = r.json()["token"]
    vs = requests.get(f"{API}/owner/venues", headers=H(S["owner_tok"])).json()
    assert [v["id"] for v in vs] == [S["venue"]]
    demo_vs = requests.get(f"{API}/owner/venues", headers=H(S["demo_owner_tok"])).json()
    S["demo_venue"] = demo_vs[0]["id"]
    r = requests.get(f"{API}/owner/bookings", params={"venue_id": S["demo_venue"]}, headers=H(S["owner_tok"]))
    assert r.status_code == 404
    assert requests.get(f"{API}/owner/overview", params={"venue_id": S["demo_venue"]}, headers=H(S["owner_tok"])).status_code == 404


def test_walkin_cash_and_double_booking():
    d = plus_days(1)
    S["walk_date"] = d
    body = {"court_id": S["court"], "date": d, "start_time": "10:00", "end_time": "12:00",
            "customer_name": "TEST_Walkin", "customer_mobile": "9999988888", "payment_method": "cash", "custom_price": 1200}
    r = requests.post(f"{API}/owner/walkin", json=body, headers=H(S["owner_tok"]))
    assert r.status_code == 200, r.text
    b = r.json()["booking"]
    assert b["status"] == "confirmed" and b["final_amount"] == 1200 and b["gross_amount"] == 1600
    assert b["price_overridden"] is True and "qr_token" not in b
    S["walk_code"], S["walk_id"] = b["code"], b["id"]
    slots = requests.get(f"{API}/venues/{S['venue']}/slots", params={"date": d}).json()
    st = {s["start"]: s["status"] for s in next(c for c in slots if c["court_id"] == S["court"])["slots"]}
    assert st[600] == "booked" and st[660] == "booked" and st[720] == "available"
    body2 = {**body, "start_time": "11:00", "end_time": "13:00", "custom_price": None}
    r = requests.post(f"{API}/owner/walkin", json=body2, headers=H(S["owner_tok"]))
    assert r.status_code == 409
    # other owner cannot walk-in on this court
    assert requests.post(f"{API}/owner/walkin", json={**body, "start_time": "15:00", "end_time": "16:00"},
                         headers=H(S["demo_owner_tok"])).status_code == 404
    bk = requests.get(f"{API}/owner/bookings", params={"venue_id": S["venue"], "date": d}, headers=H(S["owner_tok"])).json()
    assert any(x["code"] == S["walk_code"] for x in bk)


def test_checkin_flow():
    h = H(S["owner_tok"])
    r = requests.post(f"{API}/owner/checkin", json={"code": S["walk_code"].lower()}, headers=h).json()
    assert r["valid"] is True, r
    r = requests.post(f"{API}/owner/checkin", json={"code": S["walk_code"]}, headers=h).json()
    assert r["valid"] is False and r["reason"] == "Already checked in"
    r = requests.post(f"{API}/owner/checkin", json={"code": "NXP-ZZZZZZZ"}, headers=h).json()
    assert r["valid"] is False
    # demo owner cannot check in other venue's booking
    r = requests.post(f"{API}/owner/checkin", json={"code": S["walk_code"]}, headers=H(S["demo_owner_tok"])).json()
    assert r["valid"] is False and "booking" not in r


# ---------- Pricing proposals ----------
def test_price_proposal_approve_and_reject():
    ha, ho = H(S["admin_tok"]), H(S["owner_tok"])
    r = requests.post(f"{API}/admin/price-requests", json={"court_id": S["court"], "proposed_price": 950, "effective_date": today()}, headers=ha)
    assert r.status_code == 200, r.text
    pr = r.json()
    assert pr["current_price"] == 800 and pr["status"] == "pending"
    dup = requests.post(f"{API}/admin/price-requests", json={"court_id": S["court"], "proposed_price": 999, "effective_date": today()}, headers=ha)
    assert dup.status_code == 400
    assert requests.post(f"{API}/admin/price-requests", json={"court_id": S["court"], "proposed_price": 999, "effective_date": "2000-01-01"}, headers=ha).status_code == 400
    lst = requests.get(f"{API}/owner/price-requests", params={"venue_id": S["venue"]}, headers=ho).json()
    assert any(x["id"] == pr["id"] and x["proposed_price"] == 950 for x in lst)
    assert requests.get(f"{API}/venues/{S['venue']}").json()["courts"][0]["price"] == 800
    # demo owner cannot decide
    assert requests.post(f"{API}/owner/price-requests/{pr['id']}/decision", json={"approve": True}, headers=H(S["demo_owner_tok"])).status_code == 404
    r = requests.post(f"{API}/owner/price-requests/{pr['id']}/decision", json={"approve": True}, headers=ho)
    assert r.status_code == 200 and r.json()["status"] == "approved"
    assert requests.get(f"{API}/venues/{S['venue']}").json()["courts"][0]["price"] == 950
    assert requests.post(f"{API}/owner/price-requests/{pr['id']}/decision", json={"approve": False}, headers=ho).status_code == 400
    pr2 = requests.post(f"{API}/admin/price-requests", json={"court_id": S["court"], "proposed_price": 2000, "effective_date": today()}, headers=ha).json()
    r = requests.post(f"{API}/owner/price-requests/{pr2['id']}/decision", json={"approve": False}, headers=ho)
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    assert requests.get(f"{API}/venues/{S['venue']}").json()["courts"][0]["price"] == 950


# ---------- Coupons & quote ----------
def _coupon(code, **kw):
    body = {"code": code, "discount_type": "percent", "discount_value": 20, "max_discount": 300, "min_amount": 500,
            "start_date": today(), "expiry_date": plus_days(30), "usage_limit": 0, "active": True, **kw}
    r = requests.post(f"{API}/admin/coupons", json=body, headers=H(S["admin_tok"]))
    assert r.status_code == 200, r.text
    S.setdefault("coupons", []).append((r.json()["id"], body))
    return r.json()


def test_coupons_and_quote():
    _coupon(f"TEST_P{UID}")
    _coupon(f"TEST_E{UID}", start_date="2024-01-01", expiry_date="2024-01-31")
    _coupon(f"TEST_I{UID}", active=False)
    _coupon(f"TEST_M{UID}", min_amount=100000)
    d = plus_days(2)
    q = {"court_id": S["court"], "date": d, "start_min": 1080, "end_min": 1200}
    r = requests.post(f"{API}/bookings/quote", json=q, headers=H(S["cust_tok"]))
    assert r.status_code == 200, r.text
    assert r.json()["gross_amount"] == 1900 and r.json()["final_amount"] == 1900
    r = requests.post(f"{API}/bookings/quote", json={**q, "coupon_code": f"test_p{UID.lower()}"}, headers=H(S["cust_tok"]))
    assert r.status_code == 200 and r.json()["discount"] == 300 and r.json()["final_amount"] == 1600  # 20% of 1900=380 capped 300
    r = requests.post(f"{API}/bookings/quote", json={**q, "end_min": 1140, "coupon_code": f"TEST_P{UID}"}, headers=H(S["cust_tok"]))
    assert r.json()["discount"] == 190
    for c in ("E", "I", "M"):
        r = requests.post(f"{API}/bookings/quote", json={**q, "coupon_code": f"TEST_{c}{UID}"}, headers=H(S["cust_tok"]))
        assert r.status_code == 400, (c, r.text)
    assert requests.post(f"{API}/bookings/quote", json={**q, "coupon_code": "NOPE_XX"}, headers=H(S["cust_tok"])).status_code == 400
    # non-consecutive / misaligned / past
    assert requests.post(f"{API}/bookings/quote", json={**q, "start_min": 1090}, headers=H(S["cust_tok"])).status_code == 400
    assert requests.post(f"{API}/bookings/quote", json={**q, "date": "2020-01-01"}, headers=H(S["cust_tok"])).status_code == 400
    r = requests.post(f"{API}/bookings", json=q, headers=H(S["cust_tok"]))
    assert r.status_code == 503


# ---------- Cancellation cutoff (DB-inserted bookings) ----------
def _insert_booking(db, date, start_min):
    bid = f"test-{uuid.uuid4()}"
    start_at = (datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=IST) + timedelta(minutes=start_min)).astimezone(ZoneInfo("UTC"))
    db.bookings.insert_one({"id": bid, "code": f"TST-{uuid.uuid4().hex[:8].upper()}", "user_id": S["cust_id"], "status": "confirmed",
                            "venue_id": S["venue"], "venue_name": "TEST", "court_id": S["court"], "court_name": "TEST Turf",
                            "date": date, "start_min": start_min, "end_min": start_min + 60, "slot_starts": [start_min],
                            "start_at": start_at.isoformat(), "payment_method": "cash", "final_amount": 950, "gross_amount": 950,
                            "customer_name": "TEST_Customer", "created_at": datetime.now(ZoneInfo("UTC")).isoformat()})
    db.booking_slots.insert_one({"court_id": S["court"], "date": date, "start": start_min, "booking_id": bid})
    S.setdefault("db_bookings", []).append(bid)
    return bid


def test_cancel_cutoff():
    db = mongo()
    now = datetime.now(IST)
    soon = now + timedelta(hours=3)
    soon_date, soon_min = soon.strftime("%Y-%m-%d"), soon.hour * 60
    far_date = plus_days(5)
    b1 = _insert_booking(db, soon_date, soon_min)
    b2 = _insert_booking(db, far_date, 420)
    h = H(S["cust_tok"])
    d1 = requests.get(f"{API}/bookings/{b1}", headers=h).json()
    assert d1["can_cancel"] is False
    r = requests.post(f"{API}/bookings/{b1}/cancel", headers=h)
    assert r.status_code == 400 and "24" in r.json()["detail"]
    assert requests.get(f"{API}/bookings/{b2}", headers=h).json()["can_cancel"] is True
    # another customer cannot cancel
    r = requests.post(f"{API}/bookings/{b2}/cancel", headers=H(S["admin_tok"]))
    assert r.status_code == 403
    r = requests.post(f"{API}/bookings/{b2}/cancel", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert db.booking_slots.count_documents({"booking_id": b2}) == 0
    assert requests.post(f"{API}/bookings/{b2}/cancel", headers=h).status_code == 400
    mine = requests.get(f"{API}/bookings/mine", headers=h).json()
    assert {b1, b2} <= {b["id"] for b in mine}


# ---------- Finance ----------
def test_finance_cash_separate():
    f = requests.get(f"{API}/admin/finance", headers=H(S["admin_tok"])).json()
    pv = next(v for v in f["venues"] if v["venue_id"] == S["venue"])
    # walk-in 1200 + DB-inserted b1 (950, still confirmed) are cash
    assert pv["cash_total"] == 1200 + 950
    assert pv["collected"] == 0
    assert all(r["venue_id"] != S["venue"] for r in f["ledger"])


# ---------- Settings / cities / sports ----------
def test_settings_and_meta_crud():
    h = H(S["admin_tok"])
    orig = requests.get(f"{API}/admin/settings", headers=h).json()
    try:
        r = requests.put(f"{API}/admin/settings", json={"commission_pct": 12.5, "show_demo": False}, headers=h)
        assert r.status_code == 200 and r.json()["commission_pct"] == 12.5
        pub = requests.get(f"{API}/venues").json()
        assert not any(v["is_demo"] for v in pub)
        assert requests.put(f"{API}/admin/settings", json={"commission_pct": 80, "show_demo": True}, headers=h).status_code == 422
    finally:
        requests.put(f"{API}/admin/settings", json={"commission_pct": orig["commission_pct"], "show_demo": orig["show_demo"]}, headers=h)
    assert any(v["is_demo"] for v in requests.get(f"{API}/venues").json()) == orig["show_demo"]
    c = requests.post(f"{API}/admin/cities", json={"name": f"TEST_City_{UID}", "state": "Gujarat", "active": True}, headers=h)
    assert c.status_code == 200
    assert requests.post(f"{API}/admin/cities", json={"name": f"test_city_{UID}", "active": True}, headers=h).status_code == 400
    s = requests.post(f"{API}/admin/sports", json={"name": f"TEST_Sport_{UID}", "active": True}, headers=h)
    assert s.status_code == 200
    m = requests.get(f"{API}/meta").json()
    assert any(x["id"] == c.json()["id"] for x in m["cities"]) and any(x["id"] == s.json()["id"] for x in m["sports"])
    # deactivate test meta (no delete endpoint)
    requests.patch(f"{API}/admin/cities/{c.json()['id']}", json={"name": f"TEST_City_{UID}", "active": False}, headers=h)
    requests.patch(f"{API}/admin/sports/{s.json()['id']}", json={"name": f"TEST_Sport_{UID}", "active": False}, headers=h)


# ---------- Cleanup ----------
def test_zz_cleanup():
    h = H(S["admin_tok"])
    db = mongo()
    for bid in S.get("db_bookings", []) + ([S["walk_id"]] if S.get("walk_id") else []):
        db.bookings.delete_one({"id": bid})
        db.booking_slots.delete_many({"booking_id": bid})
        db.qr_checkins.delete_many({"booking_id": bid})
    for cid, body in S.get("coupons", []):
        requests.put(f"{API}/admin/coupons/{cid}", json={**body, "active": False}, headers=h)
    if S.get("venue"):
        requests.patch(f"{API}/admin/venues/{S['venue']}", json={"status": "inactive"}, headers=h)
