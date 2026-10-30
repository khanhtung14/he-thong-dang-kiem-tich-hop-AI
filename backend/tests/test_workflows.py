from datetime import date, time
import unittest
from unittest import mock

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
    list_certificates,
    list_inspections,
    list_vehicles,
    login,
    record_result,
    list_system_accounts,
    update_account_role,
    update_account_status,
    create_system_account,
    reset_account_password,
    update_account_profile_admin,
    delete_account,
    delete_owner,
    delete_vehicle,
    create_owner,
    create_vehicle,
    send_forgot_password_otp,
    verify_otp_only,
    verify_otp_and_reset_password,
    _password_reset_otps,
    register,
)
from app.schemas import (
    AppointmentCreate,
    CertificateCreate,
    FinalizeInspectionRequest,
    InspectionCreate,
    ItemResultCreate,
    LoginRequest,
    AccountRoleUpdateRequest,
    AccountStatusUpdateRequest,
    AccountCreateAdminRequest,
    AccountResetPasswordRequest,
    OwnerCreate,
    VehicleCreate,
    AccountProfileUpdateAdminRequest,
    ForgotPasswordRequest,
    VerifyOtpOnlyRequest,
    ResetPasswordWithOtpRequest,
    RegisterRequest,
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
            appointment_date=date(2030, 5, 10),
            start_time=start,
            end_time=end,
            service_type="periodic",
        )

    def make_inspection(self, vehicle_id=None, old_cert="KD-1234567", inspection_type="periodic"):
        return create_inspection(
            InspectionCreate(
                vehicle_id=vehicle_id or self.vehicle_a.id,
                inspection_type=inspection_type,
                intake_channel="counter",
                old_certificate_management_number=old_cert,
            ),
            self.db,
            self.intake,
        )

    def add_result(self, inspection, result="dat", item_code="BRAKE-01", stage=3):
        return record_result(
            inspection.id,
            ItemResultCreate(stage=stage, item_code=item_code, result=result),
            self.db,
            self.inspector,
        )

    def add_all_stages(self, inspection, result="dat"):
        for s in (1, 2, 3, 4, 5):
            record_result(
                inspection.id,
                ItemResultCreate(stage=s, item_code=f"ITEM-{s}", result=result),
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

    def test_locked_account_login_returns_403(self):
        self.owner_account.is_active = False
        self.db.commit()
        with self.assertRaises(HTTPException) as ctx:
            login(LoginRequest(username="owner-a", password="test-password-long-enough"), self.db)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("đang bị khóa", ctx.exception.detail)
        self.owner_account.is_active = True
        self.db.commit()

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
        self.assertEqual(
            [c.vehicle_id for c in list_certificates(None, self.db, self.owner_account)],
            [],
        )
        self.assertIsInstance(list_certificates(None, self.db, self.admin), list)

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
        self.add_all_stages(inspection, "mi")
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
        # Adding only 1 stage still raises 422 because all 5 stages are required
        self.add_result(inspection, "dat", stage=1)
        self.assert_http_error(422, lambda: self.finalize(inspection, complete=True))
        # Add remaining stages 2, 3, 4, 5 -> now succeeds
        for s in (2, 3, 4, 5):
            self.add_result(inspection, "dat", stage=s)
        self.assertEqual(self.finalize(inspection, complete=True).status, InspectionStatus.PASSED)

    def test_certificate_requires_passed_inspection_payment_and_legal_clearance(self):
        inspection = self.make_inspection()
        self.add_all_stages(inspection)
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
        self.add_all_stages(inspection)
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

    def test_periodic_requires_old_cert(self):
        with self.assertRaises(Exception):
            InspectionCreate(
                vehicle_id=self.vehicle_a.id,
                inspection_type="periodic",
                intake_channel="counter",
                old_certificate_management_number=None,
            )

    def test_old_cert_format_validation(self):
        # Too short (< 6)
        with self.assertRaises(Exception):
            InspectionCreate(
                vehicle_id=self.vehicle_a.id,
                inspection_type="periodic",
                intake_channel="counter",
                old_certificate_management_number="KD12",
            )
        # Invalid characters
        with self.assertRaises(Exception):
            InspectionCreate(
                vehicle_id=self.vehicle_a.id,
                inspection_type="periodic",
                intake_channel="counter",
                old_certificate_management_number="KD@#123456",
            )
        # Valid format with lowercase and whitespace should be cleaned/uppercased
        insp = InspectionCreate(
            vehicle_id=self.vehicle_a.id,
            inspection_type="periodic",
            intake_channel="counter",
            old_certificate_management_number="  kd-9876543  ",
        )
        self.assertEqual(insp.old_certificate_management_number, "KD-9876543")

    def test_first_inspection_optional_old_cert(self):
        # First-time inspection doesn't require old certificate number
        insp = InspectionCreate(
            vehicle_id=self.vehicle_a.id,
            inspection_type="first",
            intake_channel="counter",
            old_certificate_management_number=None,
        )
        self.assertIsNone(insp.old_certificate_management_number)

    def test_admin_account_management(self):
        # List accounts
        accounts = list_system_accounts(admin=self.admin, db=self.db)
        self.assertTrue(len(accounts) >= 4)

        # Create new account
        new_req = AccountCreateAdminRequest(
            username="new_inspector_user",
            password="securePassword123",
            role=Role.INSPECTOR,
            display_name="KTV Nguyễn Văn A",
            email="ktva@kiemdinh.vn",
            phone="0912345678",
        )
        created = create_system_account(body=new_req, admin=self.admin, db=self.db)
        self.assertEqual(created.username, "new_inspector_user")
        self.assertEqual(created.role, Role.INSPECTOR)
        self.assertTrue(created.is_active)

        # Update role
        role_req = AccountRoleUpdateRequest(role=Role.INTAKE)
        updated = update_account_role(account_id=created.id, body=role_req, admin=self.admin, db=self.db)
        self.assertEqual(updated.role, Role.INTAKE)

        # Can promote an account to ADMIN
        admin_role_req = AccountRoleUpdateRequest(role=Role.ADMIN)
        promoted = update_account_role(account_id=created.id, body=admin_role_req, admin=self.admin, db=self.db)
        self.assertEqual(promoted.role, Role.ADMIN)

        # Cannot delete an ADMIN account directly
        with self.assertRaises(HTTPException) as ctx:
            delete_account(account_id=created.id, admin=self.admin, db=self.db)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Không thể xóa tài khoản Quản trị viên", ctx.exception.detail)

        # Demote created back to INTAKE for remaining tests
        update_account_role(account_id=created.id, body=role_req, admin=self.admin, db=self.db)

        # Can create a new account with ADMIN role
        new_admin_req = AccountCreateAdminRequest(
            username="second_admin",
            password="password123",
            role=Role.ADMIN,
        )
        second_admin = create_system_account(body=new_admin_req, admin=self.admin, db=self.db)
        self.assertEqual(second_admin.role, Role.ADMIN)

        # Self-demotion prevention
        with self.assertRaises(HTTPException) as ctx:
            update_account_role(account_id=self.admin.id, body=role_req, admin=self.admin, db=self.db)
        self.assertEqual(ctx.exception.status_code, 400)

        # Toggle status (lock account)
        status_req = AccountStatusUpdateRequest(is_active=False)
        updated_status = update_account_status(account_id=created.id, body=status_req, admin=self.admin, db=self.db)
        self.assertFalse(updated_status.is_active)

        # Reset password
        pw_req = AccountResetPasswordRequest(new_password="newSecretPassword123")
        res = reset_account_password(account_id=created.id, body=pw_req, admin=self.admin, db=self.db)
        self.assertIn("thành công", res["message"])

        # Delete account: Cannot delete self
        with self.assertRaises(HTTPException) as ctx:
            delete_account(account_id=self.admin.id, admin=self.admin, db=self.db)
        self.assertEqual(ctx.exception.status_code, 400)

        # Delete account: Delete created account
        del_res = delete_account(account_id=created.id, admin=self.admin, db=self.db)
        self.assertIn("thành công", del_res["message"])

    @mock.patch("app.routers.send_otp_email")
    def test_forgot_password_flow(self, mock_send_email):
        # Set email for admin account
        self.admin.email = "admin_test@kiemdinh.gov.vn"
        self.db.commit()

        # Step 1: Send OTP with invalid email
        with self.assertRaises(HTTPException) as ctx:
            send_forgot_password_otp(ForgotPasswordRequest(email="nonexistent@kiemdinh.gov.vn"), db=self.db)
        self.assertEqual(ctx.exception.status_code, 404)

        # Step 1: Send OTP with valid email
        otp_res = send_forgot_password_otp(ForgotPasswordRequest(email="admin_test@kiemdinh.gov.vn"), db=self.db)
        mock_send_email.assert_called_once()
        self.assertIn("admin_test@kiemdinh.gov.vn", otp_res.message)
        otp_code = _password_reset_otps["admin_test@kiemdinh.gov.vn"]["code"]
        self.assertEqual(len(otp_code), 6)

        # Step 2: Verify with wrong code via verify_otp_only
        with self.assertRaises(HTTPException) as ctx2:
            verify_otp_only(
                VerifyOtpOnlyRequest(
                    email="admin_test@kiemdinh.gov.vn",
                    otp_code="000000",
                )
            )
        self.assertEqual(ctx2.exception.status_code, 400)

        # Step 2: Verify with correct code via verify_otp_only
        verify_res = verify_otp_only(
            VerifyOtpOnlyRequest(
                email="admin_test@kiemdinh.gov.vn",
                otp_code=otp_code,
            )
        )
        self.assertTrue(verify_res["verified"])

        # Step 3: Reset password
        reset_res = verify_otp_and_reset_password(
            ResetPasswordWithOtpRequest(
                email="admin_test@kiemdinh.gov.vn",
                otp_code=otp_code,
                new_password="BrandNewPass123!"
            ),
            db=self.db
        )
        self.assertIn("thành công", reset_res["message"])

        # Check login with new password
        login_res = login(LoginRequest(username="admin", password="BrandNewPass123!"), db=self.db)
        self.assertTrue(login_res.access_token)

    def test_owner_registration_with_required_email(self):
        # 1. Register without valid email raises 400
        with self.assertRaises(HTTPException) as ctx:
            register(
                RegisterRequest(
                    username="new_owner_1",
                    password="password123",
                    display_name="Nguyen Van A",
                    email="invalid-email",
                    phone="0911222333",
                    identity_or_tax_number="001201012345",
                ),
                db=self.db
            )
        self.assertEqual(ctx.exception.status_code, 400)

        # 1b. Register without identity_or_tax_number raises 400
        with self.assertRaises(HTTPException) as ctx_id:
            register(
                RegisterRequest(
                    username="new_owner_1",
                    password="password123",
                    display_name="Nguyen Van A",
                    email="owner1@example.com",
                    phone="0911222333",
                    identity_or_tax_number="",
                ),
                db=self.db
            )
        self.assertEqual(ctx_id.exception.status_code, 400)
        self.assertIn("số CCCD hoặc Mã số thuế", ctx_id.exception.detail)

        # 2. Register with valid required email and identity succeeds
        res = register(
            RegisterRequest(
                username="new_owner_1",
                password="password123",
                display_name="Nguyen Van A",
                email="owner1@example.com",
                phone="0911222333",
                identity_or_tax_number="001201012345",
            ),
            db=self.db
        )
        self.assertTrue(res.access_token)

        # Verify account created with email in DB
        acc = self.db.query(Account).filter(Account.username == "new_owner_1").first()
        self.assertIsNotNone(acc)
        self.assertEqual(acc.email, "owner1@example.com")
        self.assertEqual(acc.role, Role.OWNER)

        # 3. Duplicate email raises 400
        with self.assertRaises(HTTPException) as ctx_dup:
            register(
                RegisterRequest(
                    username="new_owner_2",
                    password="password123",
                    display_name="Nguyen Van B",
                    email="owner1@example.com",
                    phone="0988777666",
                    identity_or_tax_number="001201012346",
                ),
                db=self.db
            )
        self.assertEqual(ctx_dup.exception.status_code, 400)
        self.assertIn("đã được sử dụng", ctx_dup.exception.detail)

    def test_admin_update_account_profile(self):
        admin_acc = self.db.query(Account).filter(Account.username == "admin").first()
        target_acc = self.db.query(Account).filter(Account.username == "inspector").first()

        # 1. Update with valid profile info
        updated = update_account_profile_admin(
            account_id=target_acc.id,
            body=AccountProfileUpdateAdminRequest(
                display_name="Kiểm Định Viên Trưởng Chuyền",
                email="kiemdinh_truong@kiemdinh.gov.vn",
                phone="0911999888",
            ),
            admin=admin_acc,
            db=self.db,
        )
        self.assertEqual(updated.display_name, "Kiểm Định Viên Trưởng Chuyền")
        self.assertEqual(updated.email, "kiemdinh_truong@kiemdinh.gov.vn")
        self.assertEqual(updated.phone, "0911999888")

        # 2. Update with invalid email format raises 400
        with self.assertRaises(HTTPException) as ctx:
            update_account_profile_admin(
                account_id=target_acc.id,
                body=AccountProfileUpdateAdminRequest(email="invalid-email-string"),
                admin=admin_acc,
                db=self.db,
            )
        self.assertEqual(ctx.exception.status_code, 400)

        # 3. Update with duplicate email of another account raises 400
        admin_acc.email = "admin_check@example.com"
        self.db.commit()
        with self.assertRaises(HTTPException) as ctx_dup:
            update_account_profile_admin(
                account_id=target_acc.id,
                body=AccountProfileUpdateAdminRequest(email="admin_check@example.com"),
                admin=admin_acc,
                db=self.db,
            )
        self.assertEqual(ctx_dup.exception.status_code, 400)
        self.assertIn("đã được đăng ký", ctx_dup.exception.detail)




    def test_delete_owner_and_vehicle_lifecycle(self):
        # 1. Create owner
        owner = create_owner(
            body=OwnerCreate(
                display_name="Chủ xe Test Delete",
                identity_or_tax_number="TAX-DEL-001",
                phone="0987654321",
                address="123 Delete Street",
            ),
            account=self.admin,
            db=self.db,
        )
        self.assertIsNotNone(owner.id)

        # 2. Create vehicle
        vehicle = create_vehicle(
            body=VehicleCreate(
                owner_id=owner.id,
                registration_number="51H-999.88",
                chassis_number="CHASSIS-DEL-001",
                engine_number="ENGINE-DEL-001",
                vehicle_type="Ô tô con 5 chỗ",
            ),
            account=self.admin,
            db=self.db,
        )
        self.assertIsNotNone(vehicle.id)

        # 3. Create appointment
        app = create_appointment(
            body=AppointmentCreate(
                vehicle_id=vehicle.id,
                appointment_date=date(2026, 11, 20),
                start_time=time(8, 0),
                end_time=time(9, 0),
                service_type="Kiểm định định kỳ",
            ),
            account=self.admin,
            db=self.db,
        )

        # 4. Attempt to delete vehicle while active appointment exists -> should raise 400
        with self.assertRaises(HTTPException) as ctx_active:
            delete_vehicle(vehicle_id=vehicle.id, account=self.admin, db=self.db)
        self.assertEqual(ctx_active.exception.status_code, 400)

        # 5. Cancel appointment
        cancel_appointment(appointment_id=app.id, account=self.admin, db=self.db)

        # 6. Delete vehicle now succeeds and cascades cancelled appointment
        res_v = delete_vehicle(vehicle_id=vehicle.id, account=self.admin, db=self.db)
        self.assertIn("thành công", res_v["message"])

        # 7. Delete owner succeeds
        res_o = delete_owner(owner_id=owner.id, account=self.admin, db=self.db)
        self.assertIn("thành công", res_o["message"])

    def test_vehicle_cannot_book_new_registration_twice(self):
        # 1. Book new registration appointment for vehicle_a
        app = create_appointment(
            body=AppointmentCreate(
                vehicle_id=self.vehicle_a.id,
                appointment_date=date(2027, 1, 15),
                start_time=time(8, 0),
                end_time=time(9, 0),
                service_type="new_registration",
            ),
            account=self.owner_account,
            db=self.db,
        )
        self.assertIsNotNone(app.id)

        # 2. Intake inspection for vehicle_a, which completes appointment
        self.make_inspection(self.vehicle_a.id)

        # 3. Next time, owner tries to book new_registration again for vehicle_a -> should be rejected with 400
        with self.assertRaises(HTTPException) as ctx:
            create_appointment(
                body=AppointmentCreate(
                    vehicle_id=self.vehicle_a.id,
                    appointment_date=date(2027, 2, 20),
                    start_time=time(9, 0),
                    end_time=time(10, 0),
                    service_type="new_registration",
                ),
                account=self.owner_account,
                db=self.db,
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("đăng ký xe mới", ctx.exception.detail)

if __name__ == "__main__":
    unittest.main()

