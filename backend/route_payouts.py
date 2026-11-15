import hmac
import json
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from pymongo.errors import DuplicateKeyError
from starlette.concurrency import run_in_threadpool

from core import db, NO_ID, iso, new_id, require_roles, rzp, lookup_hash, dec, enc, audit, owner_venue_ids, verify_webhook_signature, log

router = APIRouter(prefix="/api/route")
admin_dep, owner_dep = require_roles("admin"), require_roles("owner")
ACTIVATION = {"requested": "submitted", "needs_clarification": "needs_clarification", "under_review": "under_review",
              "activated": "activated", "suspended": "suspended"}
BUSINESS_TYPES = ("individual", "proprietorship", "partnership", "private_limited", "public_limited", "llp", "trust", "society",
                  "not_yet_registered")
BOOKING_SETTLEMENT = {"pending": "transfer_pending", "processed": "transferred", "settled": "settled", "failed": "transfer_failed",
                      "reversed": "reversed", "partially_reversed": "partially_reversed", "mismatch": "transfer_mismatch"}
FINAL_TRANSFER = ("reversed", "failed", "mismatch")


def route_enabled() -> bool:
    return os.environ.get("ROUTE_ENABLED", "").lower() == "true"


def view(la):
    if not la:
        return None
    out = {k: v for k, v in la.items() if not k.endswith("_enc") and k != "account_hash"}
    out["has_linked_account"] = bool(la.get("account_id_enc"))
    return out


async def activated_account_for_venue(venue_id: str):
    la = await db.linked_accounts.find_one({"venue_id": venue_id, "status": "activated"}, NO_ID)
    acc = dec(la.get("account_id_enc")) if la else None
    if not acc or lookup_hash(acc) != la["account_hash"]:
        return None
    return acc, la["account_hash"]


def order_transfers(acc_id: str, amount_paise: int, booking: dict):
    return [{"account": acc_id, "amount": amount_paise, "currency": "INR", "on_hold": 0,
             "notes": {"booking": booking["code"], "venue_id": booking["venue_id"]}, "linked_account_notes": ["booking"]}]


def transfer_status(t: dict) -> str:
    reversed_amt = int(t.get("amount_reversed") or 0)
    if reversed_amt:
        return "reversed" if reversed_amt >= int(t.get("amount") or 0) else "partially_reversed"
    if t.get("recipient_settlement_id"):
        return "settled"
    return {"processed": "processed", "failed": "failed", "reversed": "reversed"}.get(t.get("status"), "pending")


async def apply_transfers(pay: dict, items: list):
    route = pay["route"]
    for t in items:
        matches = lookup_hash(t.get("recipient", "")) == route["account_hash"] and int(t.get("amount") or 0) == route["amount_paise"]
        status = transfer_status(t) if matches else "mismatch"
        if not matches:
            log.error("Route transfer mismatch for booking %s", pay["booking_code"])
            await audit("razorpay", "route.transfer_mismatch", "booking", pay["booking_id"], {"transfer_status": t.get("status")})
        upd = {"route.transfer_status": status, "route.transfer_ref_enc": enc(t.get("id")), "route.updated_at": iso(),
               "route.amount_reversed_paise": int(t.get("amount_reversed") or 0)}
        if t.get("recipient_settlement_id"):
            upd["route.settlement_ref_enc"] = enc(t["recipient_settlement_id"])
        await db.payments.update_one({"id": pay["id"]}, {"$set": upd})
        b_upd = {"settlement_status": BOOKING_SETTLEMENT[status]}
        if status == "settled":
            b_upd["settlement_date"] = iso()
        await db.bookings.update_one({"id": pay["booking_id"]}, {"$set": b_upd})


async def sync_payment_transfers(pay: dict):
    client = rzp()
    if not client or not pay.get("route") or not pay.get("razorpay_payment_id"):
        return
    res = await run_in_threadpool(client.payment.transfers, pay["razorpay_payment_id"])
    await apply_transfers(pay, res.get("items", []))


