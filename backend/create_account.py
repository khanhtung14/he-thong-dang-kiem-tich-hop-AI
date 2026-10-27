import argparse
from getpass import getpass

from sqlalchemy import select

from app.database import Base, SessionLocal, engine
from app.models import Account, Owner, Role
from app.security import hash_password


def main():
    parser = argparse.ArgumentParser(description="Provision an internal or owner login account")
    parser.add_argument("username")
    parser.add_argument("role", choices=[role.value for role in Role])
    parser.add_argument("--owner-id", type=int)
    args = parser.parse_args()
    role = Role(args.role)
    password = getpass("Password: ")
    if len(password) < 12:
        parser.error("Password must be at least 12 characters")

    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        if db.scalar(select(Account).where(Account.username == args.username)):
            parser.error("Username already exists")
        if role == Role.OWNER:
            if args.owner_id is None or db.get(Owner, args.owner_id) is None:
                parser.error("An existing --owner-id is required for owner accounts")
        elif args.owner_id is not None:
            parser.error("--owner-id is only valid for owner accounts")
        account = Account(username=args.username, password_hash=hash_password(password), role=role, owner_id=args.owner_id)
        db.add(account)
        db.commit()
    print("Account created")


if __name__ == "__main__":
    main()
