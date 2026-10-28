"""Create clearly synthetic, idempotent records for local development only."""

import os
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select

from app.database import Base, SessionLocal, engine
from app.models import (
    Account, Appointment, AppointmentStatus, InspectionFile, InspectionItem,
    InspectionStatus, InspectionType, ItemResult, Owner, Role, Vehicle,
)
from app.security import hash_password


DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "123")


def main() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        # Migration from old demo names if they exist
        rename_map = {
            "demo_admin": "admin",
            "demo_intake": "tiepnhanhoso",
            "demo_inspector": "kiemdinhvien",
            "demo_owner": "chuxe",
        }
        for old_u, new_u in rename_map.items():
            old_acc = db.scalar(select(Account).where(Account.username == old_u))
            new_acc = db.scalar(select(Account).where(Account.username == new_u))
            if old_acc and not new_acc:
                old_acc.username = new_u
                old_acc.password_hash = hash_password(DEMO_PASSWORD)
            elif old_acc and new_acc:
                new_acc.password_hash = hash_password(DEMO_PASSWORD)
                db.delete(old_acc)
        db.flush()

        demo_users = {
            "admin": (Role.ADMIN, "admin@kiemdinh.gov.vn", "Quản Trị Viên"),
            "tiepnhanhoso": (Role.INTAKE, "tiepnhan@kiemdinh.gov.vn", "Tiếp Nhận Hồ Sơ"),
            "kiemdinhvien": (Role.INSPECTOR, "kiemdinh@kiemdinh.gov.vn", "Kiểm Định Viên"),
        }
        accounts: dict[str, Account] = {}
        for username, (role, email, dname) in demo_users.items():
            account = db.scalar(select(Account).where(Account.username == username))
            if account is None:
                account = Account(username=username, password_hash=hash_password(DEMO_PASSWORD), role=role, is_active=True, email=email, display_name=dname)
                db.add(account)
                db.flush()
            else:
                account.password_hash = hash_password(DEMO_PASSWORD)
                account.role = role
                account.is_active = True
                if not account.email:
                    account.email = email
                if not account.display_name:
                    account.display_name = dname
            accounts[username] = account

        owner_specs = [
            ("Nguyễn Minh An", "DEMO-ID-0001", "0900000001", "123 Nguyễn Văn Cừ, Quận 5, TP.HCM"),
            ("Công ty Vận tải An Phát", "DEMO-TAX-0002", "0900000002", "456 Lê Duẩn, Quận 1, TP.HCM"),
        ]
        owners: list[Owner] = []
        for name, identity, phone, address in owner_specs:
            owner = db.scalar(select(Owner).where(Owner.identity_or_tax_number == identity))
            if owner is None:
                owner = Owner(display_name=name, identity_or_tax_number=identity, phone=phone, address=address)
                db.add(owner)
                db.flush()
            owners.append(owner)

        chuxe_acc = db.scalar(select(Account).where(Account.username == "chuxe"))
        if chuxe_acc is None:
            chuxe_acc = Account(username="chuxe", password_hash=hash_password(DEMO_PASSWORD), role=Role.OWNER, owner_id=owners[0].id, is_active=True, email="chuxe@gmail.com", display_name="Nguyễn Minh An")
            db.add(chuxe_acc)
            db.flush()
        else:
            chuxe_acc.password_hash = hash_password(DEMO_PASSWORD)
            chuxe_acc.is_active = True
            if not chuxe_acc.email:
                chuxe_acc.email = "chuxe@gmail.com"
            if not chuxe_acc.display_name:
                chuxe_acc.display_name = "Nguyễn Minh An"
        accounts["chuxe"] = chuxe_acc

        vehicle_specs = [
            (owners[0], "DEMO-51A-000.01", "Biển trắng", "DEMO-CHASSIS-0001", "DEMO-ENGINE-0001", "Ô tô con"),
            (owners[1], "DEMO-50H-000.02", "Biển vàng", "DEMO-CHASSIS-0002", "DEMO-ENGINE-0002", "Xe tải"),
        ]
        vehicles: list[Vehicle] = []
        for owner, plate, plate_class, chassis, engine_number, vehicle_type in vehicle_specs:
            vehicle = db.scalar(select(Vehicle).where(Vehicle.registration_number == plate))
            if vehicle is None:
                vehicle = Vehicle(owner_id=owner.id, registration_number=plate, plate_classification=plate_class,
                                  chassis_number=chassis, engine_number=engine_number, vehicle_type=vehicle_type)
                db.add(vehicle)
                db.flush()
            vehicles.append(vehicle)

        if db.scalar(select(Appointment).where(Appointment.code == "DEMO-APT-0001")) is None:
            appointment_day = date.today() + timedelta(days=2)
            db.add(Appointment(code="DEMO-APT-0001", vehicle_id=vehicles[0].id,
                               appointment_date=appointment_day, start_time=time(8, 0), end_time=time(9, 0),
                               service_type="periodic", status=AppointmentStatus.ACTIVE, active_guard=1))

        first_inspection = db.scalar(select(InspectionFile).where(InspectionFile.code == "DEMO-INS-0001"))
        if first_inspection is None:
            first_inspection = InspectionFile(code="DEMO-INS-0001", vehicle_id=vehicles[0].id,
                inspection_type=InspectionType.PERIODIC, intake_channel="counter",
                received_at=datetime.now(timezone.utc).replace(tzinfo=None), status=InspectionStatus.RECEIVED,
                old_certificate_management_number="DEMO-OLD-CERT-01", registration_document_number="DEMO-REG-01")
            db.add(first_inspection)
            db.flush()

        second_inspection = db.scalar(select(InspectionFile).where(InspectionFile.code == "DEMO-INS-0002"))
        if second_inspection is None:
            second_inspection = InspectionFile(code="DEMO-INS-0002", vehicle_id=vehicles[1].id,
                inspection_type=InspectionType.FIRST, intake_channel="online",
                received_at=datetime.now(timezone.utc).replace(tzinfo=None), status=InspectionStatus.IN_PROGRESS)
            db.add(second_inspection)
            db.flush()

        if db.scalar(select(InspectionItem).where(
            InspectionItem.inspection_id == second_inspection.id,
            InspectionItem.stage == 1,
            InspectionItem.item_code == "DEMO-IDENTIFICATION",
        )) is None:
            db.add(InspectionItem(inspection_id=second_inspection.id, stage=1,
                item_code="DEMO-IDENTIFICATION", result=ItemResult.PASS,
                inspector_account_id=accounts["kiemdinhvien"].id,
                recorded_at=datetime.now(timezone.utc).replace(tzinfo=None)))

        db.commit()

    print("Sample data is ready (synthetic records are marked DEMO).")
    print(f"Usernames: {', '.join(demo_users)}, chuxe")
    print("Password: 123")
    print("No certificate, payment confirmation, or legal eligibility was seeded.")


if __name__ == "__main__":
    main()