async def after_capture(order_id: str):
    pay = await db.payments.find_one({"razorpay_order_id": order_id, "status": "captured"}, NO_ID)
    if not pay or not pay.get("route"):
        return
    await db.bookings.update_one({"id": pay["booking_id"], "settlement_status": {"$in": ["unsettled", None]}},
                                 {"$set": {"settlement_status": "transfer_pending"}})
    try:
        await sync_payment_transfers(pay)
    except Exception as e:
        log.warning("Route transfer sync deferred for %s: %s", pay["booking_code"], e)


class KycIn(BaseModel):
    legal_business_name: str = Field(min_length=3, max_length=200)
    business_type: str
    contact_name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    phone: str = Field(pattern=r"^[6-9]\d{9}$")
    category: str = Field(default="others", max_length=60)
    subcategory: str = Field(default="others", max_length=60)
    street1: str = Field(min_length=3, max_length=100)
    street2: str = Field(default="", max_length=100)
    city: str = Field(min_length=2, max_length=60)
    state: str = Field(min_length=2, max_length=60)
    postal_code: str = Field(pattern=r"^\d{6}$")
    business_pan: str | None = Field(default=None, pattern=r"^[A-Z]{5}\d{4}[A-Z]$")
    gst: str | None = Field(default=None, pattern=r"^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$")
    stakeholder_name: str = Field(min_length=2, max_length=100)
    stakeholder_pan: str = Field(pattern=r"^[A-Z]{5}\d{4}[A-Z]$")
    account_number: str = Field(pattern=r"^\d{9,18}$")
    ifsc_code: str = Field(pattern=r"^[A-Z]{4}0[A-Z0-9]{6}$")
    beneficiary_name: str = Field(min_length=2, max_length=120)
    tnc_accepted: bool


async def owned_venue(user, venue_id):
    if user.get("must_change_password"):
        raise HTTPException(403, "Change your temporary password first")
    if venue_id not in await owner_venue_ids(user):
        raise HTTPException(404, "Venue not found")


async def save(la_id, upd):
    await db.linked_accounts.update_one({"id": la_id}, {"$set": {**upd, "updated_at": iso()}})


@router.get("/owner/venues/{venue_id}")
async def owner_status(venue_id: str, user=Depends(owner_dep)):
    await owned_venue(user, venue_id)
    la = await db.linked_accounts.find_one({"venue_id": venue_id}, NO_ID)
    return {"linked_account": view(la), "route_enabled": route_enabled(), "payments_configured": bool(rzp())}


