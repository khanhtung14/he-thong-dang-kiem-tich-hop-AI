export type Role = 'admin' | 'intake' | 'inspector' | 'owner'
export type Owner = { id: number; display_name: string; identity_or_tax_number: string; phone: string; address: string }
export type Vehicle = { id: number; owner_id: number; registration_number: string; plate_classification: string | null; chassis_number: string; engine_number: string; vehicle_type: string }
export type Appointment = { id: number; code: string; vehicle_id: number; appointment_date: string; start_time: string; end_time: string; service_type: string; status: 'active' | 'cancelled' | 'completed' }
export type Inspection = { id: number; code: string; vehicle_id: number; inspection_type: 'first' | 'periodic'; intake_channel: string; received_at: string; status: 'received' | 'needs_documents' | 'in_progress' | 'passed' | 'failed'; old_certificate_management_number: string | null; registration_document_number: string | null; insurance_contract_number: string | null; insurance_expiry: string | null }
export type InspectionResult = { id: number; inspection_id: number; stage: number; item_code: string; result: 'dat' | 'mi' | 'ma' | 'dd'; measured_value: number | null; unit: string | null; inspector_account_id: number; recorded_at: string }
export type Certificate = { id: number; inspection_id: number; vehicle_id: number; certificate_number: string; stamp_number: string; issued_on: string; expires_on: string; cycle: string; emissions_standard: string; payment_complete: boolean; legal_status_allowed: boolean; status: string }
export type Session = { token: string; role: Role; username: string; display_name?: string | null; email?: string | null; phone?: string | null; avatar_url?: string | null }
export type UserProfile = { id: number; username: string; role: Role; display_name: string | null; email: string | null; phone: string | null; avatar_url: string | null }
export type ProfileUpdateData = { display_name?: string | null; email?: string | null; phone?: string | null; avatar_url?: string | null; current_password?: string | null; new_password?: string | null }
export type ChatMessage = { role: 'user' | 'assistant'; content: string }
export type AccountListItem = {
  id: number
  username: string
  role: Role
  is_active: boolean
  display_name: string | null
  email: string | null
  phone: string | null
  avatar_url: string | null
  owner_id: number | null
}
export type AccountCreateAdminPayload = {
  username: string
  password: string
  role: Role
  display_name?: string
  email?: string
  phone?: string
}

