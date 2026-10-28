from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum

from sqlalchemy import Boolean, Date, DateTime, Enum as SqlEnum, ForeignKey, Integer, Numeric, String, Text, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Role(str, Enum):
    ADMIN = "admin"
    INTAKE = "intake"
    INSPECTOR = "inspector"
    OWNER = "owner"


class AppointmentStatus(str, Enum):
    ACTIVE = "active"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


class InspectionType(str, Enum):
    FIRST = "first"
    PERIODIC = "periodic"


class InspectionStatus(str, Enum):
    RECEIVED = "received"
    NEEDS_DOCUMENTS = "needs_documents"
    IN_PROGRESS = "in_progress"
    PASSED = "passed"
    FAILED = "failed"


class ItemResult(str, Enum):
    PASS = "dat"
    MINOR = "mi"
    MAJOR = "ma"
    DANGEROUS = "dd"


class CertificateStatus(str, Enum):
    ACTIVE = "active"
    EXPIRED = "expired"
    SUPERSEDED = "superseded"
    REVOKED = "revoked"
    VOID = "void"


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(SqlEnum(Role, native_enum=False), index=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("owners.id"), nullable=True, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    owner: Mapped["Owner | None"] = relationship(back_populates="account", foreign_keys=[owner_id])


class Owner(Base):
    __tablename__ = "owners"
    id: Mapped[int] = mapped_column(primary_key=True)
    display_name: Mapped[str] = mapped_column(String(255))
    identity_or_tax_number: Mapped[str] = mapped_column(String(50), index=True)
    phone: Mapped[str] = mapped_column(String(30), index=True)
    address: Mapped[str] = mapped_column(Text)
    account: Mapped["Account | None"] = relationship(back_populates="owner", foreign_keys="Account.owner_id", uselist=False)
    vehicles: Mapped[list["Vehicle"]] = relationship(back_populates="owner")


class Vehicle(Base):
    __tablename__ = "vehicles"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("owners.id"), index=True)
    registration_number: Mapped[str] = mapped_column(String(30), index=True)
    plate_classification: Mapped[str | None] = mapped_column(String(30), nullable=True)
    chassis_number: Mapped[str] = mapped_column(String(100), index=True)
    engine_number: Mapped[str] = mapped_column(String(100))
    vehicle_type: Mapped[str] = mapped_column(String(100))
    owner: Mapped[Owner] = relationship(back_populates="vehicles")
    appointments: Mapped[list["Appointment"]] = relationship(back_populates="vehicle")
    inspections: Mapped[list["InspectionFile"]] = relationship(back_populates="vehicle")


class Appointment(Base):
    __tablename__ = "appointments"
    __table_args__ = (UniqueConstraint("vehicle_id", "active_guard", name="uq_active_appointment_per_vehicle"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    appointment_date: Mapped[date] = mapped_column(Date)
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    service_type: Mapped[str] = mapped_column(String(40))
    status: Mapped[AppointmentStatus] = mapped_column(SqlEnum(AppointmentStatus, native_enum=False), default=AppointmentStatus.ACTIVE)
    active_guard: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vehicle: Mapped[Vehicle] = relationship(back_populates="appointments")


class InspectionFile(Base):
    __tablename__ = "inspection_files"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    inspection_type: Mapped[InspectionType] = mapped_column(SqlEnum(InspectionType, native_enum=False))
    intake_channel: Mapped[str] = mapped_column(String(40))
    received_at: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[InspectionStatus] = mapped_column(SqlEnum(InspectionStatus, native_enum=False), default=InspectionStatus.RECEIVED)
    old_certificate_management_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    registration_document_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    insurance_contract_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    insurance_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    vehicle: Mapped[Vehicle] = relationship(back_populates="inspections")
    results: Mapped[list["InspectionItem"]] = relationship(back_populates="inspection", cascade="all, delete-orphan")
    certificates: Mapped[list["Certificate"]] = relationship(back_populates="inspection")


class InspectionItem(Base):
    __tablename__ = "inspection_items"
    __table_args__ = (UniqueConstraint("inspection_id", "stage", "item_code", name="uq_inspection_stage_item"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    inspection_id: Mapped[int] = mapped_column(ForeignKey("inspection_files.id"), index=True)
    stage: Mapped[int] = mapped_column(Integer)
    item_code: Mapped[str] = mapped_column(String(100))
    result: Mapped[ItemResult] = mapped_column(SqlEnum(ItemResult, native_enum=False))
    measured_value: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(40), nullable=True)
    inspector_account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    approved_by_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime)
    inspection: Mapped[InspectionFile] = relationship(back_populates="results")


class Certificate(Base):
    __tablename__ = "certificates"
    id: Mapped[int] = mapped_column(primary_key=True)
    certificate_number: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    stamp_number: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    inspection_id: Mapped[int] = mapped_column(ForeignKey("inspection_files.id"), index=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    issued_on: Mapped[date] = mapped_column(Date)
    expires_on: Mapped[date] = mapped_column(Date)
    cycle: Mapped[str] = mapped_column(String(80))
    emissions_standard: Mapped[str] = mapped_column(String(80))
    payment_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    legal_status_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[CertificateStatus] = mapped_column(SqlEnum(CertificateStatus, native_enum=False), default=CertificateStatus.ACTIVE)
    inspection: Mapped[InspectionFile] = relationship(back_populates="certificates")


class AuditEntry(Base):
    __tablename__ = "audit_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    actor_account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    entity_type: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(80))
    before_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    after_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
