import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import {
  createClient,
  type Session,
  type User,
} from '@supabase/supabase-js'

import './App.css'
import API_URL, { SUPABASE_URL, SUPABASE_ANON_KEY } from './config'

// ============================================================
// SUPABASE CONFIG
// ============================================================

const AUTH_REDIRECT_URL =
  import.meta.env.VITE_AUTH_REDIRECT_URL?.trim() ||
  window.location.origin

const PASSWORD_RESET_REDIRECT_URL =
  `${AUTH_REDIRECT_URL.replace(/\/$/, '')}/?reset=1`

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        }
      )
    : null

// ============================================================
// TYPES
// ============================================================

type ProspectStatus =
  | 'Hot'
  | 'Warm'
  | 'Cold'

type CrmStatus =
  | ProspectStatus
  | 'Contacted'
  | 'Replied'
  | 'Won'
  | 'Lost'

type Prospect = {
  id?: string
  businessName: string
  industry: string
  location: string
  website: string
  contactEmail?: string
  contactName?: string
  contactRole?: string
  sourceUrls?: string[]
  likelyNeed: string
  reason: string
  suggestedService: string
  outreachAngle: string
  priorityScore: number
  status: CrmStatus
  notes?: string
  createdAt?: string | null
  updatedAt?: string | null
}

type HuntResult = {
  success: boolean
  prospects?: Prospect[]
  sourceCount?: number
  sources?: {
    title: string
    url: string
  }[]
  error?: string
}

type LeadsResult = {
  success: boolean
  leads?: Prospect[]
  error?: string
}

type ApiResult = {
  success: boolean
  lead?: Prospect
  text?: string
  duplicate?: boolean
  error?: string
}

// ============================================================
// HELPERS
// ============================================================

function getStatus(score: number): ProspectStatus {
  if (score >= 80) return 'Hot'
  if (score >= 60) return 'Warm'
  return 'Cold'
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')
    .slice(0, 2) || 'L'
}

async function safeJson(response: Response): Promise<any> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

// ============================================================
// API FETCH WITH AUTH
// ============================================================

async function apiFetch(
  path: string,
  options: RequestInit = {},
  accessToken?: string | null
): Promise<Response> {
  const headers = new Headers(options.headers)

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  return fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  })
}

// ============================================================
// AUTH SCREEN
// ============================================================

type AuthMode = 'login' | 'signup'

