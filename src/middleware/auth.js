import { verifyToken, getUserProfile } from '../lib/supabase.js'

// Extract token from Authorization header
function extractToken(req) {
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7)
  }
  return null
}

// Authenticate user (required)
export async function authenticate(req, res, next) {
  try {
    const token = extractToken(req)
    
    if (!token) {
      return res.status(401).json({ 
        ok: false, 
        message: 'Authentication required' 
      })
    }

    const user = await verifyToken(token)
    
    if (!user) {
      return res.status(401).json({ 
        ok: false, 
        message: 'Invalid or expired token' 
      })
    }

    // Get user profile with role
    const profile = await getUserProfile(user.id)
    
    if (!profile) {
      return res.status(401).json({ 
        ok: false, 
        message: 'User profile not found' 
      })
    }

    if (!profile.is_active) {
      return res.status(403).json({ 
        ok: false, 
        message: 'Account is deactivated' 
      })
    }

    req.user = user
    req.profile = profile
    next()
  } catch (error) {
    console.error('Auth middleware error:', error)
    res.status(500).json({ 
      ok: false, 
      message: 'Authentication error' 
    })
  }
}

// Optional authentication
export async function optionalAuth(req, res, next) {
  try {
    const token = extractToken(req)
    
    if (token) {
      const user = await verifyToken(token)
      if (user) {
        const profile = await getUserProfile(user.id)
        req.user = user
        req.profile = profile
      }
    }
    
    next()
  } catch (error) {
    // Continue without auth
    next()
  }
}

// Require admin role
export function requireAdmin(req, res, next) {
  if (!req.profile || req.profile.role !== 'admin') {
    return res.status(403).json({ 
      ok: false, 
      message: 'Admin access required' 
    })
  }
  next()
}

// Require staff or admin role
export function requireStaff(req, res, next) {
  if (!req.profile || !['admin', 'staff'].includes(req.profile.role)) {
    return res.status(403).json({ 
      ok: false, 
      message: 'Staff access required' 
    })
  }
  next()
}
