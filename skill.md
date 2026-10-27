# Skill: Phát triển hệ thống quản lý đăng kiểm tích hợp AI

## Nguồn và nguyên tắc sử dụng

- Nguồn yêu cầu duy nhất cho skill này: [`user_story.md`](./user_story.md), gồm US-01 đến US-21.
- Tài liệu nguồn mô tả toàn hệ thống, không định danh một module hẹp. Vì vậy skill này áp dụng ở cấp hệ thống; khi được giao một module con, chỉ triển khai các User Story được chỉ định và các phụ thuộc cần thiết.
- Không coi đề xuất thứ tự triển khai trong tài liệu là API, schema hay quyết định kiến trúc đã được phê duyệt.
- Không điền các điểm “cần làm rõ” bằng giả định. Khi một quyết định cần thiết cho triển khai chưa có, nêu rõ câu hỏi/blocker và xin xác nhận; có thể tiếp tục phần độc lập đã đủ yêu cầu.
- Ngữ cảnh stack được ghi nhận: FastAPI, React, SQLite và RAG. Phiên bản, thư viện, cấu trúc thư mục và quy ước dự án cụ thể chưa được chỉ định; kiểm tra repository trước khi chọn hoặc thay đổi.

## 1. Purpose

Hướng dẫn AI Agent phát triển hệ thống quản lý đăng kiểm phương tiện: quản lý chủ xe, phương tiện, lịch hẹn, hồ sơ/giấy tờ, đánh giá và kiểm định, chứng nhận, thanh toán, phát hành kết quả, báo cáo, quản trị nội bộ và các chức năng AI hỗ trợ được nêu trong User Story.

## 2. Scope

### Trong phạm vi

- Các chức năng US-01–US-21 theo đúng actor, acceptance criteria và business rules tương ứng.
- Tích hợp AI chỉ cho hỏi đáp theo tài liệu, tóm tắt hồ sơ và soạn tin nhắn theo US-09–US-11.
- Hỗ trợ cấu hình checklist, biểu phí, quy tắc/phiên bản nghiệp vụ khi User Story yêu cầu; nội dung pháp lý và ngưỡng chuyên môn phải lấy từ nguồn có thẩm quyền, không tự đặt.
- Tích hợp dữ liệu ngoài, SMS, thiết bị, cơ sở dữ liệu dùng chung/Cục Đăng kiểm chỉ trong phạm vi được cấp quyền và khi giao thức/đặc tả được cung cấp.

### Ngoài phạm vi hoặc chưa được xác lập

- Dùng AI để kết luận đạt/không đạt, quyết định pháp lý, tự xử lý cảnh báo hành chính hoặc thay kiểm định viên/người có thẩm quyền.
- Tự chọn nhà cung cấp, giao thức, biểu mẫu, ngưỡng kỹ thuật, quy tắc pháp lý, chính sách lưu trữ, lịch làm việc hoặc cơ chế retry chưa được đặc tả.
- Các hướng dẫn sử dụng AI trong SDLC trong tài liệu nguồn không phải chức năng sản phẩm.
- Tính năng, màn hình, endpoint hoặc luồng nghiệp vụ không có căn cứ trong US-01–US-21.

## 3. User Stories

Áp dụng đúng mô tả, actor, acceptance criteria và priority trong `user_story.md`:

| ID | User Story | Actor chính |
|---|---|---|
| US-01 | Đăng nhập và phân quyền | Quản trị viên, nhân viên tiếp nhận, kiểm định viên; chủ xe có luồng tài khoản được nêu |
| US-02 | Quản lý chủ xe và phương tiện | Nhân viên tiếp nhận, quản trị viên |
| US-03 | Đặt lịch đăng kiểm | Chủ xe; nhân viên tiếp nhận hỗ trợ cần xác nhận |
| US-04 | Quản lý hồ sơ kiểm định và giấy tờ | Nhân viên tiếp nhận, kiểm định viên |
| US-05 | Nhập kết quả kiểm tra từng hạng mục | Kiểm định viên |
| US-06 | Quản lý chứng nhận và ngày hết hạn | Nhân viên tiếp nhận, kiểm định viên, quản trị viên/trưởng dây chuyền |
| US-07 | Tra cứu lịch sử đăng kiểm | Chủ xe, nhân viên tiếp nhận, kiểm định viên |
| US-08 | Thống kê lượt kiểm định và hồ sơ đạt/không đạt | Quản trị viên, nhân viên tiếp nhận |
| US-09 | Hỏi đáp quy trình bằng chatbot | Chủ xe |
| US-10 | Tóm tắt hồ sơ phương tiện bằng AI | Nhân viên tiếp nhận, kiểm định viên |
| US-11 | Sinh tin nhắn nhắc lịch/thông báo hồ sơ | Nhân viên tiếp nhận |
| US-12 | Tiếp nhận hồ sơ lần đầu/định kỳ | Chủ xe, nhân viên tiếp nhận |
| US-13 | Tra cứu phạt nguội/cảnh báo | Nhân viên tiếp nhận |
| US-14 | Đánh giá hồ sơ và đối chiếu dữ liệu | Nhân viên tiếp nhận, kiểm định viên |
| US-15 | Lập phiếu, thông báo và hẹn kiểm định | Nhân viên tiếp nhận, điều phối viên, kiểm định viên |
| US-16 | Ghi nhận kiểm tra kỹ thuật/dây chuyền | Kiểm định viên |
| US-17 | Thu phí và quản lý chứng từ | Nhân viên thu phí/kế toán |
| US-18 | Phát hành và đồng bộ kết quả | Kiểm định viên có thẩm quyền, nhân viên tiếp nhận |
| US-19 | Quản lý đăng kiểm viên/chứng chỉ | Quản trị viên |
| US-20 | Quản lý thiết bị/hiệu chuẩn | Quản trị viên, nhân viên quản lý thiết bị |
| US-21 | Báo cáo hoạt động trung tâm | Quản trị viên, nhân viên kế toán/nghiệp vụ |

