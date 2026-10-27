# Phân tích yêu cầu hệ thống quản lý đăng kiểm phương tiện tích hợp AI

## 1. Phạm vi và cách hiểu yêu cầu

Tài liệu mô tả hệ thống quản lý đăng kiểm xuyên suốt: tiếp nhận thông tin xe và hồ sơ lần đầu/định kỳ, đối chiếu dữ liệu, lập phiếu, kiểm tra trên dây chuyền, thu phí, trả kết quả và quản trị nội bộ; đồng thời tích hợp AI cho hỏi đáp quy trình, tóm tắt hồ sơ và soạn thông báo.

Prompt mẫu trong tài liệu được xem là **yêu cầu về hành vi của chatbot**: chatbot chỉ trả lời theo tài liệu quy trình được cung cấp và không tự kết luận phương tiện đạt hay không đạt. Các hướng dẫn về dùng AI trong SDLC là bối cảnh triển khai, không được chuyển thành chức năng của hệ thống.

Các luồng nghiệp vụ và trường dữ liệu đã được cập nhật theo phần làm rõ của người dùng. Những quyết định này được phản ánh trong user story; các điểm còn cần xác nhận trước khi triển khai được tập hợp tại Mục 4.

Các user story dưới đây bổ sung theo nội dung người dùng cung cấp về Thông tư 47/2024/TT-BGTVT. Thông tư có hiệu lực từ 01/01/2025 và đang được liệt kê là văn bản hiện thời trên CSDL quốc gia về VBPL. Cần cấu hình checklist theo đúng đối tượng xe và quy định có hiệu lực tại thời điểm xử lý. [Cổng Chính phủ](https://vanban.chinhphu.vn/?docid=212078&pageid=27160), [CSDL quốc gia về VBPL](https://vbpl.vn/bogiaothong/pages/vbpq-luocdo.aspx?ItemID=173118).

## 2. Actor

| Actor | Căn cứ trong yêu cầu | Vai trò dự kiến trong phạm vi đã nêu |
|---|---|---|
| Quản trị viên | Có trong yêu cầu đăng nhập và phân quyền | Sử dụng hệ thống với quyền quản trị; chức năng quản trị cụ thể chưa được mô tả. |
| Nhân viên tiếp nhận | Yêu cầu bổ sung của người dùng | Quản lý chủ xe, phương tiện, hồ sơ và chứng nhận; không được nhập kết quả kiểm định. |
| Kiểm định viên | Có trong yêu cầu đăng nhập và phân quyền; được nêu là người kết luận kiểm định | Nhập kết quả từng hạng mục và đưa ra kết luận chuyên môn. |
| Trưởng dây chuyền | Yêu cầu bổ sung về sửa/đính chính chứng nhận | Quản lý đính chính chứng nhận theo quyền được cấp và lưu vết thao tác. |
| Chủ xe | Yêu cầu bổ sung của người dùng | Đăng nhập tài khoản, trực tiếp đặt/hủy lịch và tra cứu hồ sơ; nhận OTP và thông báo qua số điện thoại. |

**Lưu ý:** Chatbot AI là thành phần hệ thống, không phải actor nghiệp vụ độc lập. Nhân viên thu phí/kế toán và nhân viên quản lý thiết bị là các quyền nghiệp vụ cần phân vai cụ thể.

## 3. Danh sách User Story

### US-01 — Đăng nhập và phân quyền

- **Actor:** Quản trị viên, nhân viên tiếp nhận, kiểm định viên
- **Mục tiêu:** Truy cập hệ thống theo vai trò.
- **Mô tả:** Là một người dùng thuộc trung tâm đăng kiểm, tôi muốn đăng nhập và được phân quyền theo vai trò, để sử dụng hệ thống trong phạm vi quyền hạn của mình.
- **Acceptance Criteria:**
  1. Người dùng thuộc một trong các vai trò quản trị viên, nhân viên tiếp nhận hoặc kiểm định viên.
  2. Sau khi đăng nhập, quyền truy cập được áp dụng theo vai trò đã cấp.
  3. Chủ xe có tài khoản để đăng nhập, nhận OTP qua số điện thoại, đặt/hủy lịch và tra cứu hồ sơ.
  4. Nhân viên tiếp nhận được quản lý hồ sơ và chứng nhận nhưng không được nhập kết quả kiểm định.
  5. Kiểm định viên nhập kết quả hạng mục; Admin/Trưởng dây chuyền được đính chính chứng nhận theo quyền và phải lưu nhật ký.
- **Business Rules:**
  - Hệ thống phải hỗ trợ phân quyền cho ba vai trò được nêu.
- **Priority:** Cao — nền tảng cho các chức năng nghiệp vụ nội bộ.

### US-02 — Quản lý chủ xe và phương tiện

- **Actor:** Nhân viên tiếp nhận, Quản trị viên
- **Mục tiêu:** Lưu trữ và quản lý thông tin chủ xe, phương tiện.
- **Mô tả:** Là nhân viên tiếp nhận, tôi muốn quản lý thông tin chủ xe và phương tiện, để phục vụ các nghiệp vụ đăng kiểm.
- **Acceptance Criteria:**
  1. Hệ thống cho phép quản lý dữ liệu chủ xe và phương tiện.
  2. Dữ liệu được lưu trong hệ thống và có thể được dùng trong các nghiệp vụ liên quan.
  3. Thông tin chủ xe: họ tên cá nhân hoặc tên tổ chức; số định danh/CCCD hoặc mã số thuế; số điện thoại nhận OTP/thông báo; địa chỉ cư trú/trụ sở theo giấy đăng ký xe.
  4. Thông tin phương tiện: biển số và ký tự phân loại màu biển khi áp dụng (xe biển 5 số); số khung (đầy đủ hoặc 6 số cuối khi tra cứu trực tuyến); số máy; loại phương tiện.
  5. Một chủ xe có thể gắn với nhiều phương tiện; mỗi phương tiện có thể có nhiều hồ sơ và lịch sử lịch hẹn.
- **Business Rules:**
  - Chủ xe và phương tiện là dữ liệu chính của hệ thống.
- **Priority:** Cao — dữ liệu nền cho lịch hẹn, hồ sơ và lịch sử.

### US-03 — Đặt lịch đăng kiểm

- **Actor:** Chủ xe; Nhân viên tiếp nhận (vai trò hỗ trợ cần xác nhận)
- **Mục tiêu:** Tạo lịch hẹn đăng kiểm cho phương tiện.
- **Mô tả:** Là chủ xe, tôi muốn đặt lịch đăng kiểm cho phương tiện, để có lịch hẹn thực hiện kiểm định.
- **Acceptance Criteria:**
  1. Hệ thống có chức năng đặt lịch đăng kiểm.
  2. Lịch hẹn được lưu trong hệ thống.
  3. Lịch có mã tự sinh, trung tâm đăng kiểm, ngày/khung giờ và loại dịch vụ: kiểm định định kỳ, đăng ký xe mới hoặc thay đổi thông tin.
  4. Chỉ cho chọn khung giờ 06:30–11:00 hoặc 13:00–17:30.
  5. Mỗi phương tiện chỉ có một lịch đang hiệu lực tại một thời điểm; chủ xe có thể hủy lịch.
  6. Chủ xe đăng nhập để đặt lịch; số điện thoại tài khoản dùng nhận OTP và thông báo.
- **Business Rules:**
  - Lịch hẹn là một loại dữ liệu chính cần được quản lý.
- **Priority:** Cao.

### US-04 — Quản lý hồ sơ kiểm định và giấy tờ

- **Actor:** Nhân viên tiếp nhận, Kiểm định viên
- **Mục tiêu:** Theo dõi hồ sơ kiểm định và giấy tờ liên quan.
- **Mô tả:** Là nhân viên tiếp nhận, tôi muốn quản lý hồ sơ kiểm định và giấy tờ, để hồ sơ phục vụ quy trình đăng kiểm được theo dõi trong hệ thống.
- **Acceptance Criteria:**
  1. Hệ thống có chức năng quản lý hồ sơ kiểm định và giấy tờ.
  2. Hồ sơ có thể liên kết với phương tiện theo cách phù hợp với mô hình dữ liệu.
  3. Hồ sơ được phân loại theo lần đầu/định kỳ và lưu giấy tờ theo checklist áp dụng tại US-12.
  4. Hồ sơ tại quầy lưu mã hồ sơ tự sinh tại trạm, số quản lý GCN cũ, số seri giấy đăng ký xe (hoặc số giấy hẹn/văn bản ngân hàng thế chấp), số hợp đồng bảo hiểm TNDS và ngày hết hạn nếu các trường này áp dụng.
- **Business Rules:**
  - Hồ sơ và giấy tờ là dữ liệu chính của hệ thống.
- **Priority:** Cao.

### US-05 — Nhập kết quả kiểm tra từng hạng mục

- **Actor:** Kiểm định viên
- **Mục tiêu:** Ghi nhận kết quả kiểm tra theo từng hạng mục.
- **Mô tả:** Là kiểm định viên, tôi muốn nhập kết quả của từng hạng mục kiểm tra, để lưu lại kết quả kiểm định.
- **Acceptance Criteria:**
  1. Hệ thống cho phép nhập và lưu kết quả cho từng hạng mục.
  2. Kết quả được gắn với hồ sơ, phương tiện, 5 công đoạn và đăng kiểm viên chịu trách nhiệm/phê duyệt.
  3. Hệ thống không dùng AI để thay kiểm định viên kết luận đạt hoặc không đạt.
  4. Giá trị kết quả từng hạng mục gồm Đạt, Mi, Ma hoặc DD; kết quả tổng thể Đạt khi không có Ma/DD, và Không đạt khi có ít nhất một Ma/DD.
  5. Nhân viên tiếp nhận không được tạo/sửa kết quả kiểm định.
- **Business Rules:**
  - Kết luận đạt/không đạt thuộc thẩm quyền chuyên môn, không do AI quyết định.
- **Priority:** Cao.

### US-06 — Quản lý chứng nhận và ngày hết hạn

- **Actor:** Nhân viên tiếp nhận, Kiểm định viên, Quản trị viên/Trưởng dây chuyền
- **Mục tiêu:** Quản lý chứng nhận đăng kiểm và thời hạn.
- **Mô tả:** Là nhân viên phụ trách hồ sơ, tôi muốn quản lý chứng nhận và ngày hết hạn, để thông tin chứng nhận được lưu trong hệ thống.
- **Acceptance Criteria:**
  1. Lưu số GCN, số tem, ngày cấp, ngày hết hạn, chu kỳ và tiêu chuẩn khí thải đạt được.
  2. Chứng nhận liên quan đến phương tiện hoặc hồ sơ kiểm định tương ứng.
  3. Chỉ khởi tạo GCN khi phiên kiểm định đạt (Đạt/Mi theo quy tắc đã chốt), nghĩa vụ thanh toán hoàn tất và trạng thái pháp lý cho phép; số GCN/tem duy nhất, theo định dạng quản lý, QR tra cứu bảo mật nếu cổng hỗ trợ.
  4. Admin/Trưởng dây chuyền được đính chính lỗi hành chính; mọi thay đổi phải có audit log. Đổi biển số/sang tên giữ nguyên ngày hết hạn khi chu kỳ còn hiệu lực và quy định cho phép.
  5. Hỗ trợ ghi nhận gia hạn tự động khi xe thuộc diện được pháp luật cho phép; không tự gia hạn ngoài điều kiện đó.
  6. Quản lý trạng thái hết hạn, bị thay thế khi cấp GCN mới, bị thu hồi/hủy hoặc vô hiệu do cải tạo theo quyết định/quy định có thẩm quyền.
- **Business Rules:**
  - Chứng nhận và ngày hết hạn thuộc dữ liệu hệ thống cần quản lý.
- **Priority:** Trung bình — phụ thuộc dữ liệu và kết quả kiểm định.

### US-07 — Tra cứu lịch sử đăng kiểm

- **Actor:** Chủ xe, Nhân viên tiếp nhận, Kiểm định viên
- **Mục tiêu:** Xem lại các thông tin đăng kiểm trước đây.
- **Mô tả:** Là người dùng có nhu cầu tra cứu, tôi muốn xem lịch sử đăng kiểm của phương tiện, để tham khảo các lần đăng kiểm đã được ghi nhận.
- **Acceptance Criteria:**
  1. Hệ thống có chức năng tra cứu lịch sử đăng kiểm.
  2. Lịch sử dựa trên dữ liệu kiểm định đã lưu.
  3. Chủ xe đã đăng nhập có thể tra cứu hồ sơ/lịch sử của phương tiện thuộc tài khoản; nhân viên tra cứu theo quyền được cấp.
- **Business Rules:**
  - Lịch sử đăng kiểm là dữ liệu cần tra cứu.
- **Priority:** Trung bình — cần có dữ liệu hồ sơ và kết quả.

### US-08 — Thống kê lượt kiểm định và hồ sơ đạt/không đạt

- **Actor:** Quản trị viên, Nhân viên tiếp nhận
- **Mục tiêu:** Theo dõi số lượt kiểm định và tình trạng hồ sơ.
- **Mô tả:** Là người quản lý nghiệp vụ, tôi muốn xem thống kê lượt kiểm định và hồ sơ đạt/không đạt, để nắm tình hình hoạt động được ghi nhận trong hệ thống.
- **Acceptance Criteria:**
  1. Hệ thống cung cấp thống kê lượt kiểm định.
  2. Hệ thống cung cấp thống kê hồ sơ đạt và không đạt.
  3. Báo cáo chốt theo dữ liệu cuối ngày sau khi kết thúc giờ làm việc, tại từng trung tâm đăng kiểm.
- **Business Rules:**
  - Thống kê phải dựa trên dữ liệu lịch sử và kết quả được lưu.
- **Priority:** Thấp — phụ thuộc dữ liệu nghiệp vụ đã phát sinh.

### US-09 — Hỏi đáp quy trình đăng kiểm bằng chatbot

- **Actor:** Chủ xe
- **Mục tiêu:** Nhận câu trả lời về quy trình và giấy tờ đăng kiểm.
- **Mô tả:** Là chủ xe, tôi muốn hỏi chatbot về quy trình và giấy tờ đăng kiểm, để biết thông tin cần thiết khi thực hiện đăng kiểm.
- **Acceptance Criteria:**
  1. Chatbot nhận câu hỏi về quy trình hoặc giấy tờ đăng kiểm.
  2. Câu trả lời dựa trên tài liệu quy trình được cung cấp cho AI.
  3. Chatbot không kết luận phương tiện đạt hoặc không đạt thay kiểm định viên.
  4. Khi không tìm thấy câu trả lời trong nguồn, chatbot trả lời: “Câu hỏi không liên quan đến tài liệu”.
  5. Hiển thị cảnh báo AI không quyết định kết quả đăng kiểm trong cửa sổ chatbot dành cho chủ xe.
- **Business Rules:**
  - Chỉ trả lời theo quy trình được cung cấp.
  - AI không thay thế kết luận kiểm định chuyên môn.
- **Priority:** Trung bình — cần có tài liệu quy trình làm nguồn trả lời.

### US-10 — Tóm tắt hồ sơ phương tiện bằng AI

- **Actor:** Nhân viên tiếp nhận, Kiểm định viên
- **Mục tiêu:** Có bản tóm tắt hồ sơ phương tiện.
- **Mô tả:** Là người xử lý hồ sơ, tôi muốn AI tóm tắt hồ sơ phương tiện, để nắm nội dung hồ sơ nhanh hơn.
- **Acceptance Criteria:**
  1. AI nhận hồ sơ phương tiện làm đầu vào và tạo bản tóm tắt.
  2. Bản tóm tắt được trình bày như thông tin hỗ trợ người dùng.
  3. AI không đưa ra kết luận đạt/không đạt thay kiểm định viên.
  4. Hồ sơ kiểm định được phép làm đầu vào tóm tắt; nội dung AI sinh không cần lưu lại.
- **Business Rules:**
  - AI hỗ trợ tóm tắt, không thay thế quyết định chuyên môn.
- **Priority:** Trung bình — phụ thuộc chức năng hồ sơ.

### US-11 — Sinh tin nhắn nhắc lịch hoặc thông báo hồ sơ

- **Actor:** Nhân viên tiếp nhận
- **Mục tiêu:** Soạn nội dung nhắc lịch hoặc thông báo hồ sơ.
- **Mô tả:** Là nhân viên tiếp nhận, tôi muốn AI sinh tin nhắn nhắc lịch hoặc thông báo hồ sơ, để có nội dung thông báo dựa trên thông tin lịch hẹn hoặc hồ sơ.
- **Acceptance Criteria:**
  1. AI có thể tạo nội dung nhắc lịch hoặc thông báo hồ sơ.
  2. Đầu vào có thể gồm thông tin lịch hẹn hoặc hồ sơ phù hợp.
  3. Hệ thống gửi SMS đến số điện thoại chủ xe một ngày trước lịch hẹn; AI soạn nội dung để hệ thống gửi.
  4. Không yêu cầu người dùng duyệt nội dung trước khi gửi.
- **Business Rules:**
  - Tin nhắn nhắc lịch được sinh từ dữ liệu lịch hẹn và gửi trước một ngày.
- **Priority:** Thấp — chức năng hỗ trợ, phụ thuộc dữ liệu lịch hẹn/hồ sơ.

### US-12 — Tiếp nhận hồ sơ kiểm định lần đầu/định kỳ

- **Actor:** Chủ xe, Nhân viên tiếp nhận
- **Mô tả:** Là chủ xe/nhân viên tiếp nhận, tôi muốn nộp hoặc tiếp nhận hồ sơ tại quầy, qua bưu chính hoặc trực tuyến, để đăng ký kiểm định.
- **Acceptance Criteria:**
  1. Ghi nhận thông tin chủ xe, biển số, số khung, số động cơ; hỗ trợ nhập hoặc quét thông tin.
  2. Phân loại hồ sơ lần đầu hay định kỳ và ghi nhận kênh, thời điểm tiếp nhận.
  3. Checklist lần đầu hỗ trợ: văn bản đề nghị kiểm định ngoài cơ sở (mẫu 02 Phụ lục VII khi chủ xe đề nghị), bản chà số khung/số động cơ, bản sao phiếu kiểm tra chất lượng xuất xưởng đối với xe sản xuất/lắp ráp trong nước, bản chính giấy chứng nhận cải tạo đối với xe cải tạo.
  4. Checklist định kỳ hỗ trợ văn bản đề nghị kiểm định ngoài cơ sở khi chủ xe đề nghị và bản chà số khung/số động cơ khi xe có thay đổi các số này.
  5. Giấy tờ đăng ký xe xuất trình hỗ trợ một trong các hình thức được quy định: bản chính giấy chứng nhận đăng ký, bản sao có chứng thực/bản sao điện tử được chứng thực, hoặc bản chính giấy hẹn cấp đăng ký.
  6. Với thiết bị nâng/xi téc thuộc diện quy định, checklist yêu cầu giấy chứng nhận kết quả kiểm định còn hiệu lực; cấu hình ngưỡng áp dụng gồm sức nâng từ 1.000 kg, chiều cao nâng trên 2,0 m và điều kiện áp suất tương ứng.
  7. Phân biệt rõ giấy tờ phải nộp và giấy tờ phải xuất trình. Bảo hiểm trách nhiệm dân sự/tờ khai chỉ được đánh dấu bắt buộc khi có căn cứ áp dụng riêng.
- **Business Rules:** Checklist thay đổi theo loại kiểm định, loại xe, tình trạng cải tạo/thay số và hình thức bản giấy/bản điện tử hợp lệ.
- **Priority:** Cao.

### US-13 — Tra cứu phạt nguội và cảnh báo phương tiện

- **Actor:** Nhân viên tiếp nhận
- **Mô tả:** Tôi muốn tra cứu cảnh báo hành chính hoặc phong tỏa từ nguồn có thẩm quyền để xử lý hồ sơ theo kết quả.
- **Acceptance Criteria:** Hiển thị trạng thái, nguồn và thời điểm tra cứu; phân biệt không có cảnh báo với chưa tra cứu được; xử lý cảnh báo theo quy trình được cơ quan có thẩm quyền xác nhận.
- **Business Rules:** Chỉ kết nối nguồn dữ liệu được cấp quyền; phần mềm không tự suy diễn thẩm quyền xử lý.
- **Priority:** Cao; phụ thuộc kết nối ngoài.

### US-14 — Đánh giá hồ sơ và đối chiếu dữ liệu phương tiện

- **Actor:** Nhân viên tiếp nhận, Kiểm định viên
- **Acceptance Criteria:**
  1. So sánh giấy tờ với dữ liệu Cục Đăng kiểm/cơ sở dữ liệu được kết nối và nêu rõ trường không khớp.
  2. Với hồ sơ nhận trực tiếp, ghi nhận việc kiểm tra, đánh giá trong ngày nhận; hồ sơ thiếu thì ghi nhận hướng dẫn hoàn thiện.
  3. Nếu xe chưa có dữ liệu tại Cục Đăng kiểm Việt Nam, hỗ trợ lập bản xác nhận thông số kỹ thuật theo mẫu/quy trình áp dụng để lập hồ sơ phương tiện.
  4. Tính chu kỳ/ngày kiểm định tiếp theo theo quy tắc chính thức có hiệu lực và lưu dữ liệu đầu vào, phiên bản quy tắc.
- **Business Rules:** Sai khác và trường hợp thiếu dữ liệu cần người có thẩm quyền xem xét; chu kỳ được tính theo quy tắc pháp lý được cấu hình, không do AI quyết định.
- **Priority:** Cao.

### US-15 — Lập phiếu, thông báo và hẹn kiểm định

- **Actor:** Nhân viên tiếp nhận, Điều phối viên, Kiểm định viên
- **Acceptance Criteria:**
  1. Hồ sơ đầy đủ, xe không thuộc trường hợp từ chối: lập/in phiếu kiểm soát kiểm định theo mẫu áp dụng (Phụ lục IV).
  2. Hồ sơ thiếu hoặc xe bị từ chối: ghi lý do, hỗ trợ lập thông báo theo mẫu Phụ lục I và ghi nhận việc gửi chủ xe.
  3. Kiểm định ngoài cơ sở chỉ được hẹn khi xe và địa điểm đủ điều kiện; hỗ trợ giấy hẹn mẫu 03 Phụ lục VI.
  4. Kết quả đánh giá hồ sơ/lịch hẹn có thể gửi qua bưu chính hoặc trực tuyến theo kênh nhận hồ sơ.
- **Business Rules:** Mẫu biểu, điều kiện từ chối và điều kiện kiểm định ngoài cơ sở phải theo quy định hiện hành.
- **Priority:** Cao.

### US-16 — Ghi nhận kiểm tra kỹ thuật và kết quả dây chuyền

- **Actor:** Kiểm định viên
- **Acceptance Criteria:**
  1. Theo dõi đủ 5 công đoạn: (1) nhận dạng/tổng quát—biển số, số khung/máy, màu sơn, khóa cửa, lốp, kính, gương, đèn; (2) phần trên—kính, gạt nước, vô lăng/trục lái, bảng điều khiển, ghế, dây an toàn, sàn bệ, điện khoang lái; (3) phanh/trượt ngang—độ lệch trượt ngang, phanh chính và phanh đỗ; (4) môi trường—CO/HC với động cơ xăng, độ khói với động cơ dầu, tiếng ồn và còi; (5) phần dưới—khung/sát xi, treo, rô tuyn, trục các đăng, đường ống phanh, rò rỉ dầu/nhiên liệu.
  2. Lưu kết quả từng hạng mục, trị số đo/đơn vị (nếu có), người hoặc thiết bị ghi nhận và thời điểm.
  3. Với kiểm định ngoài cơ sở, lưu kết quả phanh/trượt ngang theo mẫu số 04 Phụ lục VIII, đính kèm hồ sơ kiểm định.
  4. Lưu ảnh chụp tại địa điểm kiểm định, rõ nét, tối thiểu 1280×720 pixel và có dấu thời gian thực gồm ngày, tháng, năm, giờ, phút.
  5. Mỗi hạng mục có kết quả Đạt, Mi, Ma hoặc DD; Mi là khiếm khuyết nhẹ theo quy tắc được cấu hình, Ma yêu cầu sửa chữa và kiểm định lại, DD không được tham gia giao thông cho đến khi sửa chữa. Tổng thể Đạt nếu chỉ có Đạt/Mi; Không đạt nếu có Ma/DD.
  6. Lập phiếu kết quả kiểm định mẫu số 01 Phụ lục VIII, gắn mã lỗi và đăng kiểm viên chịu trách nhiệm/phê duyệt từng công đoạn.
  7. Hỗ trợ thông báo kết quả không đạt; kết luận do kiểm định viên có thẩm quyền xác nhận, AI không tự kết luận.
- **Business Rules:** Hạng mục, ngưỡng kỹ thuật và kết quả tuân theo quy chuẩn áp dụng; lưu vết để truy xuất.
- **Priority:** Cao.

### US-17 — Thu phí và quản lý chứng từ

- **Actor:** Nhân viên thu phí/kế toán
- **Acceptance Criteria:** Tính phí kiểm định, lệ phí chứng nhận và phí sử dụng đường bộ theo biểu phí hiệu lực; ghi nhận thanh toán, biên lai/hóa đơn điện tử và liên kết giao dịch với hồ sơ.
- **Business Rules:** Mọi khoản thu dùng biểu phí có phiên bản và thời gian hiệu lực.
- **Priority:** Cao.

### US-18 — Phát hành và đồng bộ kết quả

- **Actor:** Kiểm định viên có thẩm quyền, Nhân viên tiếp nhận
- **Acceptance Criteria:** Phát hành/in giấy chứng nhận và tem hoặc cập nhật dữ liệu điện tử theo hình thức được phép; hỗ trợ ký số khi áp dụng; đồng bộ kết quả lên Cục Đăng kiểm và cơ sở dữ liệu dùng chung; lưu trạng thái gửi, thời điểm, mã phản hồi và hỗ trợ gửi lại an toàn; trả thông báo kết quả không đạt khi cần.
- **Business Rules:** Chỉ phát hành kết quả đã được người có thẩm quyền xác nhận.
- **Priority:** Cao; phụ thuộc giao diện tích hợp.

### US-19 — Quản lý đăng kiểm viên và chứng chỉ

- **Actor:** Quản trị viên
- **Acceptance Criteria:** Quản lý thông tin, phân quyền, chứng chỉ, tập huấn, trạng thái đình chỉ/thu hồi và thời điểm hiệu lực; cảnh báo trạng thái không đủ điều kiện trước khi phân công; lưu nhật ký thay đổi.
- **Business Rules:** Chỉ phân công đăng kiểm viên đáp ứng điều kiện nghiệp vụ tại thời điểm phân công.
- **Priority:** Cao.

### US-20 — Quản lý thiết bị và hiệu chuẩn

- **Actor:** Quản trị viên, Nhân viên quản lý thiết bị
- **Acceptance Criteria:** Quản lý mã thiết bị, dây chuyền, lịch kiểm định/hiệu chuẩn, chứng từ và hạn kế tiếp; cảnh báo thiết bị sắp/quá hạn; liên kết kết quả đo với thiết bị.
- **Business Rules:** Tình trạng thiết bị phải đáp ứng điều kiện sử dụng được phê duyệt.
- **Priority:** Cao.

### US-21 — Báo cáo hoạt động trung tâm

- **Actor:** Quản trị viên, Nhân viên kế toán/nghiệp vụ
- **Acceptance Criteria:** Thống kê số xe theo ngày/tháng, tỷ lệ đạt/trượt, báo cáo tài chính và xuất báo cáo định kỳ theo mẫu cơ quan quản lý; dữ liệu thống kê chốt cuối ngày sau khi kết thúc làm việc tại từng trung tâm.
- **Business Rules:** Số liệu truy xuất được về hồ sơ và giao dịch nguồn.
- **Priority:** Cao.

## 4. Yêu cầu còn thiếu hoặc cần làm rõ

Các quyết định dưới đây đã được đưa vào user story: chủ xe đăng nhập để đặt/hủy lịch và tra cứu hồ sơ; nhân viên tiếp nhận quản lý hồ sơ/chứng nhận nhưng không nhập kết quả; trường dữ liệu chính của chủ xe, xe, lịch, hồ sơ, kết quả và chứng nhận; quan hệ một chủ xe–nhiều xe và một xe–nhiều hồ sơ/lịch sử; 5 công đoạn và giá trị Đạt/Mi/Ma/DD; điều kiện phát hành/cập nhật/hết hiệu lực chứng nhận; khung giờ và giới hạn lịch; SMS nhắc trước một ngày; hành vi chatbot/AI; thống kê cuối ngày theo từng trung tâm; và stack FastAPI, React, SQLite, RAG.

### Các điểm vẫn cần chốt trước khi triển khai/ nghiệm thu

- Xác nhận định nghĩa chính thức và ý nghĩa trạng thái Mi/Ma/DD, cũng như điều kiện pháp lý/chuyên môn để phát hành, gia hạn, đính chính, thay thế hoặc thu hồi chứng nhận; nội dung cấu hình phải được đối chiếu quy định hiện hành.
- Xác định quy tắc cho phép tạo lịch: múi giờ, thời lượng/sức chứa từng khung giờ, ngày làm việc/ngày nghỉ, điều kiện đặt lại sau khi hủy và liệu “một lịch” nghĩa là một lịch đang hiệu lực trên mỗi xe.
- Chốt mẫu dữ liệu, quy tắc kiểm tra hợp lệ và quyền truy cập dữ liệu cá nhân (CCCD/mã số thuế, điện thoại, địa chỉ), OTP và thời hạn lưu hồ sơ.
- Chốt nhà cung cấp SMS, lỗi gửi/thử lại, mẫu nội dung được AI sinh và cơ chế dừng gửi khi dữ liệu lịch thiếu.
- Chỉ rõ phiên bản tài liệu quy trình chatbot, đơn vị cập nhật, quyền truy cập hồ sơ đưa vào RAG và biện pháp bảo vệ dữ liệu; câu trả lời fallback giữ nguyên đúng câu chữ đã nêu.
- Chốt mẫu báo cáo nhà nước, chỉ tiêu tài chính, thời điểm chốt cuối ngày và cách xử lý điều chỉnh dữ liệu sau khi đã chốt.
- Chốt giao thức tích hợp thiết bị, tiêu chuẩn/đơn vị đo và ngưỡng kỹ thuật cho từng hạng mục; xử lý khi thiết bị hoặc dịch vụ dữ liệu ngoài không sẵn sàng.
- Chốt yêu cầu phi chức năng: bảo mật, hiệu năng, sao lưu/khôi phục, khả dụng, lưu trữ ảnh/tài liệu, audit log và thời hạn lưu dữ liệu.

## 5. Đề xuất thứ tự triển khai User Story

Thứ tự dưới đây phản ánh quan hệ phụ thuộc dữ liệu và nghiệp vụ trong mô tả; các điểm chưa xác định cần được chốt trước khi triển khai chi tiết.

1. **US-01 — Đăng nhập và phân quyền**
2. **US-02 — Quản lý chủ xe và phương tiện**
3. **US-03 — Đặt lịch đăng kiểm**
4. **US-04 — Quản lý hồ sơ kiểm định và giấy tờ**
5. **US-05 — Nhập kết quả kiểm tra từng hạng mục**
6. **US-06 — Quản lý chứng nhận và ngày hết hạn**
7. **US-07 — Tra cứu lịch sử đăng kiểm**
8. **US-08 — Thống kê lượt kiểm định và hồ sơ đạt/không đạt**
9. **US-09 — Hỏi đáp quy trình đăng kiểm bằng chatbot**
10. **US-10 — Tóm tắt hồ sơ phương tiện bằng AI**
11. **US-11 — Sinh tin nhắn nhắc lịch hoặc thông báo hồ sơ**
12. **US-12 — Tiếp nhận hồ sơ lần đầu/định kỳ**
13. **US-13 — Tra cứu phạt nguội và cảnh báo**
14. **US-14 — Đánh giá hồ sơ, đối chiếu dữ liệu và chu kỳ kiểm định**
15. **US-15 — Lập phiếu, thông báo và hẹn kiểm định**
16. **US-16 — Kiểm tra kỹ thuật trên dây chuyền**
17. **US-17 đến US-18 — Thu phí, phát hành và đồng bộ kết quả**
18. **US-19 đến US-20 — Quản lý đăng kiểm viên và thiết bị**
19. **US-21 — Báo cáo hoạt động trung tâm**

Thứ tự các chức năng AI có thể cần điều chỉnh sau khi xác nhận nguồn tài liệu quy trình, quyền truy cập hồ sơ và việc hệ thống có gửi tin nhắn hay chỉ tạo bản nháp.
