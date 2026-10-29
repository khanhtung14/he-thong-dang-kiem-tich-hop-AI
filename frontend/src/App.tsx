import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, Appointment, AuditLogItem, Certificate, ChatMessage, Inspection, InspectionResult, isTokenExpired, Owner, Role, Session, UserProfile, Vehicle, AccountListItem, login as apiLogin, register as apiRegister, sendForgotPasswordOtp, verifyOtpOnly, verifyOtpAndResetPassword } from './api'
import './support-chat.css'

type Page = 'overview' | 'vehicles' | 'appointments' | 'inspections' | 'owners' | 'roles' | 'audit-logs' | 'inspection-testing' | 'profile'
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
  'roles': ['admin'],
  'audit-logs': ['admin'],
  'inspection-testing': ['admin', 'inspector'],
  'profile': ['admin', 'intake', 'inspector', 'owner'],
}

function isPageAllowedForRole(page: Page, role: Role): boolean {
  const allowed = PAGE_PERMISSIONS[page]
  return allowed ? allowed.includes(role) : false
}

function getPagesForRole(role: Role): { id: Page; label: string; icon: string }[] {
  if (role === 'admin') {
    return [
      { id: 'overview', label: 'Điều hành tổng thể', icon: '◫' },
      { id: 'inspections', label: 'Giám sát hồ sơ', icon: '▤' },
      { id: 'appointments', label: 'Lịch hẹn trung tâm', icon: '▦' },
      { id: 'vehicles', label: 'Quản lý phương tiện', icon: '▣' },
      { id: 'owners', label: 'Quản lý chủ xe', icon: '♙' },
      { id: 'roles', label: 'Phân quyền hệ thống', icon: '🛡' },
      { id: 'audit-logs', label: 'Nhật ký hệ thống', icon: '📋' },
    ]
  }
  if (role === 'intake') {
    return [
      { id: 'overview', label: 'Bàn tiếp nhận', icon: '◫' },
      { id: 'inspections', label: 'Hồ sơ tiếp nhận', icon: '▤' },
      { id: 'appointments', label: 'Điều phối lịch hẹn', icon: '▦' },
      { id: 'owners', label: 'Hồ sơ chủ xe', icon: '♙' },
      { id: 'vehicles', label: 'Phương tiện đăng ký', icon: '▣' },
    ]
  }
  if (role === 'inspector') {
    return [
      { id: 'overview', label: 'Dây chuyền kiểm định', icon: '◫' },
      { id: 'inspections', label: 'Đo kiểm & Chốt kết quả', icon: '▤' },
      { id: 'vehicles', label: 'Xe trên dây chuyền', icon: '▣' },
      { id: 'appointments', label: 'Lịch xe dự kiến', icon: '▦' },
    ]
  }
  return [
    { id: 'overview', label: 'Cổng dịch vụ chủ xe', icon: '◫' },
    { id: 'vehicles', label: 'Xe của tôi', icon: '▣' },
    { id: 'appointments', label: 'Lịch hẹn của tôi', icon: '▦' },
    { id: 'inspections', label: 'Tra cứu kiểm định', icon: '▤' },
  ]
}