## 4. Business Rules

- Phân quyền theo các vai trò và giới hạn đã nêu. Nhân viên tiếp nhận không được tạo/sửa kết quả kiểm định; kiểm định viên nhập kết quả. Admin/trưởng dây chuyền chỉ đính chính chứng nhận theo quyền được cấp và mọi thay đổi phải có audit log. Quyền chi tiết chưa được mô tả đầy đủ.
- Một chủ xe có thể có nhiều phương tiện; một phương tiện có thể có nhiều hồ sơ và lịch sử lịch hẹn.
- Một phương tiện chỉ có một lịch đang hiệu lực tại một thời điểm. Chỉ nhận khung giờ 06:30–11:00 hoặc 13:00–17:30. Sức chứa, thời lượng, ngày nghỉ, múi giờ và điều kiện đặt lại chưa chốt.
- Hồ sơ phân loại lần đầu/định kỳ; checklist thay đổi theo loại xe, tình trạng cải tạo/thay số và hình thức giấy tờ. Phân biệt tài liệu phải nộp với tài liệu phải xuất trình. Không coi bảo hiểm/tờ khai luôn bắt buộc.
- Kết quả hạng mục là Đạt, Mi, Ma hoặc DD. Tổng thể Đạt nếu chỉ có Đạt/Mi; Không đạt nếu có ít nhất một Ma/DD. Ý nghĩa/ngưỡng chính thức của trạng thái phải lấy từ cấu hình được phê duyệt; còn cần xác nhận theo tài liệu nguồn.
- Kiểm định gồm 5 công đoạn và các hạng mục liệt kê tại US-16. Lưu trị số/đơn vị khi có, người hoặc thiết bị ghi nhận, thời điểm và người chịu trách nhiệm/phê duyệt. Kết luận chuyên môn do kiểm định viên có thẩm quyền xác nhận; AI không kết luận.
- Chỉ khởi tạo/phát hành chứng nhận khi phiên kiểm định đạt theo quy tắc đã chốt, nghĩa vụ thanh toán hoàn tất và trạng thái pháp lý cho phép. Số GCN/tem duy nhất. Gia hạn, đổi biển/sang tên, thay thế, thu hồi, hủy và vô hiệu tuân điều kiện/quy định có thẩm quyền; không tự suy diễn.
- Thống kê chốt cuối ngày sau giờ làm việc theo từng trung tâm; báo cáo phải truy nguyên được về hồ sơ/giao dịch nguồn. Mẫu báo cáo và xử lý điều chỉnh sau chốt chưa chốt.
- Chatbot chỉ dựa trên tài liệu quy trình cung cấp. Nếu không tìm thấy câu trả lời, trả đúng: “Câu hỏi không liên quan đến tài liệu”. Hiển thị cảnh báo AI không quyết định kết quả đăng kiểm.
- AI tóm tắt hồ sơ để hỗ trợ; nội dung sinh không cần lưu. AI soạn SMS từ lịch/hồ sơ phù hợp; hệ thống gửi nhắc lịch một ngày trước lịch hẹn, không yêu cầu duyệt nội dung. Nhà cung cấp, retry và điều kiện dừng khi thiếu dữ liệu chưa chốt.
- Chỉ truy vấn nguồn cảnh báo được cấp quyền; phân biệt “không có cảnh báo” với “chưa tra cứu được”. Không tự suy diễn cách xử lý.
- Chu kỳ kiểm định, checklist, biểu phí, mẫu biểu và ngưỡng kỹ thuật phải theo quy tắc có hiệu lực/được cấu hình và lưu phiên bản khi User Story yêu cầu.

