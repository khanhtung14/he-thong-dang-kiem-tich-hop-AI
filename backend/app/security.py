from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pwdlib import PasswordHash
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Account, Role

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def create_access_token(account: Account) -> str:
    if not settings.jwt_secret:
        raise RuntimeError("JWT_SECRET must be configured before issuing tokens")
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    return jwt.encode(
        {"sub": str(account.id), "role": account.role.value, "iss": settings.jwt_issuer, "exp": expires},
        settings.jwt_secret,
        algorithm="HS256",
    )


def current_account(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> Account:
    unauthorized = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication credentials", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], issuer=settings.jwt_issuer)
        account_id = int(payload["sub"])
    except (JWTError, KeyError, TypeError, ValueError):
        raise unauthorized
    account = db.get(Account, account_id)
    if account is None or not account.is_active:
        raise unauthorized
    return account


def require_roles(*roles: Role):
    def dependency(account: Account = Depends(current_account)) -> Account:
        if account.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return account
    return dependency
