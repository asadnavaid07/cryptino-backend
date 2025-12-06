import { Router } from 'express'
import { authenticate, optionalAuth, requireAdmin } from '../middleware/auth.js'
import { fetchGames, fetchBets, isConfigured } from '../providers/rapidapi.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

// Get games (public endpoint)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { provider = 'all', category, page = 1, limit = 50, search } = req.query

    const result = await fetchGames({
      provider,
      page: parseInt(page),
      limit: parseInt(limit)
    })

    let games = result.games || []

    // Filter by category if provided
    if (category && category !== 'all') {
      games = games.filter(g => 
        g.category?.toLowerCase() === category.toLowerCase()
      )
    }

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase()
      games = games.filter(g =>
        g.name?.toLowerCase().includes(searchLower) ||
        g.provider?.toLowerCase().includes(searchLower)
      )
    }

    res.json({
      games,
      total: games.length,
      page: parseInt(page),
      limit: parseInt(limit),
      rapidapi_configured: isConfigured()
    })
  } catch (error) {
    console.error('Get games error:', error)
    res.status(500).json({ error: 'Failed to fetch games' })
  }
})

// Get game by ID
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params

    // For now, return from Supabase or mock
    const { data: game, error } = await supabase
      .from('games')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !game) {
      return res.status(404).json({ error: 'Game not found' })
    }

    res.json(game)
  } catch (error) {
    console.error('Get game error:', error)
    res.status(500).json({ error: 'Failed to fetch game' })
  }
})

// Get all bets (admin only)
router.get('/bets/all', authenticate, requireAdmin, async (req, res) => {
  try {
    const { 
      provider = 'spribe', 
      page = 1, 
      limit = 25, 
      startDate, 
      endDate,
      userId
    } = req.query

    const result = await fetchBets({
      provider,
      page: parseInt(page),
      limit: parseInt(limit),
      startDate,
      endDate
    })

    let bets = result.bets || []

    // Filter by user if provided
    if (userId) {
      bets = bets.filter(b => b.user_id === userId)
    }

    res.json({
      bets,
      total: result.total || bets.length,
      page: parseInt(page),
      limit: parseInt(limit)
    })
  } catch (error) {
    console.error('Get bets error:', error)
    res.status(500).json({ error: 'Failed to fetch bets' })
  }
})

// Get user's bet history
router.get('/bets/me', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 25 } = req.query
    
    // Get bets from Supabase
    const { data: bets, error, count } = await supabase
      .from('bets')
      .select('*', { count: 'exact' })
      .eq('user_id', req.user.id)
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

// Create a bet (game session)
router.post('/bets', authenticate, async (req, res) => {
  try {
    const { game_id, stake, currency = 'USD' } = req.body

    if (!game_id || !stake || stake <= 0) {
      return res.status(400).json({ error: 'Invalid bet parameters' })
    }

    // Check user wallet balance
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('currency', currency)
      .single()

    if (walletError || !wallet) {
      return res.status(400).json({ error: 'Wallet not found' })
    }

    if (wallet.balance < stake) {
      return res.status(400).json({ error: 'Insufficient balance' })
    }

    // Deduct stake from wallet
    const { error: updateError } = await supabase
      .from('wallets')
      .update({ balance: wallet.balance - stake })
      .eq('id', wallet.id)

    if (updateError) throw updateError

    // Create bet record
    const { data: bet, error: betError } = await supabase
      .from('bets')
      .insert({
        user_id: req.user.id,
        game_id,
        stake,
        currency,
        outcome: 'pending',
        win_amount: 0
      })
      .select()
      .single()

    if (betError) throw betError

    // Create transaction record
    await supabase.from('transactions').insert({
      user_id: req.user.id,
      wallet_id: wallet.id,
      type: 'bet',
      amount: -stake,
      currency,
      status: 'completed',
      reference_id: bet.id,
      reference_type: 'bet'
    })

    res.json({
      bet,
      new_balance: wallet.balance - stake
    })
  } catch (error) {
    console.error('Create bet error:', error)
    res.status(500).json({ error: 'Failed to create bet' })
  }
})

// Settle a bet (callback from provider or admin)
router.post('/bets/:id/settle', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { outcome, win_amount = 0, multiplier = 1 } = req.body

    // Get bet
    const { data: bet, error: betError } = await supabase
      .from('bets')
      .select('*')
      .eq('id', id)
      .single()

    if (betError || !bet) {
      return res.status(404).json({ error: 'Bet not found' })
    }

    // Check ownership or admin
    if (bet.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' })
    }

    if (bet.outcome !== 'pending') {
      return res.status(400).json({ error: 'Bet already settled' })
    }

    // Update bet
    const { data: updatedBet, error: updateError } = await supabase
      .from('bets')
      .update({
        outcome,
        win_amount,
        multiplier,
        settled_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw updateError

    // Credit winnings if any
    if (win_amount > 0) {
      const { data: wallet } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', bet.user_id)
        .eq('currency', bet.currency)
        .single()

      if (wallet) {
        await supabase
          .from('wallets')
          .update({ balance: wallet.balance + win_amount })
          .eq('id', wallet.id)

        await supabase.from('transactions').insert({
          user_id: bet.user_id,
          wallet_id: wallet.id,
          type: 'win',
          amount: win_amount,
          currency: bet.currency,
          status: 'completed',
          reference_id: bet.id,
          reference_type: 'bet'
        })
      }
    }

    res.json(updatedBet)
  } catch (error) {
    console.error('Settle bet error:', error)
    res.status(500).json({ error: 'Failed to settle bet' })
  }
})

// Get game providers list
router.get('/providers', optionalAuth, async (req, res) => {
  try {
    // Return static provider list or fetch from RapidAPI
    const providers = [
      { id: 'pragmatic', name: 'Pragmatic Play', logo: null },
      { id: 'evolution', name: 'Evolution Gaming', logo: null },
      { id: 'hacksaw', name: 'Hacksaw Gaming', logo: null },
      { id: 'spribe', name: 'Spribe', logo: null },
      { id: 'netent', name: 'NetEnt', logo: null },
      { id: 'play-n-go', name: "Play'n GO", logo: null },
      { id: 'nolimit', name: 'NoLimit City', logo: null },
      { id: 'relax', name: 'Relax Gaming', logo: null },
    ]

    res.json({ providers })
  } catch (error) {
    console.error('Get providers error:', error)
    res.status(500).json({ error: 'Failed to fetch providers' })
  }
})

// Get game categories
router.get('/categories', optionalAuth, async (req, res) => {
  const categories = [
    { id: 'slots', name: 'Slots', icon: 'slot-machine' },
    { id: 'live', name: 'Live Casino', icon: 'cards' },
    { id: 'crash', name: 'Crash Games', icon: 'rocket' },
    { id: 'table', name: 'Table Games', icon: 'table' },
    { id: 'lottery', name: 'Lottery', icon: 'ticket' },
    { id: 'sports', name: 'Sports', icon: 'football' },
  ]

  res.json({ categories })
})

export default router
