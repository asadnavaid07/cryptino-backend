import { Router } from 'express'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

// Get user's wallets
router.get('/', authenticate, async (req, res) => {
  try {
    const { data: wallets, error } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', req.user.id)
      .order('currency')

    if (error) throw error

    res.json({ wallets: wallets || [] })
  } catch (error) {
    console.error('Get wallets error:', error)
    res.status(500).json({ error: 'Failed to fetch wallets' })
  }
})

// Get wallet by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params

    const { data: wallet, error } = await supabase
      .from('wallets')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !wallet) {
      return res.status(404).json({ error: 'Wallet not found' })
    }

    // Check ownership or admin
    if (wallet.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' })
    }

    res.json(wallet)
  } catch (error) {
    console.error('Get wallet error:', error)
    res.status(500).json({ error: 'Failed to fetch wallet' })
  }
})

// Get wallet transactions
router.get('/:id/transactions', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { page = 1, limit = 25, type } = req.query

    // Verify wallet ownership
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('user_id')
      .eq('id', id)
      .single()

    if (walletError || !wallet) {
      return res.status(404).json({ error: 'Wallet not found' })
    }

    if (wallet.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' })
    }

    let query = supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('wallet_id', id)
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
    console.error('Get transactions error:', error)
    res.status(500).json({ error: 'Failed to fetch transactions' })
  }
})

// Admin: Get all wallets
router.get('/admin/all', authenticate, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 25, search, currency } = req.query

    let query = supabase
      .from('wallets')
      .select(`
        *,
        profiles:user_id (
          id,
          email,
          username
        )
      `, { count: 'exact' })
      .order('balance', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (currency) {
      query = query.eq('currency', currency)
    }

    const { data: wallets, error, count } = await query

    if (error) throw error

    res.json({
      wallets: wallets || [],
      total: count || 0,
      page: parseInt(page),
      limit: parseInt(limit)
    })
  } catch (error) {
    console.error('Get all wallets error:', error)
    res.status(500).json({ error: 'Failed to fetch wallets' })
  }
})

// Admin: Adjust wallet balance
router.post('/:id/adjust', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { amount, reason, type = 'adjustment' } = req.body

    if (typeof amount !== 'number') {
      return res.status(400).json({ error: 'Invalid amount' })
    }

    if (!reason) {
      return res.status(400).json({ error: 'Reason is required' })
    }

    // Get wallet
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('*')
      .eq('id', id)
      .single()

    if (walletError || !wallet) {
      return res.status(404).json({ error: 'Wallet not found' })
    }

    const newBalance = wallet.balance + amount

    if (newBalance < 0) {
      return res.status(400).json({ error: 'Insufficient balance for deduction' })
    }

    // Update wallet
    const { data: updatedWallet, error: updateError } = await supabase
      .from('wallets')
      .update({ balance: newBalance })
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw updateError

    // Create transaction record
    await supabase.from('transactions').insert({
      user_id: wallet.user_id,
      wallet_id: id,
      type,
      amount,
      currency: wallet.currency,
      status: 'completed',
      notes: reason,
      admin_id: req.user.id
    })

    res.json({
      wallet: updatedWallet,
      adjustment: {
        amount,
        reason,
        admin_id: req.user.id,
        previous_balance: wallet.balance,
        new_balance: newBalance
      }
    })
  } catch (error) {
    console.error('Adjust wallet error:', error)
    res.status(500).json({ error: 'Failed to adjust wallet' })
  }
})