## 5. Database

### Thực thể và dữ liệu đã được nêu

User Story chưa quy định tên bảng, tên cột vật lý, kiểu dữ liệu, khóa, chuẩn hóa, nullable/default, index hoặc chính sách xóa. Danh sách dưới đây là dữ liệu nghiệp vụ cần hỗ trợ, không phải schema đã được phê duyệt.

| Thực thể nghiệp vụ (tên gợi ý, chưa chốt) | Thuộc tính được yêu cầu |
|---|---|
| Chủ xe | Họ tên cá nhân/tên tổ chức; số định danh/CCCD hoặc mã số thuế; điện thoại nhận OTP/thông báo; địa chỉ cư trú/trụ sở theo giấy đăng ký xe |
| Phương tiện | Biển số; ký tự phân loại màu biển khi áp dụng (xe biển 5 số); số khung (đầy đủ hoặc 6 số cuối khi tra cứu trực tuyến); số máy; loại phương tiện |
| Tài khoản/người dùng và phân quyền | Tài khoản chủ xe; vai trò nội bộ; OTP qua số điện thoại. Chi tiết credential, session, schema vai trò chưa chốt |
| Lịch hẹn | Mã tự sinh; trung tâm; ngày/khung giờ; loại dịch vụ (định kỳ, đăng ký xe mới, thay đổi thông tin); trạng thái cần thiết cho lịch đang hiệu lực/hủy chưa được định nghĩa đầy đủ |
| Hồ sơ kiểm định | Mã hồ sơ tự sinh tại trạm; phương tiện; lần đầu/định kỳ; kênh và thời điểm tiếp nhận; số quản lý GCN cũ; số seri đăng ký xe hoặc số giấy hẹn/văn bản ngân hàng thế chấp; số hợp đồng bảo hiểm TNDS và ngày hết hạn nếu áp dụng |
| Giấy tờ/checklist | Loại giấy tờ, tình trạng nộp/xuất trình và liên kết hồ sơ; checklist chi tiết theo US-12. Metadata tệp, storage và trạng thái xác minh chưa chốt |
| Kết quả kiểm định | Hồ sơ, phương tiện, 5 công đoạn, từng hạng mục, Đạt/Mi/Ma/DD, trị số/đơn vị nếu có, mã lỗi, người/thiết bị ghi nhận, thời điểm, đăng kiểm viên chịu trách nhiệm/phê duyệt |
| Chứng nhận/tem | Số GCN, số tem, ngày cấp, ngày hết hạn, chu kỳ, tiêu chuẩn khí thải đạt được; liên kết phương tiện/hồ sơ; trạng thái và lịch sử phát hành/đính chính theo US-06 |
| Thanh toán/chứng từ | Khoản phí theo biểu phí có phiên bản/hiệu lực; giao dịch, biên lai/hóa đơn điện tử; liên kết hồ sơ. Các trường cụ thể chưa chốt |
| Nhật ký/audit và tích hợp | Audit đính chính chứng nhận; trạng thái gửi đồng bộ, thời điểm, mã phản hồi; cảnh báo nguồn/thời điểm; đo thiết bị và hiệu chuẩn khi áp dụng. Schema chưa chốt |

### Khóa, quan hệ, kiểu dữ liệu và ràng buộc

- Quan hệ nghiệp vụ xác định: một chủ xe — nhiều phương tiện; một phương tiện — nhiều hồ sơ và lịch sử lịch hẹn; kết quả gắn hồ sơ, phương tiện, công đoạn và kiểm định viên; chứng nhận liên quan phương tiện hoặc hồ sơ tương ứng; giao dịch liên kết hồ sơ.
- Primary key, foreign key cụ thể, kiểu dữ liệu, nullable, unique/index và cascade behavior: **chưa được User Story xác định**. Không tự chốt các chi tiết này nếu chưa kiểm tra quy ước đã tồn tại trong repository hoặc được người dùng xác nhận.
- Các ràng buộc nghiệp vụ đã nêu: tối đa một lịch đang hiệu lực trên mỗi phương tiện; số GCN/tem duy nhất; kết quả tổng hợp theo quy tắc ở mục 4. Cách thực thi ở DB/API chưa quy định.
- Trước khi triển khai migration, ghi rõ các lựa chọn cần thiết (bao gồm kiểu dữ liệu, khóa và constraint) và chỉ thực hiện trong phạm vi quyết định đã được xác nhận hoặc quy ước dự án có sẵn.

## 6. API Contract

