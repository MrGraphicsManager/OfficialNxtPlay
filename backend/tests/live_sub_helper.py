# Live preview helper for subscription UI testing (manual CLI). Only touches TEST_ owner records by email.
import hashlib
import os
import sys
from datetime import datetime, timedelta, timezone

import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
OWNER_EMAIL = "delivered+owner1@resend.dev"


def login(email, pw):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pw})
    return r


def admin():
    s = requests.Session()
    s.headers["Authorization"] = "Bearer " + login("nxtplayindia@gmail.com", "Nxp-Admin-IQYxyQ1CvCW4").json()["token"]
    return s


def owner():
    return db.users.find_one({"email": OWNER_EMAIL, "role": "owner"})


def setsub(**kw):
    o = owner()
    assert o and o["name"].startswith("TEST_")
    r = db.subscriptions.update_one({"owner_id": o["id"]}, {"$set": kw})
    print("sub updated", r.modified_count, db.subscriptions.find_one({"owner_id": o["id"]}, {"_id": 0, "status": 1, "paid_until": 1, "last_payment_error": 1, "plan": 1}))


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat()


cmd = sys.argv[1]
now = datetime.now(timezone.utc)
if cmd == "templogin":
    print("temp login:", login(OWNER_EMAIL, sys.argv[2]).status_code, "new login:", login(OWNER_EMAIL, sys.argv[3]).status_code)
elif cmd == "venue":
    s = admin()
    meta = requests.get(f"{BASE}/meta").json()
    cities, sports = meta["cities"], meta["sports"]
    body = {"name": "TEST_ Arena One", "city_id": cities[0]["id"], "address": "TEST address 1", "open_time": "06:00", "close_time": "23:00",
            "rules": "", "image_ids": [], "status": "active", "owner_id": owner()["id"],
            "courts": [{"sport_id": sports[0]["id"], "name": f"TEST Court {i}", "slot_minutes": 60, "price": 500} for i in range(1, 5)]}
    r = s.post(f"{BASE}/admin/venues", json=body)
    print(r.status_code, r.text[:300])
elif cmd == "active":
    setsub(status="active", paid_until=iso(now + timedelta(days=30)), last_payment_error=None)
elif cmd == "soon":
    setsub(status="active", paid_until=iso(now + timedelta(days=2, hours=12)), last_payment_error=None)
elif cmd == "pastdue":
    setsub(status="past_due", paid_until=iso(now + timedelta(days=20)), last_payment_error="TEST_ Card declined by bank")
elif cmd == "halted":
    setsub(status="halted", paid_until=iso(now - timedelta(days=400)), last_payment_error="Payment retries were exhausted")
elif cmd == "otp":
    email, code = sys.argv[2], sys.argv[3]
    h = hashlib.sha256(f"{email.lower()}:{code}:{os.environ.get('JWT_SECRET', '')}".encode()).hexdigest()
    r = db.email_otps.update_one({"email": email.lower(), "purpose": "registration"}, {"$set": {"hash": h, "attempts": 0}})
    print("otp set", r.matched_count)
elif cmd == "state":
    o = owner()
    print("sub", db.subscriptions.find_one({"owner_id": o["id"]}, {"_id": 0}))
    for v in db.venues.find({"owner_ids": o["id"]}, {"_id": 0, "id": 1, "name": 1, "status": 1}):
        print("venue", v, "courts", db.courts.count_documents({"venue_id": v["id"]}), "closures", db.venue_closures.count_documents({"venue_id": v["id"]}))
    print("history", db.subscription_history.count_documents({"owner_id": o["id"]}))
