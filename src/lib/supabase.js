import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('Warning: Supabase credentials not found in environment variables')
}

// Admin client with service role key (server-side only!)
export const supabaseAdmin = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseServiceKey || 'placeholder-key',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

// Also export as 'supabase' for routes that import it that way
export const supabase = supabaseAdmin

// Verify JWT token from client
export async function verifyToken(token) {
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
    if (error) throw error
    return user
  } catch (error) {
    console.error('Token verification error:', error)
    return null
  }
}

// Get user profile with role
export async function getUserProfile(userId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    
    if (error) throw error
    return data
  } catch (error) {
    console.error('Get profile error:', error)
    return null
  }
}
