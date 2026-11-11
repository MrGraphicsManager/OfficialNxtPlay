import hashlib
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from core import db, USER_PROJ, iso, now_utc, new_id, hash_pw, verify_pw, make_token, get_current_user, log

router = APIRouter(prefix="/api/auth")


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    age: int = Field(ge=5, le=100)


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


@router.post("/register")
async def register(body: RegisterIn):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "An account with this email already exists")
    user = {"id": new_id(), "name": body.name.strip(), "email": email, "age": body.age, "mobile": None,
            "role": "customer", "active": True, "password_hash": hash_pw(body.password), "created_at": iso()}
    await db.users.insert_one(user)
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
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_pw(body.new_password)}})
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
