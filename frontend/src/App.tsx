import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, Appointment, ChatMessage, Inspection, InspectionResult, isTokenExpired, Owner, Role, Session, Vehicle, login as apiLogin, register as apiRegister } from './api'
import './support-chat.css'

type Page = 'overview' | 'vehicles' | 'appointments' | 'inspections' | 'owners' | 'requirements-agent' | 'inspection-testing'
const roleName: Record<Role, string> = { admin: 'Quản trị viên', intake: 'Nhân viên tiếp nhận', inspector: 'Kiểm định viên', owner: 'Chủ xe' }
const statusName: Record<string, string> = { active: 'Đang hiệu lực', cancelled: 'Đã hủy', completed: 'Hoàn tất', received: 'Mới tiếp nhận', needs_documents: 'Thiếu hồ sơ', in_progress: 'Đang kiểm định', passed: 'Đạt', failed: 'Không đạt' }
const resultName: Record<string, string> = { dat: 'Đạt', mi: 'Mi', ma: 'Ma', dd: 'DD' }
const canIntake = (role: Role) => ['admin', 'intake'].includes(role)
const canInspect = (role: Role) => role === 'inspector'

const PAGE_PERMISSIONS: Record<Page, Role[]> = {
  'overview': ['admin', 'intake', 'inspector', 'owner'],
  'vehicles': ['admin', 'intake', 'inspector', 'owner'],
  'appointments': ['admin', 'intake', 'inspector', 'owner'],
  'inspections': ['admin', 'intake', 'inspector', 'owner'],
  'owners': ['admin', 'intake'],
  'requirements-agent': ['admin'],
  'inspection-testing': ['admin', 'inspector'],
}

function isPageAllowedForRole(page: Page, role: Role): boolean {
  const allowed = PAGE_PERMISSIONS[page]
  return allowed ? allowed.includes(role) : false
}

function getPagesForRole(role: Role): { id: Page; label: string; icon: string }[] {
  if (role === 'admin') {
    return [
      { id: 'overview', label: 'Điều hành tổng thể', icon: '📊' },
      { id: 'inspections', label: 'Giám sát hồ sơ', icon: '📋' },
      { id: 'appointments', label: 'Lịch hẹn trung tâm', icon: '▦' },
      { id: 'vehicles', label: 'Quản lý phương tiện', icon: '▣' },
      { id: 'owners', label: 'Quản lý chủ xe', icon: '♙' },
      { id: 'requirements-agent', label: 'Phân tích chiến lược AI', icon: '✦' },
    ]
  }
  if (role === 'intake') {
    return [
      { id: 'overview', label: 'Bàn tiếp nhận', icon: '📥' },
      { id: 'inspections', label: 'Hồ sơ tiếp nhận', icon: '◫' },
      { id: 'appointments', label: 'Điều phối lịch hẹn', icon: '▦' },
      { id: 'owners', label: 'Hồ sơ chủ xe', icon: '♙' },
      { id: 'vehicles', label: 'Phương tiện đăng ký', icon: '▣' },
    ]
  }
  if (role === 'inspector') {
    return [
      { id: 'overview', label: 'Dây chuyền kiểm định', icon: '⚙️' },
      { id: 'inspections', label: 'Đo kiểm & Chốt kết quả', icon: '◫' },
      { id: 'vehicles', label: 'Xe trên dây chuyền', icon: '▣' },
      { id: 'appointments', label: 'Lịch xe dự kiến', icon: '▦' },
    ]
  }
  return [
    { id: 'overview', label: 'Cổng dịch vụ chủ xe', icon: '⌂' },
    { id: 'vehicles', label: 'Xe của tôi', icon: '▣' },
    { id: 'appointments', label: 'Lịch hẹn của tôi', icon: '▦' },
    { id: 'inspections', label: 'Tra cứu kiểm định', icon: '◫' },
  ]
}

