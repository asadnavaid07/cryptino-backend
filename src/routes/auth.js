import { Router } from 'express'
import { authenticate } from '../middleware/auth.js'

const router = Router()

// Verify token endpoint
router.get('/verify', authenticate, (req, res) => {
  res.json({
    valid: true,
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      username: req.user.username
    }
  })
})

// Get current user profile
router.get('/me', authenticate, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    username: req.user.username,
    role: req.user.role,
    vip_level: req.user.vip_level || 0,
    avatar_url: req.user.avatar_url,
    created_at: req.user.created_at
  })
})

export default router
