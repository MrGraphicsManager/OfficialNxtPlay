import os
import re
import ipaddress
import logging
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

logger = logging.getLogger("nxtplay.email")

EMAIL_BASE_URL = "https://integrations.emergentagent.com"

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} does not match link host {real!r} (G3)")


def is_email_configured() -> bool:
    return bool(os.environ.get("EMERGENT_EMAIL_KEY") or os.environ.get("RESEND_API_KEY"))


async def send_email(*, to: str, subject: str, html: str) -> str | None:
    _assert_safe_email(subject, html)
    from_name = os.environ.get("EMAIL_FROM_NAME", "NXTPLAY")
    payload = {"to": [to], "subject": subject, "html": html, "from_name": from_name}
    if os.environ.get("EMAIL_REPLY_TO"):
        payload["contact_email"] = os.environ["EMAIL_REPLY_TO"]

    # 1. Emergent managed email proxy
    emergent_key = os.environ.get("EMERGENT_EMAIL_KEY")
    if emergent_key:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                                         headers={"X-Email-Key": emergent_key}, json=payload)
            resp.raise_for_status()
            return resp.json().get("id")
        except httpx.HTTPStatusError as e:
            try:
                code = e.response.json().get("code", "")
            except ValueError:
                code = ""
            if code in ("insufficient_credits", "integration_disabled", "daily_limit_reached"):
                logger.warning("Email paused: %s (%s)", code, e.response.status_code)
                raise HTTPException(503, "Email is temporarily unavailable")
            logger.error("Email send failed: %s", e.response.status_code)
            raise HTTPException(502, "Failed to send email")
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Email send error: %s", str(e)[:200])
            raise HTTPException(500, "Failed to send email")

    # 2. Direct Resend API
    resend_key = os.environ.get("RESEND_API_KEY")
    if resend_key:
        from_email = os.environ.get("EMAIL_FROM", f"{from_name} <onboarding@resend.dev>")
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post("https://api.resend.com/emails",
                                         headers={"Authorization": f"Bearer {resend_key}", "Content-Type": "application/json"},
                                         json={"from": from_email, "to": [to], "subject": subject, "html": html})
            resp.raise_for_status()
            return resp.json().get("id")
        except Exception as e:
            logger.error("Resend send error: %s", str(e)[:200])
            raise HTTPException(500, "Failed to send email via Resend")

    logger.warning("No email provider configured (EMERGENT_EMAIL_KEY or RESEND_API_KEY not set). Email simulated for %s: %s", to, subject)
    return None


def _app_url(path: str = "") -> str:
    base = os.environ.get("APP_PUBLIC_URL", "https://nxtplay.live")
    return base.rstrip("/") + path


def _wrap(title: str, body_html: str) -> str:
    brand = escape(os.environ.get("EMAIL_FROM_NAME", "NXTPLAY"))
    return (f'<table role="presentation" width="100%" style="background:#080808"><tr><td style="padding:28px;'
            f'font-family:Arial,sans-serif;color:#ffffff">'
            f'<p style="font-size:22px;font-weight:bold;color:#C8FF00;margin:0 0 16px">{brand}</p>'
            f'<p style="font-size:18px;font-weight:bold;margin:0 0 12px">{escape(title)}</p>{body_html}'
            f'<p style="font-size:12px;color:#A1A1AA;margin-top:24px">Sent by {brand}. We never ask for your password '
            f'or card details by email.</p></td></tr></table>')


def _button(href: str, label: str) -> str:
    return (f'<p><a href="{escape(href)}" style="display:inline-block;background:#C8FF00;color:#080808;'
            f'padding:12px 20px;font-weight:bold;text-decoration:none">{escape(label)}</a></p>')


async def send_otp(email: str, code: str):
    html = _wrap("Your verification code",
                 f'<p>Use this code to finish creating your account:</p>'
                 f'<p style="font-size:30px;letter-spacing:6px;font-weight:bold;color:#C8FF00">{escape(code)}</p>'
                 f'<p style="color:#A1A1AA">It expires in 10 minutes. If you did not request it, you can ignore this email.</p>')
    await send_email(to=email, subject="Your NXTPLAY verification code", html=html)


async def send_owner_invite(owner: dict, token: str, plan_label: str):
    link = _app_url(f"/reset-password?token={token}")
    html = _wrap("Your venue owner account is ready",
                 f'<p>Hi {escape(owner["name"])}, NXTPLAY has created your venue owner account ({escape(plan_label)}).</p>'
                 f'<p>Set your own password with this secure link. It works once and expires in 72 hours.</p>'
                 f'{_button(link, "Set up my account")}'
                 f'<p>Then sign in with {escape(owner["email"])}. If your NXTPLAY admin gave you a temporary password, '
                 f'you will be asked to replace it at first login. Next, authorize your monthly plan to activate your dashboard.</p>')
    await send_email(to=owner["email"], subject="Set up your NXTPLAY venue owner account", html=html)


async def send_password_reset(user: dict, token: str):
    html = _wrap("Reset your password", f'<p>Hi {escape(user["name"])}, use this link within 1 hour to choose a new password.</p>'
                 f'{_button(_app_url(f"/reset-password?token={token}"), "Choose a new password")}'
                 f'<p style="color:#A1A1AA">If you did not ask for this, ignore this email.</p>')
    await send_email(to=user["email"], subject="Reset your NXTPLAY password", html=html)


async def send_subscription_notice(owner: dict, kind: str, detail: str):
    titles = {"reminder": "Your subscription renews soon", "failed": "Subscription payment failed",
              "expired": "Your subscription has expired"}
    html = _wrap(titles[kind], f'<p>Hi {escape(owner["name"])}, {escape(detail)}</p>'
                 f'{_button(_app_url("/owner/subscription"), "Open my subscription")}'
                 f'<p style="color:#A1A1AA">Your venue, courts, prices and booking history are always preserved.</p>')
    await send_email(to=owner["email"], subject=f"NXTPLAY: {titles[kind]}", html=html)
