"""Subscription, onboarding, OTP and regression tests. Uses an isolated test DB and mocked Razorpay/email."""
import asyncio
import hashlib
import hmac
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")
os.environ["DB_NAME"] = "nxtplay_pytest_subscriptions"
os.environ.update(RAZORPAY_KEY_ID="rzp_test_mock", RAZORPAY_KEY_SECRET="mock_secret", RAZORPAY_WEBHOOK_SECRET="mock_webhook",
                  RAZORPAY_PLAN_399="plan_mock_399", RAZORPAY_PLAN_699="plan_mock_699", ADMIN_EMAIL="admin@nxtplaytest.com",
                  ADMIN_PASSWORD="AdminPass#123", SEED_DEMO_DATA="false")
LOOP = asyncio.new_event_loop()
asyncio.set_event_loop(LOOP)

import httpx  # noqa: E402
import core  # noqa: E402
import emailer  # noqa: E402
import subscriptions  # noqa: E402
import server  # noqa: E402

run = LOOP.run_until_complete
S = {}
SENT = []


class FakeSubAPI:
    def __init__(self):
        self.created, self.n = [], 0

    def create(self, payload):
        self.n += 1
        self.created.append(payload)
        return {"id": f"sub_mock_{self.n}", "status": "created", "short_url": "https://rzp.io/i/mock"}

    def fetch(self, sid):
        now = int(datetime.now(timezone.utc).timestamp())
        return {"id": sid, "status": "active", "current_start": now, "current_end": now + 30 * 86400, "charge_at": now + 30 * 86400}

    def cancel(self, sid, opts):
        return {"id": sid, "status": "cancelled"}


class FakePaymentAPI:
    def refund(self, pid, opts):
        return {"id": "rfnd_mock", "status": "processed"}


class FakeClient:
    subscription = FakeSubAPI()
    payment = FakePaymentAPI()


FAKE = FakeClient()


async def fake_send_email(*, to, subject, html):
    emailer._assert_safe_email(subject, html)
    SENT.append({"to": to, "subject": subject, "html": html})
    return "mock-email-id"


core.rzp = lambda: FAKE
subscriptions.rzp = lambda: FAKE
emailer.send_email = fake_send_email


def client():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


async def call(method, path, token=None, **kw):
    async with client() as c:
        headers = kw.pop("headers", {})
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return await c.request(method, f"/api{path}", headers=headers, **kw)


def req(method, path, token=None, **kw):
    return run(call(method, path, token, **kw))