function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [forgotPassword, setForgotPassword] = useState(false)

  const sendPasswordReset = async () => {
    setError('')
    setMessage('')

    const cleanEmail = email.trim().toLowerCase()

    if (!cleanEmail) {
      setError('Please enter your email address first.')
      return
    }

    if (!supabase) {
      setError('Supabase authentication is not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
      return
    }

    setLoading(true)

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        cleanEmail,
        { redirectTo: PASSWORD_RESET_REDIRECT_URL }
      )

      if (resetError) throw resetError

      setMessage('Password reset email sent. Check your inbox.')
    } catch (error) {
      console.error('Password reset error:', error)
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to send password reset email.'
      )
    } finally {
      setLoading(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()

    setError('')
    setMessage('')

    const cleanEmail = email.trim().toLowerCase()

    if (!cleanEmail) {
      setError('Please enter your email address.')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    if (!supabase) {
      setError('Supabase authentication is not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
      return
    }

    setLoading(true)

    try {
      if (mode === 'login') {
        const { error: loginError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        })

        if (loginError) throw loginError

        setMessage('Signed in successfully.')
      } else {
        const { data, error: signupError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo: AUTH_REDIRECT_URL,
          },
        })

        if (signupError) throw signupError

        if (!data.session) {
          setMessage(
            `Account created. Please confirm your email. After confirmation, you will be returned to ${AUTH_REDIRECT_URL}.`
          )
        } else {
          setMessage('Account created successfully.')
        }
      }
    } catch (error) {
      console.error('Authentication error:', error)
      setError(
        error instanceof Error
          ? error.message
          : 'Authentication failed.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-shell">
      <main
        className="main-content"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '30px',
          boxSizing: 'border-box',
        }}
      >
        <section className="panel" style={{ width: 'min(460px, 100%)' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div className="brand-mark" style={{ margin: '0 auto 16px' }}>
              AI
            </div>
            <h1 style={{ marginBottom: '8px' }}>AI Client Hunter</h1>
            <p>AI Sales Intelligence</p>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            <button
              type="button"
              className={mode === 'login' ? 'primary-button' : 'text-button'}
              onClick={() => {
                setMode('login')
                setError('')
                setMessage('')
              }}
              style={{ flex: 1 }}
            >
              Sign In
            </button>

            <button
              type="button"
              className={mode === 'signup' ? 'primary-button' : 'text-button'}
              onClick={() => {
                setMode('signup')
                setError('')
                setMessage('')
              }}
              style={{ flex: 1 }}
            >
              Create Account
            </button>
          </div>

          {!forgotPassword && (
            <form onSubmit={submit}>
              <label style={{ display: 'block', marginBottom: '7px' }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                style={{ width: '100%', boxSizing: 'border-box', marginBottom: '15px' }}
              />

              <label style={{ display: 'block', marginBottom: '7px' }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimum 6 characters"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                style={{ width: '100%', boxSizing: 'border-box', marginBottom: '15px' }}
              />

              {mode === 'login' && !forgotPassword && (
                <div style={{ textAlign: 'right', marginTop: '-7px', marginBottom: '15px' }}>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setForgotPassword(true)
                      setError('')
                      setMessage('')
                    }}
                    style={{ padding: '4px 0', fontSize: '14px' }}
                  >
                    Forgot Password?
                  </button>
                </div>
              )}

              {mode === 'signup' && (
                <>
                  <label style={{ display: 'block', marginBottom: '7px' }}>
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Repeat your password"
                    autoComplete="new-password"
                    style={{ width: '100%', boxSizing: 'border-box', marginBottom: '15px' }}
                  />
                </>
              )}

              {error && (
                <div
                  style={{
                    padding: '12px',
                    marginBottom: '15px',
                    borderRadius: '10px',
                    background: 'rgba(220, 53, 69, .10)',
                  }}
                >
                  {error}
                </div>
              )}

              {message && (
                <div
                  style={{
                    padding: '12px',
                    marginBottom: '15px',
                    borderRadius: '10px',
                    background: 'rgba(25, 135, 84, .10)',
                  }}
                >
                  {message}
                </div>
              )}

              <button
                type="submit"
                className="primary-button"
                disabled={loading}
                style={{ width: '100%' }}
              >
                {loading
                  ? 'Please wait...'
                  : mode === 'login'
                    ? 'Sign In'
                    : 'Create Account'}
              </button>
            </form>
          )}

          {forgotPassword && (
            <div>
              <p style={{ marginBottom: '18px', lineHeight: 1.6 }}>
                Enter your email and we will send you a secure password reset link.
              </p>

              <label style={{ display: 'block', marginBottom: '7px' }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                style={{ width: '100%', boxSizing: 'border-box', marginBottom: '15px' }}
              />

              {error && (
                <div
                  style={{
                    padding: '12px',
                    marginBottom: '15px',
                    borderRadius: '10px',
                    background: 'rgba(220, 53, 69, .10)',
                  }}
                >
                  {error}
                </div>
              )}

              {message && (
                <div
                  style={{
                    padding: '12px',
                    marginBottom: '15px',
                    borderRadius: '10px',
                    background: 'rgba(25, 135, 84, .10)',
                  }}
                >
                  {message}
                </div>
              )}

              <button
                type="button"
                className="primary-button"
                disabled={loading}
                onClick={sendPasswordReset}
                style={{ width: '100%', marginBottom: '10px' }}
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>

              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setForgotPassword(false)
                  setError('')
                  setMessage('')
                }}
                style={{ width: '100%' }}
              >
                Back to Sign In
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

// ============================================================
// PASSWORD RESET SCREEN
// ============================================================

function PasswordResetScreen() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setMessage('')

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    if (!supabase) {
      setError('Supabase authentication is not configured.')
      return
    }

    setLoading(true)

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })

      if (updateError) throw updateError

      setMessage('Password updated successfully. Redirecting to sign in...')

      await supabase.auth.signOut()

      setTimeout(() => {
        window.location.href = window.location.origin
      }, 1200)
    } catch (error) {
      console.error('Password update error:', error)
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to update password.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-shell">
      <main
        className="main-content"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '30px',
          boxSizing: 'border-box',
        }}
      >
        <section className="panel" style={{ width: 'min(460px, 100%)' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div className="brand-mark" style={{ margin: '0 auto 16px' }}>
              AI
            </div>
            <h1 style={{ marginBottom: '8px' }}>Set New Password</h1>
            <p>Create a new password for your AI Client Hunter account.</p>
          </div>

          <form onSubmit={updatePassword}>
            <label style={{ display: 'block', marginBottom: '7px' }}>
              New Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Minimum 6 characters"
              autoComplete="new-password"
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: '15px' }}
            />

            <label style={{ display: 'block', marginBottom: '7px' }}>
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repeat your new password"
              autoComplete="new-password"
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: '15px' }}
            />

            {error && (
              <div
                style={{
                  padding: '12px',
                  marginBottom: '15px',
                  borderRadius: '10px',
                  background: 'rgba(220, 53, 69, .10)',
                }}
              >
                {error}
              </div>
            )}

            {message && (
              <div
                style={{
                  padding: '12px',
                  marginBottom: '15px',
                  borderRadius: '10px',
                  background: 'rgba(25, 135, 84, .10)',
                }}
              >
                {message}
              </div>
            )}

            <button
              type="submit"
              className="primary-button"
              disabled={loading}
              style={{ width: '100%' }}
            >
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </section>
      </main>
    </div>
  )
}

// ============================================================
// MAIN APPLICATION
// ============================================================

