import hashlib
import os
import secrets
from datetime import timedelta

import jwt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from core import db, USER_PROJ, iso, now_utc, new_id, hash_pw, verify_pw, make_token, get_current_user, log, JWT_SECRET
import emailer

router = APIRouter(prefix="/api/auth")


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    age: int = Field(ge=5, le=100)
    registration_token: str


class OtpVerifyIn(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


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


OTP_TTL_MINUTES = 10
OTP_COOLDOWN_SECONDS = 60
OTP_MAX_ATTEMPTS = 5
OTP_MAX_SENDS_PER_HOUR = 5


@router.post("/registration-otp")
async def registration_otp(body: OtpRequestIn):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "An account with this email already exists")
    prior = await db.email_otps.find_one({"email": email, "purpose": "registration"})
    now = now_utc()
    if prior and prior.get("sent_at", "") > iso(now - timedelta(seconds=OTP_COOLDOWN_SECONDS)):
        raise HTTPException(429, "Please wait one minute before requesting another code")
    window_start = prior.get("window_start") if prior else None
    sends = prior.get("sends", 0) if prior else 0
    if not window_start or window_start < iso(now - timedelta(hours=1)):
        window_start, sends = iso(now), 0
    if sends >= OTP_MAX_SENDS_PER_HOUR:
        raise HTTPException(429, "Too many codes requested. Try again in an hour.")
    code = f"{secrets.randbelow(1000000):06d}"
    doc = {"id": prior.get("id") if prior else new_id(), "email": email, "purpose": "registration", "hash": code_hash(email, code),
           "attempts": 0, "sent_at": iso(now), "expires_at": iso(now + timedelta(minutes=OTP_TTL_MINUTES)),
           "window_start": window_start, "sends": sends + 1}
    await db.email_otps.update_one({"email": email, "purpose": "registration"}, {"$set": doc}, upsert=True)
    log.info("Verification code generated for %s: %s", email, code)
    try:
        await emailer.send_otp(email, code)
    except HTTPException:
        raise
    except Exception as e:
        log.error("Failed to deliver verification code to %s: %s", email, e)
        raise HTTPException(500, "Could not send verification email")
    return {"ok": True, "expires_in_minutes": OTP_TTL_MINUTES}


@router.post("/verify-registration-otp")
async def verify_registration_otp(body: OtpVerifyIn):
    email = body.email.lower()
    otp = await db.email_otps.find_one({"email": email, "purpose": "registration"})
    if not otp or otp.get("expires_at", "") < iso():
        raise HTTPException(400, "Verification code expired. Request a new one.")
    if otp.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
        raise HTTPException(429, "Too many wrong attempts. Request a new code.")
    if not secrets.compare_digest(otp.get("hash", ""), code_hash(email, body.otp)):
        await db.email_otps.update_one({"id": otp["id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(400, "Incorrect verification code")
    await db.email_otps.delete_one({"id": otp["id"]})
    token = jwt.encode({"type": "registration", "email": email, "exp": now_utc() + timedelta(minutes=30)}, JWT_SECRET, algorithm="HS256")
    return {"registration_token": token}


@router.post("/register")
async def register(body: RegisterIn):
    email = body.email.lower()
    try:
        claim = jwt.decode(body.registration_token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(400, "Email verification expired. Please verify your email again.")
    if claim.get("type") != "registration" or claim.get("email") != email:
        raise HTTPException(400, "Email verification does not match this email")
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "An account with this email already exists")
    user = {"id": new_id(), "name": body.name.strip(), "email": email, "age": body.age, "mobile": None, "email_verified": True,
            "role": "customer", "active": True, "password_hash": hash_pw(body.password), "created_at": iso()}
    try:
        await db.users.insert_one(user)
    except Exception:
        raise HTTPException(400, "An account with this email already exists")
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
    if body.current_password == body.new_password:
        raise HTTPException(400, "Choose a new password different from the current one")
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
        try:
            await emailer.send_password_reset(u, token)
        except (HTTPException, ValueError):
            log.warning("Password reset email not delivered for user %s", u["id"])
    return {"ok": True, "message": "If the email is registered, a reset link will be sent."}


@router.post("/reset-password")
async def reset_password(body: ResetIn):
    h = hashlib.sha256(body.token.encode()).hexdigest()
    u = await db.users.find_one({"reset.hash": h})
    if not u or u["reset"]["expires"] < iso():
        raise HTTPException(400, "Reset link is invalid or expired")
    await db.users.update_one({"id": u["id"]}, {"$set": {"password_hash": hash_pw(body.new_password), "must_change_password": False},
                                               "$unset": {"reset": ""}})
    return {"ok": True}
