# 🚗 HỆ THỐNG QUẢN LÝ ĐĂNG KIỂM PHƯƠNG TIỆN XE CƠ GIỚI TÍCH HỢP AI

> **Hệ thống quản lý quy trình kiểm định phương tiện xe cơ giới tập trung, chuẩn hóa theo quy định đăng kiểm Việt Nam, tích hợp trợ lý AI thông minh hỗ trợ phân tích tiêu chuẩn kỹ thuật và tư vấn nghiệp vụ.**

---

## 📌 1. Giới thiệu tổng quan

Dự án được xây dựng nhằm hiện đại hóa và số hóa toàn diện quy trình đăng kiểm phương tiện xe cơ giới tại các trung tâm đăng kiểm. Hệ thống kết hợp giữa nền tảng phần mềm quản lý điều hành thời gian thực và sức mạnh của mô hình ngôn ngữ lớn (Google Gemini AI), giúp:
- Tự động hóa tiếp nhận hồ sơ, đặt lịch hẹn kiểm định trực tuyến và phân luồng chuyền kiểm định.
- Hỗ trợ kiểm định viên đánh giá các chỉ tiêu kỹ thuật (nhận dạng, phanh, đèn, khí thải, khung gầm) theo quy chuẩn.
- Cung cấp trợ lý AI phục vụ đa vai trò: phân tích tiêu chuẩn kỹ thuật chuyên ngành và trả lời thắc mắc cho chủ phương tiện.
- Bảo mật thông tin tuyệt đối với phân quyền 4 cấp độ và khôi phục mật khẩu xác thực OTP qua Email thực tế.

---

## 🛠️ 2. Công nghệ sử dụng (Tech Stack)

### **Frontend**
- **Framework**: React 18 (TypeScript)
- **Công cụ xây dựng**: Vite
- **Giao diện & Trải nghiệm (UI/UX)**:
  - Thiết kế hiện đại chuẩn Enterprise SaaS, hỗ trợ phong cách Glassmorphism.
  - Hệ thống thông báo nổi (Floating Toast Notifications) góc dưới bên phải màn hình.
  - Hộp thoại tương tác (Web Modal Dialogs) thay thế toàn bộ popup trình duyệt.
  - Bảng điều khiển trực quan, thẻ trạng thái chuyển động mượt mà.

### **Backend**
- **Framework**: FastAPI (Python 3.11+)
- **ORM & Database**: SQLAlchemy 2.0, SQLite (hoặc PostgreSQL / MySQL)
- **Xác thực & Bảo mật (Security)**:
  - JWT (JSON Web Tokens) với thuật toán HS256.
  - Mã hóa mật khẩu bằng `bcrypt` / `argon2`.
  - Kiểm soát truy cập dựa trên vai trò nghiêm ngặt (**RBAC - Role-Based Access Control**).
- **Tích hợp Email**: SMTP (Google Gmail SMTP) gửi mã OTP 6 số thực tế khôi phục tài khoản.

### **Trí tuệ nhân tạo (AI Engine)**
- **Mô hình**: Google Gemini 1.5 Flash / 2.5 Flash (`google-genai` SDK).
- **Kỹ thuật Prompt**: System Prompt chuyên sâu về Luật Giao thông & Quy chuẩn kỹ thuật đăng kiểm xe cơ giới Việt Nam.
- **Khả năng chịu lỗi (Resilience)**: Cơ chế Fallback cục bộ thông minh khi mất mạng hoặc quá tải API.

---

## 👥 3. Phân quyền người dùng (Role-Based Access)

Hệ thống hỗ trợ 4 vai trò độc lập với không gian làm việc chuyên biệt:

