from app.email_service import send_otp_email
from datetime import date, datetime, time, timezone, timedelta
import logging
import random
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.config import settings
from app.models import (
    Account, Appointment, AppointmentStatus, AuditEntry, Certificate, CertificateStatus,
    InspectionFile, InspectionItem, InspectionStatus, ItemResult, Owner, Role, Vehicle,
)
from app.schemas import (
    AppointmentCreate, AppointmentRead, CertificateCreate, CertificateRead, InspectionCreate,
    InspectionRead, ItemResultCreate, ItemResultRead, LoginRequest, OwnerCreate, OwnerRead,
    FinalizeInspectionRequest, RegisterRequest, TokenResponse, VehicleCreate, VehicleRead,
    RequirementsAnalysisRequest, RequirementsAnalysisResponse,
    ChatRequest, ChatResponse, ProfileResponse, ProfileUpdateRequest,
    AccountListItem, AccountRoleUpdateRequest, AccountStatusUpdateRequest,
    AccountCreateAdminRequest, AccountResetPasswordRequest, AccountProfileUpdateAdminRequest,
    ForgotPasswordRequest, ForgotPasswordResponse, ResetPasswordWithOtpRequest,
    VerifyOtpOnlyRequest, AuditLogItem,
)
from app.security import create_access_token, current_account, hash_password, require_roles, verify_password

auth_router = APIRouter(prefix="/auth", tags=["authentication"])
api = APIRouter()

ACTION_LABELS: dict[str, str] = {
    "login": "Đăng nhập hệ thống",
    "register": "Đăng ký tài khoản",
    "create_account": "Tạo tài khoản",
    "update_role": "Phân quyền người dùng",
    "lock_account": "Khóa tài khoản",
    "unlock_account": "Mở khóa tài khoản",
    "reset_password": "Đặt lại mật khẩu",
    "update_profile": "Cập nhật hồ sơ",
    "create_owner": "Thêm chủ xe",
    "delete_owner": "Xóa chủ xe",
    "create_vehicle": "Đăng ký phương tiện",
    "delete_vehicle": "Xóa phương tiện",
    "create_appointment": "Đặt lịch hẹn",
    "cancel_appointment": "Hủy lịch hẹn",
    "create_inspection": "Tiếp nhận hồ sơ",
    "record_result": "Ghi nhận đo kiểm",
    "finalize_inspection": "Chốt kết luận kiểm định",
    "issue_certificate": "Cấp GCN / Tem",
    "administrative_correction": "Điều chỉnh hồ sơ",
}