function App() {
  // AUTH
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')

  // NAVIGATION
  const [activePage, setActivePage] = useState('Dashboard')

  const menuItems = [
    { name: 'Dashboard', icon: '▦' },
    { name: 'AI Sales Chat', icon: '✦' },
    { name: 'Leads', icon: '♙' },
    { name: 'Products & Demos', icon: '◈' },
    { name: 'Settings', icon: '⚙' },
  ]

  // HUNTER
  const [niche, setNiche] = useState('')
  const [location, setLocation] = useState('')
  const [service, setService] = useState('')
  const [additionalInfo, setAdditionalInfo] = useState('')
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [researchSources, setResearchSources] = useState<{ title: string; url: string }[]>([])
  const [hunterLoading, setHunterLoading] = useState(false)
  const [hunterError, setHunterError] = useState('')

  // CRM
  const [savedLeads, setSavedLeads] = useState<Prospect[]>([])
  const [leadsLoading, setLeadsLoading] = useState(false)
  const [selectedLead, setSelectedLead] = useState<Prospect | null>(null)
  const [leadActionLoading, setLeadActionLoading] = useState('')
  const [leadFilter, setLeadFilter] = useState<'All' | CrmStatus>('All')

  // CHAT
  const [message, setMessage] = useState('')
  const [chatResponse, setChatResponse] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  // OUTREACH
  const [outreachText, setOutreachText] = useState('')
  const [outreachChannel, setOutreachChannel] = useState('Email')
  const [outreachLoading, setOutreachLoading] = useState(false)

  // AUTOPILOT
  const [autopilotActive, setAutopilotActive] = useState(false)
  const [autopilotLoading, setAutopilotLoading] = useState(false)
  const [autopilotMessage, setAutopilotMessage] = useState('')
  const [autopilotLastRun, setAutopilotLastRun] = useState<string | null>(null)
  const [autopilotStats, setAutopilotStats] = useState<{
    found?: number
    strong?: number
    saved?: number
    emailed?: number
  } | null>(null)
  const [emailReady, setEmailReady] = useState(false)
  const [replyMonitorReady, setReplyMonitorReady] = useState(false)
  const [serviceStatusLoading, setServiceStatusLoading] = useState(true)

  // Sender profile
  const readLocalSetting = (key: string): string => {
    try {
      return localStorage.getItem(key) || ''
    } catch {
      return ''
    }
  }

  const writeLocalSetting = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      // ignore
    }
  }

  const [senderName, setSenderName] = useState(() => readLocalSetting('ach_sender_name'))
  const [senderCompany, setSenderCompany] = useState(() => readLocalSetting('ach_sender_company'))

  // AUTH INITIALIZATION
  useEffect(() => {
    let mounted = true

    const initializeAuth = async () => {
      if (!supabase) {
        if (mounted) {
          setAuthError(
            'Supabase authentication is not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
          )
          setAuthLoading(false)
        }
        return
      }

      try {
        const { data, error } = await supabase.auth.getSession()

        if (error) throw error

        if (!mounted) return

        setSession(data.session)
        setUser(data.session?.user ?? null)
      } catch (error) {
        console.error('Get session error:', error)
        if (mounted) {
          setAuthError(
            error instanceof Error
              ? error.message
              : 'Unable to restore authentication session.'
          )
        }
      } finally {
        if (mounted) setAuthLoading(false)
      }
    }

    initializeAuth()

    if (!supabase) {
      return () => {
        mounted = false
      }
    }

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!mounted) return
        setSession(nextSession)
        setUser(nextSession?.user ?? null)
        setAuthError('')
        setAuthLoading(false)
      }
    )

    return () => {
      mounted = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  // LOGOUT
  const handleLogout = async () => {
    if (!supabase) return

    try {
      await supabase.auth.signOut()
      setSession(null)
      setUser(null)
      setProspects([])
      setSavedLeads([])
      setSelectedLead(null)
      setChatResponse('')
      setOutreachText('')
    } catch (error) {
      console.error('Logout error:', error)
      alert(error instanceof Error ? error.message : 'Unable to sign out.')
    }
  }

  // LOAD SAVED LEADS
  const loadLeads = useCallback(async () => {
    if (!session?.access_token) {
      setSavedLeads([])
      return
    }

    setLeadsLoading(true)

    try {
      const response = await apiFetch('/api/leads', {}, session.access_token)
      const data: LeadsResult = await safeJson(response)

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Unable to load leads.')
      }

      setSavedLeads(data.leads || [])
    } catch (error) {
      console.error('Load leads:', error)
    } finally {
      setLeadsLoading(false)
    }
  }, [session?.access_token])

  useEffect(() => {
    if (!user || !session) return
    loadLeads()
  }, [user, session, loadLeads])

  // STATS
  const hotProspects = useMemo(
    () => prospects.filter((item) => item.priorityScore >= 80).length,
    [prospects]
  )

  const averageScore = useMemo(() => {
    if (!prospects.length) return 0
    return Math.round(
      prospects.reduce((total, item) => total + item.priorityScore, 0) /
        prospects.length
    )
  }, [prospects])

  const filteredLeads = useMemo(() => {
    if (leadFilter === 'All') return savedLeads
    return savedLeads.filter((lead) => lead.status === leadFilter)
  }, [savedLeads, leadFilter])

  // HUNT
  const findClients = async () => {
    if (!session?.access_token) {
      setHunterError('Your session has expired. Please sign in again.')
      return
    }

    if (!niche.trim()) {
      setHunterError('Please enter a niche.')
      return
    }

    setHunterLoading(true)
    setHunterError('')
    setProspects([])
    setResearchSources([])

    try {
      const response = await apiFetch(
        '/api/hunt',
        {
          method: 'POST',
          body: JSON.stringify({
            niche: niche.trim(),
            location: location.trim(),
            service: service.trim(),
            additionalInfo: additionalInfo.trim(),
          }),
        },
        session.access_token
      )

      const data: HuntResult = await safeJson(response)

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Client hunt failed.')
      }

      setProspects(data.prospects || [])
      setResearchSources(data.sources || [])
    } catch (error) {
      setHunterError(
        error instanceof Error ? error.message : 'Client hunt failed.'
      )
    } finally {
      setHunterLoading(false)
    }
  }

  // SAVE LEAD
  const saveLead = async (prospect: Prospect) => {
    if (!session?.access_token) {
      alert('Your session has expired. Please sign in again.')
      return
    }

    const key = prospect.website || prospect.businessName
    setLeadActionLoading(key)

    try {
      const response = await apiFetch(
        '/api/leads',
        {
          method: 'POST',
          body: JSON.stringify(prospect),
        },
        session.access_token
      )

      const data: ApiResult = await safeJson(response)

      if (response.status === 409) {
        alert('This lead is already saved.')
        await loadLeads()
        return
      }

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Unable to save lead.')
      }

      await loadLeads()
      alert('Lead saved successfully.')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to save lead.')
    } finally {
      setLeadActionLoading('')
    }
  }

  // DELETE LEAD
  const deleteLead = async (lead: Prospect) => {
    if (!session?.access_token) {
      alert('Your session has expired. Please sign in again.')
      return
    }

    if (!lead.id) return

    if (!window.confirm(`Delete ${lead.businessName}?`)) return

    setLeadActionLoading(lead.id)

    try {
      const response = await apiFetch(
        `/api/leads/${lead.id}`,
        { method: 'DELETE' },
        session.access_token
      )

      const data: ApiResult = await safeJson(response)

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Delete failed.')
      }

      setSelectedLead(null)
      await loadLeads()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Delete failed.')
    } finally {
      setLeadActionLoading('')
    }
  }

  // UPDATE LEAD
  const updateLead = async (
    lead: Prospect,
    updates: { status?: CrmStatus; notes?: string }
  ) => {
    if (!session?.access_token) {
      alert('Your session has expired. Please sign in again.')
      return
    }

    if (!lead.id) return

    try {
      const response = await apiFetch(
        `/api/leads/${lead.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(updates),
        },
        session.access_token
      )

      const data: ApiResult = await safeJson(response)

      if (!response.ok || !data.success || !data.lead) {
        throw new Error(data.error || 'Update failed.')
      }

      setSelectedLead(data.lead)
      await loadLeads()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Update failed.')
    }
  }

  // OUTREACH
  const generateOutreach = async (lead: Prospect, channel: string) => {
    if (!session?.access_token) {
      alert('Your session has expired. Please sign in again.')
      return
    }

    setSelectedLead(lead)
    setOutreachChannel(channel)
    setOutreachText('')
    setOutreachLoading(true)

    try {
      const response = await apiFetch(
        '/api/outreach',
        {
          method: 'POST',
          body: JSON.stringify({
            lead,
            channel,
            senderName: senderName.trim(),
            senderCompany: senderCompany.trim(),
          }),
        },
        session.access_token
      )

      const data: ApiResult = await safeJson(response)

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Outreach failed.')
      }

      setOutreachText(data.text || '')
    } catch (error) {
      setOutreachText(
        error instanceof Error ? error.message : 'Unable to generate outreach.'
      )
    } finally {
      setOutreachLoading(false)
    }
  }

  // AUTOPILOT STATUS (FIXED - safe JSON)
  const refreshAutopilotStatus = useCallback(async () => {
    setServiceStatusLoading(true)
    try {
      // Public config endpoint
      try {
        const publicResponse = await fetch(`${API_URL}/api/config-status`, {
          cache: 'no-store',
        })
        const publicData = await safeJson(publicResponse)

        if (publicResponse.ok && publicData.success) {
          setEmailReady(
            Boolean(publicData.services?.brevo || publicData.services?.smtp)
          )
          setReplyMonitorReady(Boolean(publicData.services?.imap))
        } else {
          setEmailReady(false)
          setReplyMonitorReady(false)
        }
      } catch (statusError) {
        console.error('Service config status:', statusError)
        setEmailReady(false)
        setReplyMonitorReady(false)
      }

      if (!session?.access_token) return

      const response = await apiFetch(
        '/api/autopilot/status',
        {},
        session.access_token
      )
      const data = await safeJson(response)

      if (!response.ok || !data.success) return

      setAutopilotActive(Boolean(data.active))
      setAutopilotLastRun(data.lastRunAt || null)
      setAutopilotStats(data.lastResult || null)
    } catch (error) {
      console.error('Autopilot status:', error)
    } finally {
      setServiceStatusLoading(false)
    }
  }, [session?.access_token])

  useEffect(() => {
    if (!session?.access_token) return
    refreshAutopilotStatus()
    const timer = window.setInterval(refreshAutopilotStatus, 30000)
    return () => window.clearInterval(timer)
  }, [session?.access_token, refreshAutopilotStatus])

  const startAutopilot = async () => {
    if (!session?.access_token) {
      setAutopilotMessage('Your session has expired. Please sign in again.')
      return
    }
    if (!niche.trim()) {
      setAutopilotMessage('Enter your target niche first.')
      return
    }

    setAutopilotLoading(true)
    setAutopilotMessage('')

    try {
      const response = await apiFetch(
        '/api/autopilot/start',
        {
          method: 'POST',
          body: JSON.stringify({
            niche: niche.trim(),
            location: location.trim(),
            service: service.trim(),
            additionalInfo: additionalInfo.trim(),
            senderName: senderName.trim(),
            senderCompany: senderCompany.trim(),
          }),
        },
        session.access_token
      )

      const data = await safeJson(response)

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Unable to start autopilot.')
      }

      setAutopilotActive(true)
      setAutopilotLastRun(new Date().toISOString())
      setAutopilotStats(data.firstRun || null)
      setAutopilotMessage(
        `Autopilot is ON. First run found ${data.firstRun?.found || 0} leads and emailed ${data.firstRun?.emailed || 0}${
          data.firstRun?.provider ? ` via ${data.firstRun.provider}` : ''
        }.`
      )
      await loadLeads()
    } catch (error) {
      setAutopilotMessage(
        error instanceof Error ? error.message : 'Unable to start autopilot.'
      )
    } finally {
      setAutopilotLoading(false)
    }
  }

  const stopAutopilot = async () => {
    if (!session?.access_token) return

    setAutopilotLoading(true)

    try {
      const response = await apiFetch(
        '/api/autopilot/stop',
        { method: 'POST' },
        session.access_token
      )
      const data = await safeJson(response)

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Unable to stop autopilot.')
      }

      setAutopilotActive(false)
      setAutopilotMessage('Autopilot stopped.')
    } catch (error) {
      setAutopilotMessage(
        error instanceof Error ? error.message : 'Unable to stop autopilot.'
      )
    } finally {
      setAutopilotLoading(false)
    }
  }

  const runAutopilotNow = async () => {
    if (!session?.access_token) return

    setAutopilotLoading(true)
    setAutopilotMessage('')

    try {
      const response = await apiFetch(
        '/api/autopilot/run-now',
        {
          method: 'POST',
          body: JSON.stringify({
            niche: niche.trim(),
            location: location.trim(),
            service: service.trim(),
            additionalInfo: additionalInfo.trim(),
            senderName: senderName.trim(),
            senderCompany: senderCompany.trim(),
          }),
        },
        session.access_token
      )

      const data = await safeJson(response)

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Autonomous hunt failed.')
      }

      setAutopilotLastRun(new Date().toISOString())
      setAutopilotStats(data)
      setAutopilotMessage(
        `Run complete: ${data.found || 0} found, ${data.emailed || 0} emails sent${
          data.provider ? ` via ${data.provider}` : ''
        }.`
      )
      await loadLeads()
    } catch (error) {
      setAutopilotMessage(
        error instanceof Error ? error.message : 'Autonomous hunt failed.'
      )
    } finally {
      setAutopilotLoading(false)
    }
  }

  // AI SALES CHAT
  const sendMessage = async () => {
    if (!session?.access_token) {
      setChatResponse('Your session has expired. Please sign in again.')
      return
    }

    if (!message.trim() || chatLoading) return

    const currentMessage = message.trim()
    setMessage('')
    setChatLoading(true)

    try {
      const response = await apiFetch(
        '/api/generate',
        {
          method: 'POST',
          body: JSON.stringify({
            prompt: `
You are the AI Sales Assistant inside AI Client Hunter.

User:

${currentMessage}

Give a useful and actionable sales answer.

Do not invent factual information.
            `,
          }),
        },
        session.access_token
      )

      const data: ApiResult = await safeJson(response)

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'AI request failed.')
      }

      setChatResponse(data.text || '')
    } catch (error) {
      setChatResponse(
        error instanceof Error ? error.message : 'AI request failed.'
      )
    } finally {
      setChatLoading(false)
    }
  }

  // AUTH LOADING
  if (authLoading) {
    return (
      <div className="app-shell">
        <main
          className="main-content"
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <section className="panel" style={{ textAlign: 'center', maxWidth: '420px' }}>
            <div className="brand-mark" style={{ margin: '0 auto 20px' }}>
              AI
            </div>
            <h2>Loading AI Client Hunter...</h2>
            <p>Restoring your secure session.</p>
          </section>
        </main>
      </div>
    )
  }

  // AUTH ERROR
  if (authError && !user) {
    return (
      <div className="app-shell">
        <main
          className="main-content"
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <section className="panel" style={{ maxWidth: '560px' }}>
            <h2>Authentication Configuration</h2>
            <p>{authError}</p>
            <p>Make sure your frontend environment contains:</p>
            <pre style={{ padding: '14px', borderRadius: '10px', overflow: 'auto' }}>
{`VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_AUTH_REDIRECT_URL=your_reachable_frontend_url`}
            </pre>
          </section>
        </main>
      </div>
    )
  }

  // NOT LOGGED IN
  if (!user || !session) {
    return <AuthScreen />
  }

  // MAIN APP
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">AI</div>
          <div>
            <div className="brand-title">Client Hunter</div>
            <div className="brand-subtitle">AI Sales Intelligence</div>
          </div>
        </div>

        <nav className="navigation">
          {menuItems.map((item) => (
            <button
              key={item.name}
              className={`nav-item ${activePage === item.name ? 'active' : ''}`}
              onClick={() => setActivePage(item.name)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.name}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="usage-card">
            <div className="usage-title">CRM Leads</div>
            <div className="usage-value">{savedLeads.length}</div>
            <div className="usage-text">saved prospects</div>
          </div>

          <div className="user-card">
            <div className="avatar">{getInitials(user.email || 'User')}</div>
            <div className="user-info">
              <strong>{user.email || 'User'}</strong>
              <span>Authenticated</span>
            </div>
          </div>

          <button
            className="text-button"
            onClick={handleLogout}
            style={{ width: '100%', marginTop: '10px' }}
          >
            Sign Out
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <h1>{activePage}</h1>
            <p>AI powered prospecting and lead management.</p>
          </div>
          <button
            className="primary-button"
            onClick={() => setActivePage('Dashboard')}
          >
            ✦ Hunt Clients
          </button>
        </header>

        {/* DASHBOARD */}
        {activePage === 'Dashboard' && (
          <>
            <section className="stats-grid">
              <div className="stat-card">
                <div>
                  <span>Current Prospects</span>
                  <strong>{prospects.length}</strong>
                </div>
              </div>
              <div className="stat-card">
                <div>
                  <span>Hot Prospects</span>
                  <strong>{hotProspects}</strong>
                </div>
              </div>
              <div className="stat-card">
                <div>
                  <span>Average Score</span>
                  <strong>{averageScore}</strong>
                </div>
              </div>
              <div className="stat-card">
                <div>
                  <span>Saved Leads</span>
                  <strong>{savedLeads.length}</strong>
                </div>
              </div>
            </section>

            <section className="panel" style={{ marginBottom: '24px' }}>
              <div className="panel-header">
                <div>
                  <h2>AI Client Hunter</h2>
                  <p>Search real businesses and qualify them with AI.</p>
                </div>
                <span className="online-dot">● LIVE</span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
                  gap: '14px',
                  marginTop: '20px',
                }}
              >
                <input
                  value={niche}
                  onChange={(event) => setNiche(event.target.value)}
                  placeholder="Niche e.g. Dental clinics"
                />
                <input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="Location e.g. Lahore"
                />
                <input
                  value={service}
                  onChange={(event) => setService(event.target.value)}
                  placeholder="Your service"
                />
              </div>

              <textarea
                value={additionalInfo}
                onChange={(event) => setAdditionalInfo(event.target.value)}
                placeholder="Ideal client details..."
                rows={3}
                style={{ width: '100%', marginTop: '14px', boxSizing: 'border-box' }}
              />

              <button
                className="primary-button"
                onClick={findClients}
                disabled={hunterLoading}
                style={{ marginTop: '14px' }}
              >
                {hunterLoading ? 'Researching...' : '✦ Find Real Clients'}
              </button>

              {hunterError && <p style={{ marginTop: '12px' }}>{hunterError}</p>}
            </section>

            {/* AUTOPILOT PANEL */}
            <section className="panel autopilot-panel">
              <div className="panel-header">
                <div>
                  <h2>Autonomous Client Hunter</h2>
                  <p>
                    AI repeatedly finds strong prospects, saves them, generates
                    recipient-aware outreach and sends it to public business
                    email addresses automatically.
                  </p>
                </div>
                <span
                  className={
                    autopilotActive
                      ? 'autopilot-badge active'
                      : 'autopilot-badge'
                  }
                >
                  {autopilotActive ? '● AUTOPILOT ON' : '○ OFF'}
                </span>
              </div>

              <div className="autopilot-grid">
                <div className="autopilot-info">
                  <strong>Automatic workflow</strong>
                  <span>
                    Web research → qualification → public email →
                    recipient-aware AI email → send → CRM
                  </span>
                </div>
                <div className="autopilot-info">
                  <strong>Reply handoff</strong>
                  <span>
                    {replyMonitorReady
                      ? 'AI reply monitor is ready and will notify you about interested replies.'
                      : 'Reply monitor needs IMAP email settings in backend .env.'}
                  </span>
                </div>
              </div>

              <div className="autopilot-actions">
                {!autopilotActive ? (
                  <button
                    className="primary-button"
                    onClick={startAutopilot}
                    disabled={
                      autopilotLoading || serviceStatusLoading || !emailReady
                    }
                  >
                    {autopilotLoading
                      ? 'Starting...'
                      : '▶ Start Autonomous Hunter'}
                  </button>
                ) : (
                  <button
                    className="text-button"
                    onClick={stopAutopilot}
                    disabled={autopilotLoading}
                  >
                    ■ Stop Autopilot
                  </button>
                )}

                <button
                  className="text-button"
                  onClick={runAutopilotNow}
                  disabled={autopilotLoading}
                >
                  {autopilotLoading ? 'Running...' : '↻ Run Now'}
                </button>

                {serviceStatusLoading ? (
                  <span className="autopilot-warning">
                    Checking email service status...
                  </span>
                ) : !emailReady ? (
                  <span className="autopilot-warning">
                    Email service is not configured. Backend pe{' '}
                    <strong>BREVO_API_KEY</strong> +{' '}
                    <strong>BREVO_FROM_EMAIL</strong> set karo (Render
                    Environment Variables).
                  </span>
                ) : null}
              </div>

              {autopilotMessage && (
                <p className="autopilot-message">{autopilotMessage}</p>
              )}

              {autopilotStats && (
                <div className="autopilot-stats">
                  <span>
                    Found <strong>{autopilotStats.found || 0}</strong>
                  </span>
                  <span>
                    Strong <strong>{autopilotStats.strong || 0}</strong>
                  </span>
                  <span>
                    Saved <strong>{autopilotStats.saved || 0}</strong>
                  </span>
                  <span>
                    Emailed <strong>{autopilotStats.emailed || 0}</strong>
                  </span>
                </div>
              )}

              {autopilotLastRun && (
                <small className="autopilot-last-run">
                  Last run: {new Date(autopilotLastRun).toLocaleString()}
                </small>
              )}
            </section>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))',
                gap: '18px',
              }}
            >
              {prospects.map((prospect, index) => (
                <article
                  className="panel"
                  key={`${prospect.businessName}-${index}`}
                >
                  <div className="panel-header">
                    <div>
                      <h2>{prospect.businessName}</h2>
                      <p>
                        {prospect.industry} · {prospect.location}
                      </p>
                      {prospect.contactName && (
                        <small className="contact-email">
                          👤 {prospect.contactName}
                          {prospect.contactRole
                            ? ` · ${prospect.contactRole}`
                            : ''}
                        </small>
                      )}
                      {prospect.contactEmail && (
                        <small className="contact-email">
                          ✉ {prospect.contactEmail}
                        </small>
                      )}
                    </div>
                    <strong>{prospect.priorityScore}/100</strong>
                  </div>

                  <span
                    className={`status ${getStatus(
                      prospect.priorityScore
                    ).toLowerCase()}`}
                  >
                    {getStatus(prospect.priorityScore)}
                  </span>

                  <h4>Likely Need</h4>
                  <p>{prospect.likelyNeed}</p>

                  <h4>Why This Lead?</h4>
                  <p>{prospect.reason}</p>

                  <h4>Outreach Angle</h4>
                  <p>{prospect.outreachAngle}</p>

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {prospect.website && (
                      <a
                        className="primary-button"
                        href={prospect.website}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Website ↗
                      </a>
                    )}

                    <button
                      className="text-button"
                      onClick={() => saveLead(prospect)}
                      disabled={
                        leadActionLoading ===
                        (prospect.website || prospect.businessName)
                      }
                    >
                      + Save Lead
                    </button>

                    <button
                      className="text-button"
                      onClick={() => generateOutreach(prospect, 'Email')}
                    >
                      ✉ Outreach
                    </button>
                  </div>
                </article>
              ))}
            </div>

            {researchSources.length > 0 && (
              <section className="evidence-panel">
                <div className="panel-header">
                  <div>
                    <h2>Research Evidence</h2>
                    <p>
                      Live web sources returned by the research run. Verify the
                      source before outreach.
                    </p>
                  </div>
                  <span className="evidence-count">
                    {researchSources.length} sources
                  </span>
                </div>
                <div className="evidence-list">
                  {researchSources.map((source, index) => (
                    <a
                      key={`${source.url}-${index}`}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="evidence-item"
                    >
                      <span>{index + 1}</span>
                      <div>
                        <strong>{source.title || 'Web source'}</strong>
                        <small>{source.url}</small>
                      </div>
                      <b>↗</b>
                    </a>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* LEADS */}
        {activePage === 'Leads' && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Lead CRM</h2>
                <p>Saved prospects associated with your account.</p>
              </div>
              <button
                className="text-button"
                onClick={loadLeads}
                disabled={leadsLoading}
              >
                ↻ Refresh
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap',
                margin: '15px 0',
              }}
            >
              {[
                'All',
                'Hot',
                'Warm',
                'Cold',
                'Contacted',
                'Replied',
                'Won',
                'Lost',
              ].map((item) => (
                <button
                  key={item}
                  className={
                    leadFilter === item ? 'primary-button' : 'text-button'
                  }
                  onClick={() =>
                    setLeadFilter(item as 'All' | CrmStatus)
                  }
                >
                  {item}
                </button>
              ))}
            </div>

            {leadsLoading && <p>Loading leads...</p>}

            {!leadsLoading && filteredLeads.length === 0 && (
              <div style={{ padding: '30px', textAlign: 'center' }}>
                <h3>No leads found</h3>
                <p>
                  Save prospects from the AI Client Hunter to see them here.
                </p>
              </div>
            )}

            <div style={{ display: 'grid', gap: '12px' }}>
              {filteredLeads.map((lead) => (
                <div
                  className="lead-row"
                  key={lead.id}
                  onClick={() => setSelectedLead(lead)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="lead-avatar">
                    {getInitials(lead.businessName)}
                  </div>
                  <div className="lead-details">
                    <strong>{lead.businessName}</strong>
                    <span>{lead.location}</span>
                  </div>
                  <div className="lead-score">
                    <strong>{lead.priorityScore}</strong>
                    <span>Score</span>
                  </div>
                  <span
                    className={`status ${
                      ['Hot', 'Warm', 'Cold'].includes(lead.status)
                        ? lead.status.toLowerCase()
                        : 'warm'
                    }`}
                  >
                    {lead.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* AI SALES CHAT */}
        {activePage === 'AI Sales Chat' && (
          <section className="panel ai-panel">
            <div className="panel-header">
              <div>
                <h2>AI Sales Assistant</h2>
                <p>Ask anything about prospecting and sales.</p>
              </div>
              <span className="online-dot">● Online</span>
            </div>

            <div className="chat-area">
              {chatResponse && (
                <div className="ai-message">
                  <div className="ai-avatar">✦</div>
                  <div className="message-bubble">
                    <p style={{ whiteSpace: 'pre-wrap' }}>{chatResponse}</p>
                  </div>
                </div>
              )}

              {!chatResponse && !chatLoading && (
                <div style={{ padding: '30px', textAlign: 'center' }}>
                  <h3>Your AI Sales Assistant</h3>
                  <p>
                    Ask for outreach ideas, sales strategies, qualification
                    advice, or prospecting help.
                  </p>
                </div>
              )}
            </div>

            <div className="chat-input">
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    sendMessage()
                  }
                }}
                placeholder="Ask AI..."
                disabled={chatLoading}
              />
              <button
                onClick={sendMessage}
                disabled={chatLoading || !message.trim()}
              >
                {chatLoading ? 'Sending...' : 'Send ↗'}
              </button>
            </div>
          </section>
        )}

        {/* PRODUCTS */}
        {activePage === 'Products & Demos' && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Products & Demos</h2>
                <p>
                  Define the offer you want AI Client Hunter to use in
                  qualification and outreach.
                </p>
              </div>
            </div>
            <div className="settings-grid" style={{ marginTop: '20px' }}>
              <div>
                <label>Primary service</label>
                <input
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                  placeholder="e.g. Website development"
                />
              </div>
              <div>
                <label>Ideal client</label>
                <input
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  placeholder="e.g. Dental clinics"
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label>Offer / demo notes</label>
                <textarea
                  value={additionalInfo}
                  onChange={(e) => setAdditionalInfo(e.target.value)}
                  rows={5}
                  placeholder="Describe your offer, proof, package, CTA or qualification rules."
                />
              </div>
            </div>
            <div className="info-card" style={{ marginTop: '18px' }}>
              <strong>How this is used</strong>
              <p>
                Your service and ideal-client details are sent to the AI
                qualification and outreach engines. No fake product data is
                inserted automatically.
              </p>
            </div>
          </section>
        )}

        {/* SETTINGS */}
        {activePage === 'Settings' && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Account Settings</h2>
                <p>Your AI Client Hunter account.</p>
              </div>
            </div>

            <div style={{ marginTop: '20px' }}>
              <h4>Signed-in email</h4>
              <p>{user.email}</p>

              <h4>Outreach sender profile</h4>
              <p style={{ opacity: 0.72 }}>
                This name/company is used by AI when writing first-contact
                emails. It is stored only in this browser.
              </p>
              <div className="settings-grid" style={{ marginTop: '12px' }}>
                <div>
                  <label>Your Name</label>
                  <input
                    value={senderName}
                    onChange={(event) => {
                      setSenderName(event.target.value)
                      writeLocalSetting('ach_sender_name', event.target.value)
                    }}
                    placeholder="e.g. Jahanzaib"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label>Your Company</label>
                  <input
                    value={senderCompany}
                    onChange={(event) => {
                      setSenderCompany(event.target.value)
                      writeLocalSetting(
                        'ach_sender_company',
                        event.target.value
                      )
                    }}
                    placeholder="e.g. Jahanzaib Digital"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div className="info-card" style={{ marginTop: '14px' }}>
                <strong>How outbound email identity works</strong>
                <p>
                  Emails are sent through the configured backend email service.
                  Brevo handles delivery when configured. Your company name is
                  used as the visible sender name, while the prospect's
                  business/person name is used for the greeting. The agent
                  never pretends to be the prospect.
                </p>
              </div>

              <h4>Confirmation redirect</h4>
              <p style={{ wordBreak: 'break-all' }}>{AUTH_REDIRECT_URL}</p>

              <div className="settings-status-grid">
                <div>
                  <span>Supabase</span>
                  <strong>{supabase ? 'Connected' : 'Not configured'}</strong>
                </div>
                <div>
                  <span>API</span>
                  <strong>{API_URL}</strong>
                </div>
                <div>
                  <span>Authentication redirect</span>
                  <strong>{AUTH_REDIRECT_URL}</strong>
                </div>
              </div>

              <div className="settings-grid" style={{ marginTop: '18px' }}>
                <div className="info-card">
                  <strong>Automatic email outreach</strong>
                  <p>
                    {emailReady
                      ? 'Email service connected — AI can send outreach emails.'
                      : 'Email service not configured. Set BREVO_API_KEY + BREVO_FROM_EMAIL on backend.'}
                  </p>
                </div>
                <div className="info-card">
                  <strong>Interested-reply monitor</strong>
                  <p>
                    {replyMonitorReady
                      ? 'IMAP connected — interested replies will be forwarded to your notification email.'
                      : 'IMAP not configured.'}
                  </p>
                </div>
              </div>

              {emailReady && (
                <button
                  className="text-button"
                  onClick={async () => {
                    if (!session?.access_token) return
                    try {
                      const response = await apiFetch(
                        '/api/email/test',
                        { method: 'POST' },
                        session.access_token
                      )
                      const data = await safeJson(response)

                      if (response.ok && data.success) {
                        alert(
                          `✅ Test email sent\nProvider: ${data.provider || 'unknown'}\nTo: ${data.sentTo || 'unknown'}\nMessage ID: ${data.messageId || 'none'}`
                        )
                      } else {
                        alert(
                          `❌ Email test failed\nStage: ${data.stage || 'unknown'}\n${data.error || data.message || 'Unknown email error.'}`
                        )
                      }
                    } catch {
                      alert('Email test failed.')
                    }
                  }}
                  style={{ marginTop: '18px' }}
                >
                  ✉ Send Test Email
                </button>
              )}

              <button
                className="text-button"
                onClick={handleLogout}
                style={{ marginTop: '18px' }}
              >
                Sign Out
              </button>
            </div>
          </section>
        )}
      </main>

      {/* LEAD MODAL */}
      {selectedLead && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 1000,
          }}
          onClick={() => setSelectedLead(null)}
        >
          <div
            className="panel"
            style={{
              width: 'min(700px,100%)',
              maxHeight: '90vh',
              overflow: 'auto',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-header">
              <div>
                <h2>{selectedLead.businessName}</h2>
                <p>{selectedLead.location}</p>
              </div>
              <button
                className="text-button"
                onClick={() => setSelectedLead(null)}
              >
                Close
              </button>
            </div>

            <label>CRM Status</label>
            <select
              value={selectedLead.status}
              onChange={(event) =>
                updateLead(selectedLead, {
                  status: event.target.value as CrmStatus,
                })
              }
            >
              <option value="Hot">Hot</option>
              <option value="Warm">Warm</option>
              <option value="Cold">Cold</option>
              <option value="Contacted">Contacted</option>
              <option value="Replied">Replied</option>
              <option value="Won">Won</option>
              <option value="Lost">Lost</option>
            </select>

            <h4>Notes</h4>
            <textarea
              key={selectedLead.id}
              defaultValue={selectedLead.notes || ''}
              onBlur={(event) =>
                updateLead(selectedLead, { notes: event.target.value })
              }
              rows={4}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />

            <h4>Website</h4>
            {selectedLead.website ? (
              <p>
                <a
                  href={selectedLead.website}
                  target="_blank"
                  rel="noreferrer"
                >
                  {selectedLead.website} ↗
                </a>
              </p>
            ) : (
              <p>No website available.</p>
            )}

            {selectedLead.contactEmail && (
              <>
                <h4>Public Contact Email</h4>
                <p>{selectedLead.contactEmail}</p>
              </>
            )}

            <h4>Likely Need</h4>
            <p>{selectedLead.likelyNeed}</p>

            <h4>Why This Lead?</h4>
            <p>{selectedLead.reason}</p>

            <h4>Suggested Service</h4>
            <p>{selectedLead.suggestedService}</p>

            <h4>Outreach Angle</h4>
            <p>{selectedLead.outreachAngle}</p>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {['Email', 'WhatsApp', 'LinkedIn'].map((channel) => (
                <button
                  key={channel}
                  className="text-button"
                  onClick={() => generateOutreach(selectedLead, channel)}
                >
                  {channel}
                </button>
              ))}

              <button
                className="text-button"
                onClick={() => deleteLead(selectedLead)}
                disabled={leadActionLoading === selectedLead.id}
              >
                Delete Lead
              </button>
            </div>

            {outreachLoading && (
              <p style={{ marginTop: '18px' }}>
                Generating {outreachChannel}...
              </p>
            )}

            {outreachText && (
              <div
                style={{
                  marginTop: '18px',
                  padding: '15px',
                  background: '#f8f9fc',
                  borderRadius: '10px',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {outreachText}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function RootApp() {
  const isPasswordReset =
    new URLSearchParams(window.location.search).get('reset') === '1'

  return isPasswordReset ? <PasswordResetScreen /> : <App />
}

export default RootApp