| Vai trò | Tên đăng nhập demo | Quyền hạn chính |
| :--- | :--- | :--- |
| **Quản trị viên (Admin)** | `admin` | Quản lý toàn bộ tài khoản nhân sự & chủ xe; Phân quyền vai trò; Khóa/mở khóa tài khoản; Đổi mật khẩu; Sửa thông tin tài khoản; Phân tích yêu cầu quy chuẩn kiểm định bằng AI. |
| **Nhân viên tiếp nhận (Intake)** | `tiepnhanhoso` | Tiếp nhận hồ sơ đăng kiểm phương tiện; Quản lý và điều phối lịch hẹn kiểm định; Khởi tạo lượt kiểm định mới cho chuyền kỹ thuật. |
| **Kiểm định viên (Inspector)** | `kiemdinhvien` | Thực hiện đo kiểm kỹ thuật trực tiếp trên chuyền (5 công đoạn: Nhận dạng, Khung gầm, Phanh, Đèn chiếu sáng, Khí thải & Tiếng ồn); Chốt kết quả Đạt/Không đạt; Cấp Giấy chứng nhận (GCN) kiểm định. |
| **Chủ phương tiện (Owner)** | `chuxe` | Đăng ký tài khoản trực tuyến (bắt buộc Email & SĐT); Quản lý danh sách phương tiện cá nhân; Đặt lịch hẹn đăng kiểm trực tuyến; Tra cứu hồ sơ & lịch sử kiểm định; Trợ lý AI hỏi đáp xe của mình. |

---

## 🚀 4. Hướng dẫn cài đặt & Khởi chạy nhanh

### **Yêu cầu môi trường**
- **Python**: Phiên bản 3.10 trở lên.
- **Node.js**: Phiên bản 18 trở lên (đã kèm `npm`).
- Hệ điều hành: Windows, macOS hoặc Linux.

---

### **Cách 1: Khởi chạy 1-Click tự động (Khuyên dùng trên Windows)**

Mở PowerShell tại thư mục gốc dự án và chạy:
```powershell
.\run.ps1
```
> Script sẽ tự động kiểm tra môi trường, khởi động song song Backend (cổng `8000`) và Frontend (cổng `5173`), đồng thời mở ghi log tự động trong `.run-logs/`.

---

### **Cách 2: Khởi chạy thủ công từng phần**

#### **1. Cấu hình & Chạy Backend**
```powershell
# Di chuyển vào thư mục backend
cd backend

# Tạo và kích hoạt môi trường ảo
python -m venv .venv
.\.venv\Scripts\Activate.ps1    # Trên macOS/Linux: source .venv/bin/activate

# Cài đặt thư viện phụ thuộc
pip install -r requirements.txt

# Tạo file cấu hình môi trường từ file mẫu
Copy-Item .env.example .env

# Khởi tạo dữ liệu mẫu ban đầu
python seed_sample_data.py

# Khởi chạy server FastAPI
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```
- API Backend hoạt động tại: `http://localhost:8000`
- Tài liệu API tương tác (Swagger UI): `http://localhost:8000/docs`

#### **2. Cài đặt & Chạy Frontend**
Mở một cửa sổ Terminal mới:
```powershell
# Di chuyển vào thư mục frontend
cd frontend

# Cài đặt các gói thư viện
npm install

# Khởi chạy máy chủ phát triển
npm run dev
```
- Giao diện người dùng hoạt động tại: `http://localhost:5173`

---

## ⚙️ 5. Cấu hình biến môi trường (`backend/.env`)

Để kích hoạt đầy đủ tính năng AI và gửi Email OTP thực tế, tạo file `backend/.env` với nội dung:

```env
DATABASE_URL=sqlite:///./inspection.db
JWT_SECRET=thay-the-bang-chuoi-khoa-bi-mat-dai-va-an-toan
JWT_ISSUER=vehicle-inspection
ACCESS_TOKEN_MINUTES=60
CORS_ORIGINS=http://localhost:5173

# Khóa API Google Gemini AI (Dùng cho trợ lý AI & phân tích quy chuẩn)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-1.5-flash

# Cấu hình gửi thư xác thực OTP qua Gmail SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_google_app_password_here
SMTP_FROM=your_email@gmail.com
SMTP_TLS=True
```

---

## 🧪 6. Kiểm thử tự động (Automated Testing)

