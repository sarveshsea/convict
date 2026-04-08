"""
Simple password auth — single shared password stored in config.
Returns a session token (signed with the password itself as the secret).
Token is valid for 24h. No DB storage — stateless HMAC verification.
"""
from __future__ import annotations

import hashlib
import hmac
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from convict.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])

_TOKEN_TTL = 86_400  # 24 hours


def _make_token(ts: int) -> str:
    key = (settings.admin_password or "convict").encode()
    msg = str(ts).encode()
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


def verify_token(token: str) -> bool:
    """Returns True if token is valid and not expired."""
    if not token or "." not in token:
        return False
    ts_str, sig = token.split(".", 1)
    try:
        ts = int(ts_str)
    except ValueError:
        return False
    if time.time() - ts > _TOKEN_TTL:
        return False
    expected = _make_token(ts)
    return hmac.compare_digest(expected, sig)


class PasswordIn(BaseModel):
    password: str


@router.post("/verify")
async def verify_password(body: PasswordIn):
    """
    Check the admin password. Returns a 24h token on success.
    Frontend stores this in sessionStorage — no cookies needed.
    """
    admin = settings.admin_password or ""
    if not admin:
        # No password set — auth is disabled, always grant access
        ts = int(time.time())
        return {"token": f"{ts}.{_make_token(ts)}", "auth_disabled": True}

    if not hmac.compare_digest(body.password, admin):
        raise HTTPException(status_code=401, detail="Wrong password")

    ts = int(time.time())
    return {"token": f"{ts}.{_make_token(ts)}"}


@router.get("/status")
async def auth_status():
    """Lets the frontend know whether a password is configured at all."""
    return {"password_required": bool(settings.admin_password)}
