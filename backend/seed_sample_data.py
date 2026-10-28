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


DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "DemoOnly123!")


def main() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        demo_users = {
            "demo_admin": Role.ADMIN,
            "demo_intake": Role.INTAKE,
            "demo_inspector": Role.INSPECTOR,
        }
        accounts: dict[str, Account] = {}
        for username, role in demo_users.items():
            account = db.scalar(select(Account).where(Account.username == username))
            if account is None:
                account = Account(username=username, password_hash=hash_password(DEMO_PASSWORD), role=role, is_active=True)
                db.add(account)
                db.flush()
            accounts[username] = account

        owner_specs = [
            ("Nguyễn Minh An (DỮ LIỆU MẪU)", "DEMO-ID-0001", "0900000001", "Địa chỉ mẫu, không dùng cho giao dịch thực"),
            ("Công ty Vận tải Mẫu (DỮ LIỆU MẪU)", "DEMO-TAX-0002", "0900000002", "Địa chỉ doanh nghiệp mẫu"),
        ]
        owners: list[Owner] = []
        for name, identity, phone, address in owner_specs:
            owner = db.scalar(select(Owner).where(Owner.identity_or_tax_number == identity))
            if owner is None:
                owner = Owner(display_name=name, identity_or_tax_number=identity, phone=phone, address=address)
                db.add(owner)
                db.flush()
            owners.append(owner)

        demo_owner_acc = db.scalar(select(Account).where(Account.username == "demo_owner"))
        if demo_owner_acc is None:
            demo_owner_acc = Account(username="demo_owner", password_hash=hash_password(DEMO_PASSWORD), role=Role.OWNER, owner_id=owners[0].id, is_active=True)
            db.add(demo_owner_acc)
            db.flush()
        accounts["demo_owner"] = demo_owner_acc

        vehicle_specs = [
            (owners[0], "DEMO-51A-000.01", "Biển trắng", "DEMO-CHASSIS-0001", "DEMO-ENGINE-0001", "Ô tô con (mẫu)"),
            (owners[1], "DEMO-50H-000.02", "Biển vàng", "DEMO-CHASSIS-0002", "DEMO-ENGINE-0002", "Xe tải (mẫu)"),
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
                inspector_account_id=accounts["demo_inspector"].id,
                recorded_at=datetime.now(timezone.utc).replace(tzinfo=None)))

        db.commit()

    print("Sample data is ready (synthetic records are marked DEMO).")
    print(f"Demo usernames: {', '.join(demo_users)}")
    print("Demo password: set DEMO_PASSWORD before running, otherwise DemoOnly123!")
    print("No certificate, payment confirmation, or legal eligibility was seeded.")


if __name__ == "__main__":
    main()
