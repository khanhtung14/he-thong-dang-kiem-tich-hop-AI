# Skill: frontend_ui_design

## Description
Kỹ năng chuyên sâu hướng dẫn AI Agent thiết kế và phát triển giao diện người dùng (Frontend UI/UX) cho hệ thống **Bán hàng & Quản lý Kho (B2B)** bằng React. Skill định hình kiến trúc component, lựa chọn và sử dụng thư viện UI hiện đại, chuẩn hóa quy tắc hiển thị, validation, bảng dữ liệu, và luồng tương tác song song với Backend API.

---

## 1. Stack Thư viện Khuyến nghị & Quy ước Công nghệ

Agent khi viết mã Frontend cho dự án này phải tuân thủ bộ thư viện chuẩn sau:
- **Core:** `React` (v18+ Functional Components & Hooks) + `Vite`
- **UI Component Library (Chọn 1 trong 2 tùy dự án):**
  - **Ant Design (antd v5):** Khuyến nghị hàng đầu cho Dashboard quản trị B2B, bảng biểu kho, cây danh mục phân cấp (`TreeSelect`), form nhập liệu nhiều cột phức tạp.
  - **Hoặc Tailwind CSS + Shadcn UI / Radix UI:** Nếu dự án cần tùy biến giao diện hiện đại, tinh gọn, hiệu năng cao.
- **Icon Library:** `Lucide React` hoặc `@ant-design/icons` (nhất quán phong cách outline/minimal).
- **Data Fetching & Cache:** `TanStack Query (React Query v5)` kết hợp `Axios` (tự động cache, quản lý loading/error state, refetch khi submit thành công).
- **Form Management & Validation:** `React Hook Form` kết hợp `Zod` (hoặc Ant Design Form tích hợp sẵn rules) để validate dữ liệu chặt chẽ từ phía client.
- **Table & Virtualization:** `@tanstack/react-table` (nếu dùng Tailwind/Shadcn) hoặc `Table` của Ant Design với tính năng sort, filter, phân trang server-side.
- **Charts / Dashboard:** `Recharts` hoặc `@ant-design/plots` (phục vụ biểu đồ doanh thu, vòng quay kho, nợ quá hạn).

---

## 2. Quy tắc Thiết kế Component & UX Nghiệp vụ Kho - Bán Hàng

### 2.1. Cấu trúc Component Chuẩn
Mỗi màn hình chức năng (feature) cần tuân thủ cấu trúc phân tầng:
```text
src/features/<feature_name>/
├── components/          # Các component con nhỏ (FilterBar, Table, Modals)
├── hooks/               # Custom hooks gọi API (useOrders, useStockCheck)
├── schemas/             # Zod validation schema
├── types/               # TypeScript interfaces / PropTypes
└── pages/               # Trang tổng hợp (Index page / Detail page)
```

### 2.2. Xử lý Trạng thái Bất đồng bộ (Loading, Empty, Error)
Mọi component gọi dữ liệu phải xử lý đủ 4 trạng thái:
1. **Loading:** Skeleton UI (`<Skeleton />`) hoặc Spinner toàn phần/bán phần; không để màn hình trống giật lag.
2. **Empty:** Hiển thị component Empty trực quan kèm nút kêu gọi hành động (Call to Action: ví dụ "Tạo đơn hàng đầu tiên").
3. **Error:** Thông báo lỗi bằng Alert/Toast (`notification.error` hoặc `toast.error`), hiển thị chi tiết lỗi nghiệp vụ từ backend Envelope nếu có.
4. **Success:** Bảng dữ liệu hoặc form kết quả.

---

## 3. Quy chuẩn Hiển thị Dữ liệu Nghiệp vụ (Formatting Standards)

Agent phải áp dụng hàm format dùng chung (`src/utils/formatters.js`), không format thủ công rải rác:

| Loại Dữ liệu | Quy tắc Hiển thị | Ví dụ Đầu vào | Kết quả Hiển thị |
| :--- | :--- | :--- | :--- |
| **Tiền tệ (VND)** | Phân cách hàng nghìn bằng dấu chấm/phẩy + `₫` hoặc `VND` | `1450000` | `1.450.000 ₫` |
| **Ngày tháng** | `DD/MM/YYYY` | `2026-10-09` | `09/10/2026` |
| **Ngày & Giờ** | `DD/MM/YYYY HH:mm` | `2026-10-09T14:30:00Z` | `09/10/2026 14:30` |
| **Số lượng lẻ (UOM)** | Tối đa 2 - 3 chữ số thập phân, bỏ số 0 thừa | `12.500` | `12.5 kg` |