`user_story.md` không định nghĩa endpoint nào. Vì vậy HTTP method, path, authentication cho từng API, request/response schema, status code, error payload và validation ở cấp API đều **chưa được xác định**. Không tạo API contract giả định trong implementation hoặc tài liệu.

Khi được giao thiết kế API, trước tiên kiểm tra contract/route đang có trong repository. Nếu chưa có, lập đề xuất riêng bao gồm đủ các trường trên cho từng use case và yêu cầu xác nhận trước khi coi là contract. Điều kiện nghiệp vụ và phân quyền ở mục 4, 8, 9, 10 vẫn phải được bảo toàn trong mọi API.

## 7. Backend Rules

- Dùng FastAPI theo cấu trúc và conventions sẵn có trong repository; không tự thay kiến trúc/thư viện nếu chưa có căn cứ.
- Thực thi phân quyền ở backend cho mọi thao tác và truy vấn dữ liệu; không dựa riêng vào ẩn/hiện UI.
- Kiểm tra sở hữu phương tiện của chủ xe khi tra cứu/đặt/hủy lịch; nhân viên chỉ truy cập theo quyền được cấp.
- Đảm bảo tính nhất quán cho lịch đang hiệu lực, kết quả, thanh toán và điều kiện phát hành chứng nhận; cơ chế transaction/concurrency cụ thể theo thiết kế được duyệt.
- Lưu audit cho đính chính chứng nhận; giữ dấu vết người thực hiện, thời gian và thay đổi theo schema được xác nhận.
- Tách quyết định chuyên môn khỏi AI. Backend không dùng đầu ra AI để đặt kết quả kiểm định hay trạng thái pháp lý.
- Lưu phiên bản/nguồn quy tắc khi tính chu kỳ, biểu phí hoặc checklist nếu luồng đó được triển khai theo User Story.
- Tích hợp ngoài phải thể hiện rõ trạng thái thành công/thất bại/chưa tra cứu được; chỉ hỗ trợ retry an toàn khi contract tích hợp cho phép.
- Không ghi lộ dữ liệu cá nhân, OTP, bí mật hoặc tài liệu hồ sơ vào log không được bảo vệ.

## 8. Frontend Rules

- Dùng React theo cấu trúc/conventions đang có; không tự tạo thiết kế điều hướng hoặc workflow ngoài User Story.
- Ẩn/khóa thao tác theo vai trò để hỗ trợ người dùng, đồng thời dựa vào lỗi phân quyền từ backend làm nguồn quyết định cuối.
- Không cung cấp thao tác nhập/sửa kết quả kiểm định cho nhân viên tiếp nhận.
- Chủ xe chỉ tra cứu hồ sơ/lịch sử và quản lý lịch của phương tiện thuộc tài khoản. Hiển thị các khung giờ được phép; không tự suy diễn slot còn trống nếu backend chưa xác nhận.
- Hiển thị rõ giấy tờ phải nộp và phải xuất trình; điều kiện checklist phụ thuộc loại hồ sơ/xe và dữ liệu đã xác nhận.
- Hiển thị trạng thái phân biệt được: không có cảnh báo/chưa tra cứu được; lịch hiệu lực/đã hủy; kết quả và trạng thái đồng bộ theo dữ liệu backend.
- Chatbot phải hiển thị cảnh báo AI không quyết định kết quả đăng kiểm và giữ nguyên câu trả lời fallback đã quy định.
- Trình bày tóm tắt AI là thông tin hỗ trợ, không phải kết luận chuyên môn. Không biến nội dung AI thành kết quả chính thức.
- Không hiển thị dữ liệu cá nhân nhạy cảm cho vai trò không được cấp quyền.

## 9. Validation

### Đã xác định

- Lịch: thời gian nằm trong 06:30–11:00 hoặc 13:00–17:30; tối đa một lịch đang hiệu lực trên mỗi phương tiện. Quy tắc ngày làm việc, sức chứa, múi giờ và chuyển trạng thái cần xác nhận.
- Kết quả hạng mục: chỉ Đạt, Mi, Ma, DD; tổng thể Đạt khi mọi mục là Đạt/Mi, Không đạt khi có ít nhất một Ma/DD.
- Ảnh kiểm định ngoài cơ sở: rõ nét, tối thiểu 1280×720 pixel, có dấu thời gian thực gồm ngày/tháng/năm/giờ/phút.
- Checklist và giấy đăng ký xe: xác thực theo điều kiện loại hồ sơ/xe và hình thức giấy tờ được US-12 liệt kê; không bắt buộc giấy tờ khi điều kiện áp dụng chưa thỏa.
- Chứng nhận: số GCN và số tem duy nhất; chỉ phát hành khi đủ điều kiện nghiệp vụ/pháp lý và thanh toán.
- OTP: gửi tới số điện thoại tài khoản theo luồng được nêu; độ dài, hết hạn, giới hạn thử và rate limit chưa xác định.

