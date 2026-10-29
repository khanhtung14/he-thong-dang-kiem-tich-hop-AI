import re
from datetime import date, datetime, time
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import AppointmentStatus, InspectionStatus, InspectionType, ItemResult, Role


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=6, max_length=128)
    display_name: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=5, max_length=255)
    phone: str = Field(min_length=6, max_length=30)
    identity_or_tax_number: str | None = Field(default=None, max_length=50)
    address: str | None = Field(default=None, max_length=500)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class RequirementsAnalysisRequest(BaseModel):
    requirement: str = Field(min_length=10, max_length=12000)


class RequirementsAnalysisResponse(BaseModel):
    analysis: str


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=16)


class ChatResponse(BaseModel):
    message: str


class OwnerCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=255)
    identity_or_tax_number: str = Field(min_length=1, max_length=50)
    phone: str = Field(min_length=1, max_length=30)
    address: str = Field(min_length=1)


class OwnerRead(OwnerCreate, ORMModel):
    id: int


class VehicleCreate(BaseModel):
    owner_id: int | None = None
    registration_number: str = Field(min_length=1, max_length=30)
    plate_classification: str | None = Field(default=None, max_length=30)
    chassis_number: str = Field(min_length=1, max_length=100)
    engine_number: str = Field(min_length=1, max_length=100)
    vehicle_type: str = Field(min_length=1, max_length=100)


class VehicleRead(VehicleCreate, ORMModel):
    id: int
    owner_id: int


class AppointmentCreate(BaseModel):
    vehicle_id: int
    appointment_date: date
    start_time: time
    end_time: time
    service_type: str = Field(min_length=1, max_length=40)


class AppointmentRead(AppointmentCreate, ORMModel):
    id: int
    code: str
    status: AppointmentStatus


OLD_CERT_REGEX = re.compile(r"^[A-Z0-9\-/]{6,30}$")


class InspectionBase(BaseModel):
    vehicle_id: int
    inspection_type: InspectionType
    intake_channel: str = Field(min_length=1, max_length=40)
    old_certificate_management_number: str | None = None
    registration_document_number: str | None = None
    insurance_contract_number: str | None = None
    insurance_expiry: date | None = None


class InspectionCreate(InspectionBase):
    @field_validator("old_certificate_management_number", mode="before")
    @classmethod
    def validate_old_cert(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = str(v).strip().upper()
        if not v:
            return None
        if not (6 <= len(v) <= 30):
            raise ValueError("Số quản lý GCN cũ phải có độ dài từ 6 đến 30 ký tự.")
        if not OLD_CERT_REGEX.match(v) or not re.search(r"[A-Z0-9]", v):
            raise ValueError(
                "Số quản lý GCN cũ không đúng định dạng (từ 6 đến 30 ký tự, gồm chữ cái, chữ số, '-' hoặc '/')"
            )
        return v

    @model_validator(mode="after")
    def validate_periodic_old_cert(self) -> "InspectionCreate":
        if self.inspection_type == InspectionType.PERIODIC and not self.old_certificate_management_number:
            raise ValueError("Kiểm định định kỳ bắt buộc phải có số quản lý GCN cũ")
        return self


class InspectionRead(InspectionBase, ORMModel):
    id: int
    code: str
    received_at: datetime
    status: InspectionStatus


class ItemResultCreate(BaseModel):
    stage: int = Field(ge=1, le=5)
    item_code: str = Field(min_length=1, max_length=100)
    result: ItemResult
    measured_value: Decimal | None = None
    unit: str | None = Field(default=None, max_length=40)


class ItemResultRead(ItemResultCreate, ORMModel):
    id: int
    inspection_id: int
    inspector_account_id: int
    recorded_at: datetime


class FinalizeInspectionRequest(BaseModel):
    # Inspector attests that the applicable checklist is complete. The story
    # does not define the authoritative checklist version or item catalog.
    checklist_complete: bool


class CertificateCreate(BaseModel):
    certificate_number: str | None = Field(default=None, max_length=100)
    stamp_number: str | None = Field(default=None, max_length=100)
    issued_on: date
    expires_on: date
    cycle: str = Field(min_length=1, max_length=80)
    emissions_standard: str = Field(min_length=1, max_length=80)
    payment_complete: bool
    legal_status_allowed: bool


class CertificateRead(CertificateCreate, ORMModel):
    id: int
    inspection_id: int
    vehicle_id: int
    status: str


class AccountContext(BaseModel):
    id: int
    username: str
    role: Role
    owner_id: int | None = None


class ProfileResponse(BaseModel):
    id: int
    username: str
    role: Role
    display_name: str | None = None
    email: str | None = None
    phone: str | None = None
    avatar_url: str | None = None


class ProfileUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=255)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=50)
    avatar_url: str | None = Field(default=None, max_length=1000000)
    current_password: str | None = Field(default=None, max_length=128)
    new_password: str | None = Field(default=None, max_length=128)


class AccountListItem(BaseModel):
    id: int
    username: str
    role: Role
    is_active: bool
    display_name: str | None = None
    email: str | None = None
    phone: str | None = None
    avatar_url: str | None = None
    owner_id: int | None = None


class AccountRoleUpdateRequest(BaseModel):
    role: Role


class AccountStatusUpdateRequest(BaseModel):
    is_active: bool


class AccountCreateAdminRequest(BaseModel):
    username: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=6, max_length=128)
    role: Role
    display_name: str | None = Field(default=None, max_length=255)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=50)


class AccountResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=6, max_length=128)


class AccountProfileUpdateAdminRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=255)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=50)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)


class ForgotPasswordResponse(BaseModel):
    message: str
    email: str
    username: str | None = None
    display_name: str | None = None
    dev_code: str | None = None


class ResetPasswordWithOtpRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    otp_code: str = Field(min_length=4, max_length=10)
    new_password: str = Field(min_length=6, max_length=128)


class VerifyOtpOnlyRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    otp_code: str = Field(min_length=4, max_length=10)


class AuditLogItem(BaseModel):
    id: int
    actor_account_id: int
    actor_username: str
    actor_display_name: str | None = None
    actor_role: Role
    entity_type: str
    entity_id: int
    action: str
    action_label: str
    before_value: str | None = None
    after_value: str | None = None
    created_at: datetime



