const API_URL =
  import.meta.env.VITE_API_URL?.trim() ||
  'http://localhost:5000'

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL?.trim() || ''

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || ''

export default API_URL