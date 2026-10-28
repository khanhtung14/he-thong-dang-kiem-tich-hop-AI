export type Role = 'admin' | 'intake' | 'inspector' | 'owner'
export type Owner = { id: number; display_name: string; identity_or_tax_number: string; phone: string; address: string }
export type Vehicle = { id: number; owner_id: number; registration_number: string; plate_classification: string | null; chassis_number: string; engine_number: string; vehicle_type: string }
export type Appointment = { id: number; code: string; vehicle_id: number; appointment_date: string; start_time: string; end_time: string; service_type: string; status: 'active' | 'cancelled' | 'completed' }
export type Inspection = { id: number; code: string; vehicle_id: number; inspection_type: 'first' | 'periodic'; intake_channel: string; received_at: string; status: 'received' | 'needs_documents' | 'in_progress' | 'passed' | 'failed'; old_certificate_management_number: string | null; registration_document_number: string | null; insurance_contract_number: string | null; insurance_expiry: string | null }
export type InspectionResult = { id: number; inspection_id: number; stage: number; item_code: string; result: 'dat' | 'mi' | 'ma' | 'dd'; measured_value: number | null; unit: string | null; inspector_account_id: number; recorded_at: string }
export type Certificate = { id: number; inspection_id: number; vehicle_id: number; certificate_number: string; stamp_number: string; issued_on: string; expires_on: string; cycle: string; emissions_standard: string; payment_complete: boolean; legal_status_allowed: boolean; status: string }
export type Session = { token: string; role: Role; username: string }
export type ChatMessage = { role: 'user' | 'assistant'; content: string }

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = body?.detail
    throw new ApiError(typeof detail === 'string' ? detail : `Yêu cầu thất bại (${response.status})`, response.status)
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
  return { token: result.access_token, role: payload.role as Role, username }
}

export type RegisterData = {
  username: string
  password: string
  display_name: string
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
  return { token: result.access_token, role: payload.role as Role, username: data.username }
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
  vehicles: (token: string) => request<Vehicle[]>('/api/v1/vehicles', token),
  createVehicle: (token: string, body: Omit<Vehicle, 'id'>) => request<Vehicle>('/api/v1/vehicles', token, { method: 'POST', body: JSON.stringify(body) }),
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
}
