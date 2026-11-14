# Live preview API checks for subscriptions/OTP/court limits (read-mostly; creates & cleans its own TEST_ owner).
import os
import uuid

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
ADMIN = ("nxtplayindia@gmail.com", "Nxp-Admin-IQYxyQ1CvCW4")


def tok(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


@pytest.fixture(scope="module")
def admin_h():
    return tok(*ADMIN)


@pytest.fixture(scope="module")
def owner(admin_h):
    email = f"delivered+owner{uuid.uuid4().hex[:6]}@resend.dev"
    r = requests.post(f"{API}/subscriptions/admin/owners", headers=admin_h, json={
        "name": "TEST_ Live Owner", "email": email, "mobile": "9999900099", "plan": "starter",
        "start_date": "2026-01-01", "expiry_date": "2027-01-01"})
    assert r.status_code == 200, r.text
    d = r.json()
    yield {"id": d["owner"]["id"], "email": email, "temp": d["temporary_password"], "email_sent": d["email_sent"]}
    oid = d["owner"]["id"]
    for v in db.venues.find({"owner_ids": oid}):
        db.courts.delete_many({"venue_id": v["id"]})
        db.venue_closures.delete_many({"venue_id": v["id"]})
        db.venues.delete_one({"id": v["id"]})
    for c in ("subscriptions", "subscription_history", "subscription_payments"):
        db[c].delete_many({"owner_id": oid})
    db.audit_logs.delete_many({"target_id": oid})
    db.users.delete_one({"id": oid, "name": "TEST_ Live Owner"})


class TestOwnerSubscription:
    def test_create_response(self, owner):
        assert owner["temp"].startswith("Nxp-") and isinstance(owner["email_sent"], bool)

    def test_duplicate_email_rejected(self, admin_h, owner):
        r = requests.post(f"{API}/subscriptions/admin/owners", headers=admin_h, json={
            "name": "TEST_ dup", "email": owner["email"], "mobile": "9999900099", "plan": "starter",
            "start_date": "2026-01-01", "expiry_date": "2027-01-01"})
        assert r.status_code == 400

    def test_bad_dates_rejected(self, admin_h):
        r = requests.post(f"{API}/subscriptions/admin/owners", headers=admin_h, json={
            "name": "TEST_ bad", "email": "delivered+bad@resend.dev", "mobile": "9999900099", "plan": "starter",
            "start_date": "2027-01-01", "expiry_date": "2026-01-01"})
        assert r.status_code == 400

    def test_mine_awaiting_and_authorize_503(self, owner):
        h = tok(owner["email"], owner["temp"])
        m = requests.get(f"{API}/subscriptions/mine", headers=h).json()
        assert m["access"]["state"] == "awaiting_authorization" and m["must_change_password"] is True
        assert m["payments_configured"] is False and m["subscription"]["amount"] == 399
        assert requests.post(f"{API}/subscriptions/authorize", headers=h).status_code == 403  # must change pw first
        r = requests.post(f"{API}/auth/change-password", headers=h, json={"current_password": owner["temp"], "new_password": "TestLive#2026"})
        assert r.status_code == 200
        h = tok(owner["email"], "TestLive#2026")
        r = requests.post(f"{API}/subscriptions/authorize", headers=h)
        assert r.status_code == 503 and "not configured" in r.json()["detail"]

    def test_venue_with_too_many_courts_rejected(self, admin_h, owner):
        meta = requests.get(f"{API}/meta").json()
        body = {"name": "TEST_ Live Arena", "city_id": meta["cities"][0]["id"], "address": "TEST addr", "open_time": "06:00",
                "close_time": "23:00", "rules": "", "image_ids": [], "status": "active", "owner_id": owner["id"],
                "courts": [{"sport_id": meta["sports"][0]["id"], "name": f"C{i}", "slot_minutes": 60, "price": 300} for i in range(6)]}
        assert requests.post(f"{API}/admin/venues", headers=admin_h, json=body).status_code == 400
        body["courts"] = body["courts"][:5]
        r = requests.post(f"{API}/admin/venues", headers=admin_h, json=body)
        assert r.status_code == 200
        # hidden publicly while awaiting authorization
        names = [v["name"] for v in requests.get(f"{API}/venues").json()]
        assert "TEST_ Live Arena" not in names and "Urban Ground" in names

    def test_downgrade_blocked_when_over_limit_and_growth_allows_more(self, admin_h, owner):
        r = requests.post(f"{API}/subscriptions/admin/assign", headers=admin_h, json={
            "owner_id": owner["id"], "plan": "growth", "start_date": "2026-01-01", "expiry_date": "2027-01-01"})
        assert r.status_code == 200 and r.json()["court_limit"] == 10
        r = requests.post(f"{API}/subscriptions/admin/owners/{owner['id']}/manual-renewal", headers=admin_h,
                          json={"paid_until": "2027-06-30", "note": "TEST_ live"})
        assert r.status_code == 200 and r.json()["status"] == "active"
        h = tok(owner["email"], "TestLive#2026")
        v = requests.get(f"{API}/owner/venues", headers=h).json()[0]
        sp = requests.get(f"{API}/meta").json()["sports"][0]["id"]
        r = requests.post(f"{API}/owner/venues/{v['id']}/courts", headers=h, json={"sport_id": sp, "name": "C6", "slot_minutes": 60, "price": 300})
        assert r.status_code == 200
        r = requests.post(f"{API}/subscriptions/admin/assign", headers=admin_h, json={
            "owner_id": owner["id"], "plan": "starter", "start_date": "2026-01-01", "expiry_date": "2027-01-01"})
        assert r.status_code == 400  # 6 courts > starter limit

    def test_manual_renewal_past_date_rejected(self, admin_h, owner):
        r = requests.post(f"{API}/subscriptions/admin/owners/{owner['id']}/manual-renewal", headers=admin_h,
                          json={"paid_until": "2020-01-01", "note": "TEST_ past"})
        assert r.status_code == 400

    def test_suspended_owner_cannot_login(self, admin_h, owner):
        assert requests.patch(f"{API}/admin/owners/{owner['id']}", headers=admin_h, json={"active": False}).status_code == 200
        r = requests.post(f"{API}/auth/login", json={"email": owner["email"], "password": "TestLive#2026"})
        assert r.status_code == 401
        assert requests.patch(f"{API}/admin/owners/{owner['id']}", headers=admin_h, json={"active": True}).status_code == 200

    def test_admin_list_legacy_owner(self, admin_h):
        rows = requests.get(f"{API}/subscriptions/admin/owners", headers=admin_h).json()
        ug = [r for r in rows if r["owner"]["email"] == "urbanground@gmail.com"]
        assert ug and ug[0]["access"]["state"] == "legacy" and ug[0]["subscription"] is None

    def test_admin_endpoints_require_admin(self, owner):
        h = tok(owner["email"], "TestLive#2026")
        assert requests.get(f"{API}/subscriptions/admin/owners", headers=h).status_code == 403
        assert requests.get(f"{API}/subscriptions/admin/owners").status_code in (401, 403)

    def test_webhook_bad_signature(self):
        r = requests.post(f"{API}/subscriptions/webhook", data=b"{}", headers={"x-razorpay-signature": "bad"})
        assert r.status_code == 400

    def test_cron_requires_secret(self):
        assert requests.post(f"{API}/subscriptions/cron/daily").status_code == 401


class TestRegistrationOtp:
    def test_register_without_valid_token(self):
        r = requests.post(f"{API}/auth/register", json={"name": "TEST_ x", "email": "delivered+x@resend.dev", "password": "abcdefgh1",
                                                       "age": 20, "registration_token": "garbage"})
        assert r.status_code == 400

    def test_otp_existing_email_rejected(self):
        assert requests.post(f"{API}/auth/registration-otp", json={"email": "nxtplayindia@gmail.com"}).status_code == 400

    def test_verify_without_request(self):
        r = requests.post(f"{API}/auth/verify-registration-otp", json={"email": f"delivered+none{uuid.uuid4().hex[:5]}@resend.dev", "otp": "123456"})
        assert r.status_code == 400


class TestPublicRegression:
    def test_public_venues_and_slots(self):
        vs = requests.get(f"{API}/venues").json()
        ug = [v for v in vs if v["name"] == "Urban Ground"]
        assert ug
        d = requests.get(f"{API}/venues/{ug[0]['id']}")
        assert d.status_code == 200
