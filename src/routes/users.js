import { Router } from 'express'
import { authenticate, requireAdmin, requireStaff } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

// Admin: Get all users
router.get('/', authenticate, requireStaff, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 25, 
      search, 
      role, 
      status,
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query

    let query = supabase
      .from('profiles')
      .select('*', { count: 'exact' })
      .order(sortBy, { ascending: sortOrder === 'asc' })
      .range((page - 1) * limit, page * limit - 1)

    if (search) {
      query = query.or(`email.ilike.%${search}%,username.ilike.%${search}%`)
    }

    if (role) {
      query = query.eq('role', role)
    }

    if (status) {
      query = query.eq('status', status)
    }

    const { data: users, error, count } = await query

    if (error) throw error

    res.json({
      users: users || [],
      total: count || 0,
      page: parseInt(page),
      limit: parseInt(limit)
    })
  } catch (error) {
    console.error('Get users error:', error)
    res.status(500).json({ error: 'Failed to fetch users' })
  }
})

// Admin: Get user by ID
router.get('/:id', authenticate, requireStaff, async (req, res) => {
  try {
    const { id } = req.params

    const { data: user, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Get user's wallets
    const { data: wallets } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', id)

    // Get user's stats
    const { data: bets } = await supabase
      .from('bets')
      .select('stake, win_amount, outcome')
      .eq('user_id', id)

    const stats = {
      total_bets: bets?.length || 0,
      total_wagered: bets?.reduce((sum, b) => sum + (b.stake || 0), 0) || 0,
      total_won: bets?.reduce((sum, b) => sum + (b.win_amount || 0), 0) || 0,
      win_rate: bets?.length 
        ? (bets.filter(b => b.outcome === 'win').length / bets.length * 100).toFixed(2) 
        : 0
    }

    res.json({
      ...user,
      wallets: wallets || [],
      stats
    })
  } catch (error) {
    console.error('Get user error:', error)
    res.status(500).json({ error: 'Failed to fetch user' })
  }
})

// Admin: Update user
router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { username, role, status, vip_level, notes } = req.body

    const updates = {}
    if (username !== undefined) updates.username = username
    if (role !== undefined) updates.role = role
    if (status !== undefined) updates.status = status
    if (vip_level !== undefined) updates.vip_level = vip_level
    if (notes !== undefined) updates.notes = notes

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updates provided' })
    }

    const { data: user, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    res.json(user)
  } catch (error) {
    console.error('Update user error:', error)
    res.status(500).json({ error: 'Failed to update user' })
  }
})

// Admin: Ban/unban user
router.post('/:id/ban', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { banned, reason } = req.body

    const { data: user, error } = await supabase
      .from('profiles')
      .update({
        status: banned ? 'banned' : 'active',
        ban_reason: banned ? reason : null,
        banned_at: banned ? new Date().toISOString() : null,
        banned_by: banned ? req.user.id : null
      })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    res.json({
      user,
      message: banned ? 'User banned successfully' : 'User unbanned successfully'
    })
  } catch (error) {
    console.error('Ban user error:', error)
    res.status(500).json({ error: 'Failed to update user status' })
  }
})

// Admin: Get user activity log
router.get('/:id/activity', authenticate, requireStaff, async (req, res) => {
  try {
    const { id } = req.params
    const { page = 1, limit = 50 } = req.query

    const { data: logs, error, count } = await supabase
      .from('activity_logs')
      .select('*', { count: 'exact' })
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (error) throw error

    res.json({
      logs: logs || [],
      total: count || 0,
      page: parseInt(page),
      limit: parseInt(limit)
    })
  } catch (error) {
    console.error('Get activity error:', error)
    res.status(500).json({ error: 'Failed to fetch activity' })
  }
})

// Admin: Get user's transactions
router.get('/:id/transactions', authenticate, requireStaff, async (req, res) => {
  try {
    const { id } = req.params
    const { page = 1, limit = 25, type } = req.query

    let query = supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (type) {
      query = query.eq('type', type)
    }

    const { data: transactions, error, count } = await query

    if (error) throw error

    res.json({
      transactions: transactions || [],
      total: count || 0,
      page: parseInt(page),
      limit: parseInt(limit)
    })
  } catch (error) {
    console.error('Get user transactions error:', error)
    res.status(500).json({ error: 'Failed to fetch transactions' })
  }
})

// Admin: Get user's bets
router.get('/:id/bets', authenticate, requireStaff, async (req, res) => {
  try {
    const { id } = req.params
    const { page = 1, limit = 25 } = req.query

    const { data: bets, error, count } = await supabase
      .from('bets')
      .select('*', { count: 'exact' })
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (error) throw error

    res.json({
      bets: bets || [],
      total: count || 0,
      page: parseInt(page),
      limit: parseInt(limit)
    })
  } catch (error) {
    console.error('Get user bets error:', error)
    res.status(500).json({ error: 'Failed to fetch bets' })
  }
})

// Admin: Create VIP level adjustment
router.post('/:id/vip', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { level, reason } = req.body

    if (typeof level !== 'number' || level < 0 || level > 10) {
      return res.status(400).json({ error: 'Invalid VIP level (0-10)' })
    }

    const { data: user, error } = await supabase
      .from('profiles')
      .update({ vip_level: level })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    // Log the change
    await supabase.from('activity_logs').insert({
      user_id: id,
      action: 'vip_level_change',
      details: { new_level: level, reason, admin_id: req.user.id }
    })

    res.json({
      user,
      message: `VIP level updated to ${level}`
    })
  } catch (error) {
    console.error('Update VIP error:', error)
    res.status(500).json({ error: 'Failed to update VIP level' })
  }
})

// Admin: Send bonus to user
router.post('/:id/bonus', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { amount, currency = 'USD', type = 'admin_bonus', wagering_requirement = 0, reason } = req.body

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid bonus amount' })
    }

    // Get or create wallet
    let { data: wallet } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', id)
      .eq('currency', currency)
      .single()

    if (!wallet) {
      const { data: newWallet, error } = await supabase
        .from('wallets')
        .insert({ user_id: id, currency, balance: 0 })
        .select()
        .single()
      if (error) throw error
      wallet = newWallet
    }

    // Create bonus record
    const { data: bonus, error: bonusError } = await supabase
      .from('bonuses')
      .insert({
        user_id: id,
        type,
        amount,
        currency,
        wagering_requirement,
        wagering_progress: 0,
        status: wagering_requirement > 0 ? 'pending' : 'claimed',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
        notes: reason
      })
      .select()
      .single()

    if (bonusError) throw bonusError

    // If no wagering requirement, credit immediately
    if (wagering_requirement === 0) {
      await supabase
        .from('wallets')
        .update({ balance: wallet.balance + amount })
        .eq('id', wallet.id)

      await supabase.from('transactions').insert({
        user_id: id,
        wallet_id: wallet.id,
        type: 'bonus',
        amount,
        currency,
        status: 'completed',
        reference_id: bonus.id,
        reference_type: 'bonus',
        notes: reason,
        admin_id: req.user.id
      })
    }

    res.json({
      bonus,
      message: 'Bonus sent successfully'
    })
  } catch (error) {
    console.error('Send bonus error:', error)
    res.status(500).json({ error: 'Failed to send bonus' })
  }
})

export default router