def login(email, pw):
    r = req("POST", "/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def webhook(event, sub_id, event_id, created_at=None, entity=None, payment=None):
    now = int(datetime.now(timezone.utc).timestamp())
    ent = {"id": sub_id, "status": "active", "current_start": now, "current_end": now + 30 * 86400, **(entity or {})}
    body = {"event": event, "created_at": created_at or now, "payload": {"subscription": {"entity": ent}}}
    if payment:
        body["payload"]["payment"] = {"entity": payment}
    raw = json.dumps(body).encode()
    sig = hmac.new(b"mock_webhook", raw, hashlib.sha256).hexdigest()
    return req("POST", "/subscriptions/webhook", content=raw, headers={"x-razorpay-signature": sig, "x-razorpay-event-id": event_id,
                                                                         "content-type": "application/json"})


def owner_sub(owner_id):
    return run(core.db.subscriptions.find_one({"owner_id": owner_id}, {"_id": 0}))


def test_00_setup():
    run(core.client.drop_database(os.environ["DB_NAME"]))
    run(server.ensure_indexes())
    run(server.seed())
    S["admin"] = login("admin@nxtplaytest.com", "AdminPass#123")
    meta = req("GET", "/meta").json()
    S["city"], S["sport"] = meta["cities"][0]["id"], meta["sports"][0]["id"]


def test_01_admin_creates_owner_with_plan():
    r = req("POST", "/subscriptions/admin/owners", S["admin"], json={"name": "TEST Owner A", "email": "owner.a@nxtplaytest.com",
            "mobile": "9999900001", "plan": "starter", "start_date": core.today_ist(), "expiry_date": "2099-01-01"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["temporary_password"] and d["email_sent"] is True
    assert d["subscription"]["plan"] == "starter" and d["subscription"]["court_limit"] == 5
    assert d["temporary_password"] not in SENT[-1]["html"], "temporary password must never be emailed"
    S["owner_a"], S["temp_a"] = d["owner"]["id"], d["temporary_password"]
    v = req("POST", "/admin/venues", S["admin"], json={"name": "TEST Arena A", "owner_id": S["owner_a"], "city_id": S["city"],
            "address": "Test road", "open_time": "06:00", "close_time": "23:00", "rules": "", "image_ids": [], "status": "active",
            "courts": [{"sport_id": S["sport"], "name": f"C{i}", "slot_minutes": 60, "price": 500} for i in range(1, 5)]})
    assert v.status_code == 200, v.text
    S["venue_a"] = v.json()["id"]


def test_02_forced_password_change():
    t = login("owner.a@nxtplaytest.com", S["temp_a"])
    me = req("GET", "/auth/me", t).json()
    assert me["must_change_password"] is True
    assert req("GET", f"/owner/bookings?venue_id={S['venue_a']}", t).status_code == 403
    assert req("POST", "/subscriptions/authorize", t).status_code == 403
    r = req("POST", "/auth/change-password", t, json={"current_password": S["temp_a"], "new_password": "OwnerA#Strong1"})
    assert r.status_code == 200
    assert req("POST", "/auth/login", json={"email": "owner.a@nxtplaytest.com", "password": S["temp_a"]}).status_code == 401
    S["tok_a"] = login("owner.a@nxtplaytest.com", "OwnerA#Strong1")


def test_03_unauthorized_until_subscription_active():
    st = req("GET", "/subscriptions/mine", S["tok_a"]).json()
    assert st["access"]["state"] == "awaiting_authorization" and st["access"]["operational"] is False
    r = req("PATCH", f"/owner/venues/{S['venue_a']}/operations", S["tok_a"], json={"name": "Blocked Edit", "address": "Test road", "open_time": "06:00", "close_time": "23:00"})
    assert r.status_code == 403
    assert req("GET", f"/owner/bookings?venue_id={S['venue_a']}", S["tok_a"]).status_code == 200
    assert all(v["id"] != S["venue_a"] for v in req("GET", "/venues").json()), "unpaid venue must not be public"


def test_04_subscription_creation_mocked():
    r = req("POST", "/subscriptions/authorize", S["tok_a"])
    assert r.status_code == 200, r.text
    S["rzp_sub_a"] = r.json()["subscription_id"]
    assert FAKE.subscription.created[-1]["plan_id"] == "plan_mock_399"
    raw = run(core.db.subscriptions.find_one({"owner_id": S["owner_a"]}))
    assert raw["rzp_sub_enc"] != S["rzp_sub_a"] and core.dec(raw["rzp_sub_enc"]) == S["rzp_sub_a"], "provider id stored encrypted"
    bad = req("POST", "/subscriptions/verify", S["tok_a"], json={"razorpay_payment_id": "pay_x", "razorpay_subscription_id": S["rzp_sub_a"], "razorpay_signature": "bad"})
    assert bad.status_code == 400
    assert owner_sub(S["owner_a"])["paid_until"] is None


def test_05_webhook_signature_and_activation():
    raw = json.dumps({"event": "subscription.activated"}).encode()
    r = req("POST", "/subscriptions/webhook", content=raw, headers={"x-razorpay-signature": "forged", "x-razorpay-event-id": "evt_forged"})
    assert r.status_code == 400
    assert webhook("subscription.activated", S["rzp_sub_a"], "evt_act_1").status_code == 200
    st = req("GET", "/subscriptions/mine", S["tok_a"]).json()
    assert st["access"]["state"] == "active" and st["access"]["operational"]


def test_06_duplicate_webhook_ignored():
    pay = {"id": "pay_mock_1", "amount": 39900, "method": "card"}
    assert webhook("subscription.charged", S["rzp_sub_a"], "evt_charge_1", payment=pay).status_code == 200
    r = webhook("subscription.charged", S["rzp_sub_a"], "evt_charge_1", payment=pay)
    assert r.json()["status"] == "duplicate"
    assert run(core.db.subscription_payments.count_documents({"owner_id": S["owner_a"], "status": "captured"})) == 1


def test_07_recurring_payment_extends_period_and_out_of_order_safe():
    before = owner_sub(S["owner_a"])["paid_until"]
    now = int(datetime.now(timezone.utc).timestamp())
    r = webhook("subscription.charged", S["rzp_sub_a"], "evt_charge_2", entity={"current_start": now + 30 * 86400, "current_end": now + 60 * 86400},
                payment={"id": "pay_mock_2", "amount": 39900})
    assert r.status_code == 200
    after = owner_sub(S["owner_a"])
    assert after["paid_until"] > before
    webhook("subscription.pending", S["rzp_sub_a"], "evt_old_pending", created_at=now - 86400, entity={"status": "pending"})
    assert owner_sub(S["owner_a"])["status"] == "active", "older event must not override newer state"


def test_08_failed_recurring_payment():
    r = webhook("subscription.pending", S["rzp_sub_a"], "evt_pending_1", created_at=int(datetime.now(timezone.utc).timestamp()) + 5,
                entity={"status": "pending"}, payment={"id": "pay_fail_1", "amount": 39900, "error_description": "Card declined"})
    assert r.status_code == 200
    sub = owner_sub(S["owner_a"])
    assert sub["status"] == "past_due" and sub["last_payment_error"] == "Card declined"
    assert run(core.db.subscription_payments.count_documents({"owner_id": S["owner_a"], "status": "failed"})) == 2, "stale + current failures both kept as history"
    st = req("GET", "/subscriptions/mine", S["tok_a"]).json()
    assert st["access"]["payment_issue"] and st["access"]["operational"]
    assert any("payment failed" in m["subject"].lower() for m in SENT)


def test_09_court_limit():
    v = req("GET", "/owner/venues", S["tok_a"]).json()[0]
    assert len(v["courts"]) == 4
    ok = req("POST", f"/owner/venues/{S['venue_a']}/courts", S["tok_a"], json={"sport_id": S["sport"], "name": "C5", "slot_minutes": 30, "price": 400})
    assert ok.status_code == 200, ok.text
    over = req("POST", f"/owner/venues/{S['venue_a']}/courts", S["tok_a"], json={"sport_id": S["sport"], "name": "C6", "slot_minutes": 30, "price": 400})
    assert over.status_code == 400 and "upgrade" in over.json()["detail"].lower()
    over_admin = req("POST", f"/admin/venues/{S['venue_a']}/courts", S["admin"], json={"sport_id": S["sport"], "name": "C6", "slot_minutes": 30, "price": 400})
    assert over_admin.status_code == 400


def test_10_owner_self_service_and_walkin_regression():
    r = req("PATCH", f"/owner/venues/{S['venue_a']}/operations", S["tok_a"], json={"name": "TEST Arena A", "address": "Test road",
            "open_time": "06:00", "close_time": "23:00", "description": "Floodlit turf", "operating_days": [0, 1, 2, 3, 4, 5, 6]})
    assert r.status_code == 200 and r.json()["description"] == "Floodlit turf"
    court = req("GET", "/owner/venues", S["tok_a"]).json()[0]["courts"][0]
    p = req("PATCH", f"/owner/courts/{court['id']}", S["tok_a"], json={"price": 650})
    assert p.json()["current_price"] == 650
    date = (datetime.now(core.IST) + timedelta(days=3)).strftime("%Y-%m-%d")
    w = req("POST", "/owner/walkin", S["tok_a"], json={"court_id": court["id"], "date": date, "start_time": "07:00", "end_time": "08:00",
            "customer_name": "TEST Walkin", "customer_mobile": "9000000000", "payment_method": "cash"})
    assert w.status_code == 200, w.text
    b = w.json()["booking"]
    assert b["status"] == "confirmed" and b["final_amount"] == 650 and b["platform_fee"] == 0
    dup = req("POST", "/owner/walkin", S["tok_a"], json={"court_id": court["id"], "date": date, "start_time": "07:00", "end_time": "08:00",
              "customer_name": "TEST Walkin 2", "customer_mobile": "9000000001", "payment_method": "cash"})
    assert dup.status_code == 409, "double booking must be prevented"
    S["court_a"], S["walkin_date"] = court["id"], date


def test_11_cross_owner_access_denied():
    r = req("POST", "/subscriptions/admin/owners", S["admin"], json={"name": "TEST Owner B", "email": "owner.b@nxtplaytest.com",
            "mobile": "9999900002", "plan": "growth", "start_date": core.today_ist(), "expiry_date": "2099-01-01"})
    temp = r.json()["temporary_password"]
    t = login("owner.b@nxtplaytest.com", temp)
    req("POST", "/auth/change-password", t, json={"current_password": temp, "new_password": "OwnerB#Strong1"})
    tb = login("owner.b@nxtplaytest.com", "OwnerB#Strong1")
    assert req("GET", f"/owner/bookings?venue_id={S['venue_a']}", tb).status_code == 404
    assert req("PATCH", f"/owner/courts/{S['court_a']}", tb, json={"price": 1}).status_code in (403, 404)
    assert req("GET", "/subscriptions/admin/owners", tb).status_code == 403
    assert req("GET", "/owner/venues", tb).json() == []


def test_12_seven_day_reminder():
    soon = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    run(core.db.subscriptions.update_one({"owner_id": S["owner_a"]}, {"$set": {"paid_until": soon, "status": "active", "last_payment_error": None}}))
    st = req("GET", "/subscriptions/mine", S["tok_a"]).json()["access"]
    assert st["expiring_soon"] and st["days_left"] <= 7
    hdr = {"Authorization": f"Bearer {os.environ['CRON_SECRET']}"}
    assert req("POST", "/subscriptions/cron/daily", headers={"Authorization": "Bearer wrong"}).status_code == 401
    first = req("POST", "/subscriptions/cron/daily", headers=hdr).json()
    second = req("POST", "/subscriptions/cron/daily", headers=hdr).json()
    assert first["reminders_sent"] >= 1 and second["reminders_sent"] == 0


def test_13_expiry_suspends_and_preserves_data():
    long_ago = (datetime.now(timezone.utc) - timedelta(days=400)).isoformat()
    run(core.db.subscriptions.update_one({"owner_id": S["owner_a"]}, {"$set": {"paid_until": long_ago, "status": "halted"}}))
    st = req("GET", "/subscriptions/mine", S["tok_a"]).json()["access"]
    assert st["state"] == "expired" and not st["operational"]
    assert req("POST", f"/owner/venues/{S['venue_a']}/closures", S["tok_a"], json={"date": S["walkin_date"]}).status_code == 403
    assert req("GET", f"/owner/bookings?venue_id={S['venue_a']}", S["tok_a"]).status_code == 200
    assert all(v["id"] != S["venue_a"] for v in req("GET", "/venues").json())
    assert run(core.db.courts.count_documents({"venue_id": S["venue_a"]})) == 5
    assert run(core.db.bookings.count_documents({"venue_id": S["venue_a"]})) == 1
    assert run(core.db.venues.count_documents({"id": S["venue_a"]})) == 1


def test_14_renewal_after_long_expiry():
    sub_id = owner_sub(S["owner_a"])["id"]
    r = req("POST", "/subscriptions/authorize", S["tok_a"])
    assert r.status_code == 200, r.text
    new_sid = r.json()["subscription_id"]
    assert new_sid != S["rzp_sub_a"]
    webhook("subscription.charged", S["rzp_sub_a"], "evt_old_sub_late", payment={"id": "pay_old_late", "amount": 39900})
    assert owner_sub(S["owner_a"])["status"] != "active", "events for the replaced subscription must not reactivate"
    assert webhook("subscription.activated", new_sid, "evt_renew_act").status_code == 200
    st = req("GET", "/subscriptions/mine", S["tok_a"]).json()
    assert st["access"]["operational"] and st["subscription"]["id"] == sub_id
    assert run(core.db.subscriptions.count_documents({"owner_id": S["owner_a"]})) == 1
    assert run(core.db.users.count_documents({"email": "owner.a@nxtplaytest.com"})) == 1
    assert run(core.db.venues.count_documents({"owner_ids": S["owner_a"]})) == 1
    assert any(v["id"] == S["venue_a"] for v in req("GET", "/venues").json())


def test_15_legacy_owner_keeps_working():
    t = req("POST", "/admin/owners", S["admin"], json={"name": "TEST Legacy", "email": "legacy@nxtplaytest.com", "mobile": "9999900003", "password": "Legacy#Pass1"})
    assert t.status_code == 200
    run(core.db.users.update_one({"email": "legacy@nxtplaytest.com"}, {"$set": {"must_change_password": False}}))
    tl = login("legacy@nxtplaytest.com", "Legacy#Pass1")
    assert req("GET", "/subscriptions/mine", tl).json()["access"]["state"] == "legacy"
    assert core.sub_state(None)["operational"] is True


def test_16_customer_otp_registration():
    email = "customer.otp@nxtplaytest.com"
    assert req("POST", "/auth/registration-otp", json={"email": email}).status_code == 200
    code = SENT[-1]["html"].split("letter-spacing:6px;font-weight:bold;color:#C8FF00\">")[1][:6]
    assert req("POST", "/auth/registration-otp", json={"email": email}).status_code == 429, "resend cooldown"
    doc = run(core.db.email_otps.find_one({"email": email}))
    assert code not in json.dumps({k: v for k, v in doc.items() if k != "_id"}), "OTP stored hashed"
    for _ in range(5):
        assert req("POST", "/auth/verify-registration-otp", json={"email": email, "otp": "000000" if code != "000000" else "111111"}).status_code == 400
    assert req("POST", "/auth/verify-registration-otp", json={"email": email, "otp": code}).status_code == 429, "attempt limit"
    run(core.db.email_otps.update_one({"email": email}, {"$set": {"attempts": 0, "expires_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()}}))
    assert req("POST", "/auth/verify-registration-otp", json={"email": email, "otp": code}).status_code == 400, "expired"
    run(core.db.email_otps.update_one({"email": email}, {"$set": {"sent_at": "2000-01-01T00:00:00+00:00"}}))
    req("POST", "/auth/registration-otp", json={"email": email})
    code = SENT[-1]["html"].split("letter-spacing:6px;font-weight:bold;color:#C8FF00\">")[1][:6]
    v = req("POST", "/auth/verify-registration-otp", json={"email": email, "otp": code})
    assert v.status_code == 200
    assert req("POST", "/auth/verify-registration-otp", json={"email": email, "otp": code}).status_code == 400, "OTP not reusable"
    tok = v.json()["registration_token"]
    body = {"name": "TEST Customer", "email": email, "password": "Customer#1", "age": 25, "registration_token": tok}
    assert req("POST", "/auth/register", json=body).status_code == 200
    assert req("POST", "/auth/register", json=body).status_code == 400, "no duplicate account"
    assert req("POST", "/auth/register", json={**body, "email": "other@nxtplaytest.com"}).status_code == 400
    assert req("POST", "/auth/register", json={**body, "registration_token": "forged"}).status_code == 400
    S["cust"] = login(email, "Customer#1")


def test_17_existing_password_login_and_refund_regression():
    run(core.db.users.insert_one({"id": core.new_id(), "name": "Old Customer", "email": "old@nxtplaytest.com", "role": "customer", "active": True,
                                  "password_hash": core.hash_pw("OldPass#123"), "created_at": core.iso()}))
    login("old@nxtplaytest.com", "OldPass#123")
    b = run(core.db.bookings.find_one({"venue_id": S["venue_a"]}, {"_id": 0}))
    run(core.db.payments.insert_one({"id": "pay_doc_1", "booking_id": b["id"], "status": "captured", "razorpay_payment_id": "pay_cust_1",
                                     "razorpay_order_id": "order_mock_1", "amount_paise": b["final_amount"] * 100}))
    refund = run(core.initiate_refund(b, "test"))
    again = run(core.initiate_refund(b, "test"))
    assert refund["status"] == "processed" and again["id"] == refund["id"], "refunds are idempotent"


def test_99_teardown():
    run(core.client.drop_database(os.environ["DB_NAME"]))