@router.post("/owner/venues/{venue_id}/kyc")
async def submit_kyc(venue_id: str, body: KycIn, user=Depends(owner_dep)):
    await owned_venue(user, venue_id)
    if body.business_type not in BUSINESS_TYPES or not body.tnc_accepted:
        raise HTTPException(400, "Choose a valid business type and accept the Razorpay terms")
    client = rzp()
    if not client:
        raise HTTPException(503, "Razorpay is not configured yet")
    la = await db.linked_accounts.find_one({"venue_id": venue_id}, NO_ID)
    if la and la.get("status") == "activated":
        raise HTTPException(400, "Payout account is already active")
    summary = {"legal_business_name": body.legal_business_name, "business_type": body.business_type, "contact_name": body.contact_name,
               "email": body.email, "phone_last4": body.phone[-4:], "city": body.city, "state": body.state,
               "bank_last4": body.account_number[-4:], "ifsc_code": body.ifsc_code, "beneficiary_name": body.beneficiary_name,
               "pan_last4": body.stakeholder_pan[-4:]}
    if not la:
        la = {"id": new_id(), "venue_id": venue_id, "owner_id": user["id"], "status": "draft", "created_at": iso(), "updated_at": iso()}
        try:
            await db.linked_accounts.insert_one(la)
        except DuplicateKeyError:
            raise HTTPException(409, "KYC submission already in progress")
        la.pop("_id", None)
    await save(la["id"], {"kyc": summary, "error": None, "submitted_by": user["id"]})
    try:
        acc = dec(la.get("account_id_enc"))
        if not acc:
            legal = {k: v for k, v in {"pan": body.business_pan, "gst": body.gst}.items() if v}
            created = await run_in_threadpool(client.account.create, {
                "email": body.email, "phone": body.phone, "type": "route", "reference_id": venue_id[:20],
                "legal_business_name": body.legal_business_name, "business_type": body.business_type, "contact_name": body.contact_name,
                "profile": {"category": body.category, "subcategory": body.subcategory, "addresses": {"registered": {
                    "street1": body.street1, "street2": body.street2 or body.city, "city": body.city, "state": body.state,
                    "postal_code": body.postal_code, "country": "IN"}}},
                **({"legal_info": legal} if legal else {})})
            acc = created["id"]
            await save(la["id"], {"account_id_enc": enc(acc), "account_hash": lookup_hash(acc), "status": "submitted"})
        if not la.get("stakeholder_id_enc"):
            st = await run_in_threadpool(client.stakeholder.create, acc, {"name": body.stakeholder_name, "email": body.email,
                                                                           "kyc": {"pan": body.stakeholder_pan}})
            await save(la["id"], {"stakeholder_id_enc": enc(st["id"])})
        prod_id = dec(la.get("product_id_enc"))
        if not prod_id:
            prod = await run_in_threadpool(client.product.requestProductConfiguration, acc, {"product_name": "route", "tnc_accepted": True})
            prod_id = prod["id"]
            await save(la["id"], {"product_id_enc": enc(prod_id)})
        prod = await run_in_threadpool(client.product.edit, acc, prod_id, {"settlements": {
            "account_number": body.account_number, "ifsc_code": body.ifsc_code, "beneficiary_name": body.beneficiary_name},
            "tnc_accepted": True})
        await save(la["id"], {"status": ACTIVATION.get(prod.get("activation_status"), "submitted"),
                              "requirements": prod.get("requirements", [])})
    except DuplicateKeyError:
        raise HTTPException(409, "This Razorpay account is already linked to another venue")
    except Exception as e:
        await save(la["id"], {"error": str(e)[:300]})
        raise HTTPException(502, f"Razorpay rejected the details: {str(e)[:200]}")
    await audit(user["id"], "route.kyc_submitted", "venue", venue_id)
    return view(await db.linked_accounts.find_one({"id": la["id"]}, NO_ID))


async def refresh_account(la):
    client = rzp()
    acc, prod_id = dec(la.get("account_id_enc")), dec(la.get("product_id_enc"))
    if not client or not acc:
        raise HTTPException(400, "No Razorpay linked account to refresh")
    if prod_id:
        p = await run_in_threadpool(client.product.fetch, acc, prod_id)
        status, reqs = ACTIVATION.get(p.get("activation_status"), la["status"]), p.get("requirements", [])
    else:
        a = await run_in_threadpool(client.account.fetch, acc)
        status, reqs = ("activated" if a.get("status") == "activated" else "under_review"), []
    await save(la["id"], {"status": status, "requirements": reqs})
    return status


class LinkIn(BaseModel):
    account_id: str = Field(pattern=r"^acc_[A-Za-z0-9]{6,30}$")


@router.get("/admin/accounts")
async def admin_accounts(user=Depends(admin_dep)):
    venues = await db.venues.find({}, {"_id": 0, "id": 1, "name": 1, "status": 1}).to_list(1000)
    las = {la["venue_id"]: view(la) async for la in db.linked_accounts.find({}, NO_ID)}
    return {"route_enabled": route_enabled(), "venues": [{**v, "linked_account": las.get(v["id"])} for v in venues]}