### Chưa được xác định

Độ dài/định dạng/required của từng trường chủ xe, phương tiện và tài khoản; chuẩn biển số/số khung/số máy; giới hạn tệp; loại MIME; thời hạn lưu; quy tắc trùng lặp ngoài các constraint được nêu; format mã hồ sơ/lịch; các giới hạn nhập liệu API. Không tự đặt các giá trị này.

## 10. Security

- Hỗ trợ đăng nhập và phân quyền; chủ xe xác thực bằng tài khoản và nhận OTP qua điện thoại theo User Story. Cơ chế xác thực/ủy quyền chi tiết chưa được chốt.
- Chủ xe chỉ được truy cập phương tiện, hồ sơ và lịch thuộc tài khoản; nhân viên bị giới hạn theo quyền được cấp.
- Chỉ kiểm định viên thực hiện nghiệp vụ nhập kết quả; chỉ Admin/Trưởng dây chuyền được đính chính chứng nhận theo quyền được cấp.
- Bảo vệ dữ liệu CCCD/mã số thuế, số điện thoại, địa chỉ, hồ sơ và giấy tờ. Quy tắc mã hóa, masking, retention và audit truy cập cần được xác nhận.
- Kết nối cảnh báo chỉ tới nguồn được cấp quyền. RAG chỉ sử dụng tài liệu quy trình được cung cấp; quyền đưa hồ sơ vào RAG và biện pháp bảo vệ dữ liệu cần chốt trước khi bật.
- Không để AI quyết định kết quả, phát hành chứng nhận hoặc xử lý cảnh báo. Không tin nội dung đầu vào AI là quyền hạn/ủy quyền.
- Không log OTP, thông tin xác thực, bí mật tích hợp hoặc toàn bộ hồ sơ nhạy cảm.

## 11. Error Handling

- Lỗi xác thực/phân quyền: từ chối thao tác; không tiết lộ dữ liệu ngoài phạm vi người dùng.
- Lịch không hợp lệ hoặc xung đột lịch đang hiệu lực: không tạo lịch; thông báo lỗi rõ ràng. Chi tiết status/payload API chưa được định nghĩa.
- Hồ sơ thiếu/sai khác: ghi nhận thiếu/sai khác và hướng dẫn hoàn thiện hoặc chuyển người có thẩm quyền xem xét; không tự kết luận thay họ.
- Dịch vụ tra cứu ngoài không sẵn sàng: biểu diễn “chưa tra cứu được”, không đổi thành “không có cảnh báo”.
- Đồng bộ thất bại: lưu trạng thái, thời điểm và mã phản hồi nếu có; gửi lại an toàn khi contract cho phép, tránh phát hành/trùng giao dịch ngoài ý muốn.
- SMS thất bại hoặc dữ liệu nhắc lịch thiếu: hành vi retry/dừng/chuyển xử lý chưa chốt; không tự gửi nội dung suy đoán.
- Chatbot không có căn cứ trong tài liệu: trả đúng câu fallback quy định. Lỗi dịch vụ AI không được biến thành câu trả lời nghiệp vụ bịa đặt.
- Lỗi phát hành chứng nhận do chưa đạt/thiếu thanh toán/trạng thái pháp lý: chặn phát hành và báo điều kiện còn thiếu theo dữ liệu có căn cứ.
- Không đưa stack trace, dữ liệu cá nhân hoặc nội dung hồ sơ vào lỗi trả về người dùng.

## 12. Testing

Các ca kiểm thử nghiệp vụ tối thiểu được suy ra trực tiếp từ acceptance criteria (không phải yêu cầu thêm):