Hệ thống được trang bị bộ kiểm thử tích hợp toàn diện gồm **19 test cases** kiểm tra đầy đủ các luồng đúng, sai, biên:
- Kiểm thử luồng nghiệp vụ tạo hồ sơ, đo kiểm chuyền, cấp chứng nhận, cấp đổi chứng nhận.
- Kiểm thử bảo mật: Xác thực JWT, phân quyền RBAC 403, tài khoản bị tạm khóa.
- Kiểm thử đăng ký: Kiểm tra định dạng email bắt buộc, ngăn chặn tài khoản trùng lặp.
- Kiểm thử OTP Email: Khởi tạo mã, xác thực mã đúng/sai, hết hạn mã, đổi mật khẩu.
- Kiểm thử quyền Admin: Cập nhật thông tin tài khoản, đổi quyền, reset mật khẩu, xóa tài khoản.

Chạy kiểm thử:
```powershell
cd backend
.\.venv\Scripts\python.exe -m unittest tests/test_workflows.py
```
Kết quả kiểm thử đạt **19/19 tests PASS (100%)**.

---

## 🛡️ 7. Cam kết Đạo đức AI & Trách nhiệm (Responsible AI)

1. **AI chỉ mang tính chất tham vấn**: Hệ thống phân định rõ AI không được tự động ra quyết định phê duyệt đăng kiểm. Quyết định cấp Giấy chứng nhận thuộc quyền hạn và trách nhiệm của **Kiểm định viên con người**.
2. **Bảo mật dữ liệu cá nhân**: Lời nhắc AI (Prompt Context) được cô lập nghiêm ngặt theo vai trò; Chủ xe không bao giờ có thể truy cập thông tin phương tiện hoặc lịch sử kiểm định của chủ xe khác.
3. **Cảnh báo minh bạch**: Mọi màn hình tương tác với trợ lý AI đều hiển thị thông báo rõ ràng cho người dùng về giới hạn thông tin và khuyến cáo bảo mật.

---

## 📂 8. Cấu trúc thư mục dự án

```
he-thong-dang-kiem-tich-hop-AI/
├── README.md                  # Tài liệu hướng dẫn tổng quan dự án
├── run.ps1                    # Script PowerShell khởi chạy 1-click toàn bộ hệ thống
├── backend/                   # Mã nguồn Backend (FastAPI, Python)
│   ├── .env.example           # File mẫu biến môi trường
│   ├── requirements.txt       # Danh sách thư viện Python
│   ├── seed_sample_data.py    # Script nạp dữ liệu mẫu ban đầu
│   ├── app/
│   │   ├── main.py            # Khởi tạo ứng dụng FastAPI và Middleware
│   │   ├── config.py          # Cấu hình Settings và biến môi trường
│   │   ├── database.py        # Kết nối cơ sở dữ liệu SQLAlchemy
│   │   ├── models.py          # Định nghĩa cấu trúc bảng (ORM Models)
│   │   ├── schemas.py         # Định nghĩa cấu trúc dữ liệu Pydantic
│   │   ├── routers.py         # Khai báo các API Endpoints và logic xử lý
│   │   ├── security.py        # Xử lý mã hóa mật khẩu, tạo và xác thực JWT
│   │   └── email_service.py   # Dịch vụ gửi thư điện tử xác thực OTP qua SMTP
│   └── tests/
│       └── test_workflows.py  # Bộ kiểm thử tự động toàn diện (19 test cases)
└── frontend/                  # Mã nguồn Frontend (React, TypeScript, Vite)
    ├── package.json           # Danh sách thư viện và scripts Node.js
    ├── vite.config.ts         # Cấu hình Vite bundler
    └── src/
        ├── App.tsx            # Thành phần giao diện chính và quản lý trang
        ├── api.ts             # Module gọi API RESTful tới Backend
        ├── styles.css         # Hệ thống giao diện, hiệu ứng và Toast styles
        └── support-chat.css   # Định kiểu cho Trợ lý ảo AI Support Chat
```