def log_audit_event(
    db: Session,
    actor_id: int,
    entity_type: str,
    entity_id: int,
    action: str,
    before_value: str | None = None,
    after_value: str | None = None,
) -> None:
    try:
        entry = AuditEntry(
            actor_account_id=actor_id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            before_value=before_value,
            after_value=after_value,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        db.add(entry)
        db.flush()
    except Exception as e:
        logging.warning("Không thể ghi nhật ký thao tác: %s", e)


def ensure_sample_audit_entries(db: Session) -> None:
    existing_count = db.scalar(select(func.count(AuditEntry.id))) or 0
    if existing_count >= 5:
        return

    admin_acc = db.scalar(select(Account).where(Account.role == Role.ADMIN))
    intake_acc = db.scalar(select(Account).where(Account.role == Role.INTAKE))
    inspector_acc = db.scalar(select(Account).where(Account.role == Role.INSPECTOR))
    owner_acc = db.scalar(select(Account).where(Account.role == Role.OWNER))

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    sample_logs = []
    if owner_acc:
        sample_logs.append(
            AuditEntry(
                actor_account_id=owner_acc.id,
                entity_type="account",
                entity_id=owner_acc.id,
                action="login",
                before_value=None,
                after_value="Đăng nhập cổng trực tuyến chủ xe thành công",
                created_at=now - timedelta(hours=8, minutes=15),
            )
        )
        sample_logs.append(
            AuditEntry(
                actor_account_id=owner_acc.id,
                entity_type="appointment",
                entity_id=1,
                action="create_appointment",
                before_value=None,
                after_value="Đặt lịch kiểm định định kỳ xe DEMO-51A-000.01 lúc 08:00 - 09:00",
                created_at=now - timedelta(hours=7, minutes=50),
            )
        )

    if intake_acc:
        sample_logs.append(
            AuditEntry(
                actor_account_id=intake_acc.id,
                entity_type="inspection_file",
                entity_id=1,
                action="create_inspection",
                before_value=None,
                after_value="Tiếp nhận hồ sơ DEMO-INS-0001 xe DEMO-51A-000.01 tại quầy",
                created_at=now - timedelta(hours=5, minutes=30),
            )
        )
        sample_logs.append(
            AuditEntry(
                actor_account_id=intake_acc.id,
                entity_type="vehicle",
                entity_id=2,
                action="create_vehicle",
                before_value=None,
                after_value="Nhập thông tin phương tiện DEMO-50H-000.02 (Xe tải)",
                created_at=now - timedelta(hours=4, minutes=45),
            )
        )

    if inspector_acc:
        sample_logs.append(
            AuditEntry(
                actor_account_id=inspector_acc.id,
                entity_type="inspection_item",
                entity_id=1,
                action="record_result",
                before_value=None,
                after_value="Ghi kết quả đo trượt ngang và hiệu quả phanh chính: Đạt chuẩn",
                created_at=now - timedelta(hours=3, minutes=10),
            )
        )
        sample_logs.append(
            AuditEntry(
                actor_account_id=inspector_acc.id,
                entity_type="inspection_item",
                entity_id=2,
                action="record_result",
                before_value=None,
                after_value="Ghi nhận kiểm tra khí thải và độ ồn động cơ: Đạt chuẩn",
                created_at=now - timedelta(hours=2, minutes=35),
            )
        )
        sample_logs.append(
            AuditEntry(
                actor_account_id=inspector_acc.id,
                entity_type="inspection_file",
                entity_id=1,
                action="finalize_inspection",
                before_value="Trạng thái cũ: in_progress",
                after_value="Chốt kết luận kiểm định hồ sơ DEMO-INS-0001: Đạt yêu cầu kỹ thuật",
                created_at=now - timedelta(hours=1, minutes=40),
            )
        )

    if admin_acc:
        sample_logs.append(
            AuditEntry(
                actor_account_id=admin_acc.id,
                entity_type="account",
                entity_id=admin_acc.id,
                action="login",
                before_value=None,
                after_value="Đăng nhập quản trị viên trung tâm điều hành",
                created_at=now - timedelta(hours=1, minutes=15),
            )
        )
        if inspector_acc:
            sample_logs.append(
                AuditEntry(
                    actor_account_id=admin_acc.id,
                    entity_type="account",
                    entity_id=inspector_acc.id,
                    action="update_role",
                    before_value="Vai trò cũ: intake",
                    after_value="Phân quyền sang vai trò: inspector (Kiểm định viên)",
                    created_at=now - timedelta(minutes=45),
                )
            )

    for entry in sample_logs:
        db.add(entry)
    db.commit()



def generate_fallback_chat(query: str, role: Role, live_stats: dict | None = None) -> str:
    q = query.strip().lower()
    role_names = {
        Role.ADMIN: "Quản trị viên",
        Role.INTAKE: "Nhân viên tiếp nhận",
        Role.INSPECTOR: "Kiểm định viên",
        Role.OWNER: "Chủ xe",
    }
    current_role = role_names.get(role, "Người dùng")

    if live_stats and any(k in q for k in ["chờ", "bao nhiêu", "đang chờ", "số lượng", "trên chuyền", "tiến độ", "hiện tại", "thống kê", "xe chờ", "xe của tôi"]):
        if role == Role.OWNER:
            owner_name = live_stats.get("owner_name", "bạn")
            v_count = live_stats.get("owned_vehicles_count", 0)
            plates = ", ".join(live_stats.get("owned_vehicles_plates", [])) or "Chưa có"
            waiting_c = live_stats.get("owned_waiting_count", 0)
            in_prog_c = live_stats.get("owned_in_progress_count", 0)
            apt_c = live_stats.get("owned_appointments_count", 0)

            return (
                f"Dạ, theo dữ liệu tài khoản Chủ xe ({owner_name}):\n\n"
                f"- **Số lượng phương tiện của bạn:** {v_count} xe (Biển số: {plates})\n"
                f"- **Xe của bạn đang chờ kiểm định:** {waiting_c} xe\n"
                f"- **Xe của bạn đang kiểm tra trên chuyền:** {in_prog_c} xe\n"
                f"- **Lịch hẹn đã đặt:** {apt_c} lịch hẹn\n\n"
                f"*(Lưu ý: Theo chính sách bảo mật thông tin khách hàng, tài khoản Chủ xe chỉ hiển thị dữ liệu phương tiện do chính bạn sở hữu, không hiển thị dữ liệu xe của các chủ xe khác tại trạm).* "
            )
        elif role == Role.INSPECTOR:
            waiting_c = live_stats.get("waiting_count", 0)
            in_prog_c = live_stats.get("in_progress_count", 0)
            passed_c = live_stats.get("passed_count", 0)
            failed_c = live_stats.get("failed_count", 0)
            return (
                f"Báo cáo tiến độ kỹ thuật chuyền kiểm định (Dành cho Kiểm định viên):\n\n"
                f"- **Xe đang chờ vào chuyền:** {waiting_c} xe\n"
                f"- **Xe đang kiểm tra trên chuyền:** {in_prog_c} xe\n"
                f"- **Kết quả hồ sơ trong ca:** {passed_c} Đạt, {failed_c} Không đạt\n"
            )
        elif role == Role.INTAKE:
            apt_c = live_stats.get("today_appointments_count", 0)
            waiting_c = live_stats.get("waiting_count", 0)
            return (
                f"Tình hình bàn tiếp nhận hồ sơ (Dành cho Nhân viên tiếp nhận):\n\n"
                f"- **Lịch hẹn đăng kiểm hôm nay:** {apt_c} lượt hẹn\n"
                f"- **Hồ sơ đã tiếp nhận đang chờ vào chuyền:** {waiting_c} hồ sơ\n"
            )
        else:
            waiting_count = live_stats.get("waiting_count", 0)
            in_progress_count = live_stats.get("in_progress_count", 0)
            passed_count = live_stats.get("passed_count", 0)
            failed_count = live_stats.get("failed_count", 0)
            total_vehicles = live_stats.get("total_vehicles", 0)
            today_appointments = live_stats.get("today_appointments", 0)
            waiting_list_str = live_stats.get("waiting_list_str", "")

            msg = (
                f"Dạ Quản trị viên, số liệu tổng quan hệ thống hiện tại:\n\n"
                f"- **Số xe đang chờ vào kiểm tra:** {waiting_count} xe (trạng thái Chờ kiểm định)\n"
                f"- **Số xe đang kiểm tra trên chuyền:** {in_progress_count} xe (trạng thái Đang kiểm định)\n"
                f"- **Số hồ sơ đã hoàn tất:** {passed_count} xe Đạt, {failed_count} xe Không đạt\n"
                f"- **Lịch hẹn đăng kiểm hôm nay:** {today_appointments} lượt\n"
                f"- **Tổng số phương tiện trong hệ thống:** {total_vehicles} xe\n"
            )
            if waiting_list_str and waiting_list_str != "Không có phương tiện nào đang chờ hoặc đang kiểm tra.":
                msg += f"\n**Chi tiết phương tiện:**\n{waiting_list_str}\n"
            return msg

    if any(k in q for k in ["chào", "hello", "hi", "xin chào", "hey"]):
        return (
            f"Xin chào! Tôi là Trợ lý hỗ trợ hệ thống đăng kiểm phương tiện (vai trò: {current_role}). "
            "Tôi có thể hỗ trợ giải đáp quy trình nghiệp vụ, hướng dẫn thao tác tra cứu phương tiện, đặt lịch hẹn hoặc xử lý hồ sơ kiểm định. "
            "Bạn đang cần trợ giúp về phần nào?"
        )
    if any(k in q for k in ["xe", "phương tiện", "biển số", "số khung", "số máy"]):
        if role in (Role.ADMIN, Role.INTAKE):
            return "Để quản lý phương tiện, bạn chọn menu 'Phương tiện' ở cột bên trái. Tại đây bạn có thể tra cứu thông tin xe, biển số, số khung, số máy hoặc bấm nút '＋ Thêm phương tiện' để liên kết xe mới với chủ phương tiện."
        return "Để xem thông tin phương tiện, bạn truy cập mục 'Phương tiện' trên thanh điều hướng để tra cứu các phương tiện trong hệ thống."
    if any(k in q for k in ["lịch hẹn", "đặt lịch", "hẹn"]):
        if role in (Role.ADMIN, Role.INTAKE, Role.OWNER):
            return "Để xem hoặc đăng ký lịch đăng kiểm mới, bạn chọn mục 'Lịch hẹn' trên menu và bấm '＋ Tạo lịch hẹn'. Lưu ý chọn đúng khung giờ và mỗi xe chỉ được có một lịch hẹn đang hiệu lực."
        return "Bạn có thể vào menu 'Lịch hẹn' để theo dõi danh sách lịch hẹn kiểm định phương tiện theo ngày."
    if any(k in q for k in ["hồ sơ", "kiểm định", "tiếp nhận", "chứng nhận", "đạt", "không đạt", "checklist"]):
        if role == Role.INSPECTOR:
            return "Với vai trò Kiểm định viên, bạn vào 'Hồ sơ kiểm định', chọn hồ sơ cần xử lý và bấm 'Chi tiết'. Bạn có thể bấm '＋ Ghi kết quả' cho từng công đoạn (Đạt/Mi/Ma/DD). Sau khi hoàn thành tất cả công đoạn, chọn 'Chốt checklist hoàn tất' và cấp chứng nhận nếu hồ sơ đạt yêu cầu."
        if role in (Role.ADMIN, Role.INTAKE):
            return "Bạn có thể vào mục 'Hồ sơ kiểm định' để tiếp nhận hồ sơ mới ('＋ Tiếp nhận hồ sơ') theo các kênh: Tại quầy, Trực tuyến hoặc Bưu chính. Sau khi tiếp nhận, kiểm định viên sẽ ghi nhận kết quả kiểm tra phương tiện."
        return "Bạn có thể theo dõi tiến độ và kết quả hồ sơ kiểm định của phương tiện tại mục 'Hồ sơ kiểm định'."
    if any(k in q for k in ["chủ xe", "chu xe", "khách hàng", "khach hang"]):
        return "Thông tin chủ phương tiện được quản lý tại menu 'Chủ xe' (dành cho Quản trị viên và Nhân viên tiếp nhận), cho phép lưu trữ họ tên, CCCD/mã số thuế, số điện thoại và địa chỉ."

    if any(k in q for k in ["công đoạn", "cong doan", "quy trình", "quy trinh"]):
        return (
            "Quy trình kiểm định xe cơ giới tại trạm gồm 5 công đoạn kỹ thuật chính:\n\n"
            "1. **Công đoạn 1 - Kiểm tra nhận diện & tổng quát:** Đối chiếu biển số, số khung, số máy, màu sơn, lốp, gương, kính chắn gió và đèn tín hiệu.\n"
            "2. **Công đoạn 2 - Kiểm tra phần trên:** Khung vỏ, bậc lên xuống, cơ cấu đóng mở cửa, dây đai an toàn, ghế ngồi và trang thiết bị nội thất.\n"
            "3. **Công đoạn 3 - Kiểm tra phanh & trượt ngang:** Đo hiệu quả phanh chính, phanh đỗ, độ lệch phanh và độ trượt ngang bánh dẫn hướng trên bệ thử.\n"
            "4. **Công đoạn 4 - Kiểm tra khí thải & tiếng ồn:** Đo nồng độ khí xả (CO/HC đối với xe xăng, độ mờ khói đối với xe diesel), độ ồn còi và độ sáng/góc chiếu đèn pha.\n"
            "5. **Công đoạn 5 - Kiểm tra phần dưới gầm:** Cầu xe, hệ thống treo, giảm chấn, rô-tuyn lái, khớp nối cơ cấu lái và tình trạng rò rỉ nhiên liệu/dầu nhờn.\n\n"
            "Kết quả từng hạng mục được phân loại: **Đạt**, **Mi** (Không quan trọng), **Ma** (Quan trọng) hoặc **DD** (Nguy hiểm)."
        )

    system_related_keywords = [
        "xe", "phương tiện", "phuong tien", "biển số", "bien so", "số khung", "so khung", "số máy", "so may",
        "đăng kiểm", "dang kiem", "kiểm định", "kiem dinh", "hồ sơ", "ho so", "lịch hẹn", "lich hen", "hẹn", "hen",
        "chủ xe", "chu xe", "chứng nhận", "chung nhan", "tem", "công đoạn", "cong doan", "chuyền", "chuyen",
        "chờ", "cho", "khiếm khuyết", "khiem khuyet", "kết quả", "ket qua", "đạt", "dat", "không đạt", "khong dat",
        "hệ thống", "he thong", "tài khoản", "tai khoan", "tiếp nhận", "tiep nhan", "kiểm tra", "kiem tra",
        "tra cứu", "tra cuu", "quy trình", "quy trinh", "chào", "chao", "hello", "hi", "xin chào", "xin chao",
        "bạn là ai", "ban la ai", "bạn tên gì", "ban ten gi", "hướng dẫn", "huong dan", "trợ giúp", "tro giup", "giúp", "giup",
        "menu", "chức năng", "chuc nang", "đăng ký", "dang ky", "phí", "phi", "lệ phí", "le phi", "giấy tờ", "giay to",
        "bảo hiểm", "bao hiem", "cà vẹt", "ca vet", "thủ tục", "thu tuc"
    ]
    if not any(k in q for k in system_related_keywords):
        return (
            "Xin lỗi, tôi là Trợ lý AI chuyên trách của Hệ thống Quản lý Đăng kiểm Phương tiện. "
            "Tôi chỉ có thể hỗ trợ giải đáp các câu hỏi liên quan đến quy trình kiểm định, tra cứu hồ sơ, "
            "lịch hẹn và các chức năng trong hệ thống đăng kiểm. "
            "Rất mong bạn thông cảm và vui lòng đặt câu hỏi liên quan đến nghiệp vụ đăng kiểm!"
        )

    return (
        f"Tôi là Trợ lý đăng kiểm hỗ trợ vai trò {current_role}. "
        "Hệ thống hiện cung cấp các chức năng chính:\n"
        "1. Quản lý Phương tiện: tra cứu thông tin xe theo biển số, số khung\n"
        "2. Lịch hẹn: tạo và quản lý lịch kiểm định phương tiện\n"
        "3. Hồ sơ kiểm định: tiếp nhận, kiểm tra công đoạn và cấp chứng nhận\n"
        "4. Quản lý Chủ xe: quản lý thông tin chủ phương tiện.\n\n"
        "Bạn có thể đặt câu hỏi chi tiết về bất kỳ quy trình nào ở trên để được hướng dẫn cụ thể."
    )


@api.post("/ai/requirements-analysis", response_model=RequirementsAnalysisResponse)
def analyze_requirement(body: RequirementsAnalysisRequest, _: Account = Depends(current_account)):
    from app.config import Settings
    current_settings = Settings()
    
    is_placeholder_key = (
        not current_settings.gemini_api_key
        or current_settings.gemini_api_key in ("your_gemini_api_key_here", "none", "")
        or current_settings.gemini_api_key.startswith("your_")
    )
    if not is_placeholder_key:
        try:
            from openai import OpenAI
            from pathlib import Path

            prompt_path = Path(__file__).parent / "prompts" / "requirements_agent_vi.md"
            system_prompt = prompt_path.read_text(encoding="utf-8")
            client = OpenAI(
                api_key=current_settings.gemini_api_key,
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
                timeout=10.0,
                max_retries=0,
            )
            candidate_models = [
                current_settings.gemini_model or "gemini-3.5-flash",
                "gemini-3.5-flash",
            ]
            dedup_models = [m for i, m in enumerate(candidate_models) if m and m not in candidate_models[:i]]
            for m in dedup_models:
                try:
                    response = client.chat.completions.create(
                        model=m,
                        temperature=0.3,
                        max_tokens=1500,
                        messages=[
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": f"Phân tích yêu cầu sau:\n\n{body.requirement}"},
                        ],
                    )
                    analysis = response.choices[0].message.content
                    if analysis:
                        return RequirementsAnalysisResponse(analysis=analysis)
                except Exception as model_err:
                    import logging
                    logging.getLogger("uvicorn.error").info("Model %s analysis failed/timed out: %s", m, model_err)
                    break
        except Exception as exc:
            import logging
            logging.getLogger("uvicorn.error").warning("Gemini analysis call failed: %s. Using fallback.", exc)

    fallback_analysis = (
        f"### 📋 KẾT QUẢ PHÂN TÍCH YÊU CẦU NGHIỆP VỤ\n\n"
        f"**Nội dung yêu cầu:**\n> {body.requirement}\n\n"
        f"#### 1. Đánh giá tính khả thi và phạm vi\n"
        f"- **Đối tượng áp dụng:** Hệ thống quản lý đăng kiểm phương tiện giao thông cơ giới đường bộ.\n"
        f"- **Vai trò liên quan:** Quản trị viên (Admin), Nhân viên tiếp nhận (Intake), Kiểm định viên (Inspector), Chủ phương tiện (Owner).\n"
        f"- **Mức độ phức tạp:** Trung bình - Cần rà soát quy trình đối chiếu theo quy chuẩn kỹ thuật quốc gia hiện hành.\n\n"
        f"#### 2. Các điểm kiểm soát nghiệp vụ khuyến nghị\n"
        f"- **Kiểm tra tính toàn vẹn dữ liệu:** Xác thực thông tin số khung, số máy, biển số và giấy tờ xe trước khi thực hiện quy trình.\n"
        f"- **Quy trình phân đoạn (Stage check):** Đảm bảo ghi nhận kết quả kiểm tra theo các công đoạn và phân loại khiếm khuyết (Đạt, Mi, Ma, DD) chính xác.\n"
        f"- **Kiểm soát cấp giấy chứng nhận:** Chỉ cho phép cấp Giấy chứng nhận và Tem kiểm định khi toàn bộ hạng mục đạt hoặc khiếm khuyết nhỏ (Mi) được chấp nhận theo quy định.\n"
    )
    return RequirementsAnalysisResponse(analysis=fallback_analysis)


def build_role_scoped_context(db: Session, account: Account, query: str) -> tuple[str, dict]:
    role = account.role
    live_stats: dict = {"role": role.value}

    if role == Role.OWNER:
        # Strictly query only data belonging to this owner
        owner = db.get(Owner, account.owner_id) if account.owner_id else None
        owner_name = owner.display_name if owner else account.username

        owned_vehicles = db.scalars(
            select(Vehicle).where(Vehicle.owner_id == account.owner_id)
        ).all() if account.owner_id else []

        v_ids = [v.id for v in owned_vehicles]
        owned_inspections = db.scalars(
            select(InspectionFile)
            .where(InspectionFile.vehicle_id.in_(v_ids))
            .order_by(InspectionFile.received_at.desc())
        ).all() if v_ids else []

        owned_appointments = db.scalars(
            select(Appointment)
            .where(Appointment.vehicle_id.in_(v_ids))
            .order_by(Appointment.appointment_date.desc())
        ).all() if v_ids else []

        owned_certificates = db.scalars(
            select(Certificate)
            .where(Certificate.vehicle_id.in_(v_ids))
            .order_by(Certificate.issued_on.desc())
        ).all() if v_ids else []

        vehicles_summary = [
            f"- BKS: {v.registration_number} | Loại xe: {v.vehicle_type} | Số khung: {v.chassis_number} | Số máy: {v.engine_number}"
            for v in owned_vehicles
        ]
        vehicles_text = "\n".join(vehicles_summary) if vehicles_summary else "Chưa có phương tiện nào đăng ký dưới tài khoản này."

        inspections_summary = [
            f"- BKS: {ins.vehicle.registration_number if ins.vehicle else 'N/A'} | Mã HS: {ins.code} | Trạng thái: {'Chờ kiểm định' if ins.status == InspectionStatus.RECEIVED else 'Đang kiểm định trên chuyền' if ins.status == InspectionStatus.IN_PROGRESS else 'Đạt yêu cầu' if ins.status == InspectionStatus.PASSED else 'Không đạt'}"
            for ins in owned_inspections
        ]
        inspections_text = "\n".join(inspections_summary) if inspections_summary else "Chưa có hồ sơ kiểm định nào."

        appointments_summary = [
            f"- BKS: {apt.vehicle.registration_number if apt.vehicle else 'N/A'} | Mã hẹn: {apt.code} | Ngày hẹn: {apt.appointment_date.strftime('%d/%m/%Y')} ({apt.start_time.strftime('%H:%M')} - {apt.end_time.strftime('%H:%M')}) | Trạng thái: {apt.status.value}"
            for apt in owned_appointments
        ]
        appointments_text = "\n".join(appointments_summary) if appointments_summary else "Không có lịch hẹn nào."

        certificates_summary = [
            f"- BKS: {cert.vehicle.registration_number if cert.vehicle else 'N/A'} | Số GCN: {cert.certificate_number} | Số tem: {cert.stamp_number} | Ngày cấp: {cert.issued_on.strftime('%d/%m/%Y')} | Hạn hiệu lực: {cert.expires_on.strftime('%d/%m/%Y')}"
            for cert in owned_certificates
        ]
        certificates_text = "\n".join(certificates_summary) if certificates_summary else "Chưa có giấy chứng nhận nào."

        live_stats.update({
            "owner_name": owner_name,
            "owned_vehicles_count": len(owned_vehicles),
            "owned_vehicles_plates": [v.registration_number for v in owned_vehicles],
            "owned_inspections_count": len(owned_inspections),
            "owned_waiting_count": sum(1 for ins in owned_inspections if ins.status == InspectionStatus.RECEIVED),
            "owned_in_progress_count": sum(1 for ins in owned_inspections if ins.status == InspectionStatus.IN_PROGRESS),
            "owned_appointments_count": len(owned_appointments),
        })

        system_context = (
            f"\n\n[DỮ LIỆU ĐƯỢC PHÂN QUYỀN TRUY VẤN - VAI TRÒ CHỦ XE (OWNER)]:\n"
            f"- Chủ xe: {owner_name} (Tài khoản: {account.username})\n"
            f"- Danh sách phương tiện của bạn ({len(owned_vehicles)} xe):\n{vehicles_text}\n"
            f"- Hồ sơ kiểm định của các xe của bạn ({len(owned_inspections)} hồ sơ):\n{inspections_text}\n"
            f"- Lịch hẹn kiểm định của bạn ({len(owned_appointments)} lịch hẹn):\n{appointments_text}\n"
            f"- Giấy chứng nhận/Tem kiểm định ({len(owned_certificates)} chứng nhận):\n{certificates_text}\n\n"
            f"QUY TẮC BẢO MẬT & PHÂN QUYỀN CHO VAI TRÒ CHỦ XE:\n"
            f"1. Bạn CHỈ ĐƯỢC PHÉP cung cấp thông tin liên quan đến các xe, hồ sơ, lịch hẹn thuộc sở hữu của chủ xe này ở trên.\n"
            f"2. TUYỆT ĐỐI KHÔNG tiết lộ thông tin xe hoặc số liệu tổng của trạm đăng kiểm/chủ xe khác. "
            f"Nếu người dùng hỏi về số lượng xe cả trạm đang chờ hoặc xe của người khác, hãy giải thích lịch sự rằng: "
            f"'Với vai trò Chủ xe, bạn chỉ được tra cứu thông tin phương tiện thuộc quyền sở hữu của mình nhằm đảm bảo an toàn thông tin'.\n"
            f"3. Khi người dùng hỏi về xe của mình, hãy trả lời chính xác theo số liệu thực tế ở trên."
        )

    elif role == Role.INSPECTOR:
        # Technical Lane Staff
        waiting_files = db.scalars(
            select(InspectionFile)
            .where(InspectionFile.status == InspectionStatus.RECEIVED)
            .order_by(InspectionFile.received_at.asc())
        ).all()
        in_progress_files = db.scalars(
            select(InspectionFile)
            .where(InspectionFile.status == InspectionStatus.IN_PROGRESS)
            .order_by(InspectionFile.received_at.asc())
        ).all()
        passed_count = db.scalar(select(func.count(InspectionFile.id)).where(InspectionFile.status == InspectionStatus.PASSED)) or 0
        failed_count = db.scalar(select(func.count(InspectionFile.id)).where(InspectionFile.status == InspectionStatus.FAILED)) or 0

        recent_defects = db.scalars(
            select(InspectionItem)
            .where(InspectionItem.result.in_([ItemResult.MINOR, ItemResult.MAJOR, ItemResult.DANGEROUS]))
            .order_by(InspectionItem.recorded_at.desc())
            .limit(10)
        ).all()

        waiting_list = [
            f"- BKS: {ins.vehicle.registration_number if ins.vehicle else 'N/A'} | Loại xe: {ins.vehicle.vehicle_type if ins.vehicle else 'N/A'} | Mã HS: {ins.code} | Kênh: {ins.intake_channel}"
            for ins in waiting_files
        ]
        in_progress_list = [
            f"- BKS: {ins.vehicle.registration_number if ins.vehicle else 'N/A'} | Loại xe: {ins.vehicle.vehicle_type if ins.vehicle else 'N/A'} | Mã HS: {ins.code} | Hạng mục đã ghi: {len(ins.results)}"
            for ins in in_progress_files
        ]
        defects_list = [
            f"- Mã HS {item.inspection.code if item.inspection else item.inspection_id} | Công đoạn {item.stage} | Mã lỗi: {item.item_code} | Kết quả: {item.result.value}"
            for item in recent_defects
        ]

        live_stats.update({
            "waiting_count": len(waiting_files),
            "in_progress_count": len(in_progress_files),
            "passed_count": passed_count,
            "failed_count": failed_count,
            "waiting_list_str": "\n".join(waiting_list) if waiting_list else "Không có xe nào đang chờ.",
            "in_progress_list_str": "\n".join(in_progress_list) if in_progress_list else "Không có xe nào đang kiểm tra trên chuyền.",
        })

        system_context = (
            f"\n\n[DỮ LIỆU ĐƯỢC PHÂN QUYỀN TRUY VẤN - VAI TRÒ KIỂM ĐỊNH VIÊN (INSPECTOR)]:\n"
            f"- Kiểm định viên: {account.username}\n"
            f"- Tình trạng chuyền kiểm định:\n"
            f"  + Số xe đang chờ vào chuyền ({len(waiting_files)} xe):\n{chr(10).join(waiting_list) if waiting_list else '    (Không có xe chờ)'}\n"
            f"  + Số xe đang kiểm tra trên chuyền ({len(in_progress_files)} xe):\n{chr(10).join(in_progress_list) if in_progress_list else '    (Không có xe trên chuyền)'}\n"
            f"  + Kết quả ca trực: {passed_count} xe Đạt, {failed_count} xe Không đạt.\n"
            f"- Các khiếm khuyết kỹ thuật (Mi/Ma/DD) phát hiện gần đây:\n{chr(10).join(defects_list) if defects_list else '  (Không có khiếm khuyết đáng kể)'}\n\n"
            f"QUY TẮC BẢO MẬT & PHÂN QUYỀN CHO VAI TRÒ KIỂM ĐỊNH VIÊN:\n"
            f"1. Tập trung vào dữ liệu kỹ thuật: thông số kỹ thuật xe, công đoạn kiểm tra 1-5, khiếm khuyết (Mi/Ma/DD) và tiến độ các xe trên chuyền.\n"
            f"2. KHÔNG tiết lộ thông tin cá nhân của chủ phương tiện (CCCD, địa chỉ nhà) do không thuộc phạm vi kỹ thuật của kiểm định viên."
        )

    elif role == Role.INTAKE:
        # Intake & Reception Staff
        today = date.today()
        today_appointments = db.scalars(
            select(Appointment)
            .where(Appointment.appointment_date == today)
            .order_by(Appointment.start_time.asc())
        ).all()
        waiting_intake_files = db.scalars(
            select(InspectionFile)
            .where(InspectionFile.status == InspectionStatus.RECEIVED)
            .order_by(InspectionFile.received_at.asc())
        ).all()
        total_vehicles = db.scalar(select(func.count(Vehicle.id))) or 0
        total_owners = db.scalar(select(func.count(Owner.id))) or 0

        apt_list = [
            f"- Giờ hẹn: {apt.start_time.strftime('%H:%M')}-{apt.end_time.strftime('%H:%M')} | BKS: {apt.vehicle.registration_number if apt.vehicle else 'N/A'} | Mã hẹn: {apt.code} | Dịch vụ: {apt.service_type} | Trạng thái: {apt.status.value}"
            for apt in today_appointments
        ]
        received_list = [
            f"- BKS: {ins.vehicle.registration_number if ins.vehicle else 'N/A'} | Mã HS: {ins.code} | Kênh: {ins.intake_channel} | Tiếp nhận lúc: {ins.received_at.strftime('%H:%M') if ins.received_at else 'N/A'}"
            for ins in waiting_intake_files
        ]

        live_stats.update({
            "today_appointments_count": len(today_appointments),
            "waiting_count": len(waiting_intake_files),
            "total_vehicles": total_vehicles,
            "total_owners": total_owners,
        })

        system_context = (
            f"\n\n[DỮ LIỆU ĐƯỢC PHÂN QUYỀN TRUY VẤN - VAI TRÒ TIẾP NHẬN HỒ SƠ (INTAKE)]:\n"
            f"- Nhân viên tiếp nhận: {account.username}\n"
            f"- Bàn tiếp nhận & Lịch hẹn:\n"
            f"  + Số lịch hẹn kiểm định hôm nay ({len(today_appointments)} lượt):\n{chr(10).join(apt_list) if apt_list else '    (Không có lịch hẹn hôm nay)'}\n"
            f"  + Hồ sơ đã tiếp nhận đang chờ đưa vào chuyền ({len(waiting_intake_files)} hồ sơ):\n{chr(10).join(received_list) if received_list else '    (Không có hồ sơ chờ)'}\n"
            f"- Dữ liệu trạm: {total_owners} chủ xe, {total_vehicles} phương tiện đăng ký.\n\n"
            f"QUY TẮC BẢO MẬT & PHÂN QUYỀN CHO VAI TRÒ TIẾP NHẬN:\n"
            f"1. Hỗ trợ tra cứu lịch hẹn, đối chiếu giấy tờ pháp lý phương tiện (đăng ký xe, đăng kiểm cũ, bảo hiểm bắt buộc).\n"
            f"2. Cung cấp số lượng xe đang chờ tiếp nhận và đã chuyển vào chuyền.\n"
            f"3. Không can thiệp kết luận kỹ thuật của kiểm định viên."
        )

    else:
        # Role.ADMIN: Full System Access
        waiting_count = db.scalar(select(func.count(InspectionFile.id)).where(InspectionFile.status == InspectionStatus.RECEIVED)) or 0
        in_progress_count = db.scalar(select(func.count(InspectionFile.id)).where(InspectionFile.status == InspectionStatus.IN_PROGRESS)) or 0
        passed_count = db.scalar(select(func.count(InspectionFile.id)).where(InspectionFile.status == InspectionStatus.PASSED)) or 0
        failed_count = db.scalar(select(func.count(InspectionFile.id)).where(InspectionFile.status == InspectionStatus.FAILED)) or 0
        total_vehicles = db.scalar(select(func.count(Vehicle.id))) or 0
        total_owners = db.scalar(select(func.count(Owner.id))) or 0
        today_appointments = db.scalar(select(func.count(Appointment.id)).where(Appointment.appointment_date == date.today(), Appointment.status == AppointmentStatus.ACTIVE)) or 0
        total_certificates = db.scalar(select(func.count(Certificate.id))) or 0

        active_inspections = db.scalars(
            select(InspectionFile)
            .where(InspectionFile.status.in_([InspectionStatus.RECEIVED, InspectionStatus.IN_PROGRESS]))
            .order_by(InspectionFile.received_at.asc())
            .limit(10)
        ).all()
        waiting_items = [
            f"- Biển số: {ins.vehicle.registration_number if ins.vehicle else 'N/A'} | Mã HS: {ins.code} | Trạng thái: {'Chờ kiểm định (vừa tiếp nhận)' if ins.status == InspectionStatus.RECEIVED else 'Đang kiểm tra trên chuyền'}"
            for ins in active_inspections
        ]
        waiting_list_str = "\n".join(waiting_items) if waiting_items else "Không có phương tiện nào đang chờ hoặc đang kiểm tra."

        live_stats.update({
            "waiting_count": waiting_count,
            "in_progress_count": in_progress_count,
            "passed_count": passed_count,
            "failed_count": failed_count,
            "total_vehicles": total_vehicles,
            "total_owners": total_owners,
            "today_appointments": today_appointments,
            "total_certificates": total_certificates,
            "waiting_list_str": waiting_list_str,
        })

        system_context = (
            f"\n\n[DỮ LIỆU ĐƯỢC PHÂN QUYỀN TRUY VẤN - VAI TRÒ QUẢN TRỊ VIÊN (ADMIN)]:\n"
            f"- Quản trị viên: {account.username} (Toàn quyền hệ thống)\n"
            f"- Thống kê tổng quan toàn trạm:\n"
            f"  + Tổng số phương tiện đăng ký: {total_vehicles} xe | Tổng số chủ xe: {total_owners}\n"
            f"  + Số xe đang chờ vào kiểm tra: {waiting_count} xe\n"
            f"  + Số xe đang kiểm tra trên chuyền: {in_progress_count} xe\n"
            f"  + Số hồ sơ đã hoàn thành: {passed_count} xe Đạt, {failed_count} xe Không đạt\n"
            f"  + Lịch hẹn kiểm định hôm nay: {today_appointments} lượt\n"
            f"  + Tổng số Giấy chứng nhận/Tem đã cấp: {total_certificates}\n"
            f"- Danh sách phương tiện đang hoạt động trên chuyền:\n{waiting_list_str}\n\n"
            f"QUY TẮC CHO VAI TRÒ QUẢN TRỊ VIÊN:\n"
            f"Bạn có toàn quyền truy xuất và báo cáo mọi số liệu hệ thống một cách minh bạch, chính xác."
        )

    return system_context, live_stats


@api.post("/ai/chat", response_model=ChatResponse)
def chat_with_assistant(
    body: ChatRequest,
    db: Session = Depends(get_db),
    account: Account = Depends(require_roles(Role.ADMIN, Role.INTAKE, Role.INSPECTOR, Role.OWNER)),
):
    if not body.messages or body.messages[-1].role != "user":
        raise HTTPException(422, "Tin nhắn cuối cùng phải là câu hỏi của người dùng.")
    
    last_user_message = body.messages[-1].content
    role_names = {
        Role.ADMIN: "quản trị viên",
        Role.INTAKE: "nhân viên tiếp nhận",
        Role.INSPECTOR: "kiểm định viên",
        Role.OWNER: "chủ xe",
    }

    # Query role-scoped operational data from database
    live_context, live_stats = build_role_scoped_context(db, account, last_user_message)

    from app.config import Settings
    current_settings = Settings()

    is_placeholder_key = (
        not current_settings.gemini_api_key
        or current_settings.gemini_api_key in ("your_gemini_api_key_here", "none", "")
        or current_settings.gemini_api_key.startswith("your_")
    )

    if not is_placeholder_key:
        try:
            from openai import OpenAI
            from pathlib import Path

            prompt_path = Path(__file__).parent / "prompts" / "chatbot_vi.md"
            system_prompt = prompt_path.read_text(encoding="utf-8")

            messages = [
                {"role": "system", "content": f"{system_prompt}\n\nVai trò người dùng đang trò chuyện: {role_names[account.role]} ({account.username}).{live_context}"},
                *[{"role": item.role, "content": item.content} for item in body.messages],
            ]
            primary_model = current_settings.gemini_model or "gemini-3.5-flash"
            client = OpenAI(
                api_key=current_settings.gemini_api_key,
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
                timeout=10.0,
                max_retries=0,
            )
            try:
                response = client.chat.completions.create(
                    model=primary_model,
                    temperature=0.4,
                    messages=messages,
                )
                answer = response.choices[0].message.content
                if answer:
                    return ChatResponse(message=answer)
            except Exception as model_err:
                import logging
                logging.getLogger("uvicorn.error").info("Model %s chat failed: %s", primary_model, model_err)
        except Exception as exc:
            import logging
            logging.getLogger("uvicorn.error").warning("Gemini AI API call failed: %s. Falling back to local assistant.", exc)

    return ChatResponse(message=generate_fallback_chat(last_user_message, account.role, live_stats=live_stats))

@auth_router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    clean_u = body.username.strip()
    account = db.scalar(select(Account).where(func.lower(Account.username) == clean_u.lower()))
    if not account:
        account = db.scalar(select(Account).where(Account.username == clean_u))

    if not account:
        raise HTTPException(
            status_code=401,
            detail="Tên đăng nhập hoặc mật khẩu không đúng.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not account.is_active:
        raise HTTPException(
            status_code=403,
            detail="Tài khoản của bạn đang bị khóa.",
        )

    if not verify_password(body.password, account.password_hash):
        raise HTTPException(
            status_code=401,
            detail="Tên đăng nhập hoặc mật khẩu không đúng.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return TokenResponse(access_token=create_access_token(account))


@auth_router.post("/register", response_model=TokenResponse, status_code=201)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    clean_username = body.username.strip()
    existing = db.scalar(select(Account).where(Account.username == clean_username))
    if existing:
        raise HTTPException(status_code=400, detail="Tên đăng nhập đã tồn tại. Vui lòng chọn tên đăng nhập khác.")

    clean_email = body.email.strip().lower()
    if not clean_email or "@" not in clean_email or "." not in clean_email:
        raise HTTPException(status_code=400, detail="Vui lòng nhập địa chỉ email hợp lệ.")

    existing_email = db.scalar(select(Account).where(func.lower(Account.email) == clean_email))
    if existing_email:
        raise HTTPException(
            status_code=400,
            detail="Email này đã được sử dụng cho một tài khoản khác. Vui lòng đăng nhập hoặc sử dụng email khác."
        )

    clean_identity = (body.identity_or_tax_number or "").strip()
    if not clean_identity:
        clean_identity = f"ID-{clean_username}"

    owner = Owner(
        display_name=body.display_name.strip(),
        identity_or_tax_number=clean_identity,
        phone=body.phone.strip(),
        address=(body.address or "Chưa cập nhật").strip(),
    )
    db.add(owner)
    db.flush()

    # Mặc định role là Role.OWNER (Chủ xe)
    account = Account(
        username=clean_username,
        password_hash=hash_password(body.password),
        role=Role.OWNER,
        owner_id=owner.id,
        display_name=body.display_name.strip(),
        email=clean_email,
        phone=body.phone.strip(),
        is_active=True,
    )
    db.add(account)
    db.commit()
    db.refresh(account)

    log_audit_event(
        db,
        account.id,
        entity_type="account",
        entity_id=account.id,
        action="register",
        after_value=f"Đăng ký tài khoản chủ xe @{account.username}",
    )
    db.commit()

    return TokenResponse(access_token=create_access_token(account))


# In-memory store for reset password OTPs: email.lower() -> {"code": "123456", "expires_at": datetime, "attempts": 0, "account_id": id}
_password_reset_otps: dict[str, dict] = {}


@auth_router.post("/forgot-password/send-otp", response_model=ForgotPasswordResponse)
def send_forgot_password_otp(body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    clean_email = body.email.strip().lower()
    if not clean_email or "@" not in clean_email:
        raise HTTPException(status_code=400, detail="Vui lòng nhập định dạng email hợp lệ.")

    account = db.scalar(select(Account).where(func.lower(Account.email) == clean_email))
    if not account:
        raise HTTPException(
            status_code=404,
            detail="Không tìm thấy tài khoản nào được liên kết với email này. Vui lòng kiểm tra lại.",
        )

    if not account.is_active:
        raise HTTPException(
            status_code=400,
            detail="Tài khoản này hiện đang bị tạm khóa. Vui lòng liên hệ quản trị viên.",
        )

    # Tạo mã OTP 6 chữ số
    otp_code = f"{random.randint(100000, 999999)}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

    _password_reset_otps[clean_email] = {
        "code": otp_code,
        "expires_at": expires_at,
        "attempts": 0,
        "account_id": account.id,
    }

    logger = logging.getLogger("uvicorn.error")
    logger.info("[FORGOT_PASSWORD] Đang gửi OTP cho email '%s' (tài khoản: '%s')", clean_email, account.username)

    # Gửi email thực tế qua SMTP
    try:
        send_otp_email(to_email=clean_email, otp_code=otp_code, username=account.display_name or account.username)
    except Exception as exc:
        logger.error("[FORGOT_PASSWORD] Không thể gửi email: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"{str(exc)}",
        )

    return ForgotPasswordResponse(
        message=f"Mã xác nhận 6 chữ số đã được gửi tới email {clean_email}. Vui lòng kiểm tra hộp thư đến (hoặc thư rác/spam).",
        email=clean_email,
        username=account.username,
        display_name=account.display_name or account.username,
        dev_code=None,
    )


@auth_router.post("/forgot-password/verify-otp")
def verify_otp_only(body: VerifyOtpOnlyRequest):
    clean_email = body.email.strip().lower()
    clean_code = body.otp_code.strip()

    otp_data = _password_reset_otps.get(clean_email)
    if not otp_data:
        raise HTTPException(
            status_code=400,
            detail="Chưa có yêu cầu đặt lại mật khẩu hoặc mã xác nhận đã hết hiệu lực. Vui lòng yêu cầu gửi mã mới.",
        )

    if datetime.now(timezone.utc) > otp_data["expires_at"]:
        _password_reset_otps.pop(clean_email, None)
        raise HTTPException(
            status_code=400,
            detail="Mã xác nhận đã hết hạn (quá 10 phút). Vui lòng yêu cầu gửi mã mới.",
        )

    if otp_data["code"] != clean_code:
        otp_data["attempts"] += 1
        if otp_data["attempts"] >= 5:
            _password_reset_otps.pop(clean_email, None)
            raise HTTPException(
                status_code=400,
                detail="Bạn đã nhập sai mã xác nhận quá 5 lần. Mã đã bị hủy để đảm bảo an toàn.",
            )
        remaining = 5 - otp_data["attempts"]
        raise HTTPException(
            status_code=400,
            detail=f"Mã xác nhận không đúng. Bạn còn {remaining} lần thử lại.",
        )

    otp_data["verified"] = True
    return {"message": "Mã xác nhận chính xác. Vui lòng nhập mật khẩu mới.", "verified": True}


@auth_router.post("/forgot-password/verify-and-reset")
def verify_otp_and_reset_password(body: ResetPasswordWithOtpRequest, db: Session = Depends(get_db)):
    clean_email = body.email.strip().lower()
    clean_code = body.otp_code.strip()

    otp_data = _password_reset_otps.get(clean_email)
    if not otp_data:
        raise HTTPException(
            status_code=400,
            detail="Chưa có yêu cầu đặt lại mật khẩu hoặc mã xác nhận đã hết hiệu lực. Vui lòng yêu cầu gửi mã mới.",
        )

    if datetime.now(timezone.utc) > otp_data["expires_at"]:
        _password_reset_otps.pop(clean_email, None)
        raise HTTPException(
            status_code=400,
            detail="Mã xác nhận đã hết hạn (quá 10 phút). Vui lòng yêu cầu gửi mã mới.",
        )

    if not otp_data.get("verified") and otp_data["code"] != clean_code:
        otp_data["attempts"] += 1
        if otp_data["attempts"] >= 5:
            _password_reset_otps.pop(clean_email, None)
            raise HTTPException(
                status_code=400,
                detail="Bạn đã nhập sai mã xác nhận quá 5 lần. Mã đã bị hủy để đảm bảo an toàn.",
            )
        remaining = 5 - otp_data["attempts"]
        raise HTTPException(
            status_code=400,
            detail=f"Mã xác nhận không đúng. Bạn còn {remaining} lần thử lại.",
        )

    if len(body.new_password) < 6:
        raise HTTPException(
            status_code=400,
            detail="Mật khẩu mới phải có độ dài tối thiểu 6 ký tự.",
        )

    account = db.scalar(select(Account).where(func.lower(Account.email) == clean_email))
    if not account:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản người dùng.")

    account.password_hash = hash_password(body.new_password)
    db.commit()

    # Xóa OTP sau khi đổi mật khẩu thành công
    _password_reset_otps.pop(clean_email, None)

    return {"message": "Đặt lại mật khẩu thành công! Bây giờ bạn có thể đăng nhập bằng mật khẩu mới."}


@api.get("/profile", response_model=ProfileResponse)
def get_user_profile(account: Account = Depends(current_account), db: Session = Depends(get_db)):
    disp_name = account.display_name
    ph = account.phone
    if account.owner_id:
        owner = db.get(Owner, account.owner_id)
        if owner:
            if not disp_name:
                disp_name = owner.display_name
            if not ph:
                ph = owner.phone
    return ProfileResponse(
        id=account.id,
        username=account.username,
        role=account.role,
        display_name=disp_name,
        email=account.email,
        phone=ph,
        avatar_url=account.avatar_url,
    )


@api.put("/profile", response_model=ProfileResponse)
def update_user_profile(
    body: ProfileUpdateRequest,
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
):
    if body.new_password:
        if not body.current_password:
            raise HTTPException(status_code=400, detail="Vui lòng nhập mật khẩu hiện tại để đổi mật khẩu.")
        if not verify_password(body.current_password, account.password_hash):
            raise HTTPException(status_code=400, detail="Mật khẩu hiện tại không chính xác.")
        if len(body.new_password) < 6:
            raise HTTPException(status_code=400, detail="Mật khẩu mới phải có ít nhất 6 ký tự.")
        account.password_hash = hash_password(body.new_password)

    if body.display_name is not None:
        clean_name = body.display_name.strip()
        account.display_name = clean_name or None
        if account.owner_id:
            owner = db.get(Owner, account.owner_id)
            if owner and clean_name:
                owner.display_name = clean_name

    if body.email is not None:
        account.email = body.email.strip() or None

    if body.phone is not None:
        clean_phone = body.phone.strip()
        account.phone = clean_phone or None
        if account.owner_id:
            owner = db.get(Owner, account.owner_id)
            if owner and clean_phone:
                owner.phone = clean_phone

    if body.avatar_url is not None:
        account.avatar_url = body.avatar_url.strip() or None

    db.commit()
    db.refresh(account)

    disp_name = account.display_name
    ph = account.phone
    if account.owner_id:
        owner = db.get(Owner, account.owner_id)
        if owner:
            if not disp_name:
                disp_name = owner.display_name
            if not ph:
                ph = owner.phone

    return ProfileResponse(
        id=account.id,
        username=account.username,
        role=account.role,
        display_name=disp_name,
        email=account.email,
        phone=ph,
        avatar_url=account.avatar_url,
    )


def get_owner_for_account(db: Session, account: Account) -> Owner | None:
    if account.role != Role.OWNER or account.owner_id is None:
        return None
    return db.get(Owner, account.owner_id)


def ensure_vehicle_access(db: Session, vehicle_id: int, account: Account) -> Vehicle:
    vehicle = db.get(Vehicle, vehicle_id)
    if vehicle is None:
        raise HTTPException(404, "Không tìm thấy thông tin phương tiện.")
    if account.role == Role.OWNER and account.owner_id != vehicle.owner_id:
        raise HTTPException(404, "Không tìm thấy thông tin phương tiện hoặc bạn không có quyền truy cập.")
    return vehicle


@api.post("/owners", response_model=OwnerRead, status_code=201)
def create_owner(body: OwnerCreate, db: Session = Depends(get_db), account: Account = Depends(require_roles(Role.ADMIN, Role.INTAKE))):
    owner = Owner(**body.model_dump())
    db.add(owner)
    db.commit()
    db.refresh(owner)
    log_audit_event(
        db,
        account.id,
        entity_type="owner",
        entity_id=owner.id,
        action="create_owner",
        after_value=f"Thêm thông tin chủ xe {owner.display_name}",
    )
    db.commit()
    return owner


@api.get("/owners", response_model=list[OwnerRead])
def list_owners(db: Session = Depends(get_db), _: Account = Depends(require_roles(Role.ADMIN, Role.INTAKE))):
    return db.scalars(select(Owner).order_by(Owner.id)).all()


@api.delete("/owners/{owner_id}")
def delete_owner(owner_id: int, db: Session = Depends(get_db), account: Account = Depends(require_roles(Role.ADMIN, Role.INTAKE))):
    owner = db.get(Owner, owner_id)
    if owner is None:
        raise HTTPException(404, "Không tìm thấy thông tin chủ xe.")
    if owner.vehicles:
        raise HTTPException(400, "Không thể xóa chủ xe này do đã có phương tiện đăng ký liên kết. Vui lòng chuyển hoặc xóa phương tiện trước.")
    if owner.account:
        raise HTTPException(400, "Không thể xóa chủ xe này do đang liên kết với tài khoản đăng nhập.")

    display_name = owner.display_name
    db.delete(owner)
    db.commit()
    log_audit_event(
        db,
        account.id,
        entity_type="owner",
        entity_id=owner_id,
        action="delete_owner",
        after_value=f"Xóa hồ sơ chủ xe {display_name}",
    )
    db.commit()
    return {"message": f"Đã xóa chủ xe '{display_name}' thành công."}


@api.post("/vehicles", response_model=VehicleRead, status_code=201)
def create_vehicle(body: VehicleCreate, db: Session = Depends(get_db), account: Account = Depends(require_roles(Role.ADMIN, Role.INTAKE, Role.OWNER))):
    target_owner_id = body.owner_id
    if account.role == Role.OWNER:
        if not account.owner_id:
            raise HTTPException(400, "Tài khoản chủ xe chưa được liên kết với hồ sơ chủ xe")
        target_owner_id = account.owner_id
    else:
        if target_owner_id is None:
            raise HTTPException(400, "Vui lòng chọn chủ xe cho phương tiện")

    if db.get(Owner, target_owner_id) is None:
        raise HTTPException(404, "Không tìm thấy thông tin chủ xe.")

    vehicle_data = body.model_dump()
    vehicle_data["owner_id"] = target_owner_id
    vehicle = Vehicle(**vehicle_data)
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    log_audit_event(
        db,
        account.id,
        entity_type="vehicle",
        entity_id=vehicle.id,
        action="create_vehicle",
        after_value=f"Đăng ký phương tiện {vehicle.registration_number}",
    )
    db.commit()
    return vehicle


@api.get("/vehicles", response_model=list[VehicleRead])
def list_vehicles(db: Session = Depends(get_db), account: Account = Depends(require_roles(Role.ADMIN, Role.INTAKE, Role.INSPECTOR, Role.OWNER))):
    query = select(Vehicle).order_by(Vehicle.id)
    if account.role == Role.OWNER:
        query = query.where(Vehicle.owner_id == account.owner_id)
    return db.scalars(query).all()


@api.delete("/vehicles/{vehicle_id}")
def delete_vehicle(vehicle_id: int, db: Session = Depends(get_db), account: Account = Depends(require_roles(Role.ADMIN, Role.INTAKE, Role.OWNER))):
    vehicle = db.get(Vehicle, vehicle_id)
    if vehicle is None:
        raise HTTPException(404, "Không tìm thấy thông tin phương tiện.")
    if account.role == Role.OWNER and vehicle.owner_id != account.owner_id:
        raise HTTPException(403, "Bạn không có quyền xóa phương tiện này.")
    if vehicle.inspections:
        raise HTTPException(400, "Không thể xóa phương tiện đã có hồ sơ kiểm định.")
    if vehicle.appointments:
        raise HTTPException(400, "Không thể xóa phương tiện đã có lịch hẹn liên kết.")

    plate = vehicle.registration_number
    db.delete(vehicle)
    db.commit()
    log_audit_event(
        db,
        account.id,
        entity_type="vehicle",
        entity_id=vehicle_id,
        action="delete_vehicle",
        after_value=f"Xóa phương tiện {plate}",
    )
    db.commit()
    return {"message": f"Đã xóa phương tiện '{plate}' thành công."}


@api.post("/appointments", response_model=AppointmentRead, status_code=201)
def create_appointment(body: AppointmentCreate, db: Session = Depends(get_db), account: Account = Depends(require_roles(Role.OWNER, Role.INTAKE, Role.ADMIN))):
    vehicle = ensure_vehicle_access(db, body.vehicle_id, account)
    allowed = ((time(6, 30) <= body.start_time < body.end_time <= time(11, 0)) or
               (time(13, 0) <= body.start_time < body.end_time <= time(17, 30)))
    if not allowed:
        raise HTTPException(422, "Khung giờ hẹn phải nằm trọn trong ca sáng (06:30 - 11:00) hoặc ca chiều (13:00 - 17:30).")

    # Kiểm tra chủ động: Xe có đang có lịch hẹn hiệu lực (ACTIVE) hay không
    existing_active = db.scalar(
        select(Appointment).where(
            Appointment.vehicle_id == body.vehicle_id,
            Appointment.status == AppointmentStatus.ACTIVE,
        )
    )
    if existing_active:
        raise HTTPException(
            409,
            "Phương tiện này hiện đã có một lịch hẹn đang hiệu lực. Vui lòng hoàn tất hoặc hủy lịch hẹn cũ trước khi đặt lịch mới.",
        )

    code = f"APT-{uuid4().hex[:12].upper()}"
    appointment = Appointment(
        **body.model_dump(),
        code=code,
        status=AppointmentStatus.ACTIVE,
        active_guard=1,
        center="Trung tâm Đăng kiểm Mẫu",
    )
    db.add(appointment)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        logging.error("Lỗi IntegrityError khi tạo lịch hẹn: %s", exc)
        if "uq_active_appointment_per_vehicle" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(409, "Phương tiện này hiện đã có một lịch hẹn đang hiệu lực. Vui lòng hoàn tất hoặc hủy lịch hẹn cũ trước khi đặt lịch mới.")
        raise HTTPException(400, f"Không thể lưu thông tin lịch hẹn: {exc}")

    db.refresh(appointment)
    vehicle = db.get(Vehicle, appointment.vehicle_id)
    plate = vehicle.registration_number if vehicle else ""
    plate_text = f" xe {plate}" if plate else ""
    date_formatted = appointment.appointment_date.strftime("%d/%m/%Y") if hasattr(appointment.appointment_date, "strftime") else str(appointment.appointment_date)
    time_text = f" lúc {appointment.start_time} - {appointment.end_time}" if appointment.start_time else ""
    log_audit_event(
        db,
        account.id,
        entity_type="appointment",
        entity_id=appointment.id,
        action="create_appointment",
        after_value=f"Đặt lịch kiểm định{plate_text} ngày {date_formatted}{time_text}",
    )
    db.commit()
    return appointment


@api.get("/appointments", response_model=list[AppointmentRead])
def list_appointments(vehicle_id: int | None = None, db: Session = Depends(get_db), account: Account = Depends(require_roles(Role.OWNER, Role.INTAKE, Role.ADMIN, Role.INSPECTOR))):
    query = select(Appointment).order_by(Appointment.appointment_date, Appointment.start_time)
    if account.role == Role.OWNER:
        query = query.join(Vehicle).where(Vehicle.owner_id == account.owner_id)
    if vehicle_id is not None:
        ensure_vehicle_access(db, vehicle_id, account)
        query = query.where(Appointment.vehicle_id == vehicle_id)
    return db.scalars(query).all()


@api.post("/appointments/{appointment_id}/cancel", response_model=AppointmentRead)
def cancel_appointment(appointment_id: int, db: Session = Depends(get_db), account: Account = Depends(require_roles(Role.OWNER, Role.INTAKE, Role.ADMIN))):
    appointment = db.get(Appointment, appointment_id)
    if appointment is None:
        raise HTTPException(404, "Không tìm thấy thông tin lịch hẹn.")
    ensure_vehicle_access(db, appointment.vehicle_id, account)
    if appointment.status != AppointmentStatus.ACTIVE:
        raise HTTPException(409, "Chỉ có thể hủy lịch hẹn đang ở trạng thái hiệu lực.")
    appointment.status = AppointmentStatus.CANCELLED
    appointment.active_guard = None
    vehicle = db.get(Vehicle, appointment.vehicle_id)
    plate = vehicle.registration_number if vehicle else ""
    plate_text = f" xe {plate}" if plate else ""
    date_formatted = appointment.appointment_date.strftime("%d/%m/%Y") if hasattr(appointment.appointment_date, "strftime") else str(appointment.appointment_date)
    log_audit_event(
        db,
        account.id,
        entity_type="appointment",
        entity_id=appointment.id,
        action="cancel_appointment",
        before_value="Trạng thái cũ: active",
        after_value=f"Hủy lịch hẹn kiểm định{plate_text} ngày {date_formatted}",
    )
    db.commit()
    db.refresh(appointment)
    return appointment


@api.post("/inspections", response_model=InspectionRead, status_code=201)
def create_inspection(body: InspectionCreate, db: Session = Depends(get_db), account: Account = Depends(require_roles(Role.INTAKE, Role.ADMIN))):
    if db.get(Vehicle, body.vehicle_id) is None:
        raise HTTPException(404, "Không tìm thấy thông tin phương tiện.")
    inspection = InspectionFile(**body.model_dump(), code=f"INS-{uuid4().hex[:12].upper()}", received_at=datetime.now(timezone.utc).replace(tzinfo=None), status=InspectionStatus.RECEIVED)
    db.add(inspection)
    db.commit()
    db.refresh(inspection)
    return inspection


@api.get("/inspections", response_model=list[InspectionRead])
def list_inspections(vehicle_id: int | None = None, db: Session = Depends(get_db), account: Account = Depends(require_roles(Role.OWNER, Role.INTAKE, Role.INSPECTOR, Role.ADMIN))):
    query = select(InspectionFile).order_by(InspectionFile.received_at.desc())
    if account.role == Role.OWNER:
        query = query.join(Vehicle).where(Vehicle.owner_id == account.owner_id)
    if vehicle_id is not None:
        ensure_vehicle_access(db, vehicle_id, account)
        query = query.where(InspectionFile.vehicle_id == vehicle_id)
    return db.scalars(query).all()


@api.post("/inspections/{inspection_id}/results", response_model=ItemResultRead, status_code=201)
def record_result(inspection_id: int, body: ItemResultCreate, db: Session = Depends(get_db), account: Account = Depends(require_roles(Role.INSPECTOR))):
    inspection = db.get(InspectionFile, inspection_id)
    if inspection is None:
        raise HTTPException(404, "Không tìm thấy hồ sơ kiểm định.")
    if inspection.status in (InspectionStatus.PASSED, InspectionStatus.FAILED):
        raise HTTPException(409, "Hồ sơ kiểm định đã hoàn tất kết luận, không thể ghi nhận thêm kết quả.")
    result = InspectionItem(**body.model_dump(), inspection_id=inspection.id, inspector_account_id=account.id, recorded_at=datetime.now(timezone.utc).replace(tzinfo=None))
    db.add(result)
    if body.result in (ItemResult.MAJOR, ItemResult.DANGEROUS):
        inspection.status = InspectionStatus.FAILED
    else:
        inspection.status = InspectionStatus.IN_PROGRESS
    db.commit()
    db.refresh(result)
    return result


@api.get("/inspections/{inspection_id}/results", response_model=list[ItemResultRead])
def list_results(inspection_id: int, db: Session = Depends(get_db), account: Account = Depends(require_roles(Role.OWNER, Role.INTAKE, Role.INSPECTOR, Role.ADMIN))):
    inspection = db.get(InspectionFile, inspection_id)
    if inspection is None:
        raise HTTPException(404, "Không tìm thấy hồ sơ kiểm định.")
    ensure_vehicle_access(db, inspection.vehicle_id, account)
    return db.scalars(select(InspectionItem).where(InspectionItem.inspection_id == inspection_id).order_by(InspectionItem.stage, InspectionItem.item_code)).all()


@api.post("/inspections/{inspection_id}/finalize", response_model=InspectionRead)
def finalize_inspection(inspection_id: int, body: FinalizeInspectionRequest, db: Session = Depends(get_db), account: Account = Depends(require_roles(Role.INSPECTOR))):
    inspection = db.get(InspectionFile, inspection_id)
    if inspection is None:
        raise HTTPException(404, "Không tìm thấy hồ sơ kiểm định.")
    if inspection.status in (InspectionStatus.PASSED, InspectionStatus.FAILED):
        raise HTTPException(409, "Hồ sơ kiểm định đã được kết luận hoàn tất trước đó.")
    if not body.checklist_complete:
        raise HTTPException(422, "Danh mục các hạng mục kiểm định bắt buộc phải được hoàn thành.")
    results = db.scalars(select(InspectionItem).where(InspectionItem.inspection_id == inspection_id)).all()
    if not results:
        raise HTTPException(422, "Cần có ít nhất một kết quả kiểm tra hạng mục kiểm định để kết luận.")
    inspection.status = InspectionStatus.FAILED if any(item.result in (ItemResult.MAJOR, ItemResult.DANGEROUS) for item in results) else InspectionStatus.PASSED
    db.commit()
    db.refresh(inspection)
    return inspection


@api.post("/inspections/{inspection_id}/certificates", response_model=CertificateRead, status_code=201)
def issue_certificate(inspection_id: int, body: CertificateCreate, db: Session = Depends(get_db), account: Account = Depends(require_roles(Role.ADMIN, Role.INSPECTOR))):
    inspection = db.get(InspectionFile, inspection_id)
    if inspection is None:
        raise HTTPException(404, "Không tìm thấy hồ sơ kiểm định.")
    if inspection.status != InspectionStatus.PASSED:
        raise HTTPException(409, "Chỉ có thể cấp giấy chứng nhận cho hồ sơ kiểm định đạt yêu cầu.")
    if not body.payment_complete or not body.legal_status_allowed:
        raise HTTPException(409, "Yêu cầu hoàn tất thanh toán phí/lệ phí và xác nhận phương tiện đủ điều kiện pháp lý trước khi cấp giấy.")
    if body.expires_on < body.issued_on:
        raise HTTPException(422, "Ngày hết hạn giấy chứng nhận không thể trước ngày cấp.")
    cert_data = body.model_dump()
    year = body.issued_on.year if body.issued_on else date.today().year

    # Tự động sinh số giấy chứng nhận nếu để trống
    if not (cert_data.get("certificate_number") or "").strip():
        for _ in range(10):
            candidate = f"GCN-{year}-{uuid4().hex[:6].upper()}"
            if not db.scalar(select(Certificate).where(Certificate.certificate_number == candidate)):
                cert_data["certificate_number"] = candidate
                break

    # Tự động sinh số tem kiểm định nếu để trống
    if not (cert_data.get("stamp_number") or "").strip():
        for _ in range(10):
            candidate = f"TEM-{year}-{uuid4().hex[:6].upper()}"
            if not db.scalar(select(Certificate).where(Certificate.stamp_number == candidate)):
                cert_data["stamp_number"] = candidate
                break

    certificate = Certificate(**cert_data, inspection_id=inspection.id, vehicle_id=inspection.vehicle_id, status=CertificateStatus.ACTIVE)
    db.add(certificate)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Số giấy chứng nhận hoặc số tem kiểm định đã tồn tại trong hệ thống.")
    db.refresh(certificate)
    return certificate


@api.post("/certificates/{certificate_id}/correction", response_model=CertificateRead)
def correct_certificate(certificate_id: int, body: CertificateCreate, db: Session = Depends(get_db), account: Account = Depends(require_roles(Role.ADMIN))):
    certificate = db.get(Certificate, certificate_id)
    if certificate is None:
        raise HTTPException(404, "Không tìm thấy thông tin giấy chứng nhận.")
    before = {key: str(getattr(certificate, key)) for key in CertificateCreate.model_fields}
    for key, value in body.model_dump().items():
        setattr(certificate, key, value)
    after = {key: str(getattr(certificate, key)) for key in CertificateCreate.model_fields}
    db.add(AuditEntry(actor_account_id=account.id, entity_type="certificate", entity_id=certificate.id, action="administrative_correction", before_value=str(before), after_value=str(after), created_at=datetime.now(timezone.utc).replace(tzinfo=None)))
    db.commit()
    db.refresh(certificate)
    return certificate


# ---------------------------------------------------------------------------
# ADMIN SYSTEM ROLE & ACCOUNT MANAGEMENT
# ---------------------------------------------------------------------------

@api.get("/admin/accounts", response_model=list[AccountListItem])
def list_system_accounts(
    admin: Account = Depends(require_roles(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    accounts = db.scalars(select(Account).order_by(Account.id.asc())).all()
    results = []
    for acc in accounts:
        disp = acc.display_name
        ph = acc.phone
        if acc.owner_id:
            owner = db.get(Owner, acc.owner_id)
            if owner:
                if not disp:
                    disp = owner.display_name
                if not ph:
                    ph = owner.phone
        results.append(
            AccountListItem(
                id=acc.id,
                username=acc.username,
                role=acc.role,
                is_active=acc.is_active,
                display_name=disp,
                email=acc.email,
                phone=ph,
                avatar_url=acc.avatar_url,
                owner_id=acc.owner_id,
            )
        )
    return results


@api.put("/admin/accounts/{account_id}/role", response_model=AccountListItem)
def update_account_role(
    account_id: int,
    body: AccountRoleUpdateRequest,
    admin: Account = Depends(require_roles(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản.")
    if account.id == admin.id and body.role != Role.ADMIN:
        raise HTTPException(status_code=400, detail="Không thể tự giáng quyền tài khoản quản trị của chính bạn.")

    if body.role == Role.ADMIN and account.role != Role.ADMIN:
        admin_count = db.scalar(
            select(func.count(Account.id)).where(Account.role == Role.ADMIN, Account.id != account.id)
        ) or 0
        if admin_count >= 1:
            raise HTTPException(
                status_code=400,
                detail="Hệ thống chỉ cho phép duy nhất 1 tài khoản Quản trị viên. Không thể phân quyền Quản trị viên cho tài khoản thứ hai.",
            )

    account.role = body.role
    db.commit()
    db.refresh(account)

    disp = account.display_name
    ph = account.phone
    if account.owner_id:
        owner = db.get(Owner, account.owner_id)
        if owner:
            if not disp:
                disp = owner.display_name
            if not ph:
                ph = owner.phone

    return AccountListItem(
        id=account.id,
        username=account.username,
        role=account.role,
        is_active=account.is_active,
        display_name=disp,
        email=account.email,
        phone=ph,
        avatar_url=account.avatar_url,
        owner_id=account.owner_id,
    )


@api.put("/admin/accounts/{account_id}/status", response_model=AccountListItem)
def update_account_status(
    account_id: int,
    body: AccountStatusUpdateRequest,
    admin: Account = Depends(require_roles(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản.")
    if account.id == admin.id and not body.is_active:
        raise HTTPException(status_code=400, detail="Không thể tự khóa tài khoản quản trị của chính bạn.")

    account.is_active = body.is_active
    db.commit()
    db.refresh(account)
    act_status = "unlock_account" if account.is_active else "lock_account"
    log_audit_event(
        db,
        admin.id,
        entity_type="account",
        entity_id=account.id,
        action=act_status,
        after_value=f"{'Mở khóa' if account.is_active else 'Khóa'} tài khoản @{account.username}",
    )
    db.commit()

    disp = account.display_name
    ph = account.phone
    if account.owner_id:
        owner = db.get(Owner, account.owner_id)
        if owner:
            if not disp:
                disp = owner.display_name
            if not ph:
                ph = owner.phone

    return AccountListItem(
        id=account.id,
        username=account.username,
        role=account.role,
        is_active=account.is_active,
        display_name=disp,
        email=account.email,
        phone=ph,
        avatar_url=account.avatar_url,
        owner_id=account.owner_id,
    )


@api.post("/admin/accounts", response_model=AccountListItem, status_code=status.HTTP_201_CREATED)
def create_system_account(
    body: AccountCreateAdminRequest,
    admin: Account = Depends(require_roles(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    clean_username = body.username.strip().lower()
    existing = db.scalar(select(Account).where(Account.username == clean_username))
    if existing:
        raise HTTPException(status_code=400, detail=f"Tên đăng nhập '{clean_username}' đã được sử dụng.")

    if body.role == Role.ADMIN:
        admin_count = db.scalar(select(func.count(Account.id)).where(Account.role == Role.ADMIN)) or 0
        if admin_count >= 1:
            raise HTTPException(
                status_code=400,
                detail="Hệ thống chỉ cho phép duy nhất 1 tài khoản Quản trị viên. Không thể tạo thêm Quản trị viên mới.",
            )

    new_acc = Account(
        username=clean_username,
        password_hash=hash_password(body.password),
        role=body.role,
        is_active=True,
        display_name=body.display_name.strip() if body.display_name else None,
        email=body.email.strip() if body.email else None,
        phone=body.phone.strip() if body.phone else None,
    )
    db.add(new_acc)
    db.commit()
    db.refresh(new_acc)

    return AccountListItem(
        id=new_acc.id,
        username=new_acc.username,
        role=new_acc.role,
        is_active=new_acc.is_active,
        display_name=new_acc.display_name,
        email=new_acc.email,
        phone=new_acc.phone,
        avatar_url=new_acc.avatar_url,
        owner_id=new_acc.owner_id,
    )


@api.put("/admin/accounts/{account_id}/profile", response_model=AccountListItem)
def update_account_profile_admin(
    account_id: int,
    body: AccountProfileUpdateAdminRequest,
    admin: Account = Depends(require_roles(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản.")

    clean_email = (body.email or "").strip().lower() or None
    if clean_email:
        if "@" not in clean_email or "." not in clean_email:
            raise HTTPException(status_code=400, detail="Vui lòng nhập định dạng email hợp lệ.")
        existing_email = db.scalar(
            select(Account).where(func.lower(Account.email) == clean_email, Account.id != account_id)
        )
        if existing_email:
            raise HTTPException(
                status_code=400,
                detail=f"Email '{clean_email}' đã được đăng ký cho tài khoản khác.",
            )

    account.display_name = (body.display_name or "").strip() or None
    account.email = clean_email
    account.phone = (body.phone or "").strip() or None

    if account.owner_id:
        owner = db.get(Owner, account.owner_id)
        if owner:
            if account.display_name:
                owner.display_name = account.display_name
            if account.phone:
                owner.phone = account.phone

    db.commit()
    db.refresh(account)

    disp = account.display_name
    ph = account.phone
    if account.owner_id:
        owner = db.get(Owner, account.owner_id)
        if owner:
            if not disp:
                disp = owner.display_name
            if not ph:
                ph = owner.phone

    return AccountListItem(
        id=account.id,
        username=account.username,
        role=account.role,
        is_active=account.is_active,
        display_name=disp,
        email=account.email,
        phone=ph,
        avatar_url=account.avatar_url,
        owner_id=account.owner_id,
    )


@api.post("/admin/accounts/{account_id}/reset-password")
def reset_account_password(
    account_id: int,
    body: AccountResetPasswordRequest,
    admin: Account = Depends(require_roles(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản.")
    account.password_hash = hash_password(body.new_password)
    db.commit()
    log_audit_event(
        db,
        admin.id,
        entity_type="account",
        entity_id=account.id,
        action="reset_password",
        after_value=f"Đặt lại mật khẩu cho tài khoản @{account.username}",
    )
    db.commit()
    return {"message": f"Đặt lại mật khẩu cho tài khoản '{account.username}' thành công."}


@api.delete("/admin/accounts/{account_id}")
def delete_account(
    account_id: int,
    admin: Account = Depends(require_roles(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản.")
    if account.id == admin.id:
        raise HTTPException(status_code=400, detail="Không thể xóa tài khoản quản trị của chính bạn.")
    if account.role == Role.ADMIN:
        raise HTTPException(status_code=400, detail="Không thể xóa tài khoản Quản trị viên hệ thống.")

    username = account.username
    try:
        db.delete(account)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Không thể xóa tài khoản này do đã có dữ liệu đo kiểm hoặc lịch sử nghiệp vụ liên kết. Bạn có thể sử dụng chức năng Khóa tài khoản.",
        )

    return {"message": f"Đã xóa vĩnh viễn tài khoản '@{username}' thành công."}




ACTION_GROUPS: dict[str, list[str]] = {
    "group_appointment": ["create_appointment", "cancel_appointment"],
    "group_inspection": ["create_inspection", "record_result", "finalize_inspection", "issue_certificate", "administrative_correction"],
    "group_vehicle_owner": ["create_vehicle", "create_owner", "delete_owner", "delete_vehicle"],
    "group_account": ["login", "register", "create_account", "update_role", "lock_account", "unlock_account", "reset_password"],
}


@api.get("/audit-logs", response_model=list[AuditLogItem])
def list_audit_logs(
    action: str | None = None,
    role: Role | None = None,
    query_text: str | None = None,
    admin: Account = Depends(require_roles(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    ensure_sample_audit_entries(db)

    stmt = select(AuditEntry).join(Account, AuditEntry.actor_account_id == Account.id).order_by(AuditEntry.created_at.desc(), AuditEntry.id.desc())

    if action and action.strip():
        act = action.strip()
        if act in ACTION_GROUPS:
            stmt = stmt.where(AuditEntry.action.in_(ACTION_GROUPS[act]))
        else:
            stmt = stmt.where(AuditEntry.action == act)
    if role:
        stmt = stmt.where(Account.role == role)
    if query_text and query_text.strip():
        q = f"%{query_text.strip().lower()}%"
        stmt = stmt.where(
            (func.lower(Account.username).like(q))
            | (func.lower(func.coalesce(Account.display_name, '')).like(q))
            | (func.lower(AuditEntry.action).like(q))
            | (func.lower(AuditEntry.entity_type).like(q))
            | (func.lower(func.coalesce(AuditEntry.after_value, '')).like(q))
            | (func.lower(func.coalesce(AuditEntry.before_value, '')).like(q))
        )

    entries = db.scalars(stmt).all()
    results = []
    for entry in entries:
        actor = entry.actor
        after_val = entry.after_value
        if after_val and "#APT-" in after_val:
            after_val = re.sub(r'#APT-[A-Za-z0-9]+\s*', '', after_val)
            after_val = re.sub(r'cho xe #(\d+)', r'xe', after_val)
        before_val = entry.before_value
        if before_val and "#APT-" in before_val:
            before_val = re.sub(r'#APT-[A-Za-z0-9]+\s*', '', before_val)
        results.append(
            AuditLogItem(
                id=entry.id,
                actor_account_id=entry.actor_account_id,
                actor_username=actor.username if actor else "he_thong",
                actor_display_name=(actor.display_name or actor.username) if actor else "Hệ thống",
                actor_role=actor.role if actor else Role.ADMIN,
                entity_type=entry.entity_type,
                entity_id=entry.entity_id,
                action=entry.action,
                action_label=ACTION_LABELS.get(entry.action, entry.action),
                before_value=before_val,
                after_value=after_val,
                created_at=entry.created_at,
            )
        )
    return results