- Vai trò và quyền: nhân viên tiếp nhận không tạo/sửa kết quả; kiểm định viên nhập kết quả; chủ xe chỉ truy cập dữ liệu thuộc tài khoản; đính chính chứng nhận có quyền và audit.
- Chủ xe/phương tiện: dữ liệu yêu cầu được lưu và quan hệ một-nhiều được giữ đúng.
- Lịch: các khung giờ cho phép/ngoài khung; lịch hiệu lực trùng trên cùng phương tiện; hủy lịch; quyền chủ xe. Các tình huống sức chứa/ngày nghỉ chờ xác nhận.
- Hồ sơ: phân loại lần đầu/định kỳ; checklist theo trường hợp; phân biệt nộp/xuất trình; giấy tờ không áp dụng không bị ép thành bắt buộc.
- Kết quả: từng giá trị Đạt/Mi/Ma/DD; tổng hợp đạt với chỉ Đạt/Mi và không đạt khi có Ma/DD; 5 công đoạn; trị số, thời điểm, người/thiết bị và người phê duyệt.
- Ảnh kiểm định ngoài cơ sở: độ phân giải tối thiểu và dấu thời gian theo yêu cầu; mẫu kết quả phanh/trượt ngang được gắn hồ sơ.
- Chứng nhận: điều kiện đạt + thanh toán + trạng thái pháp lý; số GCN/tem trùng; đính chính có audit; hết hạn/thay thế/thu hồi theo trạng thái được cấp.
- Tra cứu lịch sử theo quyền; báo cáo dựa trên dữ liệu lưu và chốt theo trung tâm/cuối ngày.
- Chatbot: câu trả lời có căn cứ từ tài liệu, fallback chính xác, cảnh báo không quyết định kết quả.
- AI tóm tắt không tạo kết luận và không bắt buộc lưu bản sinh; SMS nhắc trước một ngày theo dữ liệu lịch.
- Tích hợp cảnh báo phân biệt không có với chưa truy vấn; đồng bộ ghi nhận trạng thái/thời điểm/mã phản hồi và retry an toàn khi được hỗ trợ.
- Đăng kiểm viên/chứng chỉ và thiết bị/hiệu chuẩn: cảnh báo điều kiện không đủ/thiết bị hết hạn trước khi phân công hoặc sử dụng theo User Story.

## 13. Coding Rules

- Tuân theo conventions, formatter, cấu trúc thư mục, naming, migration và test framework đã có trong repository; kiểm tra trước khi thêm pattern mới.
- Backend theo FastAPI, frontend theo React, persistence theo SQLite và chatbot theo RAG trong phạm vi stack được ghi nhận; không tự nâng cấp/thay thế stack.
- Đặt tên theo convention hiện hữu. Tên bảng/cột chưa được User Story chốt; không coi tên gợi ý trong mục Database là tên vật lý bắt buộc.
- Giữ logic nghiệp vụ và quyền truy cập ở backend; UI chỉ hỗ trợ trình bày và tương tác.
- Tách tích hợp AI/nguồn ngoài khỏi quy tắc quyết định chuyên môn; đầu ra sinh phải có ranh giới rõ là nội dung hỗ trợ.
- Migration phải phản ánh schema đã thống nhất, có quan hệ và constraint tương ứng; không âm thầm phá dữ liệu hoặc đổi contract.
- Không thêm dependency, API, bảng, role, trạng thái hoặc workflow mới nếu không cần thiết theo yêu cầu đã xác nhận.

## 14. Dependencies

### Phụ thuộc nghiệp vụ

- US-02 là nền cho lịch (US-03), hồ sơ (US-04/12), tra cứu (US-07) và các chức năng xử lý tiếp theo.
- US-04/12 là nền cho đánh giá hồ sơ (US-14/15), kiểm định (US-05/16), tóm tắt (US-10), chứng nhận (US-06/18) và báo cáo.
- Kết quả kiểm định US-05/16, thanh toán US-17 và trạng thái pháp lý là điều kiện cho chứng nhận/phát hành US-06/18.
- US-08/21 phụ thuộc dữ liệu lịch sử, kết quả và giao dịch đã lưu.
- US-09 phụ thuộc tài liệu quy trình đã được cung cấp; US-10 phụ thuộc hồ sơ và quyền truy cập; US-11 phụ thuộc dữ liệu lịch/hồ sơ và dịch vụ SMS.
- US-13 phụ thuộc nguồn dữ liệu ngoài được cấp quyền; US-14 phụ thuộc cơ sở dữ liệu đối chiếu và bộ quy tắc chu kỳ; US-16/20 phụ thuộc thiết bị/quy trình hiệu chuẩn khi áp dụng; US-18 phụ thuộc giao diện đồng bộ/ ký số nếu áp dụng.
- US-19 và US-20 hỗ trợ xác nhận điều kiện người/thiết bị trước khi thực hiện nghiệp vụ liên quan.

### Phụ thuộc kỹ thuật

FastAPI, React, SQLite và RAG được ghi nhận trong tài liệu nguồn. Nhà cung cấp AI/SMS, dịch vụ OTP, lưu trữ tệp, nguồn tích hợp, giao thức thiết bị, chữ ký số, phiên bản thư viện và cấu hình triển khai chưa được xác định.

## 15. Do Not

