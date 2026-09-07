// ============================================================
// APP CONFIG
// ============================================================

export const SUPABASE_URL = (
  import.meta.env.VITE_SUPABASE_URL || ''
).trim()

export const SUPABASE_ANON_KEY = (
  import.meta.env.VITE_SUPABASE_ANON_KEY || ''
).trim()

// Sirf clean URL
const rawApiUrl = (
  import.meta.env.VITE_API_URL ||
  'https://ai-client-hunter-backend.onrender.com'
).trim()

// Agar galti se "VITE_API_URL = https://..." aa jaye to clean kar do
const API_URL = rawApiUrl
  .replace(/^VITE_API_URL\s*=\s*/i, '')
  .replace(/^["']|["']$/g, '')
  .replace(/\/$/, '')

export default API_URL