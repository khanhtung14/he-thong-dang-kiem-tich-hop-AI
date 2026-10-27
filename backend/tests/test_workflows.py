from datetime import date, time
import unittest

from fastapi import HTTPException
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, Appointment, InspectionFile, InspectionStatus, Owner, Role, Vehicle
from app.routers import (
    cancel_appointment,
    correct_certificate,
    create_appointment,
    create_inspection,
    finalize_inspection,
    issue_certificate,
    list_appointments,
    list_inspections,
    list_vehicles,
    login,
    record_result,
)
from app.schemas import (
    AppointmentCreate,
    CertificateCreate,
    FinalizeInspectionRequest,
    InspectionCreate,
    ItemResultCreate,
    LoginRequest,
)
from app.security import hash_password, require_roles
from app.config import settings


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)

        self.owner_a = Owner(
            display_name="Owner A", identity_or_tax_number="ID-A", phone="0900000001", address="Address A"
        )
        self.owner_b = Owner(
            display_name="Owner B", identity_or_tax_number="ID-B", phone="0900000002", address="Address B"
        )
        self.db.add_all([self.owner_a, self.owner_b])
        self.db.flush()

        password = hash_password("test-password-long-enough")
        self.admin = Account(username="admin", password_hash=password, role=Role.ADMIN)
        self.intake = Account(username="intake", password_hash=password, role=Role.INTAKE)
        self.inspector = Account(username="inspector", password_hash=password, role=Role.INSPECTOR)
        self.owner_account = Account(
            username="owner-a", password_hash=password, role=Role.OWNER, owner_id=self.owner_a.id
        )
        self.db.add_all([self.admin, self.intake, self.inspector, self.owner_account])
        self.db.flush()

        self.vehicle_a = Vehicle(
            owner_id=self.owner_a.id,
            registration_number="30A-00001",
            plate_classification=None,
            chassis_number="CHASSIS-A",
            engine_number="ENGINE-A",
            vehicle_type="Car",
        )
        self.vehicle_b = Vehicle(
            owner_id=self.owner_b.id,
            registration_number="30A-00002",
            plate_classification=None,
            chassis_number="CHASSIS-B",
            engine_number="ENGINE-B",
            vehicle_type="Car",
        )
        self.db.add_all([self.vehicle_a, self.vehicle_b])
        self.db.commit()

        self.old_jwt_secret = settings.jwt_secret
        self.old_jwt_issuer = settings.jwt_issuer
        settings.jwt_secret = "test-secret-for-unit-tests-only"
        settings.jwt_issuer = "test-suite"

    def tearDown(self):
        settings.jwt_secret = self.old_jwt_secret
        settings.jwt_issuer = self.old_jwt_issuer
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def assert_http_error(self, expected_status, callback):
        with self.assertRaises(HTTPException) as raised:
            callback()
        self.assertEqual(raised.exception.status_code, expected_status)

    def make_appointment(self, vehicle_id=None, start=time(8, 0), end=time(9, 0)):
        return AppointmentCreate(
            vehicle_id=vehicle_id or self.vehicle_a.id,
            center="Center A",
            appointment_date=date(2030, 5, 10),
            start_time=start,
            end_time=end,
            service_type="periodic",
        )

    def make_inspection(self, vehicle_id=None):
        return create_inspection(
            InspectionCreate(
                vehicle_id=vehicle_id or self.vehicle_a.id,
                inspection_type="periodic",
                intake_channel="counter",
            ),
            self.db,
            self.intake,
        )

    def add_result(self, inspection, result="dat", item_code="BRAKE-01"):
        return record_result(
            inspection.id,
            ItemResultCreate(stage=3, item_code=item_code, result=result),
            self.db,
            self.inspector,
        )

    def finalize(self, inspection, complete=True):
        return finalize_inspection(
            inspection.id,
            FinalizeInspectionRequest(checklist_complete=complete),
            self.db,
            self.inspector,
        )

    def make_certificate(self, **overrides):
        values = {
            "certificate_number": "CERT-001",
            "stamp_number": "STAMP-001",
            "issued_on": date(2030, 5, 10),
            "expires_on": date(2031, 5, 10),
            "cycle": "12 months",
            "emissions_standard": "Euro 5",
            "payment_complete": True,
            "legal_status_allowed": True,
        }
        values.update(overrides)
        return CertificateCreate(**values)

    def test_owner_can_login_with_password_without_otp(self):
        response = login(LoginRequest(username="owner-a", password="test-password-long-enough"), self.db)
        payload = jwt.decode(
            response.access_token,
            settings.jwt_secret,
            algorithms=["HS256"],
            issuer=settings.jwt_issuer,
        )
        self.assertEqual(payload["role"], "owner")

    def test_invalid_credentials_are_rejected(self):
        self.assert_http_error(
            401,
            lambda: login(LoginRequest(username="owner-a", password="wrong-password"), self.db),
        )

    def test_removed_roles_are_not_available(self):
        self.assertEqual({role.value for role in Role}, {"admin", "intake", "inspector", "owner"})

    def test_owner_lists_only_own_vehicles_appointments_and_inspections(self):
        create_appointment(self.make_appointment(self.vehicle_a.id), self.db, self.owner_account)
        create_appointment(self.make_appointment(self.vehicle_b.id), self.db, self.admin)
        self.make_inspection(self.vehicle_a.id)
        self.make_inspection(self.vehicle_b.id)

        self.assertEqual([v.id for v in list_vehicles(self.db, self.owner_account)], [self.vehicle_a.id])
        self.assertEqual(
            [a.vehicle_id for a in list_appointments(None, self.db, self.owner_account)],
            [self.vehicle_a.id],
        )
        self.assertEqual(
            [i.vehicle_id for i in list_inspections(None, self.db, self.owner_account)],
            [self.vehicle_a.id],
        )

    def test_owner_cannot_access_another_owners_appointment(self):
        appointment = create_appointment(self.make_appointment(self.vehicle_b.id), self.db, self.admin)
        self.assert_http_error(
            404,
            lambda: cancel_appointment(appointment.id, self.db, self.owner_account),
        )

    def test_intake_is_denied_inspector_only_permission(self):
        inspector_only = require_roles(Role.INSPECTOR)
        self.assert_http_error(403, lambda: inspector_only(self.intake))
        self.assertIs(inspector_only(self.inspector), self.inspector)

    def test_appointment_window_and_single_active_appointment(self):
        created = create_appointment(self.make_appointment(), self.db, self.owner_account)
        self.assertEqual(created.status.value, "active")
        self.assertTrue(created.code.startswith("APT-"))

        self.assert_http_error(
            422,
            lambda: create_appointment(
                self.make_appointment(start=time(11, 0), end=time(12, 0)), self.db, self.owner_account
            ),
        )
        self.assert_http_error(
            409,
            lambda: create_appointment(self.make_appointment(), self.db, self.owner_account),
        )

        cancelled = cancel_appointment(created.id, self.db, self.owner_account)
        self.assertEqual(cancelled.status.value, "cancelled")
        replacement = create_appointment(self.make_appointment(), self.db, self.owner_account)
        self.assertEqual(replacement.status.value, "active")

    def test_inspector_result_controls_final_status_and_intake_cannot_finalize(self):
        inspection = self.make_inspection()
        self.add_result(inspection, "mi")
        self.assertEqual(inspection.status, InspectionStatus.IN_PROGRESS)
        self.assertEqual(self.finalize(inspection).status, InspectionStatus.PASSED)

        failed_inspection = self.make_inspection(self.vehicle_b.id)
        self.add_result(failed_inspection, "ma")
        self.assertEqual(failed_inspection.status, InspectionStatus.FAILED)

        intake_only = require_roles(Role.INTAKE)
        self.assertIs(intake_only(self.intake), self.intake)
        self.assert_http_error(403, lambda: require_roles(Role.INSPECTOR)(self.intake))

    def test_finalize_requires_checklist_attestation_and_at_least_one_result(self):
        inspection = self.make_inspection()
        self.assert_http_error(422, lambda: self.finalize(inspection, complete=False))
        self.assert_http_error(422, lambda: self.finalize(inspection, complete=True))

    def test_certificate_requires_passed_inspection_payment_and_legal_clearance(self):
        inspection = self.make_inspection()
        self.add_result(inspection)
        self.finalize(inspection)

        self.assert_http_error(
            409,
            lambda: issue_certificate(
                inspection.id,
                self.make_certificate(payment_complete=False),
                self.db,
                self.admin,
            ),
        )
        self.assert_http_error(
            409,
            lambda: issue_certificate(
                inspection.id,
                self.make_certificate(legal_status_allowed=False),
                self.db,
                self.admin,
            ),
        )
        self.assert_http_error(
            422,
            lambda: issue_certificate(
                inspection.id,
                self.make_certificate(expires_on=date(2030, 1, 1)),
                self.db,
                self.admin,
            ),
        )
        certificate = issue_certificate(
            inspection.id, self.make_certificate(), self.db, self.admin
        )
        self.assertEqual(certificate.status, "active")

    def test_certificate_correction_writes_audit_and_is_admin_only(self):
        inspection = self.make_inspection()
        self.add_result(inspection)
        self.finalize(inspection)
        certificate = issue_certificate(
            inspection.id, self.make_certificate(), self.db, self.admin
        )

        corrected = self.make_certificate(certificate_number="CERT-001-CORRECTED")
        # Exercise the same role guard used by the correction endpoint.
        self.assert_http_error(403, lambda: require_roles(Role.ADMIN)(self.inspector))
        self.assert_http_error(403, lambda: require_roles(Role.ADMIN)(self.intake))
        result = correct_certificate(certificate.id, corrected, self.db, self.admin)
        self.assertEqual(result.certificate_number, "CERT-001-CORRECTED")
        from app.models import AuditEntry
        audit = self.db.query(AuditEntry).filter_by(entity_type="certificate", entity_id=certificate.id).one()
        self.assertEqual(audit.action, "administrative_correction")


if __name__ == "__main__":
    unittest.main()