### 3.3. Quy ước Màu sắc & Badge Trạng thái Đơn hàng & Kho
* **Trạng thái Đơn hàng:**
  - `DRAFT`: Badge Xám / Default (`Nháp`)
  - `PENDING_APPROVAL`: Badge Cam / Warning (`Chờ duyệt`)
  - `APPROVED`: Badge Xanh dương / Processing (`Đã duyệt - Giữ chỗ kho`)
  - `PICKING` / `DISPATCHED`: Badge Tím / Cyan (`Đang soạn / Đang giao`)
  - `DELIVERED`: Badge Xanh lá / Success (`Đã giao thành công`)
  - `REJECTED` / `CANCELLED`: Badge Đỏ / Error (`Từ chối / Đã hủy`)
* **Tồn kho 3 Cột:**
  - Tồn thực tế (`physicalQty`): Chữ thông thường
  - Tồn giữ chỗ (`reservedQty`): Màu vàng/cam nhạt (để nhận diện hàng đã có đơn giữ)
  - Tồn khả dụng (`availableQty`): In đậm xanh lá nếu đủ hàng, in đậm đỏ kèm badge cảnh báo nếu $\le 0$ hoặc dưới mức tồn tối thiểu (`minStock`).

---

## 4. Mẫu Thiết kế Code Mẫu (Design Patterns & Code Examples)

### 4.1. Mẫu Form Đặt hàng Động (Order Line Items Form với Ant Design & React Hook Form)
Form cho phép thêm/xóa dòng hàng, tự tính tổng tiền, chiết khấu và cảnh báo tồn khả dụng tức thì:

```jsx
import React, { useState } from 'react';
import { Form, Select, InputNumber, Button, Table, Card, Typography, Tag, Space, Alert } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { formatCurrency } from '@/utils/formatters';

const { Text } = Typography;

export const OrderCreateForm = ({ products = [], customerCredit, onSubmit }) => {
  const [form] = Form.useForm();
  const [items, setItems] = useState([
    { key: Date.now(), productId: null, unitId: null, quantity: 1, unitPrice: 0, discountPercent: 0, availableQty: 0 }
  ]);

  const handleItemChange = (key, field, value) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        const updated = { ...item, [field]: value };
        if (field === 'productId') {
          const selectedProd = products.find((p) => p.id === value);
          updated.unitPrice = selectedProd?.price || 0;
          updated.availableQty = selectedProd?.availableQty || 0;
          updated.unitId = selectedProd?.baseUnitId;
        }
        return updated;
      })
    );
  };

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      { key: Date.now(), productId: null, unitId: null, quantity: 1, unitPrice: 0, discountPercent: 0, availableQty: 0 }
    ]);
  };

  const handleRemoveItem = (key) => {
    setItems((prev) => prev.filter((item) => item.key !== key));
  };

  // Tính toán tổng tiền client-side
  const subTotal = items.reduce((sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0), 0);
  const totalDiscount = items.reduce(
    (sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0) * ((item.discountPercent || 0) / 100),
    0
  );
  const grandTotal = subTotal - totalDiscount;
  const isOverCreditLimit = customerCredit && (customerCredit.currentDebt + grandTotal > customerCredit.limit);

  const columns = [
    {
      title: 'Sản phẩm (SKU)',
      dataIndex: 'productId',
      render: (_, record) => (
        <Select
          style={{ width: '100%' }}
          placeholder="Chọn sản phẩm"
          value={record.productId}
          onChange={(val) => handleItemChange(record.key, 'productId', val)}
          options={products.map((p) => ({ label: `${p.sku} - ${p.name}`, value: p.id }))}
        />
      ),
      width: '35%'
    },
    {
      title: 'Tồn khả dụng',
      dataIndex: 'availableQty',
      render: (val, record) => (
        <Tag color={record.quantity > val ? 'volcano' : 'green'}>
          {val} {record.unitName || ''}
        </Tag>
      ),
      width: '15%'
    },
    {
      title: 'Số lượng',
      dataIndex: 'quantity',
      render: (_, record) => (
        <InputNumber
          min={1}
          value={record.quantity}
          status={record.quantity > record.availableQty ? 'error' : ''}
          onChange={(val) => handleItemChange(record.key, 'quantity', val)}
        />
      ),
      width: '15%'
    },
    {
      title: 'Đơn giá',
      dataIndex: 'unitPrice',
      render: (val) => formatCurrency(val),
      width: '15%'
    },
    {
      title: 'Thành tiền',
      key: 'lineTotal',
      render: (_, record) => {
        const lineTotal = record.quantity * record.unitPrice * (1 - record.discountPercent / 100);
        return <Text strong>{formatCurrency(lineTotal)}</Text>;
      },
      width: '15%'
    },
    {
      title: '',
      key: 'action',
      render: (_, record) => (
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => handleRemoveItem(record.key)}
          disabled={items.length <= 1}
        />
      ),
      width: '5%'
    }
  ];

  return (
    <Card title="Chi tiết Đơn đặt hàng">
      {isOverCreditLimit && (
        <Alert
          message="Cảnh báo vượt hạn mức công nợ"
          description={`Đơn hàng sẽ chuyển sang trạng thái 'Chờ duyệt' do tổng dư nợ mới vượt quá hạn mức (${formatCurrency(customerCredit.limit)}).`}
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <Table
        dataSource={items}
        columns={columns}
        pagination={false}
        rowKey="key"
        footer={() => (
          <Button type="dashed" onClick={handleAddItem} icon={<PlusOutlined />} block>
            Thêm mặt hàng
          </Button>
        )}
      />

      <div style={{ marginTop: 24, textAlign: 'right' }}>
        <Space direction="vertical" size="small">
          <Text>Tiền hàng: {formatCurrency(subTotal)}</Text>
          <Text>Chiết khấu: -{formatCurrency(totalDiscount)}</Text>
          <Text type="danger" strong style={{ fontSize: 18 }}>
            Tổng thanh toán: {formatCurrency(grandTotal)}
          </Text>
        </Space>
      </div>
    </Card>
  );
};
```

