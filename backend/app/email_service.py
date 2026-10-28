"""Email delivery service using standard SMTP (Gmail or custom SMTP server)."""

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import settings

logger = logging.getLogger("uvicorn.error")


def send_otp_email(to_email: str, otp_code: str, username: str = "") -> None:
    """Send a real 6-digit OTP email to recipient via configured SMTP."""
    smtp_user = settings.smtp_user.strip() if settings.smtp_user else ""
    smtp_password = settings.smtp_password.strip() if settings.smtp_password else ""

    if not smtp_user or not smtp_password:
        raise ValueError(
            "Chưa cấu hình tài khoản gửi thư (SMTP_USER / SMTP_PASSWORD) trong backend/.env. "
            "Vui lòng thêm thông tin tài khoản Gmail hoặc SMTP để hệ thống gửi thư thực tế."
        )

    sender_email = settings.smtp_from.strip() if settings.smtp_from else smtp_user
    subject = f"[Đăng kiểm] Mã xác nhận khôi phục mật khẩu: {otp_code}"

    display_name = username or to_email

    html_content = f"""
    <div style="font-family: Arial, sans-serif; max-width: 540px; margin: auto; padding: 28px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
      <div style="text-align: center; margin-bottom: 22px;">
        <div style="display: inline-block; width: 44px; height: 44px; line-height: 44px; border-radius: 10px; background: #1d4ed8; color: #ffffff; font-size: 18px; font-weight: bold; text-align: center;">ĐK</div>
        <h2 style="color: #0f172a; margin: 12px 0 4px 0; font-size: 20px;">HỆ THỐNG QUẢN LÝ ĐĂNG KIỂM</h2>
        <p style="color: #64748b; font-size: 14px; margin: 0;">Khôi phục mật khẩu tài khoản</p>
      </div>

      <p style="font-size: 15px; color: #334155;">Xin chào <strong>{display_name}</strong>,</p>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        Hệ thống nhận được yêu cầu đặt lại mật khẩu cho tài khoản liên kết với địa chỉ email <strong>{to_email}</strong>. 
        Vui lòng sử dụng mã xác nhận (OTP) gồm 6 chữ số dưới đây:
      </p>

      <div style="text-align: center; margin: 28px 0;">
        <span style="display: inline-block; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #1d4ed8; background: #eff6ff; padding: 14px 32px; border-radius: 10px; border: 2px dashed #3b82f6;">{otp_code}</span>
      </div>

      <p style="color: #64748b; font-size: 13.5px; line-height: 1.6;">
        ⏱️ Mã xác nhận này có hiệu lực trong vòng <strong>10 phút</strong>.<br/>
        🔒 Vì lý do an toàn, vui lòng tuyệt đối <strong>không chia sẻ</strong> mã này cho bất kỳ ai.
      </p>

      <div style="color: #94a3b8; font-size: 12px; border-top: 1px solid #f1f5f9; padding-top: 16px; margin-top: 26px; line-height: 1.5;">
        Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua thư này hoặc thông báo cho quản trị viên hệ thống để kiểm tra bảo mật.
      </div>
    </div>
    """

    text_content = f"Xin chào {display_name},\n\nMã xác nhận khôi phục mật khẩu của bạn là: {otp_code}\nMã có hiệu lực trong vòng 10 phút. Tuyệt đối không chia sẻ mã này cho người khác."

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"Hệ thống Đăng kiểm <{sender_email}>"
    msg["To"] = to_email

    msg.attach(MIMEText(text_content, "plain", "utf-8"))
    msg.attach(MIMEText(html_content, "html", "utf-8"))

    try:
        if settings.smtp_port == 465:
            server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15)
        else:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
            if settings.smtp_tls:
                server.starttls()

        server.login(smtp_user, smtp_password)
        server.sendmail(sender_email, [to_email], msg.as_string())
        server.quit()
        logger.info("[EMAIL_OTP] Đã gửi mã xác nhận tới email thành công: %s", to_email)
    except Exception as exc:
        logger.error("[EMAIL_OTP] Lỗi gửi email tới %s qua SMTP %s:%s: %s", to_email, settings.smtp_host, settings.smtp_port, exc)
        raise RuntimeError(f"Gửi email qua máy chủ SMTP thất bại: {exc}") from exc