// Admin: Get all transactions
router.get('/admin/transactions', authenticate, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 25, type, status, userId, startDate, endDate } = req.query

    let query = supabase
      .from('transactions')
      .select(`
        *,
        profiles:user_id (
          id,
          email,
          username
        ),
        wallets:wallet_id (
          id,
          currency
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (type) query = query.eq('type', type)
    if (status) query = query.eq('status', status)
    if (userId) query = query.eq('user_id', userId)
    if (startDate) query = query.gte('created_at', startDate)
    if (endDate) query = query.lte('created_at', endDate)

    const { data: transactions, error, count } = await query

    if (error) throw error

    res.json({
      transactions: transactions || [],
      total: count || 0,
      page: parseInt(page),
      limit: parseInt(limit)
    })
  } catch (error) {
    console.error('Get all transactions error:', error)
    res.status(500).json({ error: 'Failed to fetch transactions' })
  }
})

// Create deposit request (stub for payment integration)
router.post('/deposit', authenticate, async (req, res) => {
  try {
    const { amount, currency = 'USD', method = 'crypto' } = req.body

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' })
    }

    // Get or create wallet
    let { data: wallet } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('currency', currency)
      .single()

    if (!wallet) {
      const { data: newWallet, error } = await supabase
        .from('wallets')
        .insert({
          user_id: req.user.id,
          currency,
          balance: 0
        })
        .select()
        .single()

      if (error) throw error
      wallet = newWallet
    }

    // Create pending transaction
    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .insert({
        user_id: req.user.id,
        wallet_id: wallet.id,
        type: 'deposit',
        amount,
        currency,
        status: 'pending',
        notes: `${method} deposit`
      })
      .select()
      .single()

    if (txError) throw txError

    res.json({
      transaction,
      message: 'Deposit request created. Awaiting confirmation.',
      // In production, return payment gateway URL/details
      payment_url: null
    })
  } catch (error) {
    console.error('Deposit error:', error)
    res.status(500).json({ error: 'Failed to create deposit' })
  }
})

// Create withdrawal request
router.post('/withdraw', authenticate, async (req, res) => {
  try {
    const { amount, currency = 'USD', address, method = 'crypto' } = req.body

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' })
    }

    if (!address) {
      return res.status(400).json({ error: 'Withdrawal address required' })
    }

    // Get wallet
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('currency', currency)
      .single()

    if (walletError || !wallet) {
      return res.status(404).json({ error: 'Wallet not found' })
    }

    if (wallet.balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' })
    }

    // Hold the amount
    await supabase
      .from('wallets')
      .update({ balance: wallet.balance - amount })
      .eq('id', wallet.id)

    // Create pending withdrawal
    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .insert({
        user_id: req.user.id,
        wallet_id: wallet.id,
        type: 'withdrawal',
        amount: -amount,
        currency,
        status: 'pending',
        notes: `${method} withdrawal to ${address}`
      })
      .select()
      .single()

    if (txError) throw txError

    res.json({
      transaction,
      message: 'Withdrawal request submitted. Pending approval.',
      new_balance: wallet.balance - amount
    })
  } catch (error) {
    console.error('Withdrawal error:', error)
    res.status(500).json({ error: 'Failed to create withdrawal' })
  }
})

// Admin: Process withdrawal
router.post('/admin/process-withdrawal/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { action, txHash } = req.body // action: 'approve' or 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' })
    }

    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', id)
      .eq('type', 'withdrawal')
      .eq('status', 'pending')
      .single()

    if (txError || !transaction) {
      return res.status(404).json({ error: 'Transaction not found' })
    }

    if (action === 'approve') {
      // Mark as completed
      await supabase
        .from('transactions')
        .update({
          status: 'completed',
          notes: transaction.notes + (txHash ? ` | TX: ${txHash}` : ''),
          admin_id: req.user.id
        })
        .eq('id', id)

      res.json({ message: 'Withdrawal approved', status: 'completed' })
    } else {
      // Reject and refund
      const { data: wallet } = await supabase
        .from('wallets')
        .select('*')
        .eq('id', transaction.wallet_id)
        .single()

      if (wallet) {
        await supabase
          .from('wallets')
          .update({ balance: wallet.balance + Math.abs(transaction.amount) })
          .eq('id', wallet.id)
      }

      await supabase
        .from('transactions')
        .update({
          status: 'rejected',
          admin_id: req.user.id
        })
        .eq('id', id)

      res.json({ message: 'Withdrawal rejected and refunded', status: 'rejected' })
    }
  } catch (error) {
    console.error('Process withdrawal error:', error)
    res.status(500).json({ error: 'Failed to process withdrawal' })
  }
})

export default router
