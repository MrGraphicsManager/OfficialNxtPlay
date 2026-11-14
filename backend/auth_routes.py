import hashlib
import os
import secrets
import smtplib
from datetime import timedelta
from email.message import EmailMessage

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from core import db, USER_PROJ, iso, now_utc, new_id, hash_pw, verify_pw, make_token, get_current_user, log

router = APIRouter(prefix="/api/auth")


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    age: int = Field(ge=5, le=100)
    otp: str = Field(min_length=6, max_length=6)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ProfileIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    age: int | None = Field(default=None, ge=5, le=100)
    mobile: str | None = Field(default=None, max_length=15)


class ChangePwIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)


class OtpRequestIn(BaseModel):
    email: EmailStr


def code_hash(email: str, code: str) -> str:
    return hashlib.sha256(f"{email.lower()}:{code}:{os.environ.get('JWT_SECRET', '')}".encode()).hexdigest()


def deliver_otp(email: str, code: str):
    host, sender = os.environ.get("SMTP_HOST"), os.environ.get("SMTP_FROM")
    if not host or not sender:
        raise HTTPException(503, "Email verification is not configured")
    message = EmailMessage()
    message["Subject"], message["From"], message["To"] = "Your NXTPLAY verification code", sender, email
    message.set_content(f"Your NXTPLAY verification code is {code}. It expires in 10 minutes.")
    with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", "587")), timeout=10) as smtp:
        if os.environ.get("SMTP_STARTTLS", "true").lower() == "true": smtp.starttls()
        if os.environ.get("SMTP_USERNAME"): smtp.login(os.environ["SMTP_USERNAME"], os.environ.get("SMTP_PASSWORD", ""))
        smtp.send_message(message)


@router.post("/registration-otp")
async def registration_otp(body: OtpRequestIn):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "An account with this email already exists")
    prior = await db.email_otps.find_one({"email": email, "purpose": "registration"})
    if prior and prior.get("sent_at", "") > iso(now_utc() - timedelta(seconds=60)):
        raise HTTPException(429, "Please wait one minute before requesting another code")
    code = f"{secrets.randbelow(1000000):06d}"
    doc = {"id": prior.get("id") if prior else new_id(), "email": email, "purpose": "registration", "hash": code_hash(email, code),
           "attempts": 0, "sent_at": iso(), "expires_at": iso(now_utc() + timedelta(minutes=10))}
    await db.email_otps.update_one({"email": email, "purpose": "registration"}, {"$set": doc}, upsert=True)
    deliver_otp(email, code)
    return {"ok": True}


@router.post("/register")
async def register(body: RegisterIn):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "An account with this email already exists")
    otp = await db.email_otps.find_one({"email": email, "purpose": "registration"})
    valid = otp and otp.get("expires_at", "") >= iso() and otp.get("attempts", 0) < 5 and secrets.compare_digest(otp.get("hash", ""), code_hash(email, body.otp))
    if not valid:
        if otp: await db.email_otps.update_one({"id": otp["id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(400, "Verification code is invalid or expired")
    user = {"id": new_id(), "name": body.name.strip(), "email": email, "age": body.age, "mobile": None,
            "role": "customer", "active": True, "password_hash": hash_pw(body.password), "created_at": iso()}
    await db.users.insert_one(user)
    await db.email_otps.delete_one({"id": otp["id"]})
    user.pop("_id", None)
    user.pop("password_hash")
    return {"token": make_token(user), "user": user}


@router.post("/login")
async def login(body: LoginIn):
    email = body.email.lower()
    u = await db.users.find_one({"email": email})
    if u and u.get("login_fail", {}).get("locked_until", "") > iso():
        raise HTTPException(429, "Too many failed attempts. Try again in 15 minutes.")
    if not u or not verify_pw(body.password, u["password_hash"]) or not u.get("active", True):
        if u:
            count = u.get("login_fail", {}).get("count", 0) + 1
            lf = {"count": count}
            if count >= 5:
                lf = {"count": 0, "locked_until": iso(now_utc() + timedelta(minutes=15))}
            await db.users.update_one({"id": u["id"]}, {"$set": {"login_fail": lf}})
        raise HTTPException(401, "Invalid email or password")
    await db.users.update_one({"id": u["id"]}, {"$unset": {"login_fail": ""}})
    user = await db.users.find_one({"id": u["id"]}, USER_PROJ)
    return {"token": make_token(user), "user": user}


@router.get("/me")
async def me(user=Depends(get_current_user)):
    return user


@router.patch("/me")
async def update_me(body: ProfileIn, user=Depends(get_current_user)):
    await db.users.update_one({"id": user["id"]}, {"$set": {"name": body.name.strip(), "age": body.age, "mobile": body.mobile}})
    return await db.users.find_one({"id": user["id"]}, USER_PROJ)


@router.post("/change-password")
async def change_password(body: ChangePwIn, user=Depends(get_current_user)):
    u = await db.users.find_one({"id": user["id"]})
    if not verify_pw(body.current_password, u["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_pw(body.new_password), "must_change_password": False}})
    return {"ok": True}


@router.post("/forgot-password")
async def forgot_password(body: ForgotIn):
    u = await db.users.find_one({"email": body.email.lower()})
    if u:
        token = secrets.token_urlsafe(32)
        await db.users.update_one({"id": u["id"]}, {"$set": {"reset": {
            "hash": hashlib.sha256(token.encode()).hexdigest(), "expires": iso(now_utc() + timedelta(hours=1))}}})
        # Email delivery is not configured yet; plug an email provider in here to send /reset-password?token=...
        log.info("Password reset requested for user %s (email delivery not configured)", u["id"])
    return {"ok": True, "message": "If the email is registered, a reset link will be sent."}


@router.post("/reset-password")
async def reset_password(body: ResetIn):
    h = hashlib.sha256(body.token.encode()).hexdigest()
    u = await db.users.find_one({"reset.hash": h})
    if not u or u["reset"]["expires"] < iso():
        raise HTTPException(400, "Reset link is invalid or expired")
    await db.users.update_one({"id": u["id"]}, {"$set": {"password_hash": hash_pw(body.new_password)}, "$unset": {"reset": ""}})
    return {"ok": True}