function App() {
  const [session, setSession] = useState<Session | null>(() => {
    let value = sessionStorage.getItem('inspection-session')
    if (!value) {
      value = localStorage.getItem('inspection-session')
      if (value) {
        sessionStorage.setItem('inspection-session', value)
        localStorage.removeItem('inspection-session')
      }
    }
    if (!value) return null
    try {
      const parsed = JSON.parse(value) as Session
      if (isTokenExpired(parsed.token)) {
        sessionStorage.removeItem('inspection-session')
        localStorage.removeItem('inspection-session')
        return null
      }
      return parsed
    } catch {
      sessionStorage.removeItem('inspection-session')
      localStorage.removeItem('inspection-session')
      return null
    }
  })
  const [page, setPage] = useState<Page>('overview')
  const [forbiddenError, setForbiddenError] = useState<{ target: string; message?: string } | null>(null)
  const [mobileNav, setMobileNav] = useState(false)
  const [owners, setOwners] = useState<Owner[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Auto-dismiss floating toast notifications
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 4500)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(''), 6000)
    return () => clearTimeout(timer)
  }, [error])

  // State for Dedicated Inspection Testing Page (Replaces module/modal for Inspector)
  const [testingInspection, setTestingInspection] = useState<Inspection | null>(null)

  // Global modals state for other actions
  const [activeInspectionForDetail, setActiveInspectionForDetail] = useState<Inspection | null>(null)
  const [openGlobalIntakeModal, setOpenGlobalIntakeModal] = useState(false)
  const [preselectedVehicleId, setPreselectedVehicleId] = useState<number | undefined>(undefined)
  const [openGlobalOwnerModal, setOpenGlobalOwnerModal] = useState(false)
  const [openGlobalVehicleModal, setOpenGlobalVehicleModal] = useState(false)
  const [openGlobalAppointmentModal, setOpenGlobalAppointmentModal] = useState(false)

  // Synchronize navigation with browser URL hash
  useEffect(() => {
    function handleHashChange() {
      const hash = window.location.hash.replace(/^#\/?/, '') as Page
      if (!hash) return
      if ((PAGE_PERMISSIONS as Record<string, Role[]>)[hash]) {
        setForbiddenError(null)
        setPage(hash)
      } else {
        setForbiddenError({ target: hash, message: 'Đường dẫn phân hệ không hợp lệ hoặc bạn không có quyền truy cập.' })
      }
    }
    handleHashChange()
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  function navigate(target: Page) {
    setForbiddenError(null)
    window.location.hash = target
    setPage(target)
  }

  const load = useCallback(async (active: Session) => {
    setLoading(true); setError('')
    const jobs: Promise<unknown>[] = [
      api.vehicles(active.token).then(setVehicles),
      api.appointments(active.token).then(setAppointments),
      api.inspections(active.token).then(setInspections)
    ]
    if (canIntake(active.role)) jobs.push(api.owners(active.token).then(setOwners))
    const results = await Promise.allSettled(jobs)
    const failure = results.find((item): item is PromiseRejectedResult => item.status === 'rejected')
    if (failure) {
      if (failure.reason instanceof ApiError && failure.reason.status === 401) signOut()
      else if (failure.reason instanceof ApiError && failure.reason.status === 403) {
        setForbiddenError({ target: page, message: failure.reason.message })
      }
      else setError(failure.reason instanceof Error ? failure.reason.message : 'Không tải được dữ liệu')
    }
    setLoading(false)
  }, [page])

  useEffect(() => { if (session) void load(session) }, [session, load])

  function signIn(value: Session) {
    sessionStorage.setItem('inspection-session', JSON.stringify(value))
    localStorage.removeItem('inspection-session')
    setForbiddenError(null)
    setSession(value)
    navigate('overview')
  }

  function signOut() {
    sessionStorage.removeItem('inspection-session')
    localStorage.removeItem('inspection-session')
    window.location.hash = ''
    setSession(null)
    setOwners([])
    setVehicles([])
    setAppointments([])
    setInspections([])
    setActiveInspectionForDetail(null)
    setTestingInspection(null)
    setForbiddenError(null)
  }

  async function runAction(action: () => Promise<unknown>, message: string) {
    if (!session) return
    setError(''); setNotice('')
    try { 
      await action()
      setNotice(message)
      await load(session)
    }
    catch (reason) {
      if (reason instanceof ApiError && reason.status === 403) {
        setForbiddenError({ target: page, message: reason.message })
      } else {
        setError(reason instanceof Error ? reason.message : 'Có lỗi xảy ra')
      }
    }
  }

  if (!session) return <Login onLogin={signIn} />

  const allowedPages = getPagesForRole(session.role)
  const current = page === 'inspection-testing' 
    ? `Đo kiểm kỹ thuật (${testingInspection?.code ?? ''})` 
    : allowedPages.find(item => item.id === page)?.label ?? 'Tổng quan'

  function triggerIntakeForVehicle(vehicleId?: number) {
    setPreselectedVehicleId(vehicleId)
    setOpenGlobalIntakeModal(true)
  }

  // Inspector navigates to full testing page without modal/module
  function openTestingPage(ins: Inspection) {
    setTestingInspection(ins)
    navigate('inspection-testing')
  }

  return (
    <div className={`app-shell role-${session.role}`}>
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">ĐK</div>
          <div>
            <strong>Đăng kiểm</strong>
            <span>
              {session.role === 'admin' ? 'TRUNG TÂM ĐIỀU HÀNH' : session.role === 'intake' ? 'QUẦY TIẾP NHẬN' : session.role === 'inspector' ? 'DÂY CHUYỀN KỸ THUẬT' : 'CỔNG CHỦ XE'}
            </span>
          </div>
          <button className="mobile-close" onClick={() => setMobileNav(false)}>×</button>
        </div>

        <div className="nav-label">KHÔNG GIAN LÀM VIỆC</div>
        <nav>
          {allowedPages.map(item => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'nav-active' : ''}`}
              onClick={() => { navigate(item.id); setMobileNav(false) }}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
              {page === item.id && <span className="nav-current"/>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">?</div>
            <strong>Vai trò: {roleName[session.role]}</strong>
            <span>Đang đăng nhập với quyền {session.role}</span>
          </div>
          <div className="user-card">
            <div className="avatar">{session.username.slice(0, 1).toUpperCase()}</div>
            <div className="user-meta">
              <strong>{session.username}</strong>
              <span className={`role-badge-pill role-badge-${session.role}`}>{roleName[session.role]}</span>
            </div>
            <button className="logout" title="Đăng xuất" onClick={signOut} aria-label="Đăng xuất">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {mobileNav && <button className="backdrop" aria-label="Đóng menu" onClick={() => setMobileNav(false)}/>}

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)}>☰</button>
          <div className="breadcrumbs">
            <span>{roleName[session.role]}</span>
            <b>/</b>
            <strong>{current}</strong>
          </div>
          <div className="top-actions">
            <div className="live-state"><i/> Hệ thống hoạt động</div>
            <div className="top-date">{new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date())}</div>
            <button className="icon-button" title="Làm mới dữ liệu" onClick={() => void load(session)}>↻</button>
          </div>
        </header>

        <div className="content">
          {loading && <div className="loading-line"><span/> Đang đồng bộ dữ liệu...</div>}

          {/* ACCESS CONTROL CHECK: 403 FORBIDDEN VIEW */}
          {(!isPageAllowedForRole(page, session.role) || forbiddenError) ? (
            <Forbidden403Page
              page={forbiddenError?.target || page}
              session={session}
              message={forbiddenError?.message}
              onBack={() => {
                setForbiddenError(null)
                setTestingInspection(null)
                navigate('overview')
              }}
              onSignOut={signOut}
            />
          ) : (
            <>
              {/* DEDICATED FULL-PAGE INSPECTION TESTING (INSPECTOR ROLE - NO MODAL) */}
              {page === 'inspection-testing' && testingInspection && (
                <InspectionTestingPage
                  inspection={testingInspection}
                  vehicle={vehicles.find(v => v.id === testingInspection.vehicle_id)}
                  token={session.token}
                  role={session.role}
                  onBack={() => navigate(session.role === 'inspector' ? 'overview' : 'inspections')}
                  runAction={runAction}
                  onInspectionUpdated={updated => {
                    setTestingInspection(updated)
                    setInspections(prev => prev.map(x => x.id === updated.id ? updated : x))
                  }}
                />
              )}
              {page === 'inspection-testing' && !testingInspection && (
                <div className="card" style={{ padding: '36px', textAlign: 'center', maxWidth: '600px', margin: '40px auto' }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>📋</div>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 800 }}>Chưa chọn hồ sơ kiểm định</h3>
                  <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 20px 0' }}>Vui lòng chọn một phương tiện từ danh sách hồ sơ để vào chuyền đo kiểm và ghi kết quả kỹ thuật.</p>
                  <button className="button button-primary" onClick={() => navigate('inspections')}>
                    Đi đến Danh sách hồ sơ kiểm định →
                  </button>
                </div>
              )}

              {/* ROLE-SPECIFIC WORKSPACE OVERVIEW */}
              {page === 'overview' && (
                session.role === 'admin' ? (
                  <AdminOverview
                    session={session}
                    owners={owners}
                    vehicles={vehicles}
                    appointments={appointments}
                    inspections={inspections}
                    navigate={navigate}
                    onOpenDetail={ins => openTestingPage(ins)}
                  />
                ) : session.role === 'intake' ? (
                  <IntakeOverview
                    session={session}
                    owners={owners}
                    vehicles={vehicles}
                    appointments={appointments}
                    inspections={inspections}
                    navigate={navigate}
                    onStartIntake={triggerIntakeForVehicle}
                    onOpenOwnerModal={() => setOpenGlobalOwnerModal(true)}
                    onOpenVehicleModal={() => setOpenGlobalVehicleModal(true)}
                    onOpenAppointmentModal={() => setOpenGlobalAppointmentModal(true)}
                    onCancelAppointment={async id => {
                      await runAction(() => api.cancelAppointment(session.token, id), 'Đã hủy lịch hẹn.')
                    }}
                  />
                ) : session.role === 'inspector' ? (
                  <InspectorOverview
                    session={session}
                    vehicles={vehicles}
                    appointments={appointments}
                    inspections={inspections}
                    navigate={navigate}
                    onOpenDetail={ins => openTestingPage(ins)}
                  />
                ) : (
                  <OwnerOverview
                    session={session}
                    vehicles={vehicles}
                    appointments={appointments}
                    inspections={inspections}
                    navigate={navigate}
                    onOpenAppointmentModal={() => setOpenGlobalAppointmentModal(true)}
                  />
                )
              )}

              {page === 'vehicles' && <VehiclesPage role={session.role} vehicles={vehicles} owners={owners} onCreate={body => runAction(() => api.createVehicle(session.token, body), 'Đã thêm phương tiện mới.')} />}
              {page === 'owners' && <OwnersPage owners={owners} onCreate={body => runAction(() => api.createOwner(session.token, body), 'Đã tạo hồ sơ chủ xe.')} />}
              {page === 'appointments' && <AppointmentsPage role={session.role} vehicles={vehicles} appointments={appointments} onCreate={body => runAction(() => api.createAppointment(session.token, body), 'Đã tạo lịch hẹn.')} onCancel={id => runAction(() => api.cancelAppointment(session.token, id), 'Đã hủy lịch hẹn.')} />}
              {page === 'inspections' && (
                <InspectionsPage
                  role={session.role}
                  vehicles={vehicles}
                  inspections={inspections}
                  token={session.token}
                  runAction={runAction}
                  onOpenDetail={ins => {
                    if (session.role === 'inspector') {
                      openTestingPage(ins)
                    } else {
                      setActiveInspectionForDetail(ins)
                    }
                  }}
                />
              )}
              {page === 'requirements-agent' && <RequirementsAgentPage token={session.token} />}
            </>
          )}
        </div>
      </main>

      <SupportChat session={session} onSignOut={signOut} />

      {/* Floating Toast Notification Messages (Bottom-Right) */}
      <div className="toast-container" aria-live="polite">
        {error && (
          <div className="toast-message toast-error" role="alert">
            <span className="toast-icon">!</span>
            <div className="toast-content">{error}</div>
            <button type="button" className="toast-close" onClick={() => setError('')} aria-label="Đóng thông báo">×</button>
          </div>
        )}
        {notice && (
          <div className="toast-message toast-success" role="status">
            <span className="toast-icon">✓</span>
            <div className="toast-content">{notice}</div>
            <button type="button" className="toast-close" onClick={() => setNotice('')} aria-label="Đóng thông báo">×</button>
          </div>
        )}
      </div>

      {/* Global Modals triggered from other roles */}
      {openGlobalIntakeModal && (
        <InspectionModal
          vehicles={vehicles}
          defaultVehicleId={preselectedVehicleId}
          onClose={() => { setOpenGlobalIntakeModal(false); setPreselectedVehicleId(undefined) }}
          onSubmit={async body => {
            await runAction(() => api.createInspection(session.token, body), 'Đã tiếp nhận hồ sơ thành công.')
            setOpenGlobalIntakeModal(false)
            setPreselectedVehicleId(undefined)
          }}
        />
      )}

      {openGlobalOwnerModal && (
        <OwnerModal
          onClose={() => setOpenGlobalOwnerModal(false)}
          onSubmit={async body => {
            await runAction(() => api.createOwner(session.token, body), 'Đã tạo hồ sơ chủ xe mới.')
            setOpenGlobalOwnerModal(false)
          }}
        />
      )}

      {openGlobalVehicleModal && (
        <VehicleModal
          owners={owners}
          onClose={() => setOpenGlobalVehicleModal(false)}
          onSubmit={async body => {
            await runAction(() => api.createVehicle(session.token, body), 'Đã thêm phương tiện mới.')
            setOpenGlobalVehicleModal(false)
          }}
        />
      )}

      {openGlobalAppointmentModal && (
        <AppointmentModal
          vehicles={vehicles}
          onClose={() => setOpenGlobalAppointmentModal(false)}
          onSubmit={async body => {
            await runAction(() => api.createAppointment(session.token, body), 'Đã tạo lịch hẹn mới.')
            setOpenGlobalAppointmentModal(false)
          }}
        />
      )}

      {activeInspectionForDetail && session.role !== 'inspector' && (
        <InspectionDetail
          inspection={activeInspectionForDetail}
          vehicle={vehicles.find(v => v.id === activeInspectionForDetail.vehicle_id)}
          token={session.token}
          onClose={() => setActiveInspectionForDetail(null)}
        />
      )}
    </div>
  )
}

export default App

/* ==========================================================================
   DEDICATED FULL-PAGE: THỰC HIỆN ĐO KIỂM & GHI KẾT QUẢ TỪNG HẠNG MỤC
   (Thay thế hoàn toàn Modal/Module cho Inspector)
   ========================================================================== */
function InspectionTestingPage({
  inspection, vehicle, token, role, onBack, runAction, onInspectionUpdated
}: {
  inspection: Inspection;
  vehicle?: Vehicle;
  token: string;
  role: Role;
  onBack: () => void;
  runAction: (action: () => Promise<unknown>, message: string) => Promise<void>;
  onInspectionUpdated: (updated: Inspection) => void;
}) {
  const [results, setResults] = useState<InspectionResult[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Form State for Entry
  const [stage, setStage] = useState<number>(1)
  const [itemCode, setItemCode] = useState('')
  const [itemResult, setItemResult] = useState<'dat' | 'mi' | 'ma' | 'dd'>('dat')
  const [measuredValue, setMeasuredValue] = useState('')
  const [unit, setUnit] = useState('')

  // Inline Certificate State (when passed)
  const [showCertForm, setShowCertForm] = useState(false)

  // Auto-generation helper for Certificate & Stamp
  function generateCertCode() {
    const year = new Date().getFullYear()
    const num = Math.floor(100000 + Math.random() * 900000)
    return `GCN-${year}-${num}`
  }
  function generateStampCode() {
    const year = new Date().getFullYear()
    const num = Math.floor(100000 + Math.random() * 900000)
    return `TEM-${year}-${num}`
  }

  // Certificate form controlled states (with auto-generation)
  const [certNumber, setCertNumber] = useState(() => generateCertCode())
  const [stampNumber, setStampNumber] = useState(() => generateStampCode())
  const [issuedDate, setIssuedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [expiryDate, setExpiryDate] = useState(() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() + 1)
    return d.toISOString().slice(0, 10)
  })

  // Technical Stage Presets
  const stagePresets: Record<number, { code: string; label: string; defaultUnit?: string }[]> = {
    1: [
      { code: 'BIEN_SO_XE', label: 'Biển số xe & Phân loại màu biển' },
      { code: 'SO_KHUNG', label: 'Số khung phương tiện' },
      { code: 'SO_MAY', label: 'Số máy phương tiện' },
      { code: 'QUY_CACH_LOP', label: 'Quy cách & độ mòn hoa lốp' },
      { code: 'MAU_SON_HINH_DANG', label: 'Màu sơn & Hình dáng tổng thể' },
      { code: 'CO_CAU_CHUYEN_DUNG', label: 'Cơ cấu chuyên dùng (nếu có)' },
    ],
    2: [
      { code: 'KINH_CHAN_GIO', label: 'Kính chắn gió & Kính cửa sổ' },
      { code: 'GAT_NUOC_RUA_KINH', label: 'Gạt nước & Hệ thống rửa kính' },
      { code: 'DEN_CHIEU_SANG_CHINH', label: 'Cụm đèn chiếu sáng phía trước' },
      { code: 'DEN_TIN_HIEU_XI_NHAN', label: 'Đèn tín hiệu, phanh, lùi' },
      { code: 'GUONG_QUAN_SAT', label: 'Gương chiếu hậu trong & ngoài' },
      { code: 'DAI_AN_TOAN_GHE', label: 'Dây đai an toàn & Ghế ngồi' },
    ],
    3: [
      { code: 'LUC_PHANH_CHINH', label: 'Hiệu quả phanh chính toàn xe', defaultUnit: '%' },
      { code: 'DO_LECH_PHANH_TRUC_1', label: 'Độ lệch phanh trục trước', defaultUnit: '%' },
      { code: 'DO_LECH_PHANH_TRUC_2', label: 'Độ lệch phanh trục sau', defaultUnit: '%' },
      { code: 'HIEU_QUA_PHANH_DO', label: 'Hiệu quả phanh đỗ (phanh tay)', defaultUnit: '%' },
      { code: 'DO_TRUOT_NGANG_BANH_DAN_HUONG', label: 'Độ trượt ngang bánh dẫn hướng', defaultUnit: 'mm/m' },
    ],
    4: [
      { code: 'NONG_DO_KHI_THAI_CO', label: 'Nồng độ CO (Động cơ xăng)', defaultUnit: '%' },
      { code: 'NONG_DO_KHI_THAI_HC', label: 'Nồng độ HC (Động cơ xăng)', defaultUnit: 'ppm' },
      { code: 'DO_KHOI_DONG_CO_DIESEL', label: 'Độ khói (Động cơ Diesel)', defaultUnit: '% HSU' },
      { code: 'AM_LUONG_COI_DIEN', label: 'Âm lượng còi điện', defaultUnit: 'dB(A)' },
    ],
    5: [
      { code: 'CO_CAU_LAI_ROTUYN', label: 'Cơ cấu lái, rotuyn lái, khớp cầu' },
      { code: 'HE_THONG_TREO_GIAM_XOC', label: 'Hệ thống treo, nhíp, giảm chấn' },
      { code: 'KHUNG_GAM_DAM_XE', label: 'Khung gầm, dầm chịu lực xe' },
      { code: 'ONG_XA_GIAM_THANH', label: 'Ống dẫn xả & Bầu giảm thanh' },
      { code: 'TRUYEN_LUC_CAC_DANG', label: 'Trục các đăng & Khớp truyền lực' },
    ],
  }

  const refreshResults = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.results(token, inspection.id)
      setResults(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được kết quả đo kiểm')
    } finally {
      setLoading(false)
    }
  }, [token, inspection.id])

  useEffect(() => {
    void refreshResults()
  }, [refreshResults])

  const isFinalized = ['passed', 'failed'].includes(inspection.status)
  const hasMajorOrDangerous = results.some(r => r.result === 'ma' || r.result === 'dd')
  const passCount = results.filter(r => r.result === 'dat').length
  const minorCount = results.filter(r => r.result === 'mi').length
  const majorCount = results.filter(r => r.result === 'ma').length
  const dangerousCount = results.filter(r => r.result === 'dd').length

  function selectPreset(preset: { code: string; defaultUnit?: string }) {
    setItemCode(preset.code)
    if (preset.defaultUnit) setUnit(preset.defaultUnit)
  }

  async function submitItemResult(e: FormEvent) {
    e.preventDefault()
    if (!itemCode.trim()) return
    setBusy(true); setError('')
    try {
      const val = measuredValue.trim() ? Number(measuredValue) : null
      await api.addResult(token, inspection.id, {
        stage,
        item_code: itemCode.trim(),
        result: itemResult,
        measured_value: val,
        unit: unit.trim() || null,
      })
      setItemCode('')
      setMeasuredValue('')
      await refreshResults()
      // Refresh inspection object state
      const all = await api.inspections(token)
      const current = all.find(i => i.id === inspection.id)
      if (current) onInspectionUpdated(current)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể lưu kết quả kiểm tra')
    } finally {
      setBusy(false)
    }
  }

  async function handleFinalizeChecklist() {
    if (results.length === 0) {
      setError('Cần ít nhất một kết quả hạng mục trước khi chốt checklist.')
      return
    }
    setBusy(true); setError('')
    try {
      await runAction(() => api.finalize(token, inspection.id), 'Đã chốt checklist kiểm định hoàn tất.')
      const all = await api.inspections(token)
      const current = all.find(i => i.id === inspection.id)
      if (current) {
        onInspectionUpdated(current)
        if (current.status === 'passed') {
          setCertNumber(generateCertCode())
          setStampNumber(generateStampCode())
          setShowCertForm(true)
        }
      }
      await refreshResults()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể chốt kiểm định')
    } finally {
      setBusy(false)
    }
  }

  async function handleIssueCertificate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true); setError('')
    try {
      await runAction(() => api.issueCertificate(token, inspection.id, {
        certificate_number: certNumber.trim() || String(f.get('number') || '').trim() || generateCertCode(),
        stamp_number: stampNumber.trim() || String(f.get('stamp') || '').trim() || generateStampCode(),
        issued_on: String(f.get('issued')),
        expires_on: String(f.get('expires')),
        cycle: String(f.get('cycle')),
        emissions_standard: String(f.get('emissions')),
        payment_complete: f.get('paid') === 'on',
        legal_status_allowed: f.get('legal') === 'on',
      }), 'Đã cấp Giấy chứng nhận và Tem kiểm định thành công.')
      setShowCertForm(false)
      const all = await api.inspections(token)
      const current = all.find(i => i.id === inspection.id)
      if (current) onInspectionUpdated(current)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể phát hành chứng nhận')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="testing-page-root">
      {/* Top Navigation Bar */}
      <div className="testing-top-nav">
        <button className="button button-outline" onClick={onBack}>
          ← Quay lại danh sách hồ sơ
        </button>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <StatusBadge value={inspection.status} />
          {canInspect(role) && !isFinalized && results.length > 0 && (
            <button className="button button-primary" disabled={busy} onClick={handleFinalizeChecklist}>
              {busy ? 'Đang chốt...' : '🔒 Chốt checklist hoàn tất'}
            </button>
          )}
          {inspection.status === 'passed' && (
            <button className="button button-primary" onClick={() => {
              if (!showCertForm) {
                setCertNumber(generateCertCode())
                setStampNumber(generateStampCode())
              }
              setShowCertForm(v => !v)
            }}>
              {showCertForm ? 'Đóng biểu mẫu GCN' : '📜 Phát hành Giấy chứng nhận & Tem'}
            </button>
          )}
        </div>
      </div>

      {/* Vehicle Hero Details Banner */}
      <div className="testing-vehicle-hero">
        <div className="testing-vehicle-plate-wrap">
          <div className="testing-plate-box">
            {vehicle?.registration_number ?? `Xe #${inspection.vehicle_id}`}
          </div>
          <div className="testing-hero-meta">
            <strong>{vehicle?.vehicle_type ?? 'Phương tiện kiểm định'}</strong>
            <span>Mã hồ sơ: <b className="mono">{inspection.code}</b> · Loại kiểm định: <b>{inspection.inspection_type === 'first' ? 'Lần đầu' : 'Định kỳ'}</b></span>
          </div>
        </div>
        <div>
          <span className="live-state" style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' }}>
            <i style={{ background: '#d97706' }} /> Buồng đo kiểm trực tuyến
          </span>
        </div>
      </div>

      <div className="testing-details-grid">
        <div className="testing-detail-item">
          <small>Số khung (Chassis)</small>
          <strong className="mono">{vehicle?.chassis_number || '—'}</strong>
        </div>
        <div className="testing-detail-item">
          <small>Số máy (Engine)</small>
          <strong className="mono">{vehicle?.engine_number || '—'}</strong>
        </div>
        <div className="testing-detail-item">
          <small>Kênh tiếp nhận</small>
          <strong>{channelName(inspection.intake_channel)}</strong>
        </div>
        <div className="testing-detail-item">
          <small>Ngày tiếp nhận</small>
          <strong>{formatDate(inspection.received_at)}</strong>
        </div>
      </div>

      {error && <div className="alert alert-error"><span>!</span>{error}<button onClick={() => setError('')}>×</button></div>}

      {/* Main 2-Column Inspection Workspace */}
      <div className="testing-workspace-grid">
        
        {/* Left Column: Direct Item Entry Form (No modal/popup!) */}
        <section className="testing-card">
          <div className="testing-card-header">
            <div>
              <h2>Ghi nhận kết quả đo kiểm công đoạn</h2>
              <p>Chọn công đoạn, nhập mã hạng mục và ghi nhận kết luận kỹ thuật</p>
            </div>
            <span className="stage-number" style={{ width: 28, height: 28, fontSize: 13 }}>{stage}</span>
          </div>

          {/* Stage Selection Tabs */}
          <div className="stage-tabs-row">
            {[1, 2, 3, 4, 5].map(s => (
              <button
                key={s}
                type="button"
                className={`stage-tab-btn ${stage === s ? 'active' : ''}`}
                onClick={() => setStage(s)}
              >
                <span className="stage-tab-num">{s}</span>
                {s === 1 ? '1·Tổng quát' : s === 2 ? '2·Thân vỏ' : s === 3 ? '3·Phanh/Trượt' : s === 4 ? '4·Môi trường' : '5·Gầm/Lái'}
              </button>
            ))}
          </div>

          {/* Preset Item Chips for the chosen stage */}
          <div className="preset-items-bar">
            <span className="preset-items-title">Hạng mục quy chuẩn công đoạn {stage}:</span>
            <div className="preset-chips-wrap">
              {stagePresets[stage]?.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="preset-chip-btn"
                  onClick={() => selectPreset(preset)}
                >
                  ＋ {preset.label}
                </button>
              ))}
            </div>
          </div>

          {isFinalized ? (
            <div className="form-warning" style={{ margin: '14px 0', padding: '16px', borderRadius: 10, background: '#f8fafc', border: '1px solid #cbd5e1' }}>
              🔒 <strong>Hồ sơ kiểm định đã hoàn tất chốt kết quả ({statusName[inspection.status]}).</strong>
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748b' }}>Không thể ghi nhận thêm hoặc sửa đổi kết quả đo kiểm sau khi đã chốt.</p>
            </div>
          ) : (
            <form onSubmit={submitItemResult}>
              <Field label="Mã / Tên hạng mục kiểm tra" required>
                <input
                  value={itemCode}
                  onChange={e => setItemCode(e.target.value)}
                  placeholder="Ví dụ: LUC_PHANH_CHINH, SO_KHUNG, KHI_THAI_CO..."
                  required
                />
              </Field>

              <label className="field" style={{ marginTop: 14 }}>
                <span>Đánh giá kết quả chuyên môn <em>*</em></span>
                <div className="result-selector-grid">
                  <button
                    type="button"
                    className={`result-choice-btn result-choice-dat ${itemResult === 'dat' ? 'active' : ''}`}
                    onClick={() => setItemResult('dat')}
                  >
                    <span>✓ ĐẠT</span>
                    <small>Pass</small>
                  </button>
                  <button
                    type="button"
                    className={`result-choice-btn result-choice-mi ${itemResult === 'mi' ? 'active' : ''}`}
                    onClick={() => setItemResult('mi')}
                  >
                    <span>Mi</span>
                    <small>Không q.trọng</small>
                  </button>
                  <button
                    type="button"
                    className={`result-choice-btn result-choice-ma ${itemResult === 'ma' ? 'active' : ''}`}
                    onClick={() => setItemResult('ma')}
                  >
                    <span>Ma</span>
                    <small>Quan trọng</small>
                  </button>
                  <button
                    type="button"
                    className={`result-choice-btn result-choice-dd ${itemResult === 'dd' ? 'active' : ''}`}
                    onClick={() => setItemResult('dd')}
                  >
                    <span>DD</span>
                    <small>Nguy hiểm</small>
                  </button>
                </div>
              </label>

              <div className="form-grid" style={{ marginTop: 12 }}>
                <Field label="Trị số đo lường thực tế (nếu có)">
                  <input
                    type="number"
                    step="any"
                    value={measuredValue}
                    onChange={e => setMeasuredValue(e.target.value)}
                    placeholder="Ví dụ: 82.5, 0.45, 95..."
                  />
                </Field>
                <Field label="Đơn vị tính">
                  <input
                    value={unit}
                    onChange={e => setUnit(e.target.value)}
                    placeholder="%, mm/m, dB, ppm..."
                  />
                </Field>
              </div>

              <div style={{ marginTop: 20 }}>
                <button
                  type="submit"
                  className="button button-primary full-button"
                  disabled={busy || !itemCode.trim()}
                >
                  {busy ? 'Đang lưu kết quả...' : '💾 Lưu kết quả công đoạn này'}
                </button>
              </div>
            </form>
          )}

          {/* Inline Certificate Form when Passed */}
          {showCertForm && inspection.status === 'passed' && (
            <div className="cert-inline-card">
              <h3>📜 Biểu mẫu phát hành Giấy chứng nhận & Tem kiểm định</h3>
              <form onSubmit={handleIssueCertificate}>
                <div className="form-grid">
                  <Field label="Số giấy chứng nhận (Sinh tự động)" required>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        name="number"
                        value={certNumber}
                        onChange={e => setCertNumber(e.target.value)}
                        required
                        maxLength={100}
                        placeholder="VD: GCN-2026-0001"
                        style={{ fontWeight: 700, letterSpacing: '0.02em', background: '#f8fafc' }}
                      />
                      <button
                        type="button"
                        className="button button-ghost button-sm"
                        onClick={() => setCertNumber(generateCertCode())}
                        title="Tự động sinh lại số GCN"
                      >
                        🎲
                      </button>
                    </div>
                  </Field>
                  <Field label="Số tem kiểm định (Sinh tự động)" required>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        name="stamp"
                        value={stampNumber}
                        onChange={e => setStampNumber(e.target.value)}
                        required
                        maxLength={100}
                        placeholder="VD: TEM-2026-0001"
                        style={{ fontWeight: 700, letterSpacing: '0.02em', background: '#f8fafc' }}
                      />
                      <button
                        type="button"
                        className="button button-ghost button-sm"
                        onClick={() => setStampNumber(generateStampCode())}
                        title="Tự động sinh lại số Tem"
                      >
                        🎲
                      </button>
                    </div>
                  </Field>
                  <Field label="Ngày cấp" required>
                    <input
                      name="issued"
                      type="date"
                      required
                      value={issuedDate}
                      onChange={e => {
                        const val = e.target.value
                        setIssuedDate(val)
                        if (val) {
                          const d = new Date(val)
                          d.setFullYear(d.getFullYear() + 1)
                          setExpiryDate(d.toISOString().slice(0, 10))
                        }
                      }}
                    />
                  </Field>
                  <Field label="Ngày hết hạn (Mặc định 1 năm)" required>
                    <input
                      name="expires"
                      type="date"
                      required
                      value={expiryDate}
                      onChange={e => setExpiryDate(e.target.value)}
                    />
                  </Field>
                  <Field label="Chu kỳ kiểm định" required>
                    <input name="cycle" required maxLength={80} placeholder="VD: 12 tháng, 24 tháng" defaultValue="12 tháng" />
                  </Field>
                  <Field label="Tiêu chuẩn khí thải" required>
                    <input name="emissions" required maxLength={80} defaultValue="Mức 4 / Euro 4" />
                  </Field>
                </div>
                <div style={{ margin: '14px 0' }}>
                  <label className="check-row">
                    <input type="checkbox" name="paid" defaultChecked required />
                    Đã xác nhận nghĩa vụ thanh toán hoàn tất
                  </label>
                  <label className="check-row" style={{ marginTop: 8 }}>
                    <input type="checkbox" name="legal" defaultChecked required />
                    Đã xác nhận trạng thái pháp lý cho phép (không bị cảnh báo phạt nguội)
                  </label>
                </div>
                <button className="button button-primary full-button" disabled={busy}>
                  {busy ? 'Đang phát hành...' : 'Xác nhận phát hành GCN & Tem'}
                </button>
              </form>
            </div>
          )}
        </section>

        {/* Right Column: List of Recorded Results & Finalize Section */}
        <section className="testing-card">
          <div className="testing-card-header">
            <div>
              <h3>Danh sách kết quả đo kiểm ({results.length} hạng mục)</h3>
              <p>Chi tiết các thông số đã đo và đánh giá khiếm khuyết</p>
            </div>
            <button className="icon-button" title="Tải lại kết quả" onClick={() => void refreshResults()}>↻</button>
          </div>

          {/* Results Summary Strip */}
          <div className="testing-summary-strip">
            <span>Tổng: <b>{results.length}</b></span>
            <span style={{ color: '#047857' }}>✓ {passCount} Đạt</span>
            <span style={{ color: '#0369a1' }}>• {minorCount} Mi</span>
            <span style={{ color: '#b45309' }}>• {majorCount} Ma</span>
            <span style={{ color: '#be123c' }}>• {dangerousCount} DD</span>
          </div>

          {/* Assessment Warning / Notice */}
          {hasMajorOrDangerous ? (
            <div className="alert alert-error" style={{ marginBottom: 16 }}>
              <span>!</span>
              <div>
                <strong>Cảnh báo khiếm khuyết nghiêm trọng (Ma / DD)</strong>
                <p style={{ margin: '2px 0 0', fontSize: 12 }}>Phương tiện có ít nhất một lỗi quan trọng hoặc nguy hiểm. Hồ sơ sẽ được kết luận <b>KHÔNG ĐẠT</b> khi chốt.</p>
              </div>
            </div>
          ) : results.length > 0 ? (
            <div className="alert alert-success" style={{ marginBottom: 16 }}>
              <span>✓</span>
              <div>
                <strong>Tất cả hạng mục đều Đạt hoặc Mi</strong>
                <p style={{ margin: '2px 0 0', fontSize: 12 }}>Phương tiện đủ điều kiện được kết luận <b>ĐẠT</b> khi hoàn thành checklist.</p>
              </div>
            </div>
          ) : null}

          {/* Results List */}
          {loading ? (
            <div className="detail-loading">Đang tải danh sách kết quả...</div>
          ) : results.length ? (
            <div className="result-list">
              {results.map(r => (
                <div className="result-row" key={r.id}>
                  <span className="stage-number">{r.stage}</span>
                  <div>
                    <b>{r.item_code}</b>
                    <small>Công đoạn {r.stage} · {formatDate(r.recorded_at)}</small>
                  </div>
                  {r.measured_value !== null && (
                    <span className="measure">{r.measured_value} {r.unit ?? ''}</span>
                  )}
                  <StatusBadge value={r.result} />
                </div>
              ))}
            </div>
          ) : (
            <Empty title="Chưa có kết quả đo kiểm nào" detail="Sử dụng biểu mẫu bên trái để bắt đầu ghi nhận kết quả cho các công đoạn." />
          )}

          {/* Finalize Checklist Action Card (Only if not finalized) */}
          {!isFinalized && results.length > 0 && (
            <div className="finalize-action-card">
              <h4>Hoàn tất quy trình kiểm tra 5 công đoạn</h4>
              <p>Sau khi hoàn tất toàn bộ checklist, kiểm định viên chốt hồ sơ để hệ thống tự động tổng hợp kết luận ĐẠT hoặc KHÔNG ĐẠT theo quy định.</p>
              <button
                className="button button-primary"
                disabled={busy}
                onClick={handleFinalizeChecklist}
              >
                {busy ? 'Đang tổng hợp...' : '🔒 Chốt checklist hoàn tất kiểm định'}
              </button>
            </div>
          )}

          {/* Finalized Banner */}
          {isFinalized && (
            <div style={{ marginTop: 20, padding: 18, borderRadius: 12, background: inspection.status === 'passed' ? '#ecfdf5' : '#fff1f2', border: `1px solid ${inspection.status === 'passed' ? '#a7f3d0' : '#fecdd3'}` }}>
              <strong style={{ color: inspection.status === 'passed' ? '#065f46' : '#9f1239', fontSize: 15, display: 'block', marginBottom: 4 }}>
                {inspection.status === 'passed' ? '🎉 Kết luận: PHƯƠNG TIỆN ĐẠT TIÊU CHUẨN' : '⚠️ Kết luận: PHƯƠNG TIỆN KHÔNG ĐẠT TIÊU CHUẨN'}
              </strong>
              <span style={{ fontSize: 13, color: inspection.status === 'passed' ? '#047857' : '#be123c' }}>
                {inspection.status === 'passed' ? 'Phương tiện đủ điều kiện cấp Giấy chứng nhận và Tem kiểm định an toàn kỹ thuật.' : 'Phương tiện có khiếm khuyết kỹ thuật cần khắc phục trước khi kiểm định lại.'}
              </span>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/* ==========================================================================
   ROLE WORKSPACE 1: QUẢN TRỊ VIÊN (ADMIN DASHBOARD)
   ========================================================================== */
function AdminOverview({
  session, owners, vehicles, appointments, inspections, navigate, onOpenDetail
}: {
  session: Session; owners: Owner[]; vehicles: Vehicle[]; appointments: Appointment[]; inspections: Inspection[];
  navigate: (p: Page) => void; onOpenDetail: (i: Inspection) => void;
}) {
  const today = new Date().toISOString().slice(0, 10)
  const todayAppointments = appointments.filter(i => i.appointment_date === today && i.status === 'active')
  const passed = inspections.filter(i => i.status === 'passed').length
  const failed = inspections.filter(i => i.status === 'failed').length
  const activeInProcess = inspections.filter(i => ['received', 'in_progress', 'needs_documents'].includes(i.status)).length
  const totalDecided = passed + failed
  const passRate = totalDecided > 0 ? Math.round((passed / totalDecided) * 100) : 100
  const recent = [...inspections].sort((a, b) => b.received_at.localeCompare(a.received_at)).slice(0, 5)

  return (
    <>
      <div className="role-workspace-banner">
        <div>
          <div className="role-badge-pill role-badge-admin">👑 Quản trị viên: {session.username} · Giám sát toàn diện</div>
          <h1>Trung Tâm Điều Hành & Giám Sát</h1>
          <p>Giám sát toàn bộ {owners.length} chủ xe, {vehicles.length} phương tiện, lưu lượng kiểm định và chỉ số an toàn của trung tâm.</p>
        </div>
        <div className="role-header-actions">
          <button className="button button-primary" onClick={() => navigate('requirements-agent')}>✦ AI Phân tích chiến lược</button>
          <button className="button button-outline" onClick={() => navigate('inspections')}>📋 Giám sát hồ sơ</button>
        </div>
      </div>

      <section className="stat-grid">
        <StatCard label="Tỷ lệ Đạt chuẩn (Pass Rate)" value={passRate} hint={`${passed} đạt / ${totalDecided} đã chốt`} icon="📈" tone="green" isPercent />
        <StatCard label="Tổng phương tiện quản lý" value={vehicles.length} hint="Dữ liệu xe trong hệ thống" icon="▣" tone="blue" />
        <StatCard label="Hồ sơ đang xử lý" value={activeInProcess} hint="Trên chuyền & tại quầy" icon="◫" tone="orange" />
        <StatCard label="Lịch hẹn hôm nay" value={todayAppointments.length} hint="Khách hẹn đang hiệu lực" icon="▦" tone="purple" />
      </section>

      {/* Process Flow Pipeline */}
      <section className="panel" style={{ marginBottom: 24, padding: '20px 24px' }}>
        <div className="panel-heading" style={{ marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>Tiến trình luân chuyển hồ sơ toàn trung tâm</h3>
            <p style={{ fontSize: 13, color: '#64748b' }}>Phân bổ số lượng hồ sơ theo từng giai đoạn xử lý</p>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, textAlign: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#0f766e', textTransform: 'uppercase' }}>1. Tiếp nhận hồ sơ</span>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', margin: '6px 0' }}>{inspections.filter(i => i.status === 'received').length}</div>
            <span style={{ fontSize: 11.5, color: '#64748b' }}>Chờ chuyển dây chuyền</span>
          </div>
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 16, textAlign: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#b45309', textTransform: 'uppercase' }}>2. Đang kiểm định</span>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#b45309', margin: '6px 0' }}>{inspections.filter(i => i.status === 'in_progress').length}</div>
            <span style={{ fontSize: 11.5, color: '#78350f' }}>Đang đo 5 công đoạn</span>
          </div>
          <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 12, padding: 16, textAlign: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#047857', textTransform: 'uppercase' }}>3. Đạt tiêu chuẩn</span>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#047857', margin: '6px 0' }}>{passed}</div>
            <span style={{ fontSize: 11.5, color: '#065f46' }}>Đã cấp/chờ cấp GCN</span>
          </div>
          <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 12, padding: 16, textAlign: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#be123c', textTransform: 'uppercase' }}>4. Không đạt (Lỗi Ma/DD)</span>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#be123c', margin: '6px 0' }}>{failed}</div>
            <span style={{ fontSize: 11.5, color: '#9f1239' }}>Cần khắc phục kỹ thuật</span>
          </div>
        </div>
      </section>

      {/* Recent Inspections Monitor */}
      <section className="panel recent-panel">
        <div className="panel-heading">
          <div>
            <h3>Giám sát hồ sơ kiểm định gần nhất</h3>
            <p>Kiểm soát tiến độ xử lý và tính trung thực của kết quả kiểm định</p>
          </div>
          <button className="text-button" onClick={() => navigate('inspections')}>Xem tất cả hồ sơ <span>→</span></button>
        </div>
        {recent.length ? (
          <div className="table-wrap">
            <table className="dashboard-recent-table">
              <thead>
                <tr>
                  <th>MÃ HỒ SƠ</th>
                  <th>PHƯƠNG TIỆN</th>
                  <th>LOẠI KIỂM ĐỊNH</th>
                  <th>KÊNH TIẾP NHẬN</th>
                  <th>NGÀY TIẾP NHẬN</th>
                  <th>TRẠNG THÁI</th>
                  <th>THAO TÁC</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(item => (
                  <tr key={item.id}>
                    <td><strong className="mono dashboard-code">{item.code}</strong></td>
                    <td className="dashboard-vehicle-cell">{vehicleLabel(vehicles, item.vehicle_id)}</td>
                    <td className="dashboard-type-cell">{item.inspection_type === 'first' ? 'Lần đầu' : 'Định kỳ'}</td>
                    <td>{channelName(item.intake_channel)}</td>
                    <td className="dashboard-date-cell">{formatDate(item.received_at)}</td>
                    <td><StatusBadge value={item.status} /></td>
                    <td>
                      <button className="button button-outline button-sm" onClick={() => onOpenDetail(item)}>Chi tiết →</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Chưa có hồ sơ kiểm định" detail="Hồ sơ mới sẽ xuất hiện tại đây khi được tiếp nhận." />
        )}
      </section>
    </>
  )
}

/* ==========================================================================
   ROLE WORKSPACE 2: NHÂN VIÊN TIẾP NHẬN (INTAKE DASHBOARD)
   ========================================================================== */
function IntakeOverview({
  session, owners, vehicles, appointments, inspections, navigate,
  onStartIntake, onOpenOwnerModal, onOpenVehicleModal, onOpenAppointmentModal, onCancelAppointment
}: {
  session: Session; owners: Owner[]; vehicles: Vehicle[]; appointments: Appointment[]; inspections: Inspection[];
  navigate: (p: Page) => void;
  onStartIntake: (vehicleId?: number) => void;
  onOpenOwnerModal: () => void;
  onOpenVehicleModal: () => void;
  onOpenAppointmentModal: () => void;
  onCancelAppointment: (id: number) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10)
  const currentHour = new Date().getHours()
  const isMorning = currentHour < 12
  const todayAppointments = appointments.filter(a => a.appointment_date === today)
  const activeTodayApt = todayAppointments.filter(a => a.status === 'active')
  const receivedCount = inspections.filter(i => i.status === 'received').length
  const needsDocsCount = inspections.filter(i => i.status === 'needs_documents').length
  const recentIntakes = [...inspections].sort((a, b) => b.received_at.localeCompare(a.received_at)).slice(0, 5)

  return (
    <>
      <div className="role-workspace-banner">
        <div>
          <div className="role-badge-pill role-badge-intake">📥 Nhân viên tiếp nhận: {session.username} · Bàn đón tiếp</div>
          <h1>Bàn Tiếp Nhận & Điều Phối Hồ Sơ</h1>
          <p>Tiếp đón chủ phương tiện, đối chiếu hồ sơ giấy tờ, sắp xếp lịch hẹn và mở hồ sơ kiểm định.</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className={`shift-pill ${isMorning ? 'shift-morning' : 'shift-afternoon'}`}>
            {isMorning ? '☀️ Ca làm việc Sáng: 06:30 – 11:00' : '⛅ Ca làm việc Chiều: 13:00 – 17:30'}
          </span>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            Hôm nay: {formatDate(today)}
          </div>
        </div>
      </div>

      {/* Quick Action Strip */}
      <div className="quick-action-strip">
        <button className="quick-action-btn quick-action-btn-primary" onClick={() => onStartIntake()}>
          ＋ Tiếp nhận hồ sơ mới
        </button>
        <button className="quick-action-btn" onClick={onOpenOwnerModal}>
          ＋ Thêm hồ sơ chủ xe
        </button>
        <button className="quick-action-btn" onClick={onOpenVehicleModal}>
          ＋ Đăng ký phương tiện
        </button>
        <button className="quick-action-btn" onClick={onOpenAppointmentModal}>
          ＋ Đặt lịch hẹn mới
        </button>
      </div>

      <section className="stat-grid">
        <StatCard label="Khách hẹn hôm nay" value={activeTodayApt.length} hint="Cần đón tiếp trong ca" icon="📅" tone="blue" />
        <StatCard label="Hồ sơ mới tiếp nhận" value={receivedCount} hint="Đang chờ vào chuyền" icon="📥" tone="green" />
        <StatCard label="Hồ sơ thiếu chứng từ" value={needsDocsCount} hint="Chờ bổ sung giấy tờ" icon="⚠️" tone="orange" />
        <StatCard label="Tổng chủ xe quản lý" value={owners.length} hint="Hồ sơ khách hàng" icon="👥" tone="purple" />
      </section>

      {/* Today's Appointments Desk */}
      <section className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-heading">
          <div>
            <h3>Khách hẹn hôm nay cần đón tiếp ({activeTodayApt.length})</h3>
            <p>Đối chiếu biển số xe và bấm "Tiếp nhận ngay" khi khách có mặt tại quầy</p>
          </div>
          <button className="button button-outline button-sm" onClick={onOpenAppointmentModal}>＋ Thêm lịch hẹn</button>
        </div>
        {activeTodayApt.length ? (
          <div className="table-wrap">
            <table className="appointments-table">
              <thead>
                <tr>
                  <th>MÃ HẸN</th>
                  <th>PHƯƠNG TIỆN</th>
                  <th>KHUNG GIỜ</th>
                  <th>LOẠI DỊCH VỤ</th>
                  <th>THAO TÁC TIẾP NHẬN</th>
                </tr>
              </thead>
              <tbody>
                {activeTodayApt.map(item => (
                  <tr key={item.id}>
                    <td><strong className="mono appointment-code">{item.code}</strong></td>
                    <td><span className="plate plate-large">{vehicleLabel(vehicles, item.vehicle_id)}</span></td>
                    <td>
                      <span className="time-badge">{item.start_time.slice(0, 5)} - {item.end_time.slice(0, 5)}</span>
                    </td>
                    <td>{serviceName(item.service_type)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="button button-primary button-sm" onClick={() => onStartIntake(item.vehicle_id)}>
                          Tiếp nhận ngay ＋
                        </button>
                        <button className="button button-ghost button-sm" onClick={() => void onCancelAppointment(item.id)}>
                          Hủy
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Chưa có khách hẹn trong ngày hôm nay" detail="Bấm '＋ Đặt lịch hẹn mới' nếu có khách đặt lịch tại quầy hoặc qua điện thoại." />
        )}
      </section>

      {/* Recent Intakes */}
      <section className="panel recent-panel">
        <div className="panel-heading">
          <div>
            <h3>Hồ sơ tiếp nhận gần đây</h3>
            <p>Các phương tiện đã mở hồ sơ kiểm định</p>
          </div>
          <button className="text-button" onClick={() => navigate('inspections')}>Xem tất cả hồ sơ <span>→</span></button>
        </div>
        {recentIntakes.length ? (
          <div className="table-wrap">
            <table className="dashboard-recent-table">
              <thead>
                <tr>
                  <th>MÃ HỒ SƠ</th>
                  <th>PHƯƠNG TIỆN</th>
                  <th>LOẠI HỒ SƠ</th>
                  <th>KÊNH TIẾP NHẬN</th>
                  <th>NGÀY TIẾP NHẬN</th>
                  <th>TRẠNG THÁI</th>
                </tr>
              </thead>
              <tbody>
                {recentIntakes.map(item => (
                  <tr key={item.id}>
                    <td><strong className="mono dashboard-code">{item.code}</strong></td>
                    <td className="dashboard-vehicle-cell">{vehicleLabel(vehicles, item.vehicle_id)}</td>
                    <td className="dashboard-type-cell">{item.inspection_type === 'first' ? 'Lần đầu' : 'Định kỳ'}</td>
                    <td>{channelName(item.intake_channel)}</td>
                    <td className="dashboard-date-cell">{formatDate(item.received_at)}</td>
                    <td><StatusBadge value={item.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Chưa có hồ sơ kiểm định nào" detail="Bấm 'Tiếp nhận hồ sơ mới' để bắt đầu mở hồ sơ cho phương tiện." />
        )}
      </section>
    </>
  )
}

/* ==========================================================================
   ROLE WORKSPACE 3: KIỂM ĐỊNH VIÊN (INSPECTOR DASHBOARD)
   ========================================================================== */
function InspectorOverview({
  session, vehicles, appointments, inspections, navigate, onOpenDetail
}: {
  session: Session; vehicles: Vehicle[]; appointments: Appointment[]; inspections: Inspection[];
  navigate: (p: Page) => void;
  onOpenDetail: (inspection: Inspection) => void;
}) {
  const today = new Date().toISOString().slice(0, 10)
  const todayAptCount = appointments.filter(a => a.appointment_date === today && a.status === 'active').length
  const inProgress = inspections.filter(i => i.status === 'in_progress')
  const waitingTest = inspections.filter(i => i.status === 'received')
  const passedCount = inspections.filter(i => i.status === 'passed').length
  const failedCount = inspections.filter(i => i.status === 'failed').length
  const queueVehicles = inspections.filter(i => ['received', 'in_progress'].includes(i.status))

  return (
    <>
      <div className="role-workspace-banner">
        <div>
          <div className="role-badge-pill role-badge-inspector">⚙️ Kiểm định viên: {session.username} · Buồng điều khiển</div>
          <h1>Dây Chuyền Đo Kiểm Kỹ Thuật</h1>
          <p>Kiểm tra 5 công đoạn quy chuẩn, ghi nhận thông số ({todayAptCount} xe có hẹn hôm nay), đánh giá khiếm khuyết và chốt kết quả.</p>
        </div>
        <div>
          <span className="live-state" style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' }}>
            <i style={{ background: '#d97706' }} /> Dây chuyền trực tuyến
          </span>
        </div>
      </div>

      <section className="stat-grid">
        <StatCard label="Xe đang trên dây chuyền" value={inProgress.length} hint="Đang tiến hành đo kiểm" icon="⚙️" tone="orange" />
        <StatCard label="Chờ vào kiểm tra" value={waitingTest.length} hint="Hồ sơ mới chuyển sang" icon="⏳" tone="blue" />
        <StatCard label="Phương tiện ĐẠT" value={passedCount} hint="Đủ điều kiện cấp GCN" icon="✓" tone="green" />
        <StatCard label="Có khiếm khuyết (Ma/DD)" value={failedCount} hint="Không đạt tiêu chuẩn" icon="!" tone="red" />
      </section>

      {/* 5-Stage Station Map */}
      <section className="stations-section">
        <div className="panel-heading" style={{ margin: 0 }}>
          <div>
            <h3>Quy trình 5 công đoạn kiểm định kỹ thuật</h3>
            <p>Kiểm định viên phụ trách đo kiểm và nhập kết quả cho từng hạng mục theo Thông tư quy chuẩn</p>
          </div>
        </div>
        <div className="stations-grid">
          <div className="station-card">
            <div className="station-header">
              <span className="station-number">1</span>
              <span style={{ fontSize: 11, color: '#64748b' }}>Nhận dạng</span>
            </div>
            <strong>Công đoạn 1: Tổng quát</strong>
            <span>Biển số, số khung, số máy, màu sơn, lốp xe, cơ cấu chuyên dùng.</span>
          </div>

          <div className="station-card">
            <div className="station-header">
              <span className="station-number">2</span>
              <span style={{ fontSize: 11, color: '#64748b' }}>Phần trên</span>
            </div>
            <strong>Công đoạn 2: Thân vỏ & Nội thất</strong>
            <span>Kính chắn gió, gạt nước, gương chiếu hậu, đèn chiếu sáng, ghế & dây an toàn.</span>
          </div>

          <div className="station-card">
            <div className="station-header">
              <span className="station-number" style={{ background: '#fed7aa', color: '#c2410c' }}>3</span>
              <span style={{ fontSize: 11, color: '#64748b' }}>Thiết bị đo</span>
            </div>
            <strong>Công đoạn 3: Phanh & Trượt</strong>
            <span>Lực phanh chính, độ lệch phanh trục trước/sau, phanh đỗ, độ trượt ngang.</span>
          </div>

          <div className="station-card">
            <div className="station-header">
              <span className="station-number">4</span>
              <span style={{ fontSize: 11, color: '#64748b' }}>Môi trường</span>
            </div>
            <strong>Công đoạn 4: Khí thải & Còi</strong>
            <span>Nồng độ khí thải CO/HC (xăng), độ khói (diesel), âm lượng còi (dB).</span>
          </div>

          <div className="station-card">
            <div className="station-header">
              <span className="station-number">5</span>
              <span style={{ fontSize: 11, color: '#64748b' }}>Phần dưới</span>
            </div>
            <strong>Công đoạn 5: Gầm & Hệ thống lái</strong>
            <span>Khung xe, rotuyn, hệ thống treo, giảm chấn, cơ cấu lái, các đăng, ống xả.</span>
          </div>
        </div>
      </section>

      {/* Active Line Queue */}
      <section className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-heading">
          <div>
            <h3>Phương tiện chờ & đang kiểm định ({queueVehicles.length})</h3>
            <p>Bấm "Vào đo kiểm trang mới →" để thực hiện đo kiểm chuyên sâu trên trang riêng biệt</p>
          </div>
          <button className="text-button" onClick={() => navigate('inspections')}>Xem tất cả hồ sơ <span>→</span></button>
        </div>
        {queueVehicles.length ? (
          <div className="table-wrap">
            <table className="inspections-table">
              <thead>
                <tr>
                  <th>MÃ HỒ SƠ</th>
                  <th>PHƯƠNG TIỆN</th>
                  <th>LOẠI KIỂM ĐỊNH</th>
                  <th>TIẾP NHẬN</th>
                  <th>TRẠNG THÁI</th>
                  <th>THAO TÁC KỸ THUẬT</th>
                </tr>
              </thead>
              <tbody>
                {queueVehicles.map(i => (
                  <tr key={i.id}>
                    <td><strong className="mono inspection-code">{i.code}</strong></td>
                    <td><span className="plate plate-large">{vehicleLabel(vehicles, i.vehicle_id)}</span></td>
                    <td><strong>{i.inspection_type === 'first' ? 'Kiểm định lần đầu' : 'Kiểm định định kỳ'}</strong></td>
                    <td>{formatDate(i.received_at)}</td>
                    <td><StatusBadge value={i.status} /></td>
                    <td>
                      <button className="button button-primary button-sm" onClick={() => onOpenDetail(i)}>
                        Vào đo kiểm trang mới →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Dây chuyền đang trống" detail="Hiện không có phương tiện nào đang chờ đo kiểm. Hồ sơ tiếp nhận từ quầy sẽ tự động xuất hiện tại đây." />
        )}
      </section>

      {/* Passed inspections waiting for certificate */}
      {inspections.filter(i => i.status === 'passed').length > 0 && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Hồ sơ ĐẠT tiêu chuẩn · Sẵn sàng cấp Giấy chứng nhận & Tem</h3>
              <p>Mở trang đo kiểm để kiểm tra xác nhận hoàn tất thanh toán & pháp lý để phát hành Giấy chứng nhận và tem kiểm định</p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="inspections-table">
              <thead>
                <tr>
                  <th>MÃ HỒ SƠ</th>
                  <th>PHƯƠNG TIỆN</th>
                  <th>LOẠI KIỂM ĐỊNH</th>
                  <th>KẾT QUẢ</th>
                  <th>THAO TÁC PHÁT HÀNH</th>
                </tr>
              </thead>
              <tbody>
                {inspections.filter(i => i.status === 'passed').slice(0, 5).map(i => (
                  <tr key={i.id}>
                    <td><strong className="mono inspection-code">{i.code}</strong></td>
                    <td><span className="plate plate-large">{vehicleLabel(vehicles, i.vehicle_id)}</span></td>
                    <td>{i.inspection_type === 'first' ? 'Lần đầu' : 'Định kỳ'}</td>
                    <td><StatusBadge value="passed" /></td>
                    <td>
                      <button className="button button-outline button-sm" onClick={() => onOpenDetail(i)}>
                        Xem trang cấp GCN & Tem →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}

/* ==========================================================================
   ROLE WORKSPACE 4: CHỦ XE (OWNER DASHBOARD)
   ========================================================================== */
function OwnerOverview({
  session, vehicles, appointments, inspections, navigate, onOpenAppointmentModal
}: {
  session: Session; vehicles: Vehicle[]; appointments: Appointment[]; inspections: Inspection[];
  navigate: (p: Page) => void; onOpenAppointmentModal: () => void;
}) {
  const activeAppointments = appointments.filter(a => a.status === 'active')
  return (
    <>
      <div className="role-workspace-banner">
        <div>
          <div className="role-badge-pill role-badge-owner">🚗 Chủ phương tiện: {session.username} · Cổng dịch vụ</div>
          <h1>Cổng Dịch Vụ Chủ Xe & Doanh Nghiệp</h1>
          <p>Quản lý phương tiện sở hữu, theo dõi tiến độ hồ sơ và đặt lịch kiểm định thuận tiện.</p>
        </div>
        <div>
          <button className="button button-primary" onClick={onOpenAppointmentModal}>＋ Đặt lịch đăng kiểm mới</button>
        </div>
      </div>

      <section className="stat-grid">
        <StatCard label="Phương tiện của tôi" value={vehicles.length} hint="Xe đã đăng ký" icon="▣" tone="blue" />
        <StatCard label="Lịch hẹn đang hiệu lực" value={activeAppointments.length} hint="Lịch đăng kiểm sắp tới" icon="▦" tone="orange" />
        <StatCard label="Hồ sơ đã kiểm định" value={inspections.length} hint="Lịch sử đăng kiểm" icon="📋" tone="green" />
        <StatCard label="Hồ sơ Đạt tiêu chuẩn" value={inspections.filter(i => i.status === 'passed').length} hint="Đã được cấp chứng nhận" icon="✓" tone="purple" />
      </section>

      {/* My Vehicles */}
      <section className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-heading">
          <div>
            <h3>Danh sách phương tiện của tôi</h3>
            <p>Các phương tiện thuộc quyền quản lý của tài khoản</p>
          </div>
          <button className="text-button" onClick={() => navigate('vehicles')}>Xem chi tiết xe <span>→</span></button>
        </div>
        {vehicles.length ? (
          <div className="table-wrap">
            <table className="vehicles-table">
              <thead>
                <tr>
                  <th>BIỂN SỐ XE</th>
                  <th>LOẠI PHƯƠNG TIỆN</th>
                  <th>SỐ KHUNG</th>
                  <th>SỐ MÁY</th>
                  <th>THAO TÁC</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map(v => (
                  <tr key={v.id}>
                    <td><span className="plate plate-large">{v.registration_number}</span></td>
                    <td>{v.vehicle_type}</td>
                    <td><span className="mono">{v.chassis_number}</span></td>
                    <td><span className="mono">{v.engine_number}</span></td>
                    <td>
                      <button className="button button-outline button-sm" onClick={onOpenAppointmentModal}>
                        Đặt lịch cho xe này ＋
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Chưa có phương tiện nào liên kết" detail="Liên hệ trung tâm tiếp nhận để liên kết phương tiện của bạn với tài khoản." />
        )}
      </section>

      {/* My Appointments */}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Lịch hẹn đăng kiểm sắp tới</h3>
            <p>Theo dõi khung giờ hẹn kiểm định tại các trung tâm</p>
          </div>
          <button className="text-button" onClick={() => navigate('appointments')}>Xem tất cả lịch hẹn <span>→</span></button>
        </div>
        {appointments.length ? (
          <div className="table-wrap">
            <table className="appointments-table">
              <thead>
                <tr>
                  <th>MÃ HẸN</th>
                  <th>PHƯƠNG TIỆN</th>
                  <th>NGÀY HẸN</th>
                  <th>KHUNG GIỜ</th>
                  <th>DỊCH VỤ</th>
                  <th>TRẠNG THÁI</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map(a => (
                  <tr key={a.id}>
                    <td><strong className="mono appointment-code">{a.code}</strong></td>
                    <td><span className="plate plate-large">{vehicleLabel(vehicles, a.vehicle_id)}</span></td>
                    <td>{formatDate(a.appointment_date)}</td>
                    <td><span className="time-badge">{a.start_time.slice(0, 5)} - {a.end_time.slice(0, 5)}</span></td>
                    <td>{serviceName(a.service_type)}</td>
                    <td><StatusBadge value={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Bạn chưa có lịch hẹn đăng kiểm nào" detail="Bấm '＋ Đặt lịch đăng kiểm mới' để chủ động chọn ngày và khung giờ." />
        )}
      </section>
    </>
  )
}

function StatCard({ label, value, hint, icon, tone, isPercent }: { label: string; value: number; hint: string; icon: string; tone: string; isPercent?: boolean }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}>{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value.toLocaleString('vi-VN')}{isPercent ? '%' : ''}</div>
      <div className="stat-hint">{hint}</div>
      <div className={`stat-accent ${tone}`}/>
    </div>
  )
}

/* ==========================================================================
   LOGIN SCREEN WITH QUICK DEMO ACCESS
   ========================================================================== */
function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  // Registration fields (defaults to Owner role)
  const [displayName, setDisplayName] = useState('')
  const [phone, setPhone] = useState('')
  const [identity, setIdentity] = useState('')
  const [address, setAddress] = useState('')

  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submitLogin(event?: FormEvent, customUser?: string, customPass?: string) {
    if (event) event.preventDefault()
    setBusy(true); setError('')
    const u = customUser || username
    const p = customPass || password
    try {
      onLogin(await apiLogin(u, p))
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 401 ? 'Tên đăng nhập hoặc mật khẩu không đúng.' : reason instanceof Error ? reason.message : 'Không thể đăng nhập')
    } finally {
      setBusy(false)
    }
  }

  async function submitRegister(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    if (username.trim().length < 3) {
      setError('Tên đăng nhập phải có ít nhất 3 ký tự.')
      setBusy(false)
      return
    }
    if (password.length < 6) {
      setError('Mật khẩu phải có ít nhất 6 ký tự.')
      setBusy(false)
      return
    }
    if (!displayName.trim()) {
      setError('Vui lòng nhập họ và tên chủ xe.')
      setBusy(false)
      return
    }
    if (!phone.trim()) {
      setError('Vui lòng nhập số điện thoại liên hệ.')
      setBusy(false)
      return
    }
    try {
      const session = await apiRegister({
        username: username.trim(),
        password,
        display_name: displayName.trim(),
        phone: phone.trim(),
        identity_or_tax_number: identity.trim() || undefined,
        address: address.trim() || undefined,
      })
      onLogin(session)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể đăng ký tài khoản')
    } finally {
      setBusy(false)
    }
  }

  function quickLogin(user: string) {
    setAuthMode('login')
    setUsername(user)
    setPassword('DemoOnly123!')
    void submitLogin(undefined, user, 'DemoOnly123!')
  }

  return (
    <div className="login-page">
      <div className="login-decoration">
        <div className="deco-grid"/>
        <div className="deco-orbit orbit-one"/>
        <div className="deco-orbit orbit-two"/>
        <div className="login-brand">
          <div className="brand-mark brand-mark-light">ĐK</div>
          <div>
            <strong>Đăng kiểm</strong>
            <span>HỆ THỐNG QUẢN LÝ TRUNG TÂM</span>
          </div>
        </div>
        <div className="login-copy">
          <div className="eyebrow light-eyebrow"><i/> NỀN TẢNG NGHIỆP VỤ</div>
          <h1>Vận hành<br/>chuẩn xác.<br/><em>An toàn trên<br/>mọi hành trình.</em></h1>
          <p>Quản lý quy trình đăng kiểm phương tiện trên một nền tảng thống nhất với giao diện chuyên biệt cho từng vai trò.</p>
          <div className="login-steps">
            <div><b>01</b><span>Tiếp nhận hồ sơ</span></div>
            <div><b>02</b><span>Kiểm định phương tiện</span></div>
            <div><b>03</b><span>Phát hành kết quả</span></div>
          </div>
        </div>
        <div className="login-foot">HỆ THỐNG QUẢN LÝ ĐĂNG KIỂM <span>•</span> v0.1</div>
      </div>

      <div className="login-panel">
        <div className="login-mobile-brand">
          <div className="brand-mark">ĐK</div>
          <b>Đăng kiểm</b>
        </div>
        <div className="login-form-wrap" style={authMode === 'register' ? { width: 'min(440px, 100%)' } : undefined}>
          
          {/* Mode Switcher Tabs */}
          <div className="auth-mode-tabs">
            <button
              type="button"
              className={`auth-mode-tab ${authMode === 'login' ? 'active' : ''}`}
              onClick={() => { setAuthMode('login'); setError('') }}
            >
              <span>🔐</span> Đăng nhập
            </button>
            <button
              type="button"
              className={`auth-mode-tab ${authMode === 'register' ? 'active' : ''}`}
              onClick={() => { setAuthMode('register'); setError('') }}
            >
              <span>📝</span> Đăng ký Chủ xe
            </button>
          </div>

          {authMode === 'login' ? (
            <>
              <div className="eyebrow"><i/> CỔNG HỆ THỐNG</div>
              <h2>Chào mừng trở lại</h2>
              <p className="login-subtitle">Đăng nhập để vào không gian làm việc chuyên biệt theo vai trò.</p>
              
              <form onSubmit={e => void submitLogin(e)}>
                <label>
                  Tên đăng nhập
                  <div className="input-wrap">
                    <span className="input-icon">♙</span>
                    <input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="Nhập tên đăng nhập" required/>
                  </div>
                </label>
                <label>
                  Mật khẩu
                  <div className="input-wrap">
                    <span className="input-icon">⌑</span>
                    <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Nhập mật khẩu" required/>
                  </div>
                </label>
                {error && <div className="form-error">{error}</div>}
                <button className="button button-primary login-submit" disabled={busy}>
                  {busy ? 'Đang xác thực...' : 'Đăng nhập'}
                  <span>→</span>
                </button>
              </form>

              <div className="switch-auth-link">
                Bạn là Chủ xe mới chưa có tài khoản?{' '}
                <button type="button" onClick={() => { setAuthMode('register'); setError('') }}>
                  Đăng ký ngay
                </button>
              </div>

              {/* Quick Demo Login Bar */}
              <div className="demo-accounts-bar">
                <span>Đăng nhập nhanh tài khoản thử nghiệm:</span>
                <div className="demo-accounts-grid">
                  <button type="button" className="demo-pill-btn demo-pill-admin" onClick={() => quickLogin('demo_admin')}>
                    <strong>👑 Quản trị viên</strong>
                    <small>demo_admin</small>
                  </button>
                  <button type="button" className="demo-pill-btn demo-pill-intake" onClick={() => quickLogin('demo_intake')}>
                    <strong>📥 Tiếp nhận hồ sơ</strong>
                    <small>demo_intake</small>
                  </button>
                  <button type="button" className="demo-pill-btn demo-pill-inspector" onClick={() => quickLogin('demo_inspector')}>
                    <strong>⚙️ Kiểm định viên</strong>
                    <small>demo_inspector</small>
                  </button>
                  <button type="button" className="demo-pill-btn demo-pill-owner" onClick={() => quickLogin('demo_owner')}>
                    <strong>🚗 Chủ xe</strong>
                    <small>demo_owner</small>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="eyebrow"><i/> DỊCH VỤ DÀNH CHO KHÁCH HÀNG</div>
              <h2>Đăng ký tài khoản</h2>
              <p className="login-subtitle">
                Đăng ký để quản lý phương tiện cá nhân, đặt lịch hẹn kiểm định và tra cứu kết quả trực tuyến.
              </p>

              <form onSubmit={e => void submitRegister(e)}>
                <div className="form-row-two">
                  <label>
                    Họ và tên chủ xe *
                    <div className="input-wrap">
                      <span className="input-icon">👤</span>
                      <input
                        value={displayName}
                        onChange={e => setDisplayName(e.target.value)}
                        placeholder="VD: Nguyễn Văn An"
                        required
                      />
                    </div>
                  </label>
                  <label>
                    Số điện thoại *
                    <div className="input-wrap">
                      <span className="input-icon">📞</span>
                      <input
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        placeholder="VD: 0912345678"
                        required
                      />
                    </div>
                  </label>
                </div>

                <div className="form-row-two">
                  <label>
                    Tên đăng nhập *
                    <div className="input-wrap">
                      <span className="input-icon">♙</span>
                      <input
                        autoComplete="username"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        placeholder="Tối thiểu 3 ký tự"
                        required
                      />
                    </div>
                  </label>
                  <label>
                    Mật khẩu *
                    <div className="input-wrap">
                      <span className="input-icon">⌑</span>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="Tối thiểu 6 ký tự"
                        required
                      />
                    </div>
                  </label>
                </div>

                <div className="form-row-two">
                  <label>
                    Số CCCD / Mã số thuế
                    <div className="input-wrap">
                      <span className="input-icon">🪪</span>
                      <input
                        value={identity}
                        onChange={e => setIdentity(e.target.value)}
                        placeholder="Không bắt buộc"
                      />
                    </div>
                  </label>
                  <label>
                    Địa chỉ liên hệ
                    <div className="input-wrap">
                      <span className="input-icon">📍</span>
                      <input
                        value={address}
                        onChange={e => setAddress(e.target.value)}
                        placeholder="Không bắt buộc"
                      />
                    </div>
                  </label>
                </div>

                {error && <div className="form-error">{error}</div>}

                <button className="button button-primary login-submit" disabled={busy}>
                  {busy ? 'Đang tạo tài khoản...' : 'Đăng ký & Vào cổng Chủ xe'}
                  <span>→</span>
                </button>
              </form>

              <div className="switch-auth-link">
                Đã có tài khoản?{' '}
                <button type="button" onClick={() => { setAuthMode('login'); setError('') }}>
                  Đăng nhập tại đây
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   403 FORBIDDEN PAGE COMPONENT
   ========================================================================== */
function Forbidden403Page({
  message,
  onBack,
  onSignOut,
}: {
  page?: string
  session?: Session
  message?: string
  onBack: () => void
  onSignOut: () => void
}) {
  return (
    <div className="forbidden-403-container">
      <div className="forbidden-403-card">
        <div className="forbidden-403-badge">
          <span>🛡️</span>
          <span>HTTP 403 · TRUY CẬP BỊ TỪ CHỐI</span>
        </div>
        <h1 className="forbidden-title">Khu Vực Hạn Chế Quyền Truy Cập</h1>
        <p className="forbidden-subtitle">
          Bạn không có quyền truy cập vào trang này.
        </p>
        {message && (
          <div className="forbidden-server-message">
            <span>Phản hồi từ máy chủ:</span> {message}
          </div>
        )}
        <div className="forbidden-actions">
          <button type="button" className="button button-primary" onClick={onBack}>
            <span>←</span> Quay về Bàn làm việc
          </button>
          <button type="button" className="button button-secondary" onClick={onSignOut}>
            <span>⇄</span> Đổi tài khoản khác
          </button>
        </div>
        <div className="forbidden-footer-tip">
          <span>💡</span> Vui lòng liên hệ <strong>Quản trị viên</strong> nếu bạn cần được cấp quyền truy cập.
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   SUPPORT CHAT ASSISTANT
   ========================================================================== */
function SupportChat({ session, onSignOut }: { session: Session; onSignOut?: () => void }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([
        {
          role: 'assistant',
          content: `Xin chào ${session.username}! Tôi là trợ lý AI hỗ trợ nghiệp vụ đăng kiểm. Với vai trò ${roleName[session.role]}, tôi có thể giải đáp các quy định, hướng dẫn tra cứu hoặc quy trình xử lý phương tiện.`
        }
      ])
    }
  }, [open, session, messages.length])

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, busy, open])

  async function submit(event?: FormEvent) {
    if (event) event.preventDefault()
    const content = draft.trim()
    if (!content || busy) return
    const updated = [...messages, { role: 'user' as const, content }]
    setMessages(updated); setDraft(''); setBusy(true); setError('')
    try {
      const result = await api.chat(session.token, updated.slice(-16))
      setMessages([...updated, { role: 'assistant', content: result.message }])
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        setError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
      } else {
        setError(reason instanceof Error ? reason.message : 'Chưa gửi được tin nhắn. Vui lòng thử lại.')
      }
    } finally { setBusy(false) }
  }

  return (
    <div className="support-chat-root">
      {open && (
        <section className="support-chat-panel" aria-label="Trợ lý đăng kiểm">
          <header className="support-chat-header">
            <span className="support-chat-avatar">✦</span>
            <div><strong>Trợ lý đăng kiểm</strong><small>{roleName[session.role]} · AI hỗ trợ</small></div>
            <button type="button" aria-label="Đóng chatbot" onClick={() => setOpen(false)}>×</button>
          </header>
          <div className="support-chat-messages" aria-live="polite">
            {messages.map((item, index) => (
              <div key={`${index}-${item.role}`} className={`support-chat-message ${item.role === 'user' ? 'from-user' : 'from-assistant'}`}>{item.content}</div>
            ))}
            {busy && <div className="support-chat-message from-assistant">Đang soạn câu trả lời…</div>}
            <div ref={messagesEndRef} />
          </div>
          {error && (
            <div className="support-chat-error" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
              <span>{error}</span>
              {error.includes('hết hạn') && onSignOut && (
                <button type="button" className="button button-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }} onClick={onSignOut}>
                  Đăng nhập lại
                </button>
              )}
            </div>
          )}
          <form className="support-chat-form" onSubmit={submit}>
            <textarea
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submit()
                }
              }}
              maxLength={4000}
              rows={2}
              placeholder="Nhập câu hỏi của bạn (Nhấn Enter để gửi, Shift+Enter xuống dòng)…"
              aria-label="Tin nhắn"
            />
            <button className="button button-primary" disabled={busy || !draft.trim()} aria-label="Gửi tin nhắn">{busy ? '…' : 'Gửi'}</button>
          </form>
          <p className="support-chat-note">Không gửi mật khẩu hoặc thông tin cá nhân. AI có thể trả lời chưa chính xác.</p>
        </section>
      )}
      <button type="button" className={`support-chat-toggle ${open ? 'is-open' : ''}`} onClick={() => setOpen(value => !value)} aria-label={open ? 'Đóng trợ lý' : 'Mở trợ lý'} title="Trợ lý AI">
        {open ? (
          <span className="support-chat-close-icon">×</span>
        ) : (
          <svg className="support-chat-star-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M12 2C12 7.523 7.523 12 2 12C7.523 12 12 16.477 12 22C12 16.477 16.477 12 22 12C16.477 12 12 7.523 12 2Z" />
          </svg>
        )}
      </button>
    </div>
  )
}

/* ==========================================================================
   REQUIREMENTS AGENT PAGE (AI REQUIREMENTS ANALYSIS)
   ========================================================================== */
function RequirementsAgentPage({ token }: { token: string }) {
  const [requirement, setRequirement] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const samplePrompts = [
    'Tích hợp camera AI tự động nhận diện biển số xe khi đến cổng trung tâm đăng kiểm',
    'Tự động tra cứu dữ liệu phạt nguội và cảnh báo phương tiện trước khi tiếp nhận',
    'Gửi tin nhắn thông báo tự động nhắc hạn đăng kiểm cho chủ xe qua Zalo / SMS',
  ]

  async function submit(event?: FormEvent) {
    if (event) event.preventDefault()
    const text = requirement.trim()
    if (text.length < 2 || busy) return
    setBusy(true); setError(''); setAnalysis('')
    try {
      const result = await api.analyzeRequirement(token, text)
      setAnalysis(result.analysis)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể phân tích yêu cầu.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeading eyebrow="CÔNG CỤ QUẢN TRỊ CHIẾN LƯỢC" title="Phân tích yêu cầu bằng AI" description="Phân tích tác động và tính khả thi của các tính năng mới theo quy chuẩn đăng kiểm." />
      <section className="panel requirements-agent-panel">
        <div style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 8 }}>Gợi ý mẫu yêu cầu:</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {samplePrompts.map((p, idx) => (
              <button
                key={idx}
                type="button"
                className="button button-outline button-sm"
                style={{ fontSize: 12, height: 32, borderRadius: 20, padding: '0 12px' }}
                onClick={() => setRequirement(p)}
              >
                ✦ {p}
              </button>
            ))}
          </div>
        </div>
        <form onSubmit={submit}>
          <label className="field">
            <span>Yêu cầu cần phân tích <em>*</em></span>
            <textarea
              rows={4}
              value={requirement}
              onChange={e => setRequirement(e.target.value)}
              placeholder="Nhập mô tả tính năng hoặc đề xuất cải tiến quy trình..."
              required
            />
          </label>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button className="button button-primary" disabled={busy || requirement.trim().length < 2}>
              {busy ? 'Đang phân tích cùng Gemini AI...' : 'Phân tích yêu cầu'}
              <span>✦</span>
            </button>
            {requirement && (
              <button type="button" className="button button-ghost" onClick={() => { setRequirement(''); setAnalysis('') }}>
                Xóa
              </button>
            )}
          </div>
        </form>

        {error && <div className="form-error" style={{ marginTop: 14 }}>{error}</div>}

        {analysis && (
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #e2e8f0' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: '#1e3a8a' }}>✦ Kết quả phân tích từ AI:</h3>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18, whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 13.5 }}>
              {analysis}
            </div>
          </div>
        )}
      </section>
    </>
  )
}

/* ==========================================================================
   STANDARD CRUD PAGES (VEHICLES, OWNERS, APPOINTMENTS, INSPECTIONS)
   ========================================================================== */
function VehiclesPage({ role, vehicles, owners, onCreate }: { role: Role; vehicles: Vehicle[]; owners: Owner[]; onCreate: (body: Omit<Vehicle, 'id'>) => Promise<void> }) {
  const [query, setQuery] = useState(''); const [open, setOpen] = useState(false)
  const filtered = vehicles.filter(v => `${v.registration_number} ${v.chassis_number} ${v.engine_number} ${v.vehicle_type}`.toLowerCase().includes(query.toLowerCase()))
  return <>
    <PageHeading eyebrow="DỮ LIỆU NỀN" title="Phương tiện" description="Thông tin phương tiện được quản lý trong hệ thống đăng kiểm." action={canIntake(role) ? <button className="button button-primary" onClick={() => setOpen(true)}>＋ Thêm phương tiện</button> : undefined}/>
    <div className="toolbar">
      <div className="search-box">
        <span>⌕</span>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm theo biển số, loại xe, số khung, số máy..."/>
      </div>
      <span className="result-count">{filtered.length} phương tiện</span>
    </div>
    <section className="panel list-panel vehicles-panel">
      {filtered.length ? (
        <div className="table-wrap">
          <table className="vehicles-table">
            <thead>
              <tr>
                <th>BIỂN SỐ</th>
                <th>LOẠI PHƯƠNG TIỆN</th>
                <th>SỐ KHUNG</th>
                <th>SỐ MÁY</th>
                <th>CHỦ XE</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(v => (
                <tr key={v.id}>
                  <td><span className="plate plate-large">{v.registration_number}</span></td>
                  <td className="vehicle-type-cell">{v.vehicle_type}</td>
                  <td><span className="mono vehicle-code-cell">{v.chassis_number}</span></td>
                  <td><span className="mono vehicle-code-cell">{v.engine_number}</span></td>
                  <td className="vehicle-owner-cell">
                    <strong>{owners.find(o => o.id === v.owner_id)?.display_name ?? `Chủ xe #${v.owner_id}`}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Không tìm thấy phương tiện" detail={query ? 'Thử thay đổi nội dung tìm kiếm.' : 'Danh sách phương tiện đang trống.'}/>
      )}
    </section>
    {open && <VehicleModal owners={owners} onClose={() => setOpen(false)} onSubmit={async body => { await onCreate(body); setOpen(false) }}/>}
  </>
}

function OwnersPage({ owners, onCreate }: { owners: Owner[]; onCreate: (body: Omit<Owner, 'id'>) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = owners.filter(o => `${o.display_name} ${o.phone} ${o.identity_or_tax_number}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <PageHeading eyebrow="DỮ LIỆU NỀN" title="Chủ xe" description="Quản lý thông tin chủ xe đã được tiếp nhận." action={<button className="button button-primary" onClick={() => setOpen(true)}>＋ Thêm chủ xe</button>}/>
    <div className="toolbar">
      <div className="search-box">
        <span>⌕</span>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm theo tên chủ xe, số điện thoại, CCCD/MST..."/>
      </div>
      <span className="result-count">{filtered.length} chủ xe</span>
    </div>
    <section className="panel list-panel owners-panel">
      {filtered.length ? (
        <div className="table-wrap">
          <table className="owners-table">
            <thead>
              <tr>
                <th>CHỦ XE</th>
                <th>ĐỊNH DANH / MÃ SỐ THUẾ</th>
                <th>SỐ ĐIỆN THOẠI</th>
                <th>ĐỊA CHỈ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(o => (
                <tr key={o.id}>
                  <td>
                    <div className="person-cell person-cell-large">
                      <span className="person-avatar person-avatar-large">{o.display_name.slice(0, 1).toUpperCase()}</span>
                      <strong className="person-name">{o.display_name}</strong>
                    </div>
                  </td>
                  <td><span className="mono owner-identity-code">{o.identity_or_tax_number}</span></td>
                  <td><span className="owner-phone">{o.phone}</span></td>
                  <td className="address-cell owner-address-cell">{o.address}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Chưa có dữ liệu chủ xe" detail="Tạo hồ sơ chủ xe để liên kết phương tiện."/>
      )}
    </section>
    {open && <OwnerModal onClose={() => setOpen(false)} onSubmit={async body => { await onCreate(body); setOpen(false) }}/>}
  </>
}

function AppointmentsPage({ role, vehicles, appointments, onCreate, onCancel }: { role: Role; vehicles: Vehicle[]; appointments: Appointment[]; onCreate: (body: Omit<Appointment, 'id' | 'code' | 'status'>) => Promise<void>; onCancel: (id: number) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const canCreate = ['admin', 'intake', 'owner'].includes(role);
  const filtered = appointments.filter(a => {
    const veh = vehicles.find(v => v.id === a.vehicle_id);
    return `${a.code} ${a.service_type} ${veh?.registration_number ?? ''}`.toLowerCase().includes(query.toLowerCase());
  });
  return <>
    <PageHeading eyebrow="ĐIỀU PHỐI TIẾP NHẬN" title="Lịch hẹn đăng kiểm" description="Sắp xếp khung giờ kiểm định đảm bảo năng lực phục vụ của trung tâm." action={canCreate ? <button className="button button-primary" onClick={() => setOpen(true)}>＋ Tạo lịch hẹn</button> : undefined}/>
    <div className="toolbar">
      <div className="search-box">
        <span>⌕</span>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm theo mã lịch hẹn, biển số xe..."/>
      </div>
      <span className="result-count">{filtered.length} lịch hẹn</span>
    </div>
    <section className="panel list-panel appointments-panel">
      {filtered.length ? (
        <div className="table-wrap">
          <table className="appointments-table">
            <thead>
              <tr>
                <th>MÃ LỊCH HẸN</th>
                <th>PHƯƠNG TIỆN</th>
                <th>NGÀY HẸN</th>
                <th>KHUNG GIỜ</th>
                <th>DỊCH VỤ</th>
                <th>TRẠNG THÁI</th>
                <th>THAO TÁC</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id}>
                  <td><strong className="mono appointment-code">{a.code}</strong></td>
                  <td><span className="plate plate-large">{vehicleLabel(vehicles, a.vehicle_id)}</span></td>
                  <td className="appointment-date-cell">{formatDate(a.appointment_date)}</td>
                  <td><span className="time-badge">{a.start_time.slice(0, 5)} - {a.end_time.slice(0, 5)}</span></td>
                  <td>{serviceName(a.service_type)}</td>
                  <td><StatusBadge value={a.status}/></td>
                  <td>
                    {a.status === 'active' && ['admin', 'intake', 'owner'].includes(role) ? (
                      <button className="button button-ghost button-sm cancel-action-btn" onClick={() => void onCancel(a.id)}>Hủy hẹn</button>
                    ) : <span className="text-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Chưa có lịch hẹn" detail="Lịch hẹn mới sẽ hiển thị ở đây."/>
      )}
    </section>
    {open && <AppointmentModal vehicles={vehicles} onClose={() => setOpen(false)} onSubmit={async body => { await onCreate(body); setOpen(false) }}/>}
  </>
}

function InspectionsPage({ role, vehicles, inspections, token, runAction, onOpenDetail }: { role: Role; vehicles: Vehicle[]; inspections: Inspection[]; token: string; runAction: (action: () => Promise<unknown>, message: string) => Promise<void>; onOpenDetail?: (ins: Inspection) => void }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Inspection | null>(null);
  const [filter, setFilter] = useState('all');
  const visible = inspections.filter(i => filter === 'all' || i.status === filter);
  const canCreate = canIntake(role);

  function handleSelect(i: Inspection) {
    if (onOpenDetail) onOpenDetail(i)
    else setSelected(i)
  }

  return <>
    <PageHeading eyebrow="NGHIỆP VỤ KIỂM ĐỊNH" title="Hồ sơ kiểm định" description="Tiếp nhận hồ sơ và theo dõi kết quả kiểm tra phương tiện." action={canCreate ? <button className="button button-primary" onClick={() => setOpen(true)}>＋ Tiếp nhận hồ sơ</button> : undefined}/>
    <div className="filter-row">
      <div className="tabs">
        <button className={filter === 'all' ? 'tab-active' : ''} onClick={() => setFilter('all')}>Tất cả <b>{inspections.length}</b></button>
        {(['received', 'in_progress', 'passed', 'failed'] as const).map(s => (
          <button key={s} className={filter === s ? 'tab-active' : ''} onClick={() => setFilter(s)}>{statusName[s]}</button>
        ))}
      </div>
      <span className="result-count">{visible.length} hồ sơ</span>
    </div>
    <section className="panel list-panel inspections-panel">
      {visible.length ? (
        <div className="table-wrap">
          <table className="inspections-table">
            <thead>
              <tr>
                <th>MÃ HỒ SƠ</th>
                <th>PHƯƠNG TIỆN</th>
                <th>LOẠI KIỂM ĐỊNH</th>
                <th>KÊNH TIẾP NHẬN</th>
                <th>NGÀY TIẾP NHẬN</th>
                <th>TRẠNG THÁI</th>
                <th>THAO TÁC</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(i => (
                <tr key={i.id}>
                  <td><strong className="mono inspection-code">{i.code}</strong></td>
                  <td><span className="plate plate-large">{vehicleLabel(vehicles, i.vehicle_id)}</span></td>
                  <td className="inspection-type-cell"><strong>{i.inspection_type === 'first' ? 'Lần đầu' : 'Định kỳ'}</strong></td>
                  <td className="inspection-channel-cell">{channelName(i.intake_channel)}</td>
                  <td className="inspection-date-cell">{formatDate(i.received_at)}</td>
                  <td><StatusBadge value={i.status}/></td>
                  <td>
                    <button className="button button-outline button-sm detail-action-btn" onClick={() => handleSelect(i)}>
                      {role === 'inspector' ? 'Vào đo kiểm →' : 'Chi tiết →'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Chưa có hồ sơ kiểm định" detail="Tiếp nhận hồ sơ mới để bắt đầu theo dõi."/>
      )}
    </section>
    {open && <InspectionModal vehicles={vehicles} onClose={() => setOpen(false)} onSubmit={async body => { await runAction(() => api.createInspection(token, body), 'Đã tiếp nhận hồ sơ.'); setOpen(false) }}/>}
    {!onOpenDetail && selected && <InspectionDetail inspection={selected} vehicle={vehicles.find(v => v.id === selected.vehicle_id)} token={token} onClose={() => setSelected(null)}/>}
  </>
}

/* ==========================================================================
   INSPECTION DETAIL DRAWER (FOR ADMIN / INTAKE READ-ONLY VIEW)
   ========================================================================== */
function InspectionDetail({ inspection, vehicle, token, onClose }: { inspection: Inspection; vehicle?: Vehicle; token: string; onClose: () => void }) {
  const [results, setResults] = useState<InspectionResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setResults(await api.results(token, inspection.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không tải được kết quả')
    } finally {
      setLoading(false)
    }
  }, [token, inspection.id])

  useEffect(() => { void refresh() }, [refresh])

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <section className="detail-drawer">
        <div className="drawer-head">
          <div>
            <div className="eyebrow">CHI TIẾT HỒ SƠ KIỂM ĐỊNH</div>
            <h2>{inspection.code}</h2>
          </div>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <div className="drawer-status">
          <StatusBadge value={inspection.status}/>
          <span>{inspection.inspection_type === 'first' ? 'Kiểm định lần đầu' : 'Kiểm định định kỳ'}</span>
        </div>
        <div className="detail-vehicle">
          <span className="vehicle-large-icon">▣</span>
          <div>
            <small>PHƯƠNG TIỆN</small>
            <strong>{vehicle?.registration_number ?? `Xe #${inspection.vehicle_id}`}</strong>
            <span>{vehicle?.vehicle_type ?? 'Chưa có thông tin'}</span>
          </div>
        </div>
        <div className="detail-grid">
          <DetailField label="Kênh tiếp nhận" value={channelName(inspection.intake_channel)}/>
          <DetailField label="Ngày tiếp nhận" value={formatDate(inspection.received_at)}/>
          <DetailField label="Số quản lý GCN cũ" value={inspection.old_certificate_management_number}/>
          <DetailField label="Số giấy đăng ký / giấy hẹn" value={inspection.registration_document_number}/>
        </div>
        <div className="section-divider"/>
        <div className="panel-heading detail-section-heading">
          <div>
            <h3>Kết quả các hạng mục kiểm tra</h3>
            <p>{results.length} kết quả đã ghi nhận</p>
          </div>
        </div>
        {error && <div className="form-error">{error}</div>}
        {loading ? (
          <div className="detail-loading">Đang tải kết quả...</div>
        ) : results.length ? (
          <div className="result-list">
            {results.map(result => (
              <div className="result-row" key={result.id}>
                <span className="stage-number">{result.stage}</span>
                <div>
                  <b>{result.item_code}</b>
                  <small>Công đoạn {result.stage} · {formatDate(result.recorded_at)}</small>
                </div>
                {result.measured_value !== null && <span className="measure">{result.measured_value} {result.unit ?? ''}</span>}
                <StatusBadge value={result.result}/>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="Chưa có kết quả" detail="Kết quả từng hạng mục sẽ xuất hiện tại đây khi kiểm định viên đo kiểm."/>
        )}
      </section>
    </div>
  )
}

/* ==========================================================================
   UI UTILITY COMPONENTS
   ========================================================================== */
function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) { return <div className="page-heading"><div><div className="eyebrow"><i/>{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="heading-action">{action}</div>}</div> }
function StatusBadge({ value }: { value: string }) { const tone = ['active', 'passed', 'dat'].includes(value) ? 'badge-green' : ['failed', 'dd', 'ma'].includes(value) ? 'badge-red' : ['in_progress', 'mi'].includes(value) ? 'badge-blue' : value === 'cancelled' ? 'badge-gray' : 'badge-amber'; return <span className={`badge ${tone}`}><i/>{statusName[value] ?? resultName[value] ?? value}</span> }
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="empty-state"><div className="empty-art"><span>▤</span><i/></div><strong>{title}</strong><p>{detail}</p></div> }
function DetailField({ label, value }: { label: string; value?: string | null }) { return <div className="detail-field"><small>{label}</small><strong>{value || '—'}</strong></div> }
function vehicleLabel(vehicles: Vehicle[], id: number) { return vehicles.find(v => v.id === id)?.registration_number ?? `Phương tiện #${id}` }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date) }
function serviceName(value: string) { return ({ periodic: 'Kiểm định định kỳ', new_registration: 'Đăng ký xe mới', information_change: 'Thay đổi thông tin' } as Record<string, string>)[value] ?? value }
function channelName(value: string) { return ({ counter: 'Tại quầy', postal: 'Bưu chính', online: 'Trực tuyến' } as Record<string, string>)[value] ?? value }

function Modal({ title, subtitle, children, onClose, onSubmit, submitLabel = 'Lưu thông tin' }: { title: string; subtitle: string; children: ReactNode; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; submitLabel?: string }) { const [busy, setBusy] = useState(false); return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><form className="form-modal" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onSubmit(e) } finally { setBusy(false) } }}><div className="modal-heading"><div><div className="eyebrow">THÔNG TIN NGHIỆP VỤ</div><h2>{title}</h2><p>{subtitle}</p></div><button type="button" className="close-button" onClick={onClose}>×</button></div><div className="modal-body">{children}</div><div className="modal-footer"><button type="button" className="button button-ghost" onClick={onClose}>Hủy</button><button className="button button-primary" disabled={busy}>{busy ? 'Đang lưu...' : submitLabel}<span>→</span></button></div></form></div> }
function Field({ label, children, required = false }: { label: string; children: ReactNode; required?: boolean }) { return <label className="field"><span>{label}{required && <em> *</em>}</span>{children}</label> }

function OwnerModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (body: Omit<Owner, 'id'>) => Promise<void> }) { const [error, setError] = useState(''); async function submit(e: FormEvent<HTMLFormElement>) { const f = new FormData(e.currentTarget); try { await onSubmit({ display_name: String(f.get('name')), identity_or_tax_number: String(f.get('identity')), phone: String(f.get('phone')), address: String(f.get('address')) }) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể lưu chủ xe') } } return <Modal title="Thêm chủ xe" subtitle="Nhập thông tin theo giấy tờ của chủ xe." onClose={onClose} onSubmit={submit}><div className="form-grid"><Field label="Họ tên cá nhân / tên tổ chức" required><input name="name" maxLength={255} required placeholder="Nhập họ tên hoặc tên tổ chức"/></Field><Field label="Số định danh / mã số thuế" required><input name="identity" maxLength={50} required placeholder="Nhập số giấy tờ"/></Field><Field label="Số điện thoại" required><input name="phone" maxLength={30} required placeholder="Số điện thoại liên hệ"/></Field><Field label="Địa chỉ cư trú / trụ sở" required><textarea name="address" required rows={3} placeholder="Theo giấy đăng ký xe"/></Field></div>{error && <div className="form-error">{error}</div>}</Modal> }
function VehicleModal({ owners, onClose, onSubmit }: { owners: Owner[]; onClose: () => void; onSubmit: (body: Omit<Vehicle, 'id'>) => Promise<void> }) { const [error, setError] = useState(''); async function submit(e: FormEvent<HTMLFormElement>) { const f = new FormData(e.currentTarget); try { await onSubmit({ owner_id: Number(f.get('owner')), registration_number: String(f.get('plate')), plate_classification: String(f.get('plateClass') || '') || null, chassis_number: String(f.get('chassis')), engine_number: String(f.get('engine')), vehicle_type: String(f.get('type')) }) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể lưu phương tiện') } } return <Modal title="Thêm phương tiện" subtitle="Liên kết phương tiện với hồ sơ chủ xe." onClose={onClose} onSubmit={submit}><div className="form-grid"><Field label="Chủ xe" required><select name="owner" required defaultValue=""><option value="" disabled>Chọn chủ xe</option>{owners.map(o => <option key={o.id} value={o.id}>{o.display_name} · {o.phone}</option>)}</select></Field><Field label="Biển số xe" required><input name="plate" maxLength={30} required placeholder="Ví dụ: 30A-123.45"/></Field><Field label="Phân loại màu biển" ><input name="plateClass" maxLength={30} placeholder="Nếu áp dụng"/></Field><Field label="Loại phương tiện" required><input name="type" maxLength={100} required placeholder="Ô tô con, xe tải..."/></Field><Field label="Số khung" required><input name="chassis" maxLength={100} required/></Field><Field label="Số máy" required><input name="engine" maxLength={100} required/></Field></div>{owners.length === 0 && <div className="form-error">Cần tạo hồ sơ chủ xe trước khi thêm phương tiện.</div>}{error && <div className="form-error">{error}</div>}</Modal> }
function AppointmentModal({ vehicles, onClose, onSubmit }: { vehicles: Vehicle[]; onClose: () => void; onSubmit: (body: Omit<Appointment, 'id' | 'code' | 'status'>) => Promise<void> }) { const [error, setError] = useState(''); async function submit(e: FormEvent<HTMLFormElement>) { const f = new FormData(e.currentTarget); try { await onSubmit({ vehicle_id: Number(f.get('vehicle')), appointment_date: String(f.get('date')), start_time: String(f.get('start')), end_time: String(f.get('end')), service_type: String(f.get('service')) }) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tạo lịch') } } return <Modal title="Tạo lịch hẹn" subtitle="Khung giờ phải nằm trọn trong buổi sáng hoặc buổi chiều." onClose={onClose} onSubmit={submit}><div className="form-grid"><Field label="Phương tiện" required><select name="vehicle" required defaultValue=""><option value="" disabled>Chọn phương tiện</option>{vehicles.map(v => <option key={v.id} value={v.id}>{v.registration_number} · {v.vehicle_type}</option>)}</select></Field><Field label="Ngày hẹn" required><input name="date" type="date" required min={new Date().toISOString().slice(0, 10)}/></Field><Field label="Loại dịch vụ" required><select name="service" required><option value="periodic">Kiểm định định kỳ</option><option value="new_registration">Đăng ký xe mới</option><option value="information_change">Thay đổi thông tin</option></select></Field><Field label="Giờ bắt đầu" required><select name="start" required><option value="06:30">06:30</option><option value="07:00">07:00</option><option value="08:00">08:00</option><option value="09:00">09:00</option><option value="10:00">10:00</option><option value="13:00">13:00</option><option value="14:00">14:00</option><option value="15:00">15:00</option><option value="16:00">16:00</option><option value="17:00">17:00</option></select></Field><Field label="Giờ kết thúc" required><select name="end" required><option value="07:00">07:00</option><option value="08:00">08:00</option><option value="09:00">09:00</option><option value="10:00">10:00</option><option value="11:00">11:00</option><option value="14:00">14:00</option><option value="15:00">15:00</option><option value="16:00">16:00</option><option value="17:00">17:00</option><option value="17:30">17:30</option></select></Field></div>{error && <div className="form-error">{error}</div>}</Modal> }

function InspectionModal({ vehicles, onClose, onSubmit, defaultVehicleId }: { vehicles: Vehicle[]; onClose: () => void; onSubmit: (body: Pick<Inspection, 'vehicle_id' | 'inspection_type' | 'intake_channel' | 'old_certificate_management_number' | 'registration_document_number' | 'insurance_contract_number' | 'insurance_expiry'>) => Promise<void>; defaultVehicleId?: number }) {
  const [error, setError] = useState('');
  const [kind, setKind] = useState<'periodic' | 'first'>('periodic');
  const [oldCert, setOldCert] = useState('');
  const [oldCertError, setOldCertError] = useState('');
  const [touched, setTouched] = useState(false);

  function validateOldCertInput(value: string, currentKind: 'periodic' | 'first'): string {
    const trimmed = value.trim().toUpperCase();
    if (currentKind === 'periodic') {
      if (!trimmed) {
        return 'Kiểm định định kỳ bắt buộc phải nhập Số quản lý GCN cũ.';
      }
    }
    if (trimmed) {
      if (trimmed.length < 6 || trimmed.length > 30) {
        return 'Số quản lý GCN cũ phải có độ dài từ 6 đến 30 ký tự.';
      }
      if (!/^[A-Z0-9\-/]+$/.test(trimmed) || !/[A-Z0-9]/.test(trimmed)) {
        return 'Số quản lý GCN cũ không đúng định dạng (chỉ gồm chữ cái, chữ số, "-" hoặc "/", ví dụ: KD-1234567 hoặc 2901S-123456).';
      }
    }
    return '';
  }

  function handleKindChange(newKind: 'periodic' | 'first') {
    setKind(newKind);
    if (touched) {
      setOldCertError(validateOldCertInput(oldCert, newKind));
    }
  }

  function handleOldCertChange(val: string) {
    const upper = val.toUpperCase();
    setOldCert(upper);
    if (touched) {
      setOldCertError(validateOldCertInput(upper, kind));
    }
  }

  function handleOldCertBlur() {
    setTouched(true);
    setOldCertError(validateOldCertInput(oldCert, kind));
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    setError('');
    const f = new FormData(e.currentTarget);
    const validationMsg = validateOldCertInput(oldCert, kind);
    setTouched(true);
    if (validationMsg) {
      setOldCertError(validationMsg);
      setError(validationMsg);
      return;
    }
    setOldCertError('');

    try {
      await onSubmit({
        vehicle_id: Number(f.get('vehicle')),
        inspection_type: kind,
        intake_channel: String(f.get('channel')),
        old_certificate_management_number: oldCert.trim() ? oldCert.trim().toUpperCase() : null,
        registration_document_number: String(f.get('document') || '').trim() || null,
        insurance_contract_number: String(f.get('insurance') || '').trim() || null,
        insurance_expiry: String(f.get('expiry') || '') || null
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể tạo hồ sơ');
    }
  }

  return (
    <Modal title="Tiếp nhận hồ sơ" subtitle="Ghi nhận thông tin tiếp nhận ban đầu của phương tiện." onClose={onClose} onSubmit={submit}>
      <div className="form-grid">
        <Field label="Phương tiện" required>
          <select name="vehicle" required defaultValue={defaultVehicleId ? String(defaultVehicleId) : ""}>
            <option value="" disabled>Chọn phương tiện</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration_number} · {v.vehicle_type}</option>)}
          </select>
        </Field>
        <Field label="Loại kiểm định" required>
          <select name="kind" value={kind} onChange={e => handleKindChange(e.target.value as 'periodic' | 'first')}>
            <option value="periodic">Định kỳ (bắt buộc số GCN cũ)</option>
            <option value="first">Lần đầu (không bắt buộc số GCN cũ)</option>
          </select>
        </Field>
        <Field label="Kênh tiếp nhận" required>
          <select name="channel">
            <option value="counter">Tại quầy</option>
            <option value="postal">Bưu chính</option>
            <option value="online">Trực tuyến</option>
          </select>
        </Field>
        <div className="field">
          <span>
            Số quản lý GCN cũ {kind === 'periodic' && <em style={{ color: '#e11d48' }}>*</em>}
            <small style={{ fontWeight: 600, color: kind === 'periodic' ? '#0284c7' : '#64748b', marginLeft: '6px' }}>
              {kind === 'periodic' ? '(Bắt buộc)' : '(Không bắt buộc)'}
            </small>
          </span>
          <input
            name="oldCert"
            value={oldCert}
            onChange={e => handleOldCertChange(e.target.value)}
            onBlur={handleOldCertBlur}
            maxLength={30}
            placeholder={kind === 'periodic' ? "Ví dụ: KD-1234567 hoặc 2901S-123456" : "Để trống nếu xe kiểm định lần đầu"}
            style={{
              textTransform: 'uppercase',
              borderColor: oldCertError ? '#ef4444' : undefined,
              backgroundColor: oldCertError ? '#fff8f8' : undefined
            }}
          />
          {oldCertError ? (
            <div style={{ fontSize: '12px', color: '#dc2626', marginTop: '4px', lineHeight: 1.4, fontWeight: 500 }}>
              ⚠ {oldCertError}
            </div>
          ) : (
            <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '4px', lineHeight: 1.3 }}>
              {kind === 'periodic'
                ? 'Định dạng chuẩn: 6 - 30 ký tự (chữ in hoa, số, "-", "/"). Ví dụ: KD-1234567'
                : 'Để trống nếu phương tiện kiểm định lần đầu. Chỉ nhập nếu xe đã từng cấp GCN.'}
            </div>
          )}
        </div>
        <Field label="Số seri đăng ký / giấy hẹn"><input name="document" placeholder="Ví dụ: 123456 hoặc GH-999"/></Field>
        <Field label="Số hợp đồng bảo hiểm TNDS"><input name="insurance" placeholder="Ví dụ: BH-2024-888999"/></Field>
        <Field label="Ngày hết hạn bảo hiểm"><input name="expiry" type="date"/></Field>
      </div>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