- Không tạo requirement, actor, role, quyền, trạng thái, rule, endpoint, request/response, schema vật lý, constraint, ngưỡng, format, retry hay SLA không có căn cứ.
- Không thay đổi business rule hoặc API contract hiện có nếu chưa được yêu cầu/xác nhận.
- Không dùng AI để kết luận đạt/không đạt, phân loại pháp lý có tính quyết định, tự gia hạn/phát hành chứng nhận hoặc xử lý cảnh báo.
- Không coi “không tra cứu được” là “không có cảnh báo”; không coi mọi giấy tờ checklist là bắt buộc trong mọi trường hợp.
- Không cho nhân viên tiếp nhận nhập/sửa kết quả kiểm định; không cho chủ xe truy cập dữ liệu phương tiện khác tài khoản.
- Không phát hành chứng nhận khi thiếu một trong các điều kiện đã nêu; không tự suy diễn quyền đổi biển/sang tên/gia hạn/thu hồi.
- Không lưu đầu ra AI tóm tắt như kết luận chính thức; User Story nói nội dung tóm tắt không cần lưu.
- Không gửi SMS nhắc theo dữ liệu bịa hoặc lịch thiếu; các xử lý lỗi gửi chưa được xác định.
- Không tự chọn chính sách dữ liệu cá nhân, OTP, lưu trữ hồ sơ, nguồn tài liệu RAG, biểu mẫu pháp lý hoặc ngưỡng kỹ thuật.
- Không coi tài liệu hướng dẫn AI trong SDLC là tính năng sản phẩm.

## Các điểm bắt buộc xác nhận trước khi triển khai chi tiết

Tham chiếu Mục 4 của `user_story.md`. Đặc biệt, cần chốt định nghĩa Mi/Ma/DD và điều kiện chứng nhận; quy tắc slot/ngày làm việc; schema/validation và quyền dữ liệu cá nhân/OTP/retention; nhà cung cấp và lỗi SMS; phiên bản/quyền nguồn RAG; mẫu báo cáo; giao thức thiết bị/ngưỡng; yêu cầu phi chức năng; cùng API contract và database schema. Nếu thiếu quyết định làm thay đổi hành vi hoặc dữ liệu, dừng phần phụ thuộc quyết định đó và yêu cầu làm rõ, không tự đoán.

## Trạng thái backend hiện tại (2026-10-03)

Phần này ghi nhận hiện trạng mã trong `backend/`; đây là mô tả implementation tạm thời, không sửa đổi yêu cầu nghiệp vụ ở trên và không biến các lựa chọn kỹ thuật chưa duyệt thành API contract chính thức. Khi có contract/schema được phê duyệt, cập nhật phần này và mã đồng bộ.

### Hiện đã có

- FastAPI, SQLAlchemy và SQLite; bảng được tạo khi ứng dụng khởi động bằng `create_all` (chưa có migrations).
- Frontend React + TypeScript + Vite trong `frontend/`; frontend mặc định gọi API tại `http://localhost:8000`, backend CORS mặc định cho `http://localhost:5173`.
- Mô hình vật lý trong `backend/app/models.py`: `accounts`, `owners`, `vehicles`, `appointments`, `inspection_files`, `inspection_items`, `certificates`, `audit_entries`.
- Hash mật khẩu Argon2, bearer JWT cho tài khoản nội bộ và kiểm tra vai trò phía backend. Tài khoản provision qua `backend/create_account.py`; không có public signup.
- API REST dưới `/api/v1`, ngoại trừ đăng nhập ở `/auth/login` và health check `/health`.
- Luồng ghi kết quả/finalize và chặn phát hành chứng nhận khi hồ sơ chưa ở trạng thái passed; số GCN/tem được đặt unique ở DB.
- Lịch áp dụng hai khoảng giờ đã nêu, tối đa một lịch active trên mỗi xe; hủy lịch giải phóng ràng buộc active.

### API đang có trong mã (contract tạm thời)

Tất cả API nghiệp vụ trừ login yêu cầu `Authorization: Bearer <token>`. Role trong ngoặc là quyền được mã hiện tại cho phép. Payload/response chi tiết xem Pydantic schemas tại `backend/app/schemas.py`. Các lỗi dùng `detail` của FastAPI; mã đang sử dụng gồm 401, 403, 404, 409, 422, 501 và 201/200. Đây là hành vi triển khai hiện tại, cần được rà soát và duyệt trước khi cam kết tương thích.