---

### 4.2. Mẫu Bảng Tồn kho 3 cột với Phân trang Server-side (React Query + Ant Design Table)

```jsx
import React, { useState } from 'react';
import { Table, Input, Select, Tag, Space, Card } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { inventoryService } from '@/services/inventoryService';

export const InventoryStockTable = ({ warehouseId }) => {
  const [pagination, setPagination] = useState({ page: 1, limit: 10 });
  const [keyword, setKeyword] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', warehouseId, pagination, keyword],
    queryFn: () => inventoryService.getStocks({ warehouseId, ...pagination, keyword }),
    keepPreviousData: true
  });

  const columns = [
    { title: 'Mã SKU', dataIndex: 'sku', key: 'sku', render: (text) => <b>{text}</b> },
    { title: 'Tên Sản phẩm', dataIndex: 'productName', key: 'productName' },
    { title: 'ĐVT Cơ sở', dataIndex: 'baseUnit', key: 'baseUnit' },
    {
      title: 'Tồn thực tế',
      dataIndex: 'physicalQty',
      key: 'physicalQty',
      align: 'right',
      render: (val) => val.toLocaleString()
    },
    {
      title: 'Tồn giữ chỗ',
      dataIndex: 'reservedQty',
      key: 'reservedQty',
      align: 'right',
      render: (val) => (
        <span style={{ color: val > 0 ? '#fa8c16' : 'inherit' }}>
          {val.toLocaleString()}
        </span>
      )
    },
    {
      title: 'Tồn khả dụng',
      dataIndex: 'availableQty',
      key: 'availableQty',
      align: 'right',
      render: (val, record) => (
        <Tag color={val <= 0 ? 'red' : val < record.minStock ? 'orange' : 'green'}>
          {val.toLocaleString()}
        </Tag>
      )
    }
  ];

  return (
    <Card title="Sổ Tồn Kho 3 Cột">
      <Space style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Tìm theo SKU hoặc Tên sản phẩm"
          allowClear
          onSearch={(val) => setKeyword(val)}
          style={{ width: 300 }}
        />
      </Space>

      <Table
        rowKey="productId"
        columns={columns}
        dataSource={data?.data || []}
        loading={isLoading}
        pagination={{
          current: pagination.page,
          pageSize: pagination.limit,
          total: data?.pagination?.totalRecords || 0,
          onChange: (page, limit) => setPagination({ page, limit }),
          showSizeChanger: true
        }}
      />
    </Card>
  );
};
```

---

## 5. Hướng dẫn Agent khi Thực thi Code Frontend
1. **Kiểm tra API Contract trước khi code:** Luôn tham chiếu file `API_SPECIFICATION.md` để lấy đúng tên trường (`camelCase`), kiểu dữ liệu và URL endpoint.
2. **Không Mock trực tiếp vào UI:** Tách toàn bộ hàm gọi API ra các file độc lập trong `src/services/` (dùng `apiClient.js` có Interceptor gắn Bearer Token).
3. **Responsive & Mobile Layout:** Các tính năng dành cho Nhân viên kinh doanh (Sales Rep) đi thị trường và Thủ kho (Warehouse) phải ưu tiên layout thích ứng tốt trên tablet và điện thoại di động (thao tác chạm, form một cột khi ở màn hình nhỏ).
4. **Không duplicate state:** Các giá trị tính toán như `grandTotal`, `availableQty` hoặc cờ `isOverCreditLimit` phải là *derived state* (tính trực tiếp khi render hoặc dùng `useMemo`), không lưu vào `useState` riêng để tránh lệch đồng bộ dữ liệu.