@router.post("/admin/venues/{venue_id}/link")
async def admin_link(venue_id: str, body: LinkIn, user=Depends(admin_dep)):
    client = rzp()
    if not client:
        raise HTTPException(503, "Razorpay is not configured yet")
    if not await db.venues.find_one({"id": venue_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "Venue not found")
    try:
        await run_in_threadpool(client.account.fetch, body.account_id)
    except Exception as e:
        raise HTTPException(400, f"Razorpay could not find this linked account: {str(e)[:150]}")
    la = await db.linked_accounts.find_one({"venue_id": venue_id}, NO_ID)
    doc = {"account_id_enc": enc(body.account_id), "account_hash": lookup_hash(body.account_id), "product_id_enc": None,
           "status": "under_review", "error": None}
    try:
        if la:
            await save(la["id"], doc)
        else:
            la = {"id": new_id(), "venue_id": venue_id, "owner_id": None, "created_at": iso(), "updated_at": iso(), **doc}
            await db.linked_accounts.insert_one(la)
    except DuplicateKeyError:
        raise HTTPException(409, "This Razorpay account is already linked to another venue")
    la = await db.linked_accounts.find_one({"venue_id": venue_id}, NO_ID)
    await refresh_account(la)
    await audit(user["id"], "route.account_linked", "venue", venue_id)
    return view(await db.linked_accounts.find_one({"venue_id": venue_id}, NO_ID))


@router.post("/admin/venues/{venue_id}/refresh")
async def admin_refresh(venue_id: str, user=Depends(admin_dep)):
    la = await db.linked_accounts.find_one({"venue_id": venue_id}, NO_ID)
    if not la:
        raise HTTPException(404, "No payout account for this venue")
    await refresh_account(la)
    return view(await db.linked_accounts.find_one({"id": la["id"]}, NO_ID))


async def reconcile():
    done = failed = 0
    async for pay in db.payments.find({"route": {"$exists": True}, "status": "captured",
                                       "route.transfer_status": {"$nin": list(FINAL_TRANSFER)}}, NO_ID).limit(500):
        try:
            await sync_payment_transfers(pay)
            done += 1
        except Exception as e:
            failed += 1
            log.warning("Reconcile failed for %s: %s", pay["booking_code"], e)
    return {"checked": done, "errors": failed}


@router.post("/admin/reconcile")
async def admin_reconcile(user=Depends(admin_dep)):
    return await reconcile()


@router.post("/cron/reconcile")
async def cron_reconcile(request: Request):
    secret = os.environ.get("CRON_SECRET", "")
    if not secret or not hmac.compare_digest(request.headers.get("authorization", ""), f"Bearer {secret}"):
        raise HTTPException(401, "Unauthorized")
    return await reconcile()


@router.post("/webhook")
async def route_webhook(request: Request):
    body = await request.body()
    if not verify_webhook_signature(body, request.headers.get("x-razorpay-signature", "")):
        raise HTTPException(400, "Invalid webhook signature")
    event_id = request.headers.get("x-razorpay-event-id")
    if not event_id:
        raise HTTPException(400, "Missing event id")
    try:
        await db.route_webhook_events.insert_one({"event_id": event_id, "received_at": iso()})
    except DuplicateKeyError:
        return {"status": "duplicate"}
    data = json.loads(body)
    event, payload = data.get("event", ""), data.get("payload", {})
    try:
        if event.startswith("transfer."):
            t = payload.get("transfer", {}).get("entity", {})
            pay = await db.payments.find_one({"razorpay_payment_id": t.get("source"), "route": {"$exists": True}}, NO_ID)
            if pay:
                await apply_transfers(pay, [t])
        elif event.startswith("product.route.") or event.startswith("account."):
            acc = payload.get("account", {}).get("entity", {}).get("id") or payload.get("merchant_product", {}).get("entity", {}).get("merchant_id")
            la = await db.linked_accounts.find_one({"account_hash": lookup_hash(acc or "")}, NO_ID)
            if la:
                await refresh_account(la)
    except Exception:
        await db.route_webhook_events.delete_one({"event_id": event_id})
        log.exception("Route webhook %s failed", event)
        raise HTTPException(503, "Temporary processing failure")
    return {"status": "ok"}