| Method | Endpoint | Quyền hiện tại | Chức năng |
|---|---|---|---|
| POST | `/auth/login` | Công khai cho tài khoản nội bộ; tài khoản chủ xe trả 501 do OTP chưa tích hợp | Phát hành access token |
| GET | `/health` | Công khai | Health check |
| POST | `/api/v1/owners` | admin, intake | Tạo chủ xe |
| GET | `/api/v1/owners` | admin, intake | Liệt kê chủ xe |
| POST | `/api/v1/vehicles` | admin, intake | Tạo phương tiện |
| GET | `/api/v1/vehicles` | admin, intake, inspector, owner | Liệt kê phương tiện; owner bị lọc theo tài khoản |
| POST | `/api/v1/appointments` | owner, intake, admin | Tạo lịch |
| GET | `/api/v1/appointments` | owner, intake, admin, inspector | Liệt kê lịch; hỗ trợ query `vehicle_id` |
| POST | `/api/v1/appointments/{appointment_id}/cancel` | owner, intake, admin | Hủy lịch active |
| POST | `/api/v1/inspections` | intake, admin | Tạo hồ sơ |
| GET | `/api/v1/inspections` | owner, intake, inspector, admin | Liệt kê hồ sơ; hỗ trợ query `vehicle_id` |
| POST | `/api/v1/inspections/{inspection_id}/results` | inspector | Ghi kết quả hạng mục |
| GET | `/api/v1/inspections/{inspection_id}/results` | owner, intake, inspector, admin | Liệt kê kết quả theo quyền truy cập xe |
| POST | `/api/v1/inspections/{inspection_id}/finalize` | inspector | Chốt đạt/không đạt dựa trên kết quả hiện có và xác nhận checklist_complete |
| POST | `/api/v1/inspections/{inspection_id}/certificates` | admin, line_manager, inspector | Tạo chứng nhận nếu hồ sơ passed, thanh toán và cờ pháp lý được gửi true |
| POST | `/api/v1/certificates/{certificate_id}/correction` | admin, line_manager | Đính chính trường chứng nhận và tạo audit entry |

**Giới hạn hiện tại cần xử lý trước production:** finalization chỉ kiểm tra `checklist_complete` do inspector gửi và các kết quả đã ghi; chưa đối chiếu checklist chuẩn có phiên bản. Trường payment/legal eligibility của request chứng nhận hiện là cờ do caller cung cấp, chưa được xác minh với module thanh toán/nguồn pháp lý. OTP chủ xe, giới hạn thử đăng nhập, refresh/revoke token, gửi SMS, tích hợp AI/RAG, đồng bộ cơ quan ngoài, lưu tệp, phí, báo cáo và quản trị chứng chỉ/thiết bị chưa được triển khai. Không xem các cờ này là xác minh nghiệp vụ có thẩm quyền.

### Schema vật lý tạm thời đang implement

Kiểu dưới đây là ánh xạ SQLAlchemy/Python hiện tại; không đồng nghĩa kiểu SQL cuối cùng đã được người dùng phê duyệt. Các khóa chính hiện đều integer tự tăng; quan hệ FK được mô tả ở mục 5.

| Table | Columns đang có (kiểu Python/SQLAlchemy) | Constraints chính |
|---|---|---|
| `accounts` | `id` int; `username` str; `password_hash` str; `role` enum; `owner_id` int nullable; `is_active` bool | username unique/index; owner_id unique nullable FK `owners.id` |
| `owners` | `id` int; `display_name` str; `identity_or_tax_number` str; `phone` str; `address` text | identity/tax và phone index |
| `vehicles` | `id` int; `owner_id` int; `registration_number` str; `plate_classification` str nullable; `chassis_number` str; `engine_number` str; `vehicle_type` str | FK `owners.id`; owner/plate/chassis index |
| `appointments` | `id` int; `code` str; `vehicle_id` int; `center` str; `appointment_date` date; `start_time`, `end_time` time; `service_type` str; `status` enum; `active_guard` int nullable | code unique/index; FK `vehicles.id`; unique `(vehicle_id, active_guard)` |
| `inspection_files` | `id` int; `code` str; `vehicle_id` int; `inspection_type` enum; `intake_channel` str; `received_at` datetime; `status` enum; `old_certificate_management_number` str nullable; `registration_document_number` str nullable; `insurance_contract_number` str nullable; `insurance_expiry` date nullable | code unique/index; FK `vehicles.id` |
| `inspection_items` | `id` int; `inspection_id` int; `stage` int; `item_code` str; `result` enum; `measured_value` Decimal nullable; `unit` str nullable; `inspector_account_id` int; `approved_by_account_id` int nullable; `recorded_at` datetime | unique `(inspection_id, stage, item_code)`; FK inspection/accounts |
| `certificates` | `id` int; `certificate_number`, `stamp_number` str; `inspection_id`, `vehicle_id` int; `issued_on`, `expires_on` date; `cycle`, `emissions_standard` str; `payment_complete`, `legal_status_allowed` bool; `status` enum | certificate/stamp number unique/index; FK inspection/vehicle |
| `audit_entries` | `id` int; `actor_account_id` int; `entity_type` str; `entity_id` int; `action` str; `before_value`, `after_value` text nullable; `created_at` datetime | FK `accounts.id` |

Thay đổi schema cần cập nhật cả model và migrations (khi migrations được đưa vào dự án); không được làm mất audit trail hoặc bỏ các điều kiện nghiệp vụ đã mô tả.
