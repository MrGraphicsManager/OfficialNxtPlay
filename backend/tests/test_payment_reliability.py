import asyncio
import hashlib
import hmac
import importlib
import json
import os
import sys
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException


os.environ.setdefault("MONGO_URL", "mongodb://localhost/nxtplay-test")
os.environ.setdefault("DB_NAME", "nxtplay-test")
os.environ.setdefault("JWT_SECRET", "test-secret")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

core = importlib.import_module("core")
booking_routes = importlib.import_module("booking_routes")


def run(coroutine):
    return asyncio.run(coroutine)


def test_captured_payment_retries_booking_finalization(monkeypatch):
    payment = {"id": "payment-1", "booking_id": "booking-1", "razorpay_order_id": "order-1", "status": "captured", "method": "upi"}
    booking = {"id": "booking-1", "status": "pending_payment"}
    database = type("Database", (), {})()
    database.payments = type("Payments", (), {"find_one": AsyncMock(return_value=payment)})()
    database.bookings = type("Bookings", (), {"find_one": AsyncMock(return_value=booking)})()
    complete = AsyncMock(return_value={"id": "booking-1", "status": "confirmed"})
    monkeypatch.setattr(core, "db", database)
    monkeypatch.setattr(core, "complete_captured_payment", complete)

    result = run(core.confirm_paid_order("order-1", "payment-provider-id"))

    assert result["status"] == "confirmed"
    complete.assert_awaited_once_with(payment, booking, "upi")


class WebhookRequest:
    def __init__(self, body, signature, event_id="event-1"):
        self._body = body
        self.headers = {"x-razorpay-signature": signature, "x-razorpay-event-id": event_id}

    async def body(self):
        return self._body


def signed_request(event):
    body = json.dumps(event).encode()
    secret = "webhook-test-secret"
    signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return body, signature, secret


def test_webhook_marks_event_processed_only_after_success(monkeypatch):
    body, signature, secret = signed_request({"event": "payment.captured", "payload": {"payment": {"entity": {"order_id": "order-1", "id": "pay-1"}}}})
    marked = AsyncMock()
    confirm = AsyncMock(return_value={"status": "confirmed"})
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", secret)
    monkeypatch.setattr(booking_routes, "claim_webhook_event", AsyncMock(return_value="claimed"))
    monkeypatch.setattr(booking_routes, "mark_webhook_event", marked)
    monkeypatch.setattr(booking_routes, "confirm_paid_order", confirm)

    result = run(booking_routes.razorpay_webhook(WebhookRequest(body, signature)))

    assert result == {"status": "ok"}
    confirm.assert_awaited_once_with("order-1", "pay-1")
    marked.assert_awaited_once_with("event-1", "processed")


def test_webhook_records_failure_and_returns_retryable_status(monkeypatch):
    body, signature, secret = signed_request({"event": "payment.captured", "payload": {"payment": {"entity": {"order_id": "order-1", "id": "pay-1"}}}})
    marked = AsyncMock()
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", secret)
    monkeypatch.setattr(booking_routes, "claim_webhook_event", AsyncMock(return_value="claimed"))
    monkeypatch.setattr(booking_routes, "mark_webhook_event", marked)
    monkeypatch.setattr(booking_routes, "confirm_paid_order", AsyncMock(side_effect=HTTPException(503, "Payments are unavailable")))

    with pytest.raises(HTTPException) as error:
        run(booking_routes.razorpay_webhook(WebhookRequest(body, signature)))

    assert error.value.status_code == 503
    marked.assert_awaited_once_with("event-1", "failed", "Payments are unavailable")
