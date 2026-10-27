from datetime import date, datetime, time
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import AppointmentStatus, InspectionStatus, InspectionType, ItemResult, Role


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LoginRequest(BaseModel):
    username: str
    password: str


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
    owner_id: int
    registration_number: str = Field(min_length=1, max_length=30)
    plate_classification: str | None = Field(default=None, max_length=30)
    chassis_number: str = Field(min_length=1, max_length=100)
    engine_number: str = Field(min_length=1, max_length=100)
    vehicle_type: str = Field(min_length=1, max_length=100)


class VehicleRead(VehicleCreate, ORMModel):
    id: int


class AppointmentCreate(BaseModel):
    vehicle_id: int
    center: str = Field(min_length=1, max_length=160)
    appointment_date: date
    start_time: time
    end_time: time
    service_type: str = Field(min_length=1, max_length=40)


class AppointmentRead(AppointmentCreate, ORMModel):
    id: int
    code: str
    status: AppointmentStatus


class InspectionCreate(BaseModel):
    vehicle_id: int
    inspection_type: InspectionType
    intake_channel: str = Field(min_length=1, max_length=40)
    old_certificate_management_number: str | None = None
    registration_document_number: str | None = None
    insurance_contract_number: str | None = None
    insurance_expiry: date | None = None


class InspectionRead(InspectionCreate, ORMModel):
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
    certificate_number: str = Field(min_length=1, max_length=100)
    stamp_number: str = Field(min_length=1, max_length=100)
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