function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
  const [certificates, setCertificates] = useState<Certificate[]>([])
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

  // Synchronize user profile to ensure fresh avatar and display name
  useEffect(() => {
    if (session?.token) {
      api.getProfile(session.token).then(profile => {
        setSession(prev => {
          if (!prev) return prev
          const cleanName = profile.display_name ? profile.display_name.replace(/\s*\(DỮ LIỆU MẪU\)/gi, '').trim() : null
          if (
            prev.display_name === cleanName &&
            prev.email === profile.email &&
            prev.phone === profile.phone &&
            prev.avatar_url === profile.avatar_url
          ) {
            return prev
          }
          const updated: Session = {
            ...prev,
            display_name: cleanName,
            email: profile.email,
            phone: profile.phone,
            avatar_url: profile.avatar_url,
          }
          sessionStorage.setItem('inspection-session', JSON.stringify(updated))
          return updated
        })
      }).catch(() => {})
    }
  }, [session?.token])

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
      api.inspections(active.token).then(setInspections),
      api.certificates(active.token).then(setCertificates),
      api.owners(active.token).then(setOwners),
    ]
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
    setCertificates([])
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
      const errMsg = reason instanceof Error ? reason.message : 'Có lỗi xảy ra'
      if (reason instanceof ApiError && reason.status === 403) {
        setForbiddenError({ target: page, message: errMsg })
      } else {
        setError(errMsg)
      }
      throw reason
    }
  }

  if (!session) return <Login onLogin={signIn} />

  const allowedPages = getPagesForRole(session.role)
  const current = page === 'inspection-testing' 
    ? `Đo kiểm kỹ thuật (${testingInspection?.code ?? ''})` 
    : page === 'profile'
    ? 'Chỉnh sửa thông tin cá nhân'
    : page === 'roles'
    ? 'Phân quyền hệ thống'
    : page === 'audit-logs'
    ? 'Nhật ký thao tác hệ thống'
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
              {item.icon ? <span className="nav-icon">{item.icon}</span> : null}
              {item.label}
              {page === item.id && <span className="nav-current"/>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div
            className="user-card user-card-interactive"
            onClick={() => { navigate('profile'); setMobileNav(false) }}
            title="Bấm vào để chỉnh sửa thông tin cá nhân"
            role="button"
            tabIndex={0}
          >
            <div className="avatar" title="Ảnh đại diện - Bấm để chỉnh sửa">
              {session.avatar_url ? (
                <img src={session.avatar_url} alt="Avatar" className="avatar-img" />
              ) : (
                (session.display_name || session.username).replace(/\s*\(DỮ LIỆU MẪU\)/gi, '').slice(0, 1).toUpperCase()
              )}
            </div>
            <div className="user-meta">
              <strong>{(session.display_name || session.username).replace(/\s*\(DỮ LIỆU MẪU\)/gi, '')}</strong>
              <span
                className={`role-badge-pill role-badge-${session.role}`}
                style={{
                  width: 'fit-content',
                  maxWidth: 'fit-content',
                  alignSelf: 'flex-start',
                  display: 'inline-flex',
                  fontSize: '11px',
                  padding: '2.5px 8px',
                  letterSpacing: '0.01em',
                  lineHeight: '1.3',
                }}
              >
                {roleName[session.role]}
              </span>
            </div>
            <button
              className="logout"
              title="Đăng xuất"
              onClick={(e) => {
                e.stopPropagation()
                signOut()
              }}
              aria-label="Đăng xuất"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
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
                  owner={owners.find(o => o.id === vehicles.find(v => v.id === testingInspection.vehicle_id)?.owner_id)}
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
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 800 }}>Chưa chọn hồ sơ kiểm định</h3>
                  <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 20px 0' }}>Vui lòng chọn một phương tiện từ danh sách hồ sơ để vào chuyền đo kiểm và ghi kết quả kỹ thuật.</p>
                  <button className="button button-primary" onClick={() => navigate('inspections')}>
                    Đi đến Danh sách hồ sơ kiểm định
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

              {page === 'vehicles' && (
                <VehiclesPage
                  role={session.role}
                  vehicles={vehicles}
                  owners={owners}
                  onCreate={body => runAction(() => api.createVehicle(session.token, body), 'Đã thêm phương tiện mới.')}
                  onDelete={id => runAction(() => api.deleteVehicle(session.token, id), 'Đã xóa phương tiện thành công.')}
                />
              )}
              {page === 'owners' && (
                <OwnersPage
                  owners={owners}
                  vehicles={vehicles}
                  inspections={inspections}
                  certificates={certificates}
                  onCreate={body => runAction(() => api.createOwner(session.token, body), 'Đã tạo hồ sơ chủ xe.')}
                  onDelete={id => runAction(() => api.deleteOwner(session.token, id), 'Đã xóa hồ sơ chủ xe thành công.')}
                />
              )}
              {page === 'appointments' && (
                <AppointmentsPage
                  role={session.role}
                  vehicles={vehicles}
                  owners={owners}
                  appointments={appointments}
                  onCreate={body => runAction(() => api.createAppointment(session.token, body), 'Đã tạo lịch hẹn.')}
                  onCancel={id => runAction(() => api.cancelAppointment(session.token, id), 'Đã hủy lịch hẹn.')}
                />
              )}
              {page === 'inspections' && (
                <InspectionsPage
                  role={session.role}
                  vehicles={vehicles}
                  owners={owners}
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
              {page === 'roles' && <SystemRolesPage session={session} />}
              {page === 'audit-logs' && <AuditLogsPage session={session} />}
              {page === 'profile' && (
                <ProfilePage
                  session={session}
                  onProfileUpdated={(updatedProfile) => {
                    const newSession: Session = {
                      ...session,
                      display_name: updatedProfile.display_name,
                      email: updatedProfile.email,
                      phone: updatedProfile.phone,
                      avatar_url: updatedProfile.avatar_url,
                    }
                    setSession(newSession)
                    sessionStorage.setItem('inspection-session', JSON.stringify(newSession))
                    setNotice('Đã cập nhật thông tin cá nhân thành công!')
                  }}
                  onBack={() => navigate('overview')}
                />
              )}
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
          isOwner={session.role === 'owner'}
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
          owners={owners}
          isOwner={session.role === 'owner'}
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
          owner={owners.find(o => o.id === vehicles.find(v => v.id === activeInspectionForDetail.vehicle_id)?.owner_id)}
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
  inspection, vehicle, owner, token, role, onBack, runAction, onInspectionUpdated
}: {
  inspection: Inspection;
  vehicle?: Vehicle;
  owner?: Owner;
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
  const [issuedDate, setIssuedDate] = useState(() => getLocalDateString())
  const [expiryDate, setExpiryDate] = useState(() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() + 1)
    return getLocalDateString(d)
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
              {busy ? 'Đang chốt...' : 'Chốt checklist hoàn tất'}
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
              {showCertForm ? 'Đóng biểu mẫu GCN' : 'Phát hành Giấy chứng nhận & Tem'}
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
          <small>Chủ phương tiện</small>
          <strong>{owner?.display_name || '—'}</strong>
        </div>
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
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {isFinalized ? (
            <div className="form-warning" style={{ margin: '14px 0', padding: '16px', borderRadius: 10, background: '#f8fafc', border: '1px solid #cbd5e1' }}>
              <strong>Hồ sơ kiểm định đã hoàn tất chốt kết quả ({statusName[inspection.status]}).</strong>
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
                    <span>ĐẠT</span>
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
                  {busy ? 'Đang lưu kết quả...' : 'Lưu kết quả công đoạn này'}
                </button>
              </div>
            </form>
          )}

          {/* Inline Certificate Form when Passed */}
          {showCertForm && inspection.status === 'passed' && (
            <div className="cert-inline-card">
              <h3>Biểu mẫu phát hành Giấy chứng nhận & Tem kiểm định</h3>
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
                        Tạo số
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
                        Tạo số
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
                          setExpiryDate(getLocalDateString(d))
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
            <span style={{ color: '#047857' }}>{passCount} Đạt</span>
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
                {busy ? 'Đang tổng hợp...' : 'Chốt checklist hoàn tất kiểm định'}
              </button>
            </div>
          )}

          {/* Finalized Banner */}
          {isFinalized && (
            <div style={{ marginTop: 20, padding: 18, borderRadius: 12, background: inspection.status === 'passed' ? '#ecfdf5' : '#fff1f2', border: `1px solid ${inspection.status === 'passed' ? '#a7f3d0' : '#fecdd3'}` }}>
              <strong style={{ color: inspection.status === 'passed' ? '#065f46' : '#9f1239', fontSize: 15, display: 'block', marginBottom: 4 }}>
                {inspection.status === 'passed' ? 'Kết luận: PHƯƠNG TIỆN ĐẠT TIÊU CHUẨN' : 'Kết luận: PHƯƠNG TIỆN KHÔNG ĐẠT TIÊU CHUẨN'}
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
   REUSABLE TABLE PAGINATION BAR
   ========================================================================== */
function TablePagination({
  currentPage,
  totalItems,
  pageSize = 10,
  onPageChange,
  itemName = 'mục',
}: {
  currentPage: number
  totalItems: number
  pageSize?: number
  onPageChange: (page: number) => void
  itemName?: string
}) {
  const totalPages = Math.ceil(totalItems / pageSize) || 1
  if (totalItems === 0) return null

  const startItem = (currentPage - 1) * pageSize + 1
  const endItem = Math.min(currentPage * pageSize, totalItems)

  const pages: (number | string)[] = Array.from({ length: totalPages }, (_, idx) => idx + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
    .reduce<(number | string)[]>((acc, p, i, arr) => {
      if (i > 0 && p - (arr[i - 1] as number) > 1) {
        acc.push('...')
      }
      acc.push(p)
      return acc
    }, [])

  return (
    <div className="table-pagination-bar">
      <div className="table-pagination-info">
        Hiển thị <strong>{startItem}</strong> - <strong>{endItem}</strong> trên tổng số <strong>{totalItems}</strong> {itemName}
      </div>
      <div className="table-pagination-controls">
        {pages.map((p, idx) =>
          p === '...' ? (
            <span key={`ellipsis-${idx}`} className="pagination-ellipsis">…</span>
          ) : (
            <button
              key={`page-${p}`}
              type="button"
              className={`pagination-btn ${p === currentPage ? 'active' : ''}`}
              onClick={() => onPageChange(p as number)}
            >
              {p}
            </button>
          )
        )}
      </div>
    </div>
  )
}

/* ==========================================================================
   ROLE WORKSPACE 1: QUẢN TRỊ VIÊN (ADMIN DASHBOARD)
   ========================================================================== */
function AdminOverview({
  vehicles, appointments, inspections, navigate, onOpenDetail
}: {
  session?: Session; owners?: Owner[]; vehicles: Vehicle[]; appointments: Appointment[]; inspections: Inspection[];
  navigate: (p: Page) => void; onOpenDetail: (i: Inspection) => void;
}) {
  const today = getLocalDateString()
  const todayAppointments = appointments.filter(i => i.appointment_date === today && i.status === 'active')
  const passed = inspections.filter(i => i.status === 'passed').length
  const failed = inspections.filter(i => i.status === 'failed').length
  const activeInProcess = inspections.filter(i => ['received', 'in_progress', 'needs_documents'].includes(i.status)).length
  const totalDecided = passed + failed
  const passRate = totalDecided > 0 ? Math.round((passed / totalDecided) * 100) : 100
  
  // Pagination: 10 records per page for Recent Inspections
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10

  const sortedInspections = useMemo(() => {
    return [...inspections].sort((a, b) => b.received_at.localeCompare(a.received_at))
  }, [inspections])

  const totalPages = Math.ceil(sortedInspections.length / pageSize) || 1
  const paginatedInspections = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return sortedInspections.slice(start, start + pageSize)
  }, [sortedInspections, currentPage])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(Math.max(1, totalPages))
    }
  }, [currentPage, totalPages])

  return (
    <>
      <div className="role-workspace-banner">
        <div>
          <h1>Trung Tâm Điều Hành & Giám Sát</h1>
        </div>
      </div>

      <section className="stat-grid">
        <StatCard label="Tỷ lệ Đạt chuẩn (Pass Rate)" value={passRate} hint={`${passed} đạt / ${totalDecided} đã chốt`} tone="green" isPercent />
        <StatCard label="Tổng phương tiện quản lý" value={vehicles.length} hint="Dữ liệu xe trong hệ thống" tone="blue" />
        <StatCard label="Hồ sơ đang xử lý" value={activeInProcess} hint="Trên chuyền & tại quầy" tone="orange" />
        <StatCard label="Lịch hẹn hôm nay" value={todayAppointments.length} hint="Khách hẹn đang hiệu lực" tone="purple" />
      </section>

      {/* Process Flow Pipeline */}
      <section
        className="panel"
        style={{
          marginBottom: 14,
          padding: 8,
          background: '#ffffff',
          borderRadius: 10,
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          {/* Stage 1: Tiếp nhận */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#e2e8f0',
                  color: '#475569',
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                1
              </span>
              <div style={{ minWidth: 0, lineHeight: 1.25 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Tiếp nhận hồ sơ
                </div>
                <div style={{ fontSize: 10.5, color: '#64748b', whiteSpace: 'nowrap' }}>
                  Chờ chuyển dây chuyền
                </div>
              </div>
            </div>
            <span
              style={{
                minWidth: 24,
                height: 22,
                padding: '0 7px',
                borderRadius: 11,
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                color: '#0f172a',
                fontSize: 13,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {inspections.filter(i => i.status === 'received').length}
            </span>
          </div>

          {/* Stage 2: Đang kiểm định */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#e2e8f0',
                  color: '#475569',
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                2
              </span>
              <div style={{ minWidth: 0, lineHeight: 1.25 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Đang kiểm định
                </div>
                <div style={{ fontSize: 10.5, color: '#64748b', whiteSpace: 'nowrap' }}>
                  Đang đo 5 công đoạn
                </div>
              </div>
            </div>
            <span
              style={{
                minWidth: 24,
                height: 22,
                padding: '0 7px',
                borderRadius: 11,
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                color: '#0f172a',
                fontSize: 13,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {inspections.filter(i => i.status === 'in_progress').length}
            </span>
          </div>

          {/* Stage 3: Đạt tiêu chuẩn */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#e2e8f0',
                  color: '#475569',
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                3
              </span>
              <div style={{ minWidth: 0, lineHeight: 1.25 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Đạt tiêu chuẩn
                </div>
                <div style={{ fontSize: 10.5, color: '#64748b', whiteSpace: 'nowrap' }}>
                  Đã cấp/chờ cấp GCN
                </div>
              </div>
            </div>
            <span
              style={{
                minWidth: 24,
                height: 22,
                padding: '0 7px',
                borderRadius: 11,
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                color: '#0f172a',
                fontSize: 13,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {passed}
            </span>
          </div>

          {/* Stage 4: Không đạt */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#e2e8f0',
                  color: '#475569',
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                4
              </span>
              <div style={{ minWidth: 0, lineHeight: 1.25 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Không đạt (Lỗi Ma/DD)
                </div>
                <div style={{ fontSize: 10.5, color: '#64748b', whiteSpace: 'nowrap' }}>
                  Cần khắc phục kỹ thuật
                </div>
              </div>
            </div>
            <span
              style={{
                minWidth: 24,
                height: 22,
                padding: '0 7px',
                borderRadius: 11,
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                color: '#0f172a',
                fontSize: 13,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {failed}
            </span>
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
        {sortedInspections.length ? (
          <>
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
                  {paginatedInspections.map(item => (
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

            {/* Pagination Controls */}
            <TablePagination
              currentPage={currentPage}
              totalItems={sortedInspections.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              itemName="hồ sơ"
            />
          </>
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
  const today = getLocalDateString()
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
          <div className="role-badge-pill role-badge-intake">Nhân viên tiếp nhận: {session.username} · Bàn đón tiếp</div>
          <h1>Bàn Tiếp Nhận & Điều Phối Hồ Sơ</h1>
          <p>Tiếp đón chủ phương tiện, đối chiếu hồ sơ giấy tờ, sắp xếp lịch hẹn và mở hồ sơ kiểm định.</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className={`shift-pill ${isMorning ? 'shift-morning' : 'shift-afternoon'}`}>
            {isMorning ? 'Ca làm việc Sáng: 06:30 – 11:00' : 'Ca làm việc Chiều: 13:00 – 17:30'}
          </span>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            Hôm nay: {formatDate(today)}
          </div>
        </div>
      </div>

      {/* Quick Action Strip */}
      <div className="quick-action-strip">
        <button className="quick-action-btn quick-action-btn-primary" onClick={() => onStartIntake()}>
          Tiếp nhận hồ sơ mới
        </button>
        <button className="quick-action-btn" onClick={onOpenOwnerModal}>
          Thêm hồ sơ chủ xe
        </button>
        <button className="quick-action-btn" onClick={onOpenVehicleModal}>
          Đăng ký phương tiện
        </button>
        <button className="quick-action-btn" onClick={onOpenAppointmentModal}>
          Đặt lịch hẹn mới
        </button>
      </div>

      <section className="stat-grid">
        <StatCard label="Khách hẹn hôm nay" value={activeTodayApt.length} hint="Cần đón tiếp trong ca" tone="blue" />
        <StatCard label="Hồ sơ mới tiếp nhận" value={receivedCount} hint="Đang chờ vào chuyền" tone="green" />
        <StatCard label="Hồ sơ thiếu chứng từ" value={needsDocsCount} hint="Chờ bổ sung giấy tờ" tone="orange" />
        <StatCard label="Tổng chủ xe quản lý" value={owners.length} hint="Hồ sơ khách hàng" tone="purple" />
      </section>

      {/* Today's Appointments Desk */}
      <section className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-heading">
          <div>
            <h3>Khách hẹn hôm nay cần đón tiếp ({activeTodayApt.length})</h3>
            <p>Đối chiếu biển số xe và bấm "Tiếp nhận ngay" khi khách có mặt tại quầy</p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="button button-outline button-sm" onClick={() => navigate('appointments')}>
              Xem tất cả lịch hẹn ({appointments.length})
            </button>
            <button className="button button-outline button-sm" onClick={onOpenAppointmentModal}>Thêm lịch hẹn</button>
          </div>
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
                          Tiếp nhận ngay
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
          <Empty title="Chưa có khách hẹn trong ngày hôm nay" detail="Bấm 'Đặt lịch hẹn mới' nếu có khách đặt lịch tại quầy hoặc qua điện thoại." />
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
  const today = getLocalDateString()
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
          <div className="role-badge-pill role-badge-inspector">Kiểm định viên: {session.username} · Buồng điều khiển</div>
          <h1>Dây Chuyền Đo Kiểm Kỹ Thuật</h1>
          <p>Kiểm tra 5 công đoạn quy chuẩn, ghi nhận thông số ({todayAptCount} xe có hẹn hôm nay), đánh giá khiếm khuyết và chốt kết quả.</p>
        </div>
        <div>
          <span className="live-state" style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' }}>
            Dây chuyền trực tuyến
          </span>
        </div>
      </div>

      <section className="stat-grid">
        <StatCard label="Xe đang trên dây chuyền" value={inProgress.length} hint="Đang tiến hành đo kiểm" tone="orange" />
        <StatCard label="Chờ vào kiểm tra" value={waitingTest.length} hint="Hồ sơ mới chuyển sang" tone="blue" />
        <StatCard label="Phương tiện ĐẠT" value={passedCount} hint="Đủ điều kiện cấp GCN" tone="green" />
        <StatCard label="Có khiếm khuyết (Ma/DD)" value={failedCount} hint="Không đạt tiêu chuẩn" tone="red" />
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
          <div className="role-badge-pill role-badge-owner">Chủ phương tiện: {session.username} · Cổng dịch vụ</div>
          <h1>Cổng Dịch Vụ Chủ Xe & Doanh Nghiệp</h1>
          <p>Quản lý phương tiện sở hữu, theo dõi tiến độ hồ sơ và đặt lịch kiểm định thuận tiện.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="button button-primary" onClick={onOpenAppointmentModal}>Đặt lịch đăng kiểm mới</button>
        </div>
      </div>

      <section className="stat-grid">
        <StatCard label="Phương tiện của tôi" value={vehicles.length} hint="Xe đã đăng ký" tone="blue" />
        <StatCard label="Lịch hẹn đang hiệu lực" value={activeAppointments.length} hint="Lịch đăng kiểm sắp tới" tone="orange" />
        <StatCard label="Hồ sơ đã kiểm định" value={inspections.length} hint="Lịch sử đăng kiểm" tone="green" />
        <StatCard label="Hồ sơ Đạt tiêu chuẩn" value={inspections.filter(i => i.status === 'passed').length} hint="Đã được cấp chứng nhận" tone="purple" />
      </section>

      {/* My Vehicles */}
      <section className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-heading">
          <div>
            <h3>Danh sách phương tiện của tôi</h3>
            <p>Các phương tiện thuộc quyền quản lý của tài khoản</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="text-button" onClick={() => navigate('vehicles')}>Xem chi tiết xe <span>→</span></button>
          </div>
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
                        Đặt lịch cho xe này
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
          <Empty title="Bạn chưa có lịch hẹn đăng kiểm nào" detail="Bấm 'Đặt lịch đăng kiểm mới' để chủ động chọn ngày và khung giờ." />
        )}
      </section>
    </>
  )
}

function StatCard({ label, value, hint, tone, isPercent }: { label: string; value: number; hint: string; tone: string; isPercent?: boolean }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value.toLocaleString('vi-VN')}{isPercent ? '%' : ''}</div>
      <div className="stat-hint">{hint}</div>
      <div className={`stat-accent ${tone}`}/>
    </div>
  )
}

/* ==========================================================================
   LOGIN SCREEN WITH QUICK DEMO ACCESS & DEDICATED FORGOT PASSWORD VIEW
   ========================================================================== */
function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Registration fields (defaults to Owner role)
  const [displayName, setDisplayName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [identity, setIdentity] = useState('')
  const [address, setAddress] = useState('')

  // Forgot password fields
  const [forgotStep, setForgotStep] = useState<'email' | 'otp' | 'success'>('email')
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotAccountUsername, setForgotAccountUsername] = useState('')
  const [forgotOtp, setForgotOtp] = useState('')
  const [otpVerified, setOtpVerified] = useState(false)
  const [forgotNewPassword, setForgotNewPassword] = useState('')
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('')
  const [forgotShowPassword, setForgotShowPassword] = useState(false)
  const [forgotBusy, setForgotBusy] = useState(false)

  async function handleSendOtp(e?: FormEvent) {
    if (e) e.preventDefault()
    const clean = forgotEmail.trim().toLowerCase()
    if (!clean || !clean.includes('@')) {
      setError('Vui lòng nhập định dạng email hợp lệ (Ví dụ: user@kiemdinh.vn).')
      return
    }
    setForgotBusy(true)
    setError('')
    try {
      const res = await sendForgotPasswordOtp(clean)
      setForgotAccountUsername(res.username || '')
      setOtpVerified(false)
      setForgotOtp('')
      setForgotNewPassword('')
      setForgotConfirmPassword('')
      setForgotStep('otp')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể gửi mã xác nhận.')
    } finally {
      setForgotBusy(false)
    }
  }

  async function handleCheckOtp(e?: FormEvent) {
    if (e) e.preventDefault()
    setError('')
    const cleanOtp = forgotOtp.trim()
    if (cleanOtp.length < 6) {
      setError('Vui lòng nhập đủ mã xác nhận gồm 6 chữ số.')
      return
    }
    setForgotBusy(true)
    try {
      await verifyOtpOnly({
        email: forgotEmail.trim().toLowerCase(),
        otp_code: cleanOtp,
      })
      setOtpVerified(true)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mã xác nhận không đúng hoặc đã hết hạn.')
    } finally {
      setForgotBusy(false)
    }
  }

  async function handleVerifyAndReset(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!forgotOtp.trim()) {
      setError('Vui lòng nhập mã xác nhận gồm 6 chữ số.')
      return
    }
    if (forgotNewPassword.length < 6) {
      setError('Mật khẩu mới phải có ít nhất 6 ký tự.')
      return
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setError('Mật khẩu xác nhận không trùng khớp.')
      return
    }

    setForgotBusy(true)
    try {
      await verifyOtpAndResetPassword({
        email: forgotEmail.trim().toLowerCase(),
        otp_code: forgotOtp.trim(),
        new_password: forgotNewPassword,
      })
      setForgotStep('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xác thực mã hoặc đổi mật khẩu thất bại.')
    } finally {
      setForgotBusy(false)
    }
  }

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
      if (reason instanceof ApiError) {
        if (reason.status === 403 || reason.message.includes('khóa')) {
          setError(reason.message || 'Tài khoản của bạn đang bị khóa.')
          return
        }
        if (reason.status === 401) {
          setError('Tên đăng nhập hoặc mật khẩu không đúng.')
          return
        }
      }
      setError(reason instanceof Error ? reason.message : 'Không thể đăng nhập')
    } finally {
      setBusy(false)
    }
  }

  async function submitRegister(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
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
    if (!regEmail.trim()) {
      setError('Vui lòng nhập địa chỉ email.')
      setBusy(false)
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail.trim())) {
      setError('Định dạng email không hợp lệ (Ví dụ: chuxe@gmail.com).')
      setBusy(false)
      return
    }
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
    if (!identity.trim()) {
      setError('Vui lòng nhập số CCCD hoặc Mã số thuế.')
      setBusy(false)
      return
    }
    try {
      const session = await apiRegister({
        username: username.trim(),
        password,
        display_name: displayName.trim(),
        email: regEmail.trim().toLowerCase(),
        phone: phone.trim(),
        identity_or_tax_number: identity.trim(),
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
    setPassword('123')
    setShowPassword(false)
    setError('')
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
        {authMode === 'forgot' ? (
          <div className="login-form-wrap" style={{ width: 'min(460px, 100%)' }}>
            <div style={{ marginBottom: '18px' }}>
              <button
                type="button"
                style={{
                  background: '#f8fafc',
                  border: '1.5px solid #2563eb',
                  color: '#2563eb',
                  cursor: 'pointer',
                  padding: '8px 18px',
                  borderRadius: '8px',
                  fontSize: '13.5px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  boxShadow: '0 2px 6px rgba(37, 99, 235, 0.12)',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#2563eb'
                  e.currentTarget.style.color = '#ffffff'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#f8fafc'
                  e.currentTarget.style.color = '#2563eb'
                }}
                onClick={() => { setAuthMode('login'); setOtpVerified(false); setError('') }}
              >
                Quay lại Đăng nhập
              </button>
            </div>
            <h2>Khôi phục mật khẩu</h2>
              {forgotStep !== 'email' && (
                <p className="login-subtitle">
                  {forgotStep === 'otp'
                    ? (otpVerified
                        ? `Mã xác nhận hợp lệ! Vui lòng nhập mật khẩu mới cho tài khoản ${forgotEmail}.`
                        : `Đã gửi mã xác nhận đến ${forgotEmail}. Vui lòng nhập mã và bấm Kiểm tra mã xác nhận.`)
                    : 'Mật khẩu đã được cập nhật thành công!'}
                </p>
              )}

              {forgotStep === 'email' && (
                <form onSubmit={e => void handleSendOtp(e)}>
                  <label>
                    Email đăng ký tài khoản *
                    <div className="input-wrap">
                      <input
                        type="email"
                        value={forgotEmail}
                        onChange={e => setForgotEmail(e.target.value)}
                        placeholder="VD: admin@kiemdinh.gov.vn hoặc chuxe@gmail.com"
                        required
                        autoFocus
                      />
                    </div>
                  </label>

                  {error && <div className="form-error">{error}</div>}

                  <button className="button button-primary login-submit" disabled={forgotBusy} type="submit">
                    {forgotBusy ? 'Đang gửi mã...' : 'Gửi mã xác nhận →'}
                  </button>

                  <div className="switch-auth-link">
                    Đã nhớ mật khẩu?{' '}
                    <button type="button" onClick={() => { setAuthMode('login'); setOtpVerified(false); setError('') }}>
                      Đăng nhập tại đây
                    </button>
                  </div>
                </form>
              )}

              {forgotStep === 'otp' && !otpVerified && (
                <form onSubmit={e => void handleCheckOtp(e)}>
                  <div style={{ marginBottom: '14px', fontSize: '13px', background: '#eff6ff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #bfdbfe', color: '#1e40af' }}>
                    {forgotAccountUsername ? (
                      <div style={{ fontWeight: 600 }}>Tài khoản xác nhận: <span style={{ color: '#1d4ed8' }}>@{forgotAccountUsername}</span></div>
                    ) : null}
                    <div style={{ fontSize: '12.5px', color: '#3b82f6', marginTop: forgotAccountUsername ? '3px' : '0' }}>
                      Email nhận mã: <strong>{forgotEmail}</strong>
                    </div>
                  </div>

                  <label>
                    Mã xác nhận (6 chữ số) *
                    <div className="input-wrap" style={{ position: 'relative' }}>
                      <input
                        type="text"
                        maxLength={6}
                        value={forgotOtp}
                        onChange={e => setForgotOtp(e.target.value.replace(/\D/g, ''))}
                        placeholder="VD: 123456"
                        style={{
                          fontSize: '18px',
                          letterSpacing: '5px',
                          paddingLeft: '16px',
                          paddingRight: '118px',
                          fontWeight: 'bold',
                        }}
                        required
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => void handleSendOtp()}
                        disabled={forgotBusy}
                        style={{
                          position: 'absolute',
                          right: '7px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: '#f1f5f9',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          color: '#2563eb',
                          fontSize: '12px',
                          fontWeight: 600,
                          padding: '6px 10px',
                          cursor: forgotBusy ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          whiteSpace: 'nowrap',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={e => {
                          if (!forgotBusy) {
                            e.currentTarget.style.background = '#eff6ff'
                            e.currentTarget.style.borderColor = '#93c5fd'
                          }
                        }}
                        onMouseLeave={e => {
                          if (!forgotBusy) {
                            e.currentTarget.style.background = '#f1f5f9'
                            e.currentTarget.style.borderColor = '#cbd5e1'
                          }
                        }}
                        title="Gửi lại mã xác nhận mới đến email"
                      >
                        ↻ Gửi lại mã
                      </button>
                    </div>
                  </label>

                  <div style={{ margin: '8px 0 14px', fontSize: '13px', color: '#0369a1', background: '#e0f2fe', padding: '10px 14px', borderRadius: '8px', lineHeight: 1.5 }}>
                    📬 Mã xác nhận 6 chữ số đã được gửi đến email. Vui lòng kiểm tra hộp thư đến (hoặc mục Thư rác/Spam) và nhập mã vào ô trên để kiểm tra.
                  </div>

                  {error && <div className="form-error">{error}</div>}

                  <button className="button button-primary login-submit" disabled={forgotBusy || forgotOtp.trim().length < 6} type="submit">
                    {forgotBusy ? 'Đang kiểm tra mã...' : 'Kiểm tra mã xác nhận →'}
                  </button>
                </form>
              )}

              {forgotStep === 'otp' && otpVerified && (
                <form onSubmit={e => void handleVerifyAndReset(e)}>
                  <div style={{ marginBottom: '14px', fontSize: '13px', background: '#ecfdf5', padding: '10px 14px', borderRadius: '8px', border: '1px solid #a7f3d0', color: '#065f46', lineHeight: 1.5 }}>
                    <div style={{ fontWeight: 700, fontSize: '13.5px' }}>✓ Mã xác nhận chính xác ({forgotOtp})</div>
                    <div style={{ fontSize: '12.5px', color: '#047857', marginTop: '3px' }}>
                      {forgotAccountUsername ? (
                        <>Đang đổi mật khẩu cho tài khoản: <strong>@{forgotAccountUsername}</strong></>
                      ) : (
                        <>Đang đổi mật khẩu cho email: <strong>{forgotEmail}</strong></>
                      )}
                    </div>
                  </div>

                  <label>
                    Mật khẩu mới *
                    <div className="input-wrap">
                      <input
                        type={forgotShowPassword ? 'text' : 'password'}
                        value={forgotNewPassword}
                        onChange={e => setForgotNewPassword(e.target.value)}
                        placeholder="Tối thiểu 6 ký tự"
                        required
                        autoFocus
                      />
                      <button
                        type="button"
                        className="password-toggle-btn"
                        onClick={() => setForgotShowPassword(v => !v)}
                        title={forgotShowPassword ? "Ẩn mật khẩu" : "Xem mật khẩu"}
                        aria-label={forgotShowPassword ? "Ẩn mật khẩu" : "Xem mật khẩu"}
                        tabIndex={-1}
                      >
                        {forgotShowPassword ? (
                          <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </label>

                  <label>
                    Nhập lại mật khẩu mới *
                    <div className="input-wrap">
                      <input
                        type={forgotShowPassword ? 'text' : 'password'}
                        value={forgotConfirmPassword}
                        onChange={e => setForgotConfirmPassword(e.target.value)}
                        placeholder="Xác nhận mật khẩu mới"
                        required
                      />
                    </div>
                  </label>

                  {error && <div className="form-error">{error}</div>}

                  <button className="button button-primary login-submit" disabled={forgotBusy} type="submit">
                    {forgotBusy ? 'Đang đổi mật khẩu...' : 'Xác nhận đổi mật khẩu'}
                  </button>
                </form>
              )}

              {forgotStep === 'success' && (
                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                  <div style={{ width: '60px', height: '60px', background: '#dcfce7', color: '#16a34a', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '28px' }}>
                    ✓
                  </div>
                  <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>Đổi mật khẩu thành công!</h3>
                  <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '24px' }}>
                    Tài khoản của bạn đã được cập nhật mật khẩu mới. Vui lòng đăng nhập để tiếp tục làm việc.
                  </p>
                  <button
                    type="button"
                    className="button button-primary login-submit"
                    onClick={() => {
                      if (forgotAccountUsername) {
                        setUsername(forgotAccountUsername)
                      }
                      setPassword(forgotNewPassword)
                      setShowPassword(true)
                      setAuthMode('login')
                      setForgotStep('email')
                      setOtpVerified(false)
                      setForgotOtp('')
                      setForgotNewPassword('')
                      setForgotConfirmPassword('')
                      setError('')
                    }}
                  >
                    Đăng nhập ngay với mật khẩu mới →
                  </button>
                </div>
              )}
          </div>
        ) : (
          <div className="login-form-wrap" style={authMode === 'register' ? { width: 'min(460px, 100%)' } : undefined}>
            {/* Mode Switcher Tabs - Chỉ hiển thị Đăng nhập và Đăng ký */}
            <div className="auth-mode-tabs">
              <button
                type="button"
                className={`auth-mode-tab ${authMode === 'login' ? 'active' : ''}`}
                onClick={() => { setAuthMode('login'); setError('') }}
              >
                Đăng nhập
              </button>
              <button
                type="button"
                className={`auth-mode-tab ${authMode === 'register' ? 'active' : ''}`}
                onClick={() => { setAuthMode('register'); setError('') }}
              >
                Đăng ký Chủ xe
              </button>
            </div>

            {authMode === 'login' ? (
            <>
              <div className="eyebrow">CỔNG HỆ THỐNG</div>
              <h2>Chào mừng trở lại</h2>
              <p className="login-subtitle">Đăng nhập để vào không gian làm việc chuyên biệt theo vai trò.</p>
              
              <form onSubmit={e => void submitLogin(e)}>
                <label>
                  Tên đăng nhập
                  <div className="input-wrap">
                    <input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="Nhập tên đăng nhập" required/>
                  </div>
                </label>
                <label>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                    <span>Mật khẩu</span>
                    <button
                      type="button"
                      className="forgot-password-link"
                      onClick={() => { setAuthMode('forgot'); setError('') }}
                    >
                      Quên mật khẩu?
                    </button>
                  </div>
                  <div className="input-wrap">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Nhập mật khẩu"
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowPassword(v => !v)}
                      title={showPassword ? "Ẩn mật khẩu" : "Xem mật khẩu"}
                      aria-label={showPassword ? "Ẩn mật khẩu" : "Xem mật khẩu"}
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </label>
                {error && <div className="form-error">{error}</div>}
                <button className="button button-primary login-submit" disabled={busy}>
                  {busy ? 'Đang xác thực...' : 'Đăng nhập'}
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
                  <button type="button" className="demo-pill-btn demo-pill-admin" onClick={() => quickLogin('admin')}>
                    <strong>Quản trị viên</strong>
                    <small>admin</small>
                  </button>
                  <button type="button" className="demo-pill-btn demo-pill-intake" onClick={() => quickLogin('tiepnhanhoso')}>
                    <strong>Tiếp nhận hồ sơ</strong>
                    <small>tiepnhanhoso</small>
                  </button>
                  <button type="button" className="demo-pill-btn demo-pill-inspector" onClick={() => quickLogin('kiemdinhvien')}>
                    <strong>Kiểm định viên</strong>
                    <small>kiemdinhvien</small>
                  </button>
                  <button type="button" className="demo-pill-btn demo-pill-owner" onClick={() => quickLogin('chuxe')}>
                    <strong>Chủ xe</strong>
                    <small>chuxe</small>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="eyebrow">DỊCH VỤ DÀNH CHO KHÁCH HÀNG</div>
              <h2>Đăng ký tài khoản</h2>
              <p className="login-subtitle">
                Đăng ký để quản lý phương tiện cá nhân, đặt lịch hẹn kiểm định và tra cứu kết quả trực tuyến.
              </p>

              <form onSubmit={e => void submitRegister(e)}>
                <div className="form-row-two">
                  <label>
                    Họ và tên chủ xe *
                    <div className="input-wrap">
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
                      <input
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        placeholder="VD: 0912345678"
                        required
                      />
                    </div>
                  </label>
                </div>

                <label>
                  Email *
                  <div className="input-wrap">
                    <input
                      type="email"
                      value={regEmail}
                      onChange={e => setRegEmail(e.target.value)}
                      placeholder="VD: an.nguyen@gmail.com"
                      required
                    />
                  </div>
                </label>

                <div className="form-row-two">
                  <label>
                    Tên đăng nhập *
                    <div className="input-wrap">
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
                      <input
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="Tối thiểu 6 ký tự"
                        required
                      />
                      <button
                        type="button"
                        className="password-toggle-btn"
                        onClick={() => setShowPassword(v => !v)}
                        title={showPassword ? "Ẩn mật khẩu" : "Xem mật khẩu"}
                        aria-label={showPassword ? "Ẩn mật khẩu" : "Xem mật khẩu"}
                        tabIndex={-1}
                      >
                        {showPassword ? (
                          <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </label>
                </div>

                <div className="form-row-two">
                  <label>
                    Số CCCD / Mã số thuế *
                    <div className="input-wrap">
                      <input
                        value={identity}
                        onChange={e => setIdentity(e.target.value)}
                        placeholder="VD: 001201012345 hoặc MST"
                        required
                      />
                    </div>
                  </label>
                  <label>
                    Địa chỉ liên hệ
                    <div className="input-wrap">
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
      )}
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
            Quay về Bàn làm việc
          </button>
          <button type="button" className="button button-secondary" onClick={onSignOut}>
            Đổi tài khoản khác
          </button>
        </div>
        <div className="forbidden-footer-tip">
          Vui lòng liên hệ <strong>Quản trị viên</strong> nếu bạn cần được cấp quyền truy cập.
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   SUPPORT CHAT ASSISTANT
   ========================================================================== */
function SupportChat({
  session,
  onSignOut,
  isOpen,
  onToggle,
  onClose,
}: {
  session: Session
  onSignOut?: () => void
  isOpen?: boolean
  onToggle?: () => void
  onClose?: () => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = isOpen !== undefined ? isOpen : internalOpen
  const setOpen = useCallback(
    (action: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof action === 'function' ? action(open) : action
      if (!next && onClose) {
        onClose()
      } else if (onToggle && next !== open) {
        onToggle()
      }
      setInternalOpen(next)
    },
    [open, onToggle, onClose]
  )

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Draggable position state (Default: right 28px, bottom 92px - safely above table pagination)
  const [pos, setPos] = useState<{ right: number; bottom: number }>(() => {
    try {
      const saved = localStorage.getItem('support-chat-pos')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (typeof parsed.right === 'number' && typeof parsed.bottom === 'number') {
          return parsed
        }
      }
    } catch {}
    return { right: 28, bottom: 92 }
  })

  const draggingRef = useRef(false)
  const dragStartRef = useRef<{ startX: number; startY: number; initRight: number; initBottom: number }>({
    startX: 0,
    startY: 0,
    initRight: 28,
    initBottom: 92,
  })
  const hasMovedRef = useRef(false)

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    draggingRef.current = true
    hasMovedRef.current = false
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initRight: pos.right,
      initBottom: pos.bottom,
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current) return
    const dx = e.clientX - dragStartRef.current.startX
    const dy = e.clientY - dragStartRef.current.startY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      hasMovedRef.current = true
    }
    const newRight = Math.max(12, Math.min(window.innerWidth - 68, dragStartRef.current.initRight - dx))
    const newBottom = Math.max(16, Math.min(window.innerHeight - 76, dragStartRef.current.initBottom - dy))
    setPos({ right: newRight, bottom: newBottom })
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}
    if (hasMovedRef.current) {
      localStorage.setItem('support-chat-pos', JSON.stringify(pos))
    } else {
      setOpen(v => !v)
    }
  }

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
    <div className="support-chat-root" style={{ right: `${pos.right}px`, bottom: `${pos.bottom}px` }}>
      {open && (
        <section className="support-chat-panel" aria-label="Trợ lý đăng kiểm">
          <header className="support-chat-header">
            <span className="support-chat-avatar">✨</span>
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
      <button
        type="button"
        className={`support-chat-toggle ${open ? 'is-open' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        aria-label={open ? 'Đóng trợ lý' : 'Mở trợ lý'}
        title="Trợ lý ảo AI đăng kiểm (Có thể kéo thả vị trí)"
      >
        {open ? (
          <span className="support-chat-close-icon">×</span>
        ) : (
          <svg className="support-chat-star-icon" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M12 2C12 7.523 7.523 12 2 12C7.523 12 12 16.477 12 22C12 16.477 16.477 12 22 12C16.477 12 12 7.523 12 2Z" />
          </svg>
        )}
      </button>
    </div>
  )
}


/* ==========================================================================
   STANDARD CRUD PAGES (VEHICLES, OWNERS, APPOINTMENTS, INSPECTIONS)
   ========================================================================== */
function VehiclesPage({
  role,
  vehicles,
  owners,
  onCreate,
  onDelete,
}: {
  role: Role;
  vehicles: Vehicle[];
  owners: Owner[];
  onCreate: (body: Omit<Vehicle, 'id'> | (Omit<Vehicle, 'id' | 'owner_id'> & { owner_id?: number })) => Promise<void>;
  onDelete?: (id: number) => Promise<void>;
}) {
  const [query, setQuery] = useState(''); const [open, setOpen] = useState(false)
  const [deletingVehicle, setDeletingVehicle] = useState<Vehicle | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const isOwner = role === 'owner'
  const filtered = vehicles.filter(v => `${v.registration_number} ${v.chassis_number} ${v.engine_number} ${v.vehicle_type}`.toLowerCase().includes(query.toLowerCase()))

  // Pagination: 10 items per page
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(Math.max(1, totalPages));
    }
  }, [currentPage, totalPages]);

  return <>
    <PageHeading
      eyebrow={isOwner ? "QUẢN LÝ PHƯƠNG TIỆN" : "DỮ LIỆU NỀN"}
      title={isOwner ? "Xe của tôi" : "Phương tiện"}
      description={isOwner ? "Danh sách phương tiện bạn sở hữu trong hệ thống đăng kiểm." : "Thông tin phương tiện được quản lý trong hệ thống đăng kiểm."}
      action={(canIntake(role) || isOwner) ? <button className="button button-primary" onClick={() => setOpen(true)}>Thêm phương tiện</button> : undefined}
    />
    <div className="toolbar">
      <div className="search-box">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm theo biển số, loại xe, số khung, số máy..."/>
      </div>
      <span className="result-count">{filtered.length} phương tiện</span>
    </div>
    <section className="panel list-panel vehicles-panel">
      {filtered.length ? (
        <>
          <div className="table-wrap">
            <table className="vehicles-table">
              <thead>
                <tr>
                  <th>BIỂN SỐ</th>
                  <th>LOẠI PHƯƠNG TIỆN</th>
                  <th>SỐ KHUNG</th>
                  <th>SỐ MÁY</th>
                  {!isOwner && <th>CHỦ XE</th>}
                  {onDelete && <th style={{ textAlign: 'right' }}>THAO TÁC</th>}
                </tr>
              </thead>
              <tbody>
                {paginated.map(v => (
                  <tr key={v.id}>
                    <td><span className="plate plate-large">{v.registration_number}</span></td>
                    <td className="vehicle-type-cell">{v.vehicle_type}</td>
                    <td><span className="mono vehicle-code-cell">{v.chassis_number}</span></td>
                    <td><span className="mono vehicle-code-cell">{v.engine_number}</span></td>
                    {!isOwner && (
                      <td className="vehicle-owner-cell">
                        <strong>{owners.find(o => o.id === v.owner_id)?.display_name ?? `Chủ xe #${v.owner_id}`}</strong>
                      </td>
                    )}
                    {onDelete && (
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          className="button button-ghost button-sm"
                          style={{
                            color: '#dc2626',
                            border: '1px solid #fecaca',
                            backgroundColor: '#fef2f2',
                            padding: '4px 12px',
                            borderRadius: '6px',
                            fontSize: '12.5px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                          onClick={() => setDeletingVehicle(v)}
                          title="Xóa phương tiện"
                        >
                          Xóa
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <TablePagination
            currentPage={currentPage}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            itemName="phương tiện"
          />
        </>
      ) : (
        <Empty
          title="Không tìm thấy phương tiện"
          detail={query ? 'Thử thay đổi nội dung tìm kiếm.' : isOwner ? 'Bạn chưa có phương tiện nào trong danh sách. Bấm "Thêm phương tiện" để thêm xe mới.' : 'Danh sách phương tiện đang trống.'}
        />
      )}
    </section>
    {open && <VehicleModal owners={owners} isOwner={isOwner} onClose={() => setOpen(false)} onSubmit={async body => { await onCreate(body); setOpen(false) }}/>}
    {deletingVehicle && (
      <Modal
        title="Xác nhận xóa phương tiện"
        subtitle={`Thao tác xóa phương tiện biển số "${deletingVehicle.registration_number}".`}
        onClose={() => {
          setDeletingVehicle(null);
          setDeleteError('');
        }}
        onSubmit={async () => {
          setDeleteError('');
          try {
            if (onDelete) {
              await onDelete(deletingVehicle.id);
            }
            setDeletingVehicle(null);
          } catch (err: any) {
            setDeleteError(err?.message || 'Không thể xóa phương tiện này.');
          }
        }}
        submitLabel="Xác nhận xóa"
        submitVariant="danger"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '14px', lineHeight: 1.6 }}>
          <div style={{ padding: '14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#991b1b' }}>
            ⚠️ Bạn có chắc chắn muốn xóa phương tiện biển số <strong>"{deletingVehicle.registration_number}"</strong> ({deletingVehicle.vehicle_type}) không?
            <div style={{ marginTop: '8px', fontSize: '13px', color: '#b91c1c' }}>
              Lưu ý: Chỉ có thể xóa nếu phương tiện chưa có hồ sơ kiểm định và không có lịch hẹn đang có hiệu lực.
            </div>
          </div>
          {deleteError && (
            <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #f87171', borderRadius: '6px', color: '#b91c1c', fontSize: '13.5px', fontWeight: 500 }}>
              {deleteError}
            </div>
          )}
        </div>
      </Modal>
    )}
  </>
}

function OwnersPage({
  owners,
  vehicles = [],
  inspections = [],
  certificates = [],
  onCreate,
  onDelete,
}: {
  owners: Owner[];
  vehicles?: Vehicle[];
  inspections?: Inspection[];
  certificates?: Certificate[];
  onCreate: (body: Omit<Owner, 'id'>) => Promise<void>;
  onDelete?: (id: number) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selectedOwnerForDetail, setSelectedOwnerForDetail] = useState<Owner | null>(null);
  const [deletingOwner, setDeletingOwner] = useState<Owner | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [query, setQuery] = useState('');
  const filtered = owners.filter(o => `${o.display_name} ${o.phone} ${o.identity_or_tax_number}`.toLowerCase().includes(query.toLowerCase()));

  // Pagination: 10 items per page
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(Math.max(1, totalPages));
    }
  }, [currentPage, totalPages]);

  return <>
    <PageHeading eyebrow="DỮ LIỆU NỀN" title="Chủ xe" description="Quản lý thông tin chủ xe đã được tiếp nhận." action={<button className="button button-primary" onClick={() => setOpen(true)}>Thêm chủ xe</button>}/>
    <div className="toolbar">
      <div className="search-box">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm theo tên chủ xe, số điện thoại, CCCD/MST..."/>
      </div>
      <span className="result-count">{filtered.length} chủ xe</span>
    </div>
    <section className="panel list-panel owners-panel">
      {filtered.length ? (
        <>
          <div className="table-wrap">
            <table className="owners-table">
              <thead>
                <tr>
                  <th>CHỦ XE</th>
                  <th>ĐỊNH DANH / MÃ SỐ THUẾ</th>
                  <th>SỐ ĐIỆN THOẠI</th>
                  <th>ĐỊA CHỈ</th>
                  <th style={{ textAlign: 'right' }}>THAO TÁC</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(o => (
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
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="button button-ghost button-sm"
                        style={{
                          color: '#1d4ed8',
                          border: '1px solid #bfdbfe',
                          backgroundColor: '#eff6ff',
                          padding: '4px 12px',
                          borderRadius: '6px',
                          fontSize: '12.5px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          marginRight: onDelete ? '8px' : '0',
                        }}
                        onClick={() => setSelectedOwnerForDetail(o)}
                        title="Xem thông tin chi tiết xe, lịch sử và hạn đăng kiểm của chủ xe"
                      >
                        Xem chi tiết
                      </button>
                      {onDelete && (
                        <button
                          type="button"
                          className="button button-ghost button-sm"
                          style={{
                            color: '#dc2626',
                            border: '1px solid #fecaca',
                            backgroundColor: '#fef2f2',
                            padding: '4px 12px',
                            borderRadius: '6px',
                            fontSize: '12.5px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                          onClick={() => setDeletingOwner(o)}
                          title="Xóa chủ xe"
                        >
                          Xóa
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <TablePagination
            currentPage={currentPage}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            itemName="chủ xe"
          />
        </>
      ) : (
        <Empty title="Chưa có dữ liệu chủ xe" detail="Tạo hồ sơ chủ xe để liên kết phương tiện."/>
      )}
    </section>
    {open && <OwnerModal onClose={() => setOpen(false)} onSubmit={async body => { await onCreate(body); setOpen(false) }}/>}
    {selectedOwnerForDetail && (
      <OwnerDetailModal
        owner={selectedOwnerForDetail}
        vehicles={vehicles}
        inspections={inspections}
        certificates={certificates}
        onClose={() => setSelectedOwnerForDetail(null)}
      />
    )}
    {deletingOwner && (
      <Modal
        title="Xác nhận xóa chủ xe"
        subtitle={`Thao tác xóa hồ sơ chủ xe "${deletingOwner.display_name}".`}
        onClose={() => {
          setDeletingOwner(null);
          setDeleteError('');
        }}
        onSubmit={async () => {
          setDeleteError('');
          try {
            if (onDelete) {
              await onDelete(deletingOwner.id);
            }
            setDeletingOwner(null);
          } catch (err: any) {
            setDeleteError(err?.message || 'Không thể xóa chủ xe này.');
          }
        }}
        submitLabel="Xác nhận xóa"
        submitVariant="danger"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '14px', lineHeight: 1.6 }}>
          <div style={{ padding: '14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#991b1b' }}>
            ⚠️ Bạn có chắc chắn muốn xóa chủ xe <strong>"{deletingOwner.display_name}"</strong> (Số định danh: {deletingOwner.identity_or_tax_number}) không?
            <div style={{ marginTop: '8px', fontSize: '13px', color: '#b91c1c' }}>
              Lưu ý: Chỉ có thể xóa nếu chủ xe này chưa có phương tiện liên kết và không gắn với tài khoản đăng nhập.
            </div>
          </div>
          {deleteError && (
            <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #f87171', borderRadius: '6px', color: '#b91c1c', fontSize: '13.5px', fontWeight: 500 }}>
              {deleteError}
            </div>
          )}
        </div>
      </Modal>
    )}
  </>
}

function OwnerDetailModal({
  owner,
  vehicles,
  inspections,
  certificates,
  onClose,
}: {
  owner: Owner;
  vehicles: Vehicle[];
  inspections: Inspection[];
  certificates: Certificate[];
  onClose: () => void;
}) {
  const ownerVehicles = useMemo(() => vehicles.filter(v => v.owner_id === owner.id), [vehicles, owner.id]);
  const ownerVehicleIds = useMemo(() => new Set(ownerVehicles.map(v => v.id)), [ownerVehicles]);
  const totalInspections = useMemo(() => inspections.filter(i => ownerVehicleIds.has(i.vehicle_id)).length, [inspections, ownerVehicleIds]);
  const totalCertificates = useMemo(() => certificates.filter(c => ownerVehicleIds.has(c.vehicle_id)).length, [certificates, ownerVehicleIds]);

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="form-modal"
        style={{
          width: 'min(920px, 95vw)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#fff',
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 25px 60px -15px rgba(15, 23, 42, 0.25)',
        }}
      >
        {/* Modal Header */}
        <div className="modal-heading" style={{ borderBottom: '1px solid #e2e8f0', padding: '18px 24px', background: '#f8fafc' }}>
          <div>
            <div className="eyebrow" style={{ color: '#2563eb', fontWeight: 700, letterSpacing: '0.6px' }}>HỒ SƠ CHI TIẾT CHỦ XE</div>
            <h2 style={{ margin: '4px 0 0', fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>{owner.display_name}</h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
              Mã định danh/MST: <strong style={{ color: '#1e293b' }}>{owner.identity_or_tax_number}</strong> · SĐT: <strong style={{ color: '#1e293b' }}>{owner.phone}</strong>
            </p>
          </div>
          <button type="button" className="close-button" onClick={onClose}>×</button>
        </div>

        {/* Modal Scrollable Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Thông tin hành chính của chủ xe */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <DetailField label="Họ tên / Đơn vị" value={owner.display_name} />
              <DetailField label="Số định danh / Mã số thuế" value={owner.identity_or_tax_number} />
              <DetailField label="Số điện thoại liên hệ" value={owner.phone} />
              <DetailField label="Địa chỉ cư trú / Trụ sở" value={owner.address} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', marginTop: '14px', paddingTop: '12px', borderTop: '1px dashed #cbd5e1', fontSize: '13px' }}>
              <span style={{ color: '#475569' }}>
                🚗 Tổng số xe: <strong style={{ color: '#0f172a' }}>{ownerVehicles.length} phương tiện</strong>
              </span>
              <span style={{ color: '#cbd5e1' }}>•</span>
              <span style={{ color: '#475569' }}>
                📋 Lịch sử kiểm định: <strong style={{ color: '#0f172a' }}>{totalInspections} lượt</strong>
              </span>
              <span style={{ color: '#cbd5e1' }}>•</span>
              <span style={{ color: '#475569' }}>
                📜 Giấy chứng nhận đã cấp: <strong style={{ color: '#0f172a' }}>{totalCertificates} GCN</strong>
              </span>
            </div>
          </div>

          {/* Danh sách xe và chi tiết lịch sử đăng kiểm */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>Danh sách phương tiện sở hữu</span>
                <span className="badge badge-blue" style={{ fontSize: '12px', padding: '2px 8px' }}>{ownerVehicles.length} xe</span>
              </h3>
            </div>

            {ownerVehicles.length === 0 ? (
              <div className="empty-state" style={{ padding: '30px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '10px' }}>
                <strong>Chưa có phương tiện nào</strong>
                <p>Chủ xe này hiện chưa có phương tiện nào được liên kết trong hệ thống.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {ownerVehicles.map((veh, index) => {
                  const vehInspections = inspections
                    .filter(i => i.vehicle_id === veh.id)
                    .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
                  const vehCerts = certificates
                    .filter(c => c.vehicle_id === veh.id)
                    .sort((a, b) => new Date(b.issued_on).getTime() - new Date(a.issued_on).getTime());
                  const latestCert = vehCerts[0];

                  // Tính trạng thái hạn đăng kiểm
                  let expiryBadge = (
                    <span className="badge badge-gray" style={{ fontSize: '12px' }}>
                      Chưa có GCN kiểm định
                    </span>
                  );

                  if (latestCert?.expires_on) {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const exp = new Date(latestCert.expires_on);
                    exp.setHours(0, 0, 0, 0);
                    const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                    if (diffDays < 0) {
                      expiryBadge = (
                        <span className="badge badge-red" style={{ fontSize: '12.5px', padding: '4px 10px' }}>
                          ⚠️ Đã hết hạn ({Math.abs(diffDays)} ngày trước)
                        </span>
                      );
                    } else if (diffDays <= 30) {
                      expiryBadge = (
                        <span className="badge badge-amber" style={{ fontSize: '12.5px', padding: '4px 10px' }}>
                          ⏳ Sắp hết hạn (Còn {diffDays} ngày)
                        </span>
                      );
                    } else {
                      expiryBadge = (
                        <span className="badge badge-green" style={{ fontSize: '12.5px', padding: '4px 10px' }}>
                          ✓ Còn hiệu lực (Hết hạn: {formatDate(latestCert.expires_on)})
                        </span>
                      );
                    }
                  }

                  return (
                    <div
                      key={veh.id}
                      style={{
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px',
                        overflow: 'hidden',
                        background: '#ffffff',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
                      }}
                    >
                      {/* Vehicle Header Bar */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: '10px',
                          padding: '12px 18px',
                          background: '#f1f5f9',
                          borderBottom: '1px solid #e2e8f0',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>#{index + 1}</span>
                          <span
                            style={{
                              fontFamily: 'monospace',
                              fontWeight: 700,
                              fontSize: '15px',
                              letterSpacing: '0.6px',
                              background: '#0f172a',
                              color: '#fff',
                              padding: '3px 9px',
                              borderRadius: '6px',
                            }}
                          >
                            {veh.registration_number}
                          </span>
                          <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#334155' }}>
                            {veh.vehicle_type}
                          </span>
                          {veh.plate_classification && (
                            <span style={{ fontSize: '12px', color: '#64748b' }}>
                              ({veh.plate_classification})
                            </span>
                          )}
                        </div>
                        <div>{expiryBadge}</div>
                      </div>

                      {/* Thông số kỹ thuật & Hạn đăng kiểm chi tiết */}
                      <div style={{ padding: '14px 18px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', fontSize: '13px', marginBottom: '14px' }}>
                          <div>
                            <span style={{ color: '#64748b', fontSize: '12px', display: 'block' }}>Số khung (VIN)</span>
                            <strong style={{ fontFamily: 'monospace', color: '#0f172a' }}>{veh.chassis_number}</strong>
                          </div>
                          <div>
                            <span style={{ color: '#64748b', fontSize: '12px', display: 'block' }}>Số máy</span>
                            <strong style={{ fontFamily: 'monospace', color: '#0f172a' }}>{veh.engine_number}</strong>
                          </div>
                          <div>
                            <span style={{ color: '#64748b', fontSize: '12px', display: 'block' }}>Hạn kiểm định hiện tại</span>
                            <strong style={{ color: latestCert?.expires_on ? '#0f172a' : '#94a3b8' }}>
                              {latestCert?.expires_on ? formatDate(latestCert.expires_on) : 'Chưa có thông tin'}
                            </strong>
                          </div>
                          <div>
                            <span style={{ color: '#64748b', fontSize: '12px', display: 'block' }}>GCN & Tem gần nhất</span>
                            <strong style={{ color: latestCert ? '#0f172a' : '#94a3b8' }}>
                              {latestCert ? `${latestCert.certificate_number} / ${latestCert.stamp_number}` : 'Chưa cấp'}
                            </strong>
                          </div>
                        </div>

                        {/* Bảng lịch sử đăng kiểm của xe */}
                        <div style={{ marginTop: '10px' }}>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>📋 Lịch sử đăng kiểm</span>
                            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>({vehInspections.length} lần)</span>
                          </div>

                          {vehInspections.length === 0 ? (
                            <p style={{ margin: 0, padding: '10px 14px', background: '#f8fafc', borderRadius: '6px', fontSize: '13px', color: '#64748b', fontStyle: 'italic' }}>
                              Phương tiện này chưa có hồ sơ đăng kiểm nào được ghi nhận.
                            </p>
                          ) : (
                            <div className="table-wrap" style={{ border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                              <table style={{ margin: 0, fontSize: '12.5px' }}>
                                <thead>
                                  <tr style={{ background: '#f8fafc' }}>
                                    <th>MÃ HỒ SƠ</th>
                                    <th>NGÀY TIẾP NHẬN</th>
                                    <th>LOẠI KIỂM ĐỊNH</th>
                                    <th>KÊNH</th>
                                    <th>HẠN BẢO HIỂM</th>
                                    <th>TRẠNG THÁI</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {vehInspections.map(ins => (
                                    <tr key={ins.id}>
                                      <td><strong className="mono" style={{ color: '#1e40af' }}>{ins.code}</strong></td>
                                      <td>{formatDate(ins.received_at)}</td>
                                      <td>{ins.inspection_type === 'first' ? 'Kiểm định lần đầu' : 'Kiểm định định kỳ'}</td>
                                      <td>{channelName(ins.intake_channel)}</td>
                                      <td>{ins.insurance_expiry ? formatDate(ins.insurance_expiry) : <span style={{ color: '#94a3b8' }}>—</span>}</td>
                                      <td><StatusBadge value={ins.status} /></td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal-footer" style={{ borderTop: '1px solid #e2e8f0', padding: '14px 24px', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="button button-primary" onClick={onClose} style={{ minWidth: '90px' }}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

function AppointmentsPage({ role, vehicles, owners, appointments, onCreate, onCancel }: { role: Role; vehicles: Vehicle[]; owners: Owner[]; appointments: Appointment[]; onCreate: (body: Omit<Appointment, 'id' | 'code' | 'status'>) => Promise<void>; onCancel: (id: number) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const canCreate = ['admin', 'intake', 'owner'].includes(role);
  const filtered = appointments.filter(a => {
    const veh = vehicles.find(v => v.id === a.vehicle_id);
    return `${a.code} ${a.service_type} ${veh?.registration_number ?? ''}`.toLowerCase().includes(query.toLowerCase());
  });

  // Pagination: 10 items per page
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(Math.max(1, totalPages));
    }
  }, [currentPage, totalPages]);

  return <>
    <PageHeading eyebrow="ĐIỀU PHỐI TIẾP NHẬN" title="Lịch hẹn đăng kiểm" description="Sắp xếp khung giờ kiểm định đảm bảo năng lực phục vụ của trung tâm." action={canCreate ? <button className="button button-primary" onClick={() => setOpen(true)}>Tạo lịch hẹn</button> : undefined}/>
    <div className="toolbar">
      <div className="search-box">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm theo mã lịch hẹn, biển số xe..."/>
      </div>
      <span className="result-count">{filtered.length} lịch hẹn</span>
    </div>
    <section className="panel list-panel appointments-panel">
      {filtered.length ? (
        <>
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
                {paginated.map(a => (
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

          {/* Pagination Controls */}
          <TablePagination
            currentPage={currentPage}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            itemName="lịch hẹn"
          />
        </>
      ) : (
        <Empty title="Chưa có lịch hẹn" detail="Lịch hẹn mới sẽ hiển thị ở đây."/>
      )}
    </section>
    {open && <AppointmentModal vehicles={vehicles} owners={owners} isOwner={role === 'owner'} onClose={() => setOpen(false)} onSubmit={async body => { await onCreate(body); setOpen(false) }}/>}
  </>
}

function InspectionsPage({
  role,
  vehicles,
  owners = [],
  inspections,
  token,
  runAction,
  onOpenDetail,
}: {
  role: Role;
  vehicles: Vehicle[];
  owners?: Owner[];
  inspections: Inspection[];
  token: string;
  runAction: (action: () => Promise<unknown>, message: string) => Promise<void>;
  onOpenDetail?: (ins: Inspection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Inspection | null>(null);
  const [filter, setFilter] = useState('all');
  const visible = inspections.filter(i => filter === 'all' || i.status === filter);
  const canCreate = canIntake(role);

  // Pagination: 10 items per page
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const totalPages = Math.ceil(visible.length / pageSize) || 1;
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return visible.slice(start, start + pageSize);
  }, [visible, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(Math.max(1, totalPages));
    }
  }, [currentPage, totalPages]);

  function handleSelect(i: Inspection) {
    if (onOpenDetail) onOpenDetail(i)
    else setSelected(i)
  }

  return <>
    <PageHeading eyebrow="NGHIỆP VỤ KIỂM ĐỊNH" title="Hồ sơ kiểm định" description="Tiếp nhận hồ sơ và theo dõi kết quả kiểm tra phương tiện." action={canCreate ? <button className="button button-primary" onClick={() => setOpen(true)}>Tiếp nhận hồ sơ</button> : undefined}/>
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
        <>
          <div className="table-wrap">
            <table className="inspections-table">
              <thead>
                <tr>
                  <th>MÃ HỒ SƠ</th>
                  <th>PHƯƠNG TIỆN</th>
                  <th>CHỦ PHƯƠNG TIỆN</th>
                  <th>LOẠI KIỂM ĐỊNH</th>
                  <th>KÊNH TIẾP NHẬN</th>
                  <th>NGÀY TIẾP NHẬN</th>
                  <th>TRẠNG THÁI</th>
                  <th>THAO TÁC</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(i => {
                  const veh = vehicles.find(v => v.id === i.vehicle_id);
                  const owner = veh ? owners.find(o => o.id === veh.owner_id) : undefined;
                  return (
                    <tr key={i.id}>
                      <td><strong className="mono inspection-code">{i.code}</strong></td>
                      <td><span className="plate plate-large">{veh ? veh.registration_number : vehicleLabel(vehicles, i.vehicle_id)}</span></td>
                      <td className="vehicle-owner-cell">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              width: '26px',
                              height: '26px',
                              borderRadius: '50%',
                              backgroundColor: '#e0e7ff',
                              color: '#3730a3',
                              fontSize: '11px',
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {owner?.display_name ? owner.display_name.slice(0, 1).toUpperCase() : '?'}
                          </span>
                          <strong style={{ color: '#0f172a', fontSize: '13.5px' }}>
                            {owner?.display_name ?? '—'}
                          </strong>
                        </div>
                      </td>
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
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <TablePagination
            currentPage={currentPage}
            totalItems={visible.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            itemName="hồ sơ"
          />
        </>
      ) : (
        <Empty title="Chưa có hồ sơ kiểm định" detail="Tiếp nhận hồ sơ mới để bắt đầu theo dõi."/>
      )}
    </section>
    {open && <InspectionModal vehicles={vehicles} onClose={() => setOpen(false)} onSubmit={async body => { await runAction(() => api.createInspection(token, body), 'Đã tiếp nhận hồ sơ.'); setOpen(false) }}/>}
    {!onOpenDetail && selected && (
      <InspectionDetail
        inspection={selected}
        vehicle={vehicles.find(v => v.id === selected.vehicle_id)}
        owner={owners.find(o => o.id === vehicles.find(v => v.id === selected.vehicle_id)?.owner_id)}
        token={token}
        onClose={() => setSelected(null)}
      />
    )}
  </>
}

/* ==========================================================================
   INSPECTION DETAIL DRAWER (FOR ADMIN / INTAKE READ-ONLY VIEW)
   ========================================================================== */
function InspectionDetail({ inspection, vehicle, owner, token, onClose }: { inspection: Inspection; vehicle?: Vehicle; owner?: Owner; token: string; onClose: () => void }) {
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
          <div>
            <small>PHƯƠNG TIỆN</small>
            <strong>{vehicle?.registration_number ?? `Xe #${inspection.vehicle_id}`}</strong>
            <span>{vehicle?.vehicle_type ?? 'Chưa có thông tin'}</span>
            {owner && (
              <span style={{ display: 'block', marginTop: '6px', fontSize: '13px', color: '#1e40af', fontWeight: 600 }}>
                👤 Chủ xe: {owner.display_name} · SĐT: {owner.phone}
              </span>
            )}
          </div>
        </div>
        <div className="detail-grid">
          <DetailField label="Chủ phương tiện" value={owner?.display_name}/>
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
function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) { return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="heading-action">{action}</div>}</div> }
function StatusBadge({ value }: { value: string }) { const tone = ['active', 'passed', 'dat'].includes(value) ? 'badge-green' : ['failed', 'dd', 'ma'].includes(value) ? 'badge-red' : ['in_progress', 'mi'].includes(value) ? 'badge-blue' : value === 'cancelled' ? 'badge-gray' : 'badge-amber'; return <span className={`badge ${tone}`}>{statusName[value] ?? resultName[value] ?? value}</span> }
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="empty-state"><strong>{title}</strong><p>{detail}</p></div> }
function DetailField({ label, value }: { label: string; value?: string | null }) { return <div className="detail-field"><small>{label}</small><strong>{value || '—'}</strong></div> }
function vehicleLabel(vehicles: Vehicle[], id: number) { return vehicles.find(v => v.id === id)?.registration_number ?? `Phương tiện #${id}` }
function formatDate(value: string) {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}/${m}/${y}`;
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}
function serviceName(value: string) { return ({ periodic: 'Kiểm định định kỳ', new_registration: 'Đăng ký xe mới', information_change: 'Thay đổi thông tin' } as Record<string, string>)[value] ?? value }
function channelName(value: string) { return ({ counter: 'Tại quầy', postal: 'Bưu chính', online: 'Trực tuyến' } as Record<string, string>)[value] ?? value }

function Modal({ title, subtitle, children, onClose, onSubmit, submitLabel = 'Lưu thông tin', submitVariant = 'primary', submitDisabled = false }: { title: string; subtitle: string; children: ReactNode; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; submitLabel?: string; submitVariant?: 'primary' | 'danger'; submitDisabled?: boolean }) { const [busy, setBusy] = useState(false); return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><form className="form-modal" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onSubmit(e) } finally { setBusy(false) } }}><div className="modal-heading"><div><div className="eyebrow">THÔNG TIN NGHIỆP VỤ</div><h2>{title}</h2><p>{subtitle}</p></div><button type="button" className="close-button" onClick={onClose}>×</button></div><div className="modal-body">{children}</div><div className="modal-footer"><button type="button" className="button button-ghost" onClick={onClose}>Hủy</button><button className={`button ${submitVariant === 'danger' ? 'button-danger' : 'button-primary'}`} style={submitVariant === 'danger' ? { backgroundColor: '#dc2626', borderColor: '#dc2626', color: '#fff' } : undefined} disabled={busy || submitDisabled}>{busy ? 'Đang xử lý...' : submitLabel}</button></div></form></div> }
function Field({ label, children, required = false }: { label: string; children: ReactNode; required?: boolean }) { return <label className="field"><span>{label}{required && <em> *</em>}</span>{children}</label> }

function OwnerModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (body: Omit<Owner, 'id'>) => Promise<void> }) { const [error, setError] = useState(''); async function submit(e: FormEvent<HTMLFormElement>) { const f = new FormData(e.currentTarget); try { await onSubmit({ display_name: String(f.get('name')), identity_or_tax_number: String(f.get('identity')), phone: String(f.get('phone')), address: String(f.get('address')) }) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể lưu chủ xe') } } return <Modal title="Thêm chủ xe" subtitle="Nhập thông tin theo giấy tờ của chủ xe." onClose={onClose} onSubmit={submit}><div className="form-grid"><Field label="Họ tên cá nhân / tên tổ chức" required><input name="name" maxLength={255} required placeholder="Nhập họ tên hoặc tên tổ chức"/></Field><Field label="Số định danh / mã số thuế" required><input name="identity" maxLength={50} required placeholder="Nhập số giấy tờ"/></Field><Field label="Số điện thoại" required><input name="phone" maxLength={30} required placeholder="Số điện thoại liên hệ"/></Field><Field label="Địa chỉ cư trú / trụ sở" required><textarea name="address" required rows={3} placeholder="Theo giấy đăng ký xe"/></Field></div>{error && <div className="form-error">{error}</div>}</Modal> }
function VehicleModal({
  owners,
  onClose,
  onSubmit,
  isOwner = false,
}: {
  owners: Owner[];
  onClose: () => void;
  onSubmit: (body: Omit<Vehicle, 'id'> | (Omit<Vehicle, 'id' | 'owner_id'> & { owner_id?: number })) => Promise<void>;
  isOwner?: boolean;
}) {
  const [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    const f = new FormData(e.currentTarget);
    try {
      const ownerVal = f.get('owner');
      await onSubmit({
        owner_id: isOwner ? undefined : Number(ownerVal),
        registration_number: String(f.get('plate') || '').trim().toUpperCase(),
        plate_classification: String(f.get('plateClass') || '').trim() || null,
        chassis_number: String(f.get('chassis') || '').trim().toUpperCase(),
        engine_number: String(f.get('engine') || '').trim().toUpperCase(),
        vehicle_type: String(f.get('type') || '').trim()
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể lưu phương tiện');
    }
  }

  return (
    <Modal
      title={isOwner ? "Thêm phương tiện mới" : "Thêm phương tiện"}
      subtitle={isOwner ? "Đăng ký thông tin xe vào danh sách quản lý của bạn." : "Liên kết phương tiện với hồ sơ chủ xe."}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Thêm phương tiện"
    >
      <div className="form-grid">
        {!isOwner && (
          <Field label="Chủ xe" required>
            <select name="owner" required defaultValue="">
              <option value="" disabled>Chọn chủ xe</option>
              {owners.map(o => <option key={o.id} value={o.id}>{o.display_name} · {o.phone}</option>)}
            </select>
          </Field>
        )}
        <Field label="Biển số xe" required>
          <input name="plate" maxLength={30} required placeholder="Ví dụ: 30A-123.45" style={{ textTransform: 'uppercase' }} />
        </Field>
        <Field label="Phân loại màu biển">
          <input name="plateClass" maxLength={30} placeholder="Trắng, Vàng, Xanh (nếu có)" />
        </Field>
        <Field label="Loại phương tiện" required>
          <input name="type" maxLength={100} required placeholder="Ô tô con, xe tải..." />
        </Field>
        <Field label="Số khung (VIN)" required>
          <input name="chassis" maxLength={100} required placeholder="Số khung theo giấy đăng ký" style={{ textTransform: 'uppercase' }} />
        </Field>
        <Field label="Số máy" required>
          <input name="engine" maxLength={100} required placeholder="Số máy theo giấy đăng ký" style={{ textTransform: 'uppercase' }} />
        </Field>
      </div>
      {!isOwner && owners.length === 0 && <div className="form-error">Cần tạo hồ sơ chủ xe trước khi thêm phương tiện.</div>}
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
function AppointmentModal({
  vehicles,
  owners = [],
  onClose,
  onSubmit,
  isOwner = false,
}: {
  vehicles: Vehicle[];
  owners?: Owner[];
  onClose: () => void;
  onSubmit: (body: Omit<Appointment, 'id' | 'code' | 'status'>) => Promise<void>;
  isOwner?: boolean;
}) {
  const [selectedOwnerId, setSelectedOwnerId] = useState<number | ''>('');
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | ''>('');
  const [error, setError] = useState('');

  const hasOwnerSelected = isOwner || !!selectedOwnerId;

  const availableVehicles = useMemo(() => {
    if (isOwner) return vehicles;
    if (!selectedOwnerId) return [];
    return vehicles.filter(v => v.owner_id === Number(selectedOwnerId));
  }, [vehicles, selectedOwnerId, isOwner]);

  // Khi chọn chủ xe, tự động chọn xe nếu chủ xe chỉ có 1 xe duy nhất
  useEffect(() => {
    if (hasOwnerSelected) {
      if (availableVehicles.length === 1) {
        setSelectedVehicleId(availableVehicles[0].id);
      } else if (!availableVehicles.some(v => v.id === selectedVehicleId)) {
        setSelectedVehicleId('');
      }
    } else {
      setSelectedVehicleId('');
    }
  }, [hasOwnerSelected, availableVehicles]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');

    if (!isOwner && !selectedOwnerId) {
      setError('Vui lòng chọn chủ xe trong hệ thống trước.');
      return;
    }

    const f = new FormData(e.currentTarget);
    const vehicleId = Number(f.get('vehicle')) || Number(selectedVehicleId);
    const dateVal = String(f.get('date') || '');
    const start = String(f.get('start') || '06:30');
    const end = String(f.get('end') || '07:00');
    const service = String(f.get('service') || 'periodic');

    if (!vehicleId) {
      setError('Vui lòng chọn phương tiện để đặt lịch hẹn.');
      return;
    }
    if (!dateVal) {
      setError('Vui lòng chọn ngày hẹn.');
      return;
    }
    if (start >= end) {
      setError('Giờ kết thúc phải sau giờ bắt đầu.');
      return;
    }
    const isMorning = start >= '06:30' && end <= '11:00';
    const isAfternoon = start >= '13:00' && end <= '17:30';
    if (!isMorning && !isAfternoon) {
      setError('Khung giờ hẹn phải nằm trọn trong buổi sáng (06:30 - 11:00) hoặc buổi chiều (13:00 - 17:30).');
      return;
    }

    try {
      await onSubmit({
        vehicle_id: vehicleId,
        appointment_date: dateVal,
        start_time: start,
        end_time: end,
        service_type: service,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể tạo lịch hẹn.');
    }
  }

  return (
    <Modal
      title="Tạo lịch hẹn"
      subtitle={!isOwner && !selectedOwnerId ? 'Vui lòng chọn chủ xe trước để mở khóa chọn phương tiện và các thông tin khác.' : 'Khung giờ phải nằm trọn trong buổi sáng hoặc buổi chiều.'}
      onClose={onClose}
      onSubmit={submit}
      submitDisabled={!hasOwnerSelected || !selectedVehicleId}
    >
      <div className="form-grid">
        {!isOwner && (
          <Field label="Chủ xe" required>
            <select
              name="owner"
              required
              value={selectedOwnerId}
              onChange={e => {
                const val = e.target.value ? Number(e.target.value) : '';
                setSelectedOwnerId(val);
              }}
            >
              <option value="">-- Chọn chủ xe trong hệ thống --</option>
              {owners.map(o => (
                <option key={o.id} value={o.id}>
                  {o.display_name} ({o.identity_or_tax_number}) · SĐT: {o.phone}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Phương tiện" required>
          <select
            name="vehicle"
            required
            value={selectedVehicleId}
            onChange={e => setSelectedVehicleId(e.target.value ? Number(e.target.value) : '')}
            disabled={!hasOwnerSelected || availableVehicles.length === 0}
          >
            {!hasOwnerSelected ? (
              <option value="">-- Vui lòng chọn chủ xe trước --</option>
            ) : availableVehicles.length === 0 ? (
              <option value="">Chủ xe này chưa có phương tiện nào</option>
            ) : (
              <>
                <option value="">-- Chọn phương tiện --</option>
                {availableVehicles.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.registration_number} · {v.vehicle_type}
                  </option>
                ))}
              </>
            )}
          </select>
        </Field>
        <Field label="Ngày hẹn" required>
          <input
            name="date"
            type="date"
            required
            min={getLocalDateString()}
            disabled={!hasOwnerSelected}
          />
        </Field>
        <Field label="Loại dịch vụ" required>
          <select name="service" required disabled={!hasOwnerSelected} defaultValue="periodic">
            <option value="periodic">Kiểm định định kỳ</option>
            <option value="new_registration">Đăng ký xe mới</option>
            <option value="information_change">Thay đổi thông tin</option>
          </select>
        </Field>
        <Field label="Giờ bắt đầu" required>
          <select name="start" required disabled={!hasOwnerSelected} defaultValue="06:30">
            <option value="06:30">06:30</option>
            <option value="07:00">07:00</option>
            <option value="08:00">08:00</option>
            <option value="09:00">09:00</option>
            <option value="10:00">10:00</option>
            <option value="13:00">13:00</option>
            <option value="14:00">14:00</option>
            <option value="15:00">15:00</option>
            <option value="16:00">16:00</option>
            <option value="17:00">17:00</option>
          </select>
        </Field>
        <Field label="Giờ kết thúc" required>
          <select name="end" required disabled={!hasOwnerSelected} defaultValue="07:00">
            <option value="07:00">07:00</option>
            <option value="08:00">08:00</option>
            <option value="09:00">09:00</option>
            <option value="10:00">10:00</option>
            <option value="11:00">11:00</option>
            <option value="14:00">14:00</option>
            <option value="15:00">15:00</option>
            <option value="16:00">16:00</option>
            <option value="17:00">17:00</option>
            <option value="17:30">17:30</option>
          </select>
        </Field>
      </div>
      {!hasOwnerSelected && !isOwner && (
        <div style={{ marginTop: '14px', padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', color: '#1d4ed8', fontSize: '13px' }}>
          💡 <strong>Bước 1:</strong> Vui lòng chọn chủ xe có trong hệ thống để mở khóa chọn phương tiện và các thông tin lịch hẹn.
        </div>
      )}
      {hasOwnerSelected && !isOwner && availableVehicles.length === 0 && (
        <div style={{ marginTop: '14px', padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', color: '#b45309', fontSize: '13px' }}>
          ⚠️ Chủ xe được chọn hiện chưa có phương tiện nào trong hệ thống. Vui lòng thêm phương tiện cho chủ xe này trước khi đặt lịch.
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

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
              {oldCertError}
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

/* ==========================================================================
   SYSTEM ROLES & USER MANAGEMENT PAGE
   ========================================================================== */
function SystemRolesPage({ session }: { session: Session }) {
  const [accounts, setAccounts] = useState<AccountListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'locked'>('all')

  // Modals
  const [openCreate, setOpenCreate] = useState(false)
  const [roleModalAccount, setRoleModalAccount] = useState<AccountListItem | null>(null)
  const [selectedNewRole, setSelectedNewRole] = useState<Role>('intake')
  const [resetPwAccount, setResetPwAccount] = useState<AccountListItem | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [editProfileAccount, setEditProfileAccount] = useState<AccountListItem | null>(null)
  const [editDisplayName, setEditDisplayName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [confirmModal, setConfirmModal] = useState<{
    type: 'lock' | 'unlock' | 'delete'
    account: AccountListItem
  } | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null)

  useEffect(() => {
    function handleClickOutside() {
      setActiveMenuId(null)
    }
    if (activeMenuId !== null) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [activeMenuId])

  // Auto-dismiss floating toast notifications
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 4500)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(''), 5500)
    return () => clearTimeout(timer)
  }, [error])

  // Create form state
  const [createUsername, setCreateUsername] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createRole, setCreateRole] = useState<Role>('inspector')
  const [createDisplayName, setCreateDisplayName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createPhone, setCreatePhone] = useState('')

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.getAdminAccounts(session.token)
      setAccounts(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách tài khoản.')
    } finally {
      setLoading(false)
    }
  }, [session.token])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  const filtered = accounts.filter(acc => {
    const textMatch = `${acc.username} ${acc.display_name || ''} ${acc.email || ''} ${acc.phone || ''}`
      .toLowerCase()
      .includes(query.toLowerCase())
    const statusMatch =
      statusFilter === 'all' ||
      (statusFilter === 'active' && acc.is_active) ||
      (statusFilter === 'locked' && !acc.is_active)
    return textMatch && statusMatch
  })

  // Pagination: 10 items per page
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, statusFilter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(Math.max(1, totalPages));
    }
  }, [currentPage, totalPages]);

  const hasOtherAdmin = accounts.some(a => a.role === 'admin' && (!roleModalAccount || a.id !== roleModalAccount.id))
  const hasAnyAdmin = accounts.some(a => a.role === 'admin')


  async function handleUpdateRole(e: FormEvent) {
    e.preventDefault()
    if (!roleModalAccount) return
    if (selectedNewRole === 'admin' && hasOtherAdmin && roleModalAccount.role !== 'admin') {
      setError('Hệ thống chỉ cho phép duy nhất 1 tài khoản Quản trị viên. Không thể phân quyền Quản trị viên cho người thứ hai.')
      return
    }
    setActionLoading(true)
    setError('')
    try {
      const updated = await api.updateAccountRole(session.token, roleModalAccount.id, selectedNewRole)
      setAccounts(prev => prev.map(a => a.id === updated.id ? updated : a))
      setNotice(`Đã cập nhật vai trò của tài khoản '${updated.username}' thành ${roleName[updated.role]}.`)
      setRoleModalAccount(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đổi vai trò thất bại.')
    } finally {
      setActionLoading(false)
    }
  }

  function handleOpenStatusConfirm(acc: AccountListItem) {
    setConfirmModal({
      type: acc.is_active ? 'lock' : 'unlock',
      account: acc,
    })
  }

  function handleOpenDeleteConfirm(acc: AccountListItem) {
    if (acc.username === session.username) {
      setError('Bạn không thể tự xóa tài khoản quản trị bạn đang đăng nhập.')
      return
    }
    if (acc.role === 'admin') {
      setError('Không thể xóa tài khoản Quản trị viên hệ thống.')
      return
    }
    setConfirmModal({
      type: 'delete',
      account: acc,
    })
  }

  async function handleConfirmAction(e: FormEvent) {
    e.preventDefault()
    if (!confirmModal) return
    const { type, account: acc } = confirmModal
    setActionLoading(true)
    setError('')
    try {
      if (type === 'lock' || type === 'unlock') {
        const nextActive = type === 'unlock'
        const updated = await api.updateAccountStatus(session.token, acc.id, nextActive)
        setAccounts(prev => prev.map(a => a.id === updated.id ? updated : a))
        setNotice(`Đã ${nextActive ? 'mở khóa' : 'khóa'} tài khoản '${updated.username}' thành công.`)
      } else if (type === 'delete') {
        const res = await api.deleteAdminAccount(session.token, acc.id)
        setAccounts(prev => prev.filter(a => a.id !== acc.id))
        setNotice(res.message || `Đã xóa tài khoản '@${acc.username}' thành công.`)
      }
      setConfirmModal(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Thao tác thất bại.')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault()
    if (!resetPwAccount) return
    if (newPassword.length < 6) {
      setError('Mật khẩu mới phải có ít nhất 6 ký tự.')
      return
    }
    setActionLoading(true)
    setError('')
    try {
      const res = await api.resetAccountPassword(session.token, resetPwAccount.id, newPassword)
      setNotice(res.message || 'Đặt lại mật khẩu thành công.')
      setResetPwAccount(null)
      setNewPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đặt lại mật khẩu thất bại.')
    } finally {
      setActionLoading(false)
    }
  }

  function handleOpenEditProfile(acc: AccountListItem) {
    setEditProfileAccount(acc)
    setEditDisplayName(acc.display_name || '')
    setEditEmail(acc.email || '')
    setEditPhone(acc.phone || '')
  }

  async function handleUpdateProfile(e: FormEvent) {
    e.preventDefault()
    if (!editProfileAccount) return
    setActionLoading(true)
    setError('')
    try {
      const updated = await api.updateAdminAccountProfile(session.token, editProfileAccount.id, {
        display_name: editDisplayName.trim() || undefined,
        email: editEmail.trim() || undefined,
        phone: editPhone.trim() || undefined,
      })
      setAccounts(prev => prev.map(a => a.id === updated.id ? updated : a))
      setNotice(`Đã cập nhật thông tin tài khoản '@${updated.username}' thành công.`)
      setEditProfileAccount(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cập nhật thông tin thất bại.')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleCreateAccount(e: FormEvent) {
    e.preventDefault()
    if (createRole === 'admin' && hasAnyAdmin) {
      setError('Hệ thống chỉ cho phép duy nhất 1 tài khoản Quản trị viên.')
      return
    }
    setActionLoading(true)
    setError('')
    try {
      const created = await api.createAdminAccount(session.token, {
        username: createUsername.trim().toLowerCase(),
        password: createPassword,
        role: createRole,
        display_name: createDisplayName.trim() || undefined,
        email: createEmail.trim() || undefined,
        phone: createPhone.trim() || undefined,
      })
      setAccounts(prev => [created, ...prev])
      setNotice(`Đã tạo tài khoản '${created.username}' (${roleName[created.role]}) thành công!`)
      setOpenCreate(false)
      setCreateUsername('')
      setCreatePassword('')
      setCreateDisplayName('')
      setCreateEmail('')
      setCreatePhone('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tạo tài khoản thất bại.')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="QUẢN TRỊ HỆ THỐNG"
        title="Phân quyền hệ thống"
        action={
          <button className="button button-primary" onClick={() => setOpenCreate(true)}>
            Thêm tài khoản mới
          </button>
        }
      />

      {/* Filter and Search Bar */}
      <div className="roles-filter-bar">
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', width: '100%', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="search-box" style={{ width: '280px' }}>
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Tìm tên, @username, email, SĐT..."
              />
            </div>

            <select
              className="filter-select"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Đang hoạt động</option>
              <option value="locked">Đã khóa</option>
            </select>
          </div>

          <div style={{ fontWeight: 700, fontSize: '14.5px', color: '#64748b' }}>
            Danh sách tài khoản ({filtered.length})
          </div>
        </div>
      </div>

      {/* Accounts Table */}
      <section className="panel list-panel roles-panel">
        {loading ? (
          <div style={{ padding: '50px 20px', textAlign: 'center' }}>
            <div className="loading-line" style={{ display: 'inline-flex' }}>
              <span /> Đang tải dữ liệu phân quyền tài khoản...
            </div>
          </div>
        ) : filtered.length ? (
          <>
            <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>TÀI KHOẢN & NGƯỜI DÙNG</th>
                  <th>VAI TRÒ PHÂN QUYỀN</th>
                  <th>LIÊN LẠC (EMAIL / SĐT)</th>
                  <th>TRẠNG THÁI</th>
                  <th style={{ textAlign: 'right' }}>THAO TÁC</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(acc => (
                  <tr key={acc.id}>
                    <td>
                      <div className="account-cell-user">
                        <div className="account-mini-avatar">
                          {acc.avatar_url ? (
                            <img src={acc.avatar_url} alt={acc.username} />
                          ) : (
                            (acc.display_name || acc.username).slice(0, 1).toUpperCase()
                          )}
                        </div>
                        <div className="account-user-info">
                          <span className="account-display-name">
                            {acc.display_name || acc.username}
                            {acc.username === session.username && (
                              <span style={{ fontSize: '11px', color: '#0284c7', marginLeft: '6px', fontWeight: 600 }}>
                                (Bạn)
                              </span>
                            )}
                          </span>
                          <span className="account-username-sub">@{acc.username}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`role-badge-pill role-badge-${acc.role}`}>
                        {roleName[acc.role]}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '13px' }}>
                        <span>{acc.email || '—'}</span>
                        <span style={{ color: '#64748b' }}>{acc.phone || '—'}</span>
                      </div>
                    </td>
                    <td>
                      {acc.username === session.username ? (
                        <span className="status-badge-pill status-badge-active" title="Tài khoản quản trị bạn đang đăng nhập">
                          Hoạt động
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={`status-badge-pill ${acc.is_active ? 'status-badge-active' : 'status-badge-locked'}`}
                          onClick={() => handleOpenStatusConfirm(acc)}
                          title={acc.is_active ? "Bấm để khóa tài khoản này" : "Bấm để mở khóa tài khoản này"}
                        >
                          {acc.is_active ? 'Hoạt động' : 'Tạm khóa'}
                        </button>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="action-dropdown-container">
                        <button
                          type="button"
                          className={`action-dots-button ${activeMenuId === acc.id ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setActiveMenuId(activeMenuId === acc.id ? null : acc.id)
                          }}
                          title="Thao tác"
                        >
                          ⋮
                        </button>

                        {activeMenuId === acc.id && (
                          <div className="action-dropdown-menu" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="dropdown-item"
                              onClick={() => {
                                setActiveMenuId(null)
                                handleOpenEditProfile(acc)
                              }}
                            >
                              Đổi thông tin
                            </button>

                            <button
                              type="button"
                              className="dropdown-item"
                              onClick={() => {
                                setActiveMenuId(null)
                                setRoleModalAccount(acc)
                                setSelectedNewRole(acc.role === 'admin' ? 'intake' : acc.role)
                              }}
                            >
                              Đổi quyền
                            </button>

                            <button
                              type="button"
                              className="dropdown-item"
                              onClick={() => {
                                setActiveMenuId(null)
                                setResetPwAccount(acc)
                                setNewPassword('')
                              }}
                            >
                              Đổi MK
                            </button>

                            {acc.username !== session.username && (
                              <>
                                <div className="dropdown-divider" />
                                <button
                                  type="button"
                                  className="dropdown-item dropdown-item-danger"
                                  onClick={() => {
                                    setActiveMenuId(null)
                                    handleOpenDeleteConfirm(acc)
                                  }}
                                  style={{ color: '#dc2626' }}
                                >
                                  Xóa tài khoản
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <TablePagination
            currentPage={currentPage}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            itemName="tài khoản"
          />
        </>
        ) : (
          <Empty
            title="Không tìm thấy tài khoản phù hợp"
            detail={query || statusFilter !== 'all' ? 'Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm.' : 'Hệ thống chưa có tài khoản nào.'}
          />
        )}
      </section>

      {/* Modal: Edit Account Profile */}
      {editProfileAccount && (
        <Modal
          title={`Đổi thông tin: @${editProfileAccount.username}`}
          subtitle="Cập nhật họ tên, email và số điện thoại liên hệ của tài khoản."
          onClose={() => setEditProfileAccount(null)}
          onSubmit={handleUpdateProfile}
          submitLabel={actionLoading ? 'Đang lưu...' : 'Lưu thay đổi'}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Field label="Tên đăng nhập (username)">
              <input
                type="text"
                value={`@${editProfileAccount.username}`}
                disabled
                style={{ background: '#f8fafc', color: '#64748b', cursor: 'not-allowed' }}
              />
            </Field>

            <Field label="Họ và tên / Tên hiển thị">
              <input
                type="text"
                value={editDisplayName}
                onChange={e => setEditDisplayName(e.target.value)}
                placeholder="VD: Nguyễn Văn An"
              />
            </Field>

            <Field label="Email liên lạc">
              <input
                type="email"
                value={editEmail}
                onChange={e => setEditEmail(e.target.value)}
                placeholder="user@kiemdinh.vn"
              />
            </Field>

            <Field label="Số điện thoại">
              <input
                type="tel"
                value={editPhone}
                onChange={e => setEditPhone(e.target.value)}
                placeholder="0912345678"
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* Modal: Change Role */}
      {roleModalAccount && (
        <Modal
          title={`Phân quyền tài khoản: @${roleModalAccount.username}`}
          subtitle="Chọn vai trò phân quyền hệ thống mới cho người dùng này."
          onClose={() => setRoleModalAccount(null)}
          onSubmit={handleUpdateRole}
          submitLabel={actionLoading ? 'Đang lưu...' : 'Lưu vai trò'}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <strong>Tài khoản:</strong> {roleModalAccount.display_name || roleModalAccount.username} (@{roleModalAccount.username})
            </div>
            <div>
              <strong>Vai trò hiện tại:</strong>{' '}
              <span className={`role-badge-pill role-badge-${roleModalAccount.role}`}>
                {roleName[roleModalAccount.role]}
              </span>
            </div>

            {roleModalAccount.username === session.username ? (
              <div style={{ padding: '12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#991b1b', fontSize: '13px' }}>
                Đây là tài khoản quản trị bạn đang đăng nhập. Bạn không thể tự thay đổi vai trò của chính mình để tránh mất quyền quản trị.
              </div>
            ) : (
              <Field label="Chọn vai trò phân quyền mới" required>
                <select
                  value={selectedNewRole}
                  onChange={e => setSelectedNewRole(e.target.value as Role)}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                >
                  <option value="intake">Nhân viên tiếp nhận (Tiếp nhận hồ sơ, điều phối lịch hẹn)</option>
                  <option value="inspector">Kiểm định viên (Đo kiểm chuyền kỹ thuật, chốt kết quả)</option>
                  <option value="owner">Chủ phương tiện (Quản lý xe và đăng ký kiểm định trực tuyến)</option>
                </select>
              </Field>
            )}
          </div>
        </Modal>
      )}

      {/* Modal: Reset Password */}
      {resetPwAccount && (
        <Modal
          title={`Đặt lại mật khẩu: @${resetPwAccount.username}`}
          subtitle="Thiết lập mật khẩu đăng nhập mới cho tài khoản."
          onClose={() => setResetPwAccount(null)}
          onSubmit={handleResetPassword}
          submitLabel={actionLoading ? 'Đang xử lý...' : 'Xác nhận đổi mật khẩu'}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ margin: 0, fontSize: '13.5px', color: '#475569' }}>
              Đặt lại mật khẩu đăng nhập mới cho tài khoản <strong>{resetPwAccount.username}</strong>:
            </p>
            <Field label="Mật khẩu mới (Tối thiểu 6 ký tự)" required>
              <input
                type="text"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Nhập mật khẩu mới..."
                required
                minLength={6}
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* Modal: Create Account */}
      {openCreate && (
        <Modal
          title="Tạo tài khoản & Phân quyền mới"
          subtitle="Tạo thông tin đăng nhập và gán vai trò quyền hạn ban đầu."
          onClose={() => setOpenCreate(false)}
          onSubmit={handleCreateAccount}
          submitLabel={actionLoading ? 'Đang tạo...' : 'Tạo tài khoản'}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Field label="Tên đăng nhập (username)" required>
              <input
                type="text"
                required
                value={createUsername}
                onChange={e => setCreateUsername(e.target.value)}
                placeholder="Ví dụ: kiemdinh_vien01"
              />
            </Field>

            <Field label="Mật khẩu khởi tạo" required>
              <input
                type="password"
                required
                minLength={6}
                value={createPassword}
                onChange={e => setCreatePassword(e.target.value)}
                placeholder="Tối thiểu 6 ký tự..."
              />
            </Field>

            <Field label="Vai trò / Phân quyền hệ thống" required>
              <select
                value={createRole}
                onChange={e => setCreateRole(e.target.value as Role)}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
              >
                <option value="intake">Nhân viên tiếp nhận (Tiếp nhận hồ sơ & lịch hẹn)</option>
                <option value="inspector">Kiểm định viên (Kỹ thuật chuyền kiểm định)</option>
                <option value="owner">Chủ phương tiện (Chủ xe)</option>
              </select>
            </Field>

            <Field label="Tên hiển thị (Họ và tên)">
              <input
                type="text"
                value={createDisplayName}
                onChange={e => setCreateDisplayName(e.target.value)}
                placeholder="Ví dụ: Nguyễn Văn Bình"
              />
            </Field>

            <div className="form-row-two">
              <Field label="Email liên lạc">
                <input
                  type="email"
                  value={createEmail}
                  onChange={e => setCreateEmail(e.target.value)}
                  placeholder="user@kiemdinh.vn"
                />
              </Field>

              <Field label="Số điện thoại">
                <input
                  type="tel"
                  value={createPhone}
                  onChange={e => setCreatePhone(e.target.value)}
                  placeholder="0912345678"
                />
              </Field>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Confirm Action (Lock / Unlock / Delete) */}
      {confirmModal && (
        <Modal
          title={
            confirmModal.type === 'lock'
              ? `Khóa tài khoản: @${confirmModal.account.username}`
              : confirmModal.type === 'unlock'
              ? `Mở khóa tài khoản: @${confirmModal.account.username}`
              : `Xóa tài khoản: @${confirmModal.account.username}`
          }
          subtitle={
            confirmModal.type === 'lock'
              ? 'Tài khoản bị khóa sẽ không thể đăng nhập vào hệ thống.'
              : confirmModal.type === 'unlock'
              ? 'Khôi phục quyền đăng nhập bình thường cho người dùng này.'
              : 'Thao tác này sẽ xóa vĩnh viễn và không thể hoàn tác.'
          }
          onClose={() => setConfirmModal(null)}
          onSubmit={handleConfirmAction}
          submitLabel={
            actionLoading
              ? 'Đang xử lý...'
              : confirmModal.type === 'lock'
              ? 'Xác nhận khóa'
              : confirmModal.type === 'unlock'
              ? 'Xác nhận mở khóa'
              : 'Xác nhận xóa vĩnh viễn'
          }
          submitVariant={confirmModal.type === 'delete' ? 'danger' : 'primary'}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '14px', lineHeight: 1.6 }}>
            {confirmModal.type === 'delete' ? (
              <div style={{ padding: '14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#991b1b' }}>
                ⚠️ Bạn có chắc chắn muốn <strong>xóa vĩnh viễn</strong> tài khoản <strong>@{confirmModal.account.username}</strong> ({confirmModal.account.display_name || 'Người dùng'}) không?
                <div style={{ marginTop: '8px', fontSize: '13px', color: '#b91c1c' }}>
                  Toàn bộ thông tin đăng nhập của người dùng này sẽ bị xóa khỏi hệ thống.
                </div>
              </div>
            ) : confirmModal.type === 'lock' ? (
              <div style={{ padding: '14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', color: '#92400e' }}>
                Bạn có chắc chắn muốn <strong>tạm khóa</strong> tài khoản <strong>@{confirmModal.account.username}</strong> ({confirmModal.account.display_name || 'Người dùng'}) không?
                <div style={{ marginTop: '8px', fontSize: '13px', color: '#b45309' }}>
                  Người dùng này sẽ không thể đăng nhập cho đến khi được mở khóa lại.
                </div>
              </div>
            ) : (
              <div style={{ padding: '14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', color: '#166534' }}>
                Bạn có chắc chắn muốn <strong>mở khóa</strong> cho tài khoản <strong>@{confirmModal.account.username}</strong> ({confirmModal.account.display_name || 'Người dùng'}) không?
                <div style={{ marginTop: '8px', fontSize: '13px', color: '#15803d' }}>
                  Người dùng này sẽ có thể tiếp tục đăng nhập và làm việc bình thường.
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

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
    </>
  )
}


/* ==========================================================================
   SYSTEM AUDIT & ACTIVITY LOGS PAGE
   ========================================================================== */
const AUDIT_ACTION_GROUPS: Record<string, string[]> = {
  group_appointment: ['create_appointment', 'cancel_appointment'],
  group_inspection: ['create_inspection', 'record_result', 'finalize_inspection', 'issue_certificate', 'administrative_correction'],
  group_vehicle_owner: ['create_vehicle', 'create_owner'],
  group_account: ['login', 'register', 'create_account', 'update_role', 'lock_account', 'unlock_account', 'reset_password'],
}

function formatAuditDetailText(text?: string | null): string {
  if (!text) return '—'
  return text
    .replace(/#APT-[A-Za-z0-9]+\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || '—'
}
function AuditLogsPage({ session }: { session: Session }) {
  const [logs, setLogs] = useState<AuditLogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [selectedAction, setSelectedAction] = useState<string>('all')
  const [selectedRole, setSelectedRole] = useState<string>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.auditLogs(session.token, {
        action: selectedAction !== 'all' ? selectedAction : undefined,
        role: selectedRole !== 'all' ? selectedRole : undefined,
        query_text: query.trim() || undefined,
      })
      setLogs(data)
    } catch (err: any) {
      setError(err?.message || 'Không thể tải danh sách nhật ký thao tác.')
    } finally {
      setLoading(false)
    }
  }, [session.token, selectedAction, selectedRole, query])

  useEffect(() => {
    void fetchLogs()
  }, [fetchLogs])

  // Client-side instant filter to ensure ultra-smooth response
  const filteredLogs = useMemo(() => {
    return logs.filter(item => {
      if (selectedAction !== 'all') {
        const groupList = AUDIT_ACTION_GROUPS[selectedAction]
        if (groupList) {
          if (!groupList.includes(item.action)) return false
        } else if (item.action !== selectedAction) {
          return false
        }
      }
      if (selectedRole !== 'all' && item.actor_role !== selectedRole) return false
      if (!query.trim()) return true
      const q = query.toLowerCase()
      return (
        item.actor_username.toLowerCase().includes(q) ||
        (item.actor_display_name && item.actor_display_name.toLowerCase().includes(q)) ||
        item.action_label.toLowerCase().includes(q) ||
        item.entity_type.toLowerCase().includes(q) ||
        (item.after_value && item.after_value.toLowerCase().includes(q)) ||
        (item.before_value && item.before_value.toLowerCase().includes(q))
      )
    })
  }, [logs, selectedAction, selectedRole, query])

  // Pagination: 10 items per page
  const pageSize = 10
  const pagedLogs = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredLogs.slice(start, start + pageSize)
  }, [filteredLogs, currentPage, pageSize])

  const formatTime = (isoString: string) => {
    try {
      const d = new Date(isoString)
      return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch {
      return isoString
    }
  }

  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString)
      return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
    } catch {
      return ''
    }
  }

  const formatDateTime = (isoString: string) => {
    try {
      const d = new Date(isoString)
      return new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(d)
    } catch {
      return isoString
    }
  }

  const getEntityTypeLabel = (type: string) => {
    switch (type) {
      case 'inspection_file': return 'Hồ sơ kiểm định'
      case 'appointment': return 'Lịch hẹn'
      case 'vehicle': return 'Phương tiện'
      case 'owner': return 'Chủ xe'
      case 'account': return 'Tài khoản'
      case 'inspection_item': return 'Hạng mục đo kiểm'
      case 'certificate': return 'GCN / Tem'
      default: return type
    }
  }

  const getActionBadgeColor = (action: string) => {
    if (['create_appointment', 'create_inspection', 'create_vehicle', 'create_owner', 'create_account', 'issue_certificate'].includes(action)) {
      return { bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' }
    }
    if (['cancel_appointment', 'lock_account', 'delete_account'].includes(action)) {
      return { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' }
    }
    if (['update_role', 'reset_password', 'unlock_account', 'administrative_correction'].includes(action)) {
      return { bg: '#f5f3ff', color: '#6d28d9', border: '#ddd6fe' }
    }
    if (['record_result', 'finalize_inspection'].includes(action)) {
      return { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' }
    }
    return { bg: '#f8fafc', color: '#475569', border: '#e2e8f0' }
  }

  return (
    <>
      <div className="section-head">
        <div>
          <h2>Nhật ký thao tác hệ thống</h2>
        </div>
        <div className="section-actions">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                background: '#f1f5f9',
                color: '#334155',
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              Tổng số thao tác: <strong>{filteredLogs.length}</strong>
            </span>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: '20px', marginBottom: '24px' }}>
        {/* Filter bar */}
        <div className="table-filter-bar" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search-input-wrapper" style={{ flex: '1 1 260px', position: 'relative' }}>
            <svg
              className="search-icon"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="table-search-input"
              placeholder="Tìm theo người thực hiện, đối tượng, nội dung..."
              value={query}
              onChange={e => {
                setQuery(e.target.value)
                setCurrentPage(1)
              }}
              style={{
                paddingLeft: '38px',
                height: '44px',
                width: '100%',
                borderRadius: '10px',
                border: '1.5px solid #e2e8f0',
                fontSize: '14px',
              }}
            />
            {query && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => {
                  setQuery('')
                  setCurrentPage(1)
                }}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#94a3b8',
                  fontSize: '16px',
                }}
              >
                ×
              </button>
            )}
          </div>

          <select
            className="table-filter-select"
            value={selectedAction}
            onChange={e => {
              setSelectedAction(e.target.value)
              setCurrentPage(1)
            }}
            style={{
              height: '44px',
              borderRadius: '10px',
              border: '1.5px solid #e2e8f0',
              padding: '0 14px',
              fontSize: '14px',
              minWidth: '220px',
            }}
            title="Lọc theo nhóm thao tác"
          >
            <option value="all">Tất cả thao tác</option>
            <option value="group_appointment">Lịch hẹn (Đặt, Hủy)</option>
            <option value="group_inspection">Kiểm định xe (Tiếp nhận, Đo kiểm, Cấp tem)</option>
            <option value="group_vehicle_owner">Phương tiện & Chủ xe</option>
            <option value="group_account">Tài khoản & Phân quyền</option>
          </select>

          <select
            className="table-filter-select"
            value={selectedRole}
            onChange={e => {
              setSelectedRole(e.target.value)
              setCurrentPage(1)
            }}
            style={{
              height: '44px',
              borderRadius: '10px',
              border: '1.5px solid #e2e8f0',
              padding: '0 14px',
              fontSize: '14px',
              minWidth: '170px',
            }}
            title="Lọc theo vai trò"
          >
            <option value="all">Tất cả vai trò</option>
            <option value="admin">Quản trị viên</option>
            <option value="intake">Nhân viên tiếp nhận</option>
            <option value="inspector">Kiểm định viên</option>
            <option value="owner">Chủ xe</option>
          </select>

          <button
            type="button"
            className="button button-outline"
            onClick={fetchLogs}
            style={{
              height: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '10px',
              padding: '0 16px',
              fontSize: '14px',
              fontWeight: 600,
            }}
            title="Làm mới danh sách nhật ký"
          >
            ↻ Làm mới
          </button>
        </div>

        {error && <div className="form-error" style={{ marginTop: '16px' }}>{error}</div>}

        {/* Data Table */}
        <div style={{ marginTop: '18px', width: '100%', overflowX: 'hidden' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b' }}>
              <div className="loading-spinner" style={{ margin: '0 auto 12px' }} />
              Đang tải nhật ký thao tác hệ thống...
            </div>
          ) : filteredLogs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: '#94a3b8' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔍</div>
              <div style={{ fontWeight: 600, fontSize: '15px', color: '#64748b' }}>Không tìm thấy thao tác nào phù hợp</div>
              <p style={{ fontSize: '13px', marginTop: '4px' }}>Hãy thử điều chỉnh lại bộ lọc tìm kiếm hoặc từ khóa.</p>
            </div>
          ) : (
            <table className="table" style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ width: '95px', textAlign: 'left', padding: '12px 6px', boxSizing: 'border-box', whiteSpace: 'nowrap' }}>THỜI GIAN</th>
                  <th style={{ width: '155px', textAlign: 'left', padding: '12px 8px', boxSizing: 'border-box', whiteSpace: 'nowrap' }}>NGƯỜI THỰC HIỆN</th>
                  <th style={{ width: '145px', textAlign: 'left', padding: '12px 8px', boxSizing: 'border-box', whiteSpace: 'nowrap' }}>VAI TRÒ</th>
                  <th style={{ width: '165px', textAlign: 'left', padding: '12px 8px', boxSizing: 'border-box', whiteSpace: 'nowrap' }}>HÀNH ĐỘNG</th>
                  <th style={{ width: '120px', textAlign: 'left', padding: '12px 8px', boxSizing: 'border-box', whiteSpace: 'nowrap' }}>ĐỐI TƯỢNG</th>
                  <th style={{ textAlign: 'left', padding: '12px 10px', boxSizing: 'border-box', whiteSpace: 'nowrap' }}>NỘI DUNG CHI TIẾT</th>
                  <th style={{ width: '80px', textAlign: 'right', padding: '12px 6px', boxSizing: 'border-box', whiteSpace: 'nowrap' }}>THAO TÁC</th>
                </tr>
              </thead>
              <tbody>
                {pagedLogs.map(item => {
                  const badgeStyle = getActionBadgeColor(item.action)
                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ fontSize: '13px', verticalAlign: 'middle', padding: '12px 6px', boxSizing: 'border-box' }}>
                        <div style={{ fontWeight: 600, color: '#1e293b' }}>
                          {formatTime(item.created_at)}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                          {formatDate(item.created_at)}
                        </div>
                      </td>
                      <td style={{ verticalAlign: 'middle', overflow: 'hidden', padding: '12px 8px', boxSizing: 'border-box' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: '28px',
                              height: '28px',
                              borderRadius: '50%',
                              backgroundColor: '#e0e7ff',
                              color: '#3730a3',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 700,
                              fontSize: '12px',
                              flexShrink: 0,
                            }}
                          >
                            {(item.actor_display_name || item.actor_username).slice(0, 1).toUpperCase()}
                          </div>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <div
                              style={{ fontWeight: 600, fontSize: '12.5px', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              title={item.actor_display_name || item.actor_username}
                            >
                              {item.actor_display_name || item.actor_username}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              @{item.actor_username}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ verticalAlign: 'middle', padding: '12px 8px', boxSizing: 'border-box' }}>
                        <span
                          className={`role-badge-pill role-badge-${item.actor_role}`}
                          style={{ fontSize: '11px', padding: '3px 8px', whiteSpace: 'nowrap', display: 'inline-block' }}
                        >
                          {roleName[item.actor_role] || item.actor_role}
                        </span>
                      </td>
                      <td style={{ verticalAlign: 'middle', padding: '12px 8px', boxSizing: 'border-box' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '11.5px',
                            fontWeight: 600,
                            backgroundColor: badgeStyle.bg,
                            color: badgeStyle.color,
                            border: `1px solid ${badgeStyle.border}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.action_label}
                        </span>
                      </td>
                      <td style={{ verticalAlign: 'middle', padding: '12px 8px', boxSizing: 'border-box' }}>
                        <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                          {getEntityTypeLabel(item.entity_type)}
                        </div>
                      </td>
                      <td style={{ verticalAlign: 'middle', padding: '12px 10px', boxSizing: 'border-box' }}>
                        <div
                          style={{
                            fontSize: '12.5px',
                            color: '#334155',
                            lineHeight: 1.4,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            wordBreak: 'break-word',
                          }}
                          title={formatAuditDetailText(item.after_value || item.before_value)}
                        >
                          {formatAuditDetailText(item.after_value || item.before_value)}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', verticalAlign: 'middle', padding: '12px 6px', boxSizing: 'border-box' }}>
                        <button
                          type="button"
                          className="button button-outline"
                          onClick={() => setSelectedLog(item)}
                          style={{
                            padding: '3px 8px',
                            fontSize: '11.5px',
                            height: '28px',
                            borderRadius: '6px',
                            whiteSpace: 'nowrap',
                          }}
                          title="Xem chi tiết thao tác"
                        >
                          Chi tiết →
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination bar - 10 items per page */}
        <TablePagination
          currentPage={currentPage}
          totalItems={filteredLogs.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          itemName="thao tác"
        />
      </div>

      {/* Modal Detail */}
      {selectedLog && (
        <div
          className="modal-backdrop"
          onMouseDown={e => {
            if (e.target === e.currentTarget) setSelectedLog(null)
          }}
        >
          <div className="form-modal" style={{ maxWidth: '640px' }}>
            <div className="modal-heading">
              <div>
                <div className="eyebrow">NHẬT KÝ KIỂM TOÁN HỆ THỐNG</div>
                <h2>Chi tiết thao tác</h2>
                <p>Thông tin kiểm toán và truy vết thay đổi</p>
              </div>
              <button type="button" className="close-button" onClick={() => setSelectedLog(null)}>
                ×
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '8px', alignItems: 'center' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Thời gian:</span>
                <span style={{ fontWeight: 600, color: '#1e293b' }}>
                  {formatDateTime(selectedLog.created_at)}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '8px', alignItems: 'center' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Người thực hiện:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <strong>{selectedLog.actor_display_name || selectedLog.actor_username}</strong>
                  <span className={`role-badge-pill role-badge-${selectedLog.actor_role}`}>
                    {roleName[selectedLog.actor_role]}
                  </span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '8px', alignItems: 'center' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Hành động:</span>
                <span>
                  <strong style={{ color: '#1e293b' }}>{selectedLog.action_label}</strong>
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '8px', alignItems: 'center' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Đối tượng tác động:</span>
                <span style={{ fontWeight: 600, color: '#1e293b' }}>
                  {getEntityTypeLabel(selectedLog.entity_type)}
                </span>
              </div>

              {selectedLog.before_value && (
                <div>
                  <div style={{ color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>Dữ liệu trước thay đổi:</div>
                  <pre
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '12px',
                      fontSize: '12.5px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      margin: 0,
                      color: '#b91c1c',
                    }}
                  >
                    {formatAuditDetailText(selectedLog.before_value)}
                  </pre>
                </div>
              )}

              <div>
                <div style={{ color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>Nội dung chi tiết / Dữ liệu sau thao tác:</div>
                <pre
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '12px',
                    fontSize: '12.5px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    margin: 0,
                    color: '#047857',
                  }}
                >
                  {formatAuditDetailText(selectedLog.after_value) || 'Không có dữ liệu bổ sung'}
                </pre>
              </div>
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
              <button
                type="button"
                className="button button-primary"
                onClick={() => setSelectedLog(null)}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ==========================================================================
   PERSONAL PROFILE EDIT PAGE
   ========================================================================== */
function ProfilePage({
  session,
  onProfileUpdated,
  onBack,
}: {
  session: Session
  onProfileUpdated: (updated: UserProfile) => void
  onBack: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Auto-dismiss floating toast notifications
  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => setSuccess(''), 4500)
    return () => clearTimeout(timer)
  }, [success])

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(''), 5500)
    return () => clearTimeout(timer)
  }, [error])

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleAvatarFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setError('Vui lòng chọn một tệp hình ảnh hợp lệ (JPG, PNG, WebP).')
      return
    }

    const reader = new FileReader()
    reader.onload = (loadEvent) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const MAX_DIM = 320
        let w = img.width
        let h = img.height
        if (w > h) {
          if (w > MAX_DIM) {
            h = Math.round((h * MAX_DIM) / w)
            w = MAX_DIM
          }
        } else {
          if (h > MAX_DIM) {
            w = Math.round((w * MAX_DIM) / h)
            h = MAX_DIM
          }
        }
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
          setAvatarUrl(dataUrl)
        }
      }
      img.src = loadEvent.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  // Password fields
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)



  useEffect(() => {
    let isMounted = true
    setLoading(true)
    api.getProfile(session.token)
      .then(p => {
        if (!isMounted) return
        setDisplayName(p.display_name || '')
        setEmail(p.email || '')
        setPhone(p.phone || '')
        setAvatarUrl(p.avatar_url || '')
      })
      .catch(err => {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : 'Không thể tải thông tin hồ sơ.')
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })
    return () => { isMounted = false }
  }, [session.token])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (newPassword) {
      if (!currentPassword) {
        setError('Vui lòng nhập mật khẩu hiện tại để xác nhận đổi mật khẩu.')
        return
      }
      if (newPassword.length < 6) {
        setError('Mật khẩu mới phải có ít nhất 6 ký tự.')
        return
      }
      if (newPassword !== confirmPassword) {
        setError('Mật khẩu xác nhận không khớp với mật khẩu mới.')
        return
      }
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Định dạng email không hợp lệ (Ví dụ: user@example.com).')
      return
    }

    setSaving(true)
    try {
      const updated = await api.updateProfile(session.token, {
        display_name: displayName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        avatar_url: avatarUrl.trim() || null,
        current_password: newPassword ? currentPassword : null,
        new_password: newPassword ? newPassword : null,
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setSuccess('Cập nhật thông tin cá nhân thành công!')
      onProfileUpdated(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cập nhật thất bại. Vui lòng thử lại.')
    } finally {
      setSaving(false)
    }
  }

  const roleLabels: Record<Role, string> = {
    admin: 'Quản trị viên hệ thống (Toàn quyền)',
    intake: 'Nhân viên tiếp nhận hồ sơ đăng kiểm',
    inspector: 'Kiểm định viên kỹ thuật chuyền',
    owner: 'Chủ phương tiện xe cơ giới',
  }

  if (loading) {
    return (
      <div className="card" style={{ padding: '60px 20px', textAlign: 'center' }}>
        <div className="loading-line" style={{ display: 'inline-flex' }}>
          <span /> Đang đồng bộ thông tin tài khoản...
        </div>
      </div>
    )
  }

  return (
    <div className="profile-page-wrapper">
      <div className="profile-top-header">
        <div>
          <div className="eyebrow">TÀI KHOẢN VÀ ĐỊNH DANH</div>
          <h2>Hồ sơ cá nhân</h2>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="profile-main-grid">
        {/* Left Column: Avatar & Overview */}
        <div className="card profile-avatar-card">
          <div className="profile-avatar-display">
            <div
              className="profile-avatar-circle"
              onClick={() => fileInputRef.current?.click()}
              title="Bấm vào để đổi ảnh đại diện"
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Ảnh đại diện"
                  onError={() => {
                    // Fallback on broken image link
                  }}
                />
              ) : (
                <span className="profile-avatar-fallback">
                  {(displayName || session.username).slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="profile-avatar-overlay">
                <span>Đổi ảnh</span>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleAvatarFileChange}
            />

            <div className="profile-meta-center">
              <h3>{displayName || session.username}</h3>
              <span className="profile-username-tag">@{session.username}</span>
              <div style={{ marginTop: '8px' }}>
                <span className={`role-badge-pill role-badge-${session.role}`}>
                  {roleName[session.role]}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Editable Details and Password */}
        <div className="profile-content-cards">
          {/* Section 1: Basic Information */}
          <div className="card profile-section-box">
            <div className="section-header">
              <div className="section-badge">1</div>
              <div>
                <h3>Thông tin cá nhân</h3>
                <p>Tên hiển thị và các thông tin liên lạc được hiển thị trên hệ thống.</p>
              </div>
            </div>

            <div className="form-grid">
              <Field label="Tên hiển thị" required>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="Ví dụ: Nguyễn Văn An"
                  maxLength={255}
                />
              </Field>

              <Field label="Địa chỉ Email">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Ví dụ: nguyenvana@dangkiem.vn"
                  maxLength={255}
                />
              </Field>

              <Field label="Số điện thoại liên lạc">
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="Ví dụ: 0912345678"
                  maxLength={30}
                />
              </Field>

              <Field label="Tên đăng nhập (Cố định)">
                <input
                  type="text"
                  disabled
                  value={session.username}
                  className="input-disabled"
                  title="Tên tài khoản không thể thay đổi sau khi đăng ký"
                />
              </Field>

              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Vai trò / Quyền hạn trên hệ thống">
                  <input
                    type="text"
                    disabled
                    value={roleLabels[session.role]}
                    className="input-disabled"
                  />
                </Field>
              </div>
            </div>
          </div>

          {/* Section 2: Password Management */}
          <div className="card profile-section-box" style={{ marginTop: '20px' }}>
            <div className="section-header">
              <div className="section-badge">2</div>
              <div>
                <h3>Đổi mật khẩu tài khoản</h3>
                <p>Bảo vệ an toàn cho tài khoản của bạn. <em>(Để trống nếu không muốn đổi mật khẩu)</em></p>
              </div>
            </div>

            <div className="form-grid">
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Mật khẩu hiện tại (Bắt buộc nếu đổi mật khẩu)">
                  <div className="pw-input-container">
                    <input
                      type={showCurrentPw ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      placeholder="Nhập mật khẩu hiện tại"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="pw-toggle-inline"
                      onClick={() => setShowCurrentPw(!showCurrentPw)}
                    >
                      {showCurrentPw ? 'Ẩn' : 'Hiện'}
                    </button>
                  </div>
                </Field>
              </div>

              <Field label="Mật khẩu mới">
                <div className="pw-input-container">
                  <input
                    type={showNewPw ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Tối thiểu 6 ký tự"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="pw-toggle-inline"
                    onClick={() => setShowNewPw(!showNewPw)}
                  >
                    {showNewPw ? 'Ẩn' : 'Hiện'}
                  </button>
                </div>
              </Field>

              <Field label="Xác nhận mật khẩu mới">
                <div className="pw-input-container">
                  <input
                    type={showConfirmPw ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Nhập lại mật khẩu mới"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="pw-toggle-inline"
                    onClick={() => setShowConfirmPw(!showConfirmPw)}
                  >
                    {showConfirmPw ? 'Ẩn' : 'Hiện'}
                  </button>
                </div>
              </Field>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="profile-actions-bar">
            <button
              type="button"
              className="button button-outline"
              onClick={onBack}
              disabled={saving}
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={saving}
              style={{ minWidth: '170px' }}
            >
              {saving ? 'Đang cập nhật...' : 'Lưu thông tin'}
            </button>
          </div>
        </div>
      </form>

      {/* Floating Toast Notification Messages (Bottom-Right) */}
      <div className="toast-container" aria-live="polite">
        {error && (
          <div className="toast-message toast-error" role="alert">
            <span className="toast-icon">!</span>
            <div className="toast-content">{error}</div>
            <button type="button" className="toast-close" onClick={() => setError('')} aria-label="Đóng thông báo">×</button>
          </div>
        )}
        {success && (
          <div className="toast-message toast-success" role="status">
            <span className="toast-icon">✓</span>
            <div className="toast-content">{success}</div>
            <button type="button" className="toast-close" onClick={() => setSuccess('')} aria-label="Đóng thông báo">×</button>
          </div>
        )}
      </div>
    </div>
  )
}