export type AuditLogItem = {
  id: number
  actor_account_id: number
  actor_username: string
  actor_display_name: string | null
  actor_role: Role
  entity_type: string
  entity_id: number
  action: string
  action_label: string
  before_value: string | null
  after_value: string | null
  created_at: string
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

const ERROR_TRANSLATIONS: Record<string, string> = {
  'vehicle already has an active appointment': 'Phương tiện này hiện đã có một lịch hẹn đang hiệu lực. Vui lòng hoàn tất hoặc hủy lịch hẹn cũ trước khi đặt lịch mới.',
  'appointment must fit within': 'Khung giờ hẹn phải nằm trọn trong ca sáng (06:30 - 11:00) hoặc ca chiều (13:00 - 17:30).',
  'appointment not found': 'Không tìm thấy thông tin lịch hẹn.',
  'only an active appointment can be cancelled': 'Chỉ có thể hủy lịch hẹn đang ở trạng thái hiệu lực.',
  'vehicle not found': 'Không tìm thấy thông tin phương tiện.',
  'owner not found': 'Không tìm thấy thông tin chủ xe.',
  'inspection file not found': 'Không tìm thấy hồ sơ kiểm định.',
  'inspection is already finalized': 'Hồ sơ kiểm định đã được hoàn tất trước đó.',
  'finalized inspection results cannot be changed': 'Hồ sơ kiểm định đã hoàn tất kết luận, không thể thay đổi.',
  'applicable inspection checklist must be complete': 'Danh mục các hạng mục kiểm định bắt buộc phải được hoàn thành.',
  'at least one inspection item result is required': 'Cần có ít nhất một kết quả kiểm tra hạng mục kiểm định để kết luận.',
  'certificate requires a passed inspection': 'Chỉ có thể cấp giấy chứng nhận cho hồ sơ kiểm định đạt yêu cầu.',
  'certificate requires completed payment': 'Yêu cầu hoàn tất thanh toán phí/lệ phí và phương tiện đủ điều kiện pháp lý trước khi cấp giấy.',
  'expiry date cannot precede issue date': 'Ngày hết hạn giấy chứng nhận không thể trước ngày cấp.',
  'certificate or stamp number already exists': 'Số giấy chứng nhận hoặc số tem kiểm định đã tồn tại trong hệ thống.',
  'certificate not found': 'Không tìm thấy thông tin giấy chứng nhận.',
  'invalid authentication credentials': 'Thông tin xác thực không hợp lệ hoặc phiên đăng nhập đã hết hạn.',
  'insufficient permissions': 'Bạn không có quyền thực hiện thao tác này.',
  'internal server error': 'Lỗi máy chủ nội bộ. Vui lòng thử lại sau.',
}

export function translateErrorMessage(msg: string): string {
  if (!msg) return 'Có lỗi xảy ra'
  const lower = msg.toLowerCase()
  for (const [enKey, viVal] of Object.entries(ERROR_TRANSLATIONS)) {
    if (lower.includes(enKey)) {
      return viVal
    }
  }
  return msg
}

async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    let detail = body?.detail
    if (Array.isArray(detail)) {
      // Pydantic validation errors list
      detail = detail.map((d: any) => d.msg || JSON.stringify(d)).join(', ')
    }
    const rawMsg = typeof detail === 'string' ? detail : `Yêu cầu thất bại (${response.status})`
    throw new ApiError(translateErrorMessage(rawMsg), response.status)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function login(username: string, password: string): Promise<Session> {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Không thể đăng nhập', response.status)
  }
  const result = await response.json() as { access_token: string }
  const payload = JSON.parse(atob(result.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  let profile: UserProfile | null = null
  try {
    profile = await request<UserProfile>('/api/v1/profile', result.access_token)
  } catch {
    // ignore
  }
  return {
    token: result.access_token,
    role: payload.role as Role,
    username,
    display_name: profile?.display_name ?? null,
    email: profile?.email ?? null,
    phone: profile?.phone ?? null,
    avatar_url: profile?.avatar_url ?? null,
  }
}

export type RegisterData = {
  username: string
  password: string
  display_name: string
  email: string
  phone: string
  identity_or_tax_number?: string
  address?: string
}

export async function register(data: RegisterData): Promise<Session> {
  const response = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Không thể đăng ký tài khoản', response.status)
  }
  const result = await response.json() as { access_token: string }
  const payload = JSON.parse(atob(result.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  let profile: UserProfile | null = null
  try {
    profile = await request<UserProfile>('/api/v1/profile', result.access_token)
  } catch {
    // ignore
  }
  return {
    token: result.access_token,
    role: payload.role as Role,
    username: data.username,
    display_name: profile?.display_name ?? data.display_name,
    email: profile?.email ?? null,
    phone: profile?.phone ?? data.phone,
    avatar_url: profile?.avatar_url ?? null,
  }
}

export type ForgotPasswordResponse = {
  message: string
  email: string
  username?: string | null
  display_name?: string | null
  dev_code?: string | null
}

export async function sendForgotPasswordOtp(email: string): Promise<ForgotPasswordResponse> {
  const response = await fetch(`${API_URL}/auth/forgot-password/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Gửi mã xác nhận thất bại', response.status)
  }
  return response.json()
}

export async function verifyOtpOnly(payload: {
  email: string
  otp_code: string
}): Promise<{ message: string; verified: boolean }> {
  const response = await fetch(`${API_URL}/auth/forgot-password/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Mã xác nhận không hợp lệ', response.status)
  }
  return response.json()
}

export async function verifyOtpAndResetPassword(payload: {
  email: string
  otp_code: string
  new_password: string
}): Promise<{ message: string }> {
  const response = await fetch(`${API_URL}/auth/forgot-password/verify-and-reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Đặt lại mật khẩu thất bại', response.status)
  }
  return response.json()
}

export function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.exp === 'number') {
      return Date.now() / 1000 >= payload.exp
    }
  } catch {
    return true
  }
  return false
}

export const api = {
  owners: (token: string) => request<Owner[]>('/api/v1/owners', token),
  createOwner: (token: string, body: Omit<Owner, 'id'>) => request<Owner>('/api/v1/owners', token, { method: 'POST', body: JSON.stringify(body) }),
  deleteOwner: (token: string, id: number) => request<{ message: string }>(`/api/v1/owners/${id}`, token, { method: 'DELETE' }),
  vehicles: (token: string) => request<Vehicle[]>('/api/v1/vehicles', token),
  createVehicle: (token: string, body: Omit<Vehicle, 'id'> | (Omit<Vehicle, 'id' | 'owner_id'> & { owner_id?: number })) => request<Vehicle>('/api/v1/vehicles', token, { method: 'POST', body: JSON.stringify(body) }),
  deleteVehicle: (token: string, id: number) => request<{ message: string }>(`/api/v1/vehicles/${id}`, token, { method: 'DELETE' }),
  appointments: (token: string) => request<Appointment[]>('/api/v1/appointments', token),
  createAppointment: (token: string, body: Omit<Appointment, 'id' | 'code' | 'status'>) => request<Appointment>('/api/v1/appointments', token, { method: 'POST', body: JSON.stringify(body) }),
  cancelAppointment: (token: string, id: number) => request<Appointment>(`/api/v1/appointments/${id}/cancel`, token, { method: 'POST' }),
  inspections: (token: string) => request<Inspection[]>('/api/v1/inspections', token),
  createInspection: (token: string, body: Pick<Inspection, 'vehicle_id' | 'inspection_type' | 'intake_channel' | 'old_certificate_management_number' | 'registration_document_number' | 'insurance_contract_number' | 'insurance_expiry'>) => request<Inspection>('/api/v1/inspections', token, { method: 'POST', body: JSON.stringify(body) }),
  results: (token: string, id: number) => request<InspectionResult[]>(`/api/v1/inspections/${id}/results`, token),
  addResult: (token: string, id: number, body: Omit<InspectionResult, 'id' | 'inspection_id' | 'inspector_account_id' | 'recorded_at'>) => request<InspectionResult>(`/api/v1/inspections/${id}/results`, token, { method: 'POST', body: JSON.stringify(body) }),
  finalize: (token: string, id: number) => request<Inspection>(`/api/v1/inspections/${id}/finalize`, token, { method: 'POST', body: JSON.stringify({ checklist_complete: true }) }),
  issueCertificate: (token: string, id: number, body: Omit<Certificate, 'id' | 'inspection_id' | 'vehicle_id' | 'status'>) => request<Certificate>(`/api/v1/inspections/${id}/certificates`, token, { method: 'POST', body: JSON.stringify(body) }),
  analyzeRequirement: (token: string, requirement: string) => request<{ analysis: string }>('/api/v1/ai/requirements-analysis', token, { method: 'POST', body: JSON.stringify({ requirement }) }),
  chat: (token: string, messages: ChatMessage[]) => request<{ message: string }>('/api/v1/ai/chat', token, { method: 'POST', body: JSON.stringify({ messages }) }),
  getProfile: (token: string) => request<UserProfile>('/api/v1/profile', token),
  updateProfile: (token: string, body: ProfileUpdateData) => request<UserProfile>('/api/v1/profile', token, { method: 'PUT', body: JSON.stringify(body) }),
  getAdminAccounts: (token: string) => request<AccountListItem[]>('/api/v1/admin/accounts', token),
  updateAccountRole: (token: string, accountId: number, role: Role) => request<AccountListItem>(`/api/v1/admin/accounts/${accountId}/role`, token, { method: 'PUT', body: JSON.stringify({ role }) }),
  updateAccountStatus: (token: string, accountId: number, is_active: boolean) => request<AccountListItem>(`/api/v1/admin/accounts/${accountId}/status`, token, { method: 'PUT', body: JSON.stringify({ is_active }) }),
  createAdminAccount: (token: string, body: AccountCreateAdminPayload) => request<AccountListItem>('/api/v1/admin/accounts', token, { method: 'POST', body: JSON.stringify(body) }),
  resetAccountPassword: (token: string, accountId: number, new_password: string) => request<{ message: string }>(`/api/v1/admin/accounts/${accountId}/reset-password`, token, { method: 'POST', body: JSON.stringify({ new_password }) }),
  updateAdminAccountProfile: (token: string, accountId: number, data: { display_name?: string; email?: string; phone?: string }) => request<AccountListItem>(`/api/v1/admin/accounts/${accountId}/profile`, token, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAdminAccount: (token: string, accountId: number) => request<{ message: string }>(`/api/v1/admin/accounts/${accountId}`, token, { method: 'DELETE' }),
  auditLogs: (token: string, params?: { action?: string; role?: string; query_text?: string }) => {
    const sp = new URLSearchParams()
    if (params?.action && params.action !== 'all') sp.append('action', params.action)
    if (params?.role && params.role !== 'all') sp.append('role', params.role)
    if (params?.query_text && params.query_text.trim()) sp.append('query_text', params.query_text.trim())
    const qs = sp.toString()
    return request<AuditLogItem[]>(`/api/v1/audit-logs${qs ? `?${qs}` : ''}`, token)
  },
}

