import { Router } from 'express'
import { authenticate, requireAdmin, requireStaff } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

// Dashboard stats
router.get('/dashboard', authenticate, requireStaff, async (req, res) => {
  try {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    // Total users
    const { count: totalUsers } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })

    // New users today
    const { count: newUsersToday } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString())

    // Total bets
    const { data: betsData } = await supabase
      .from('bets')
      .select('stake, win_amount, outcome')

    const totalBets = betsData?.length || 0
    const totalWagered = betsData?.reduce((sum, b) => sum + (b.stake || 0), 0) || 0
    const totalPaidOut = betsData?.reduce((sum, b) => sum + (b.win_amount || 0), 0) || 0
    const ggr = totalWagered - totalPaidOut // Gross Gaming Revenue

    // Today's bets
    const { data: todayBets } = await supabase
      .from('bets')
      .select('stake, win_amount')
      .gte('created_at', today.toISOString())

    const todayWagered = todayBets?.reduce((sum, b) => sum + (b.stake || 0), 0) || 0
    const todayPaidOut = todayBets?.reduce((sum, b) => sum + (b.win_amount || 0), 0) || 0
    const todayGGR = todayWagered - todayPaidOut

    // Pending withdrawals
    const { count: pendingWithdrawals } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'withdrawal')
      .eq('status', 'pending')

    // Total deposits today
    const { data: todayDeposits } = await supabase
      .from('transactions')
      .select('amount')
      .eq('type', 'deposit')
      .eq('status', 'completed')
      .gte('created_at', today.toISOString())

    const depositsToday = todayDeposits?.reduce((sum, d) => sum + (d.amount || 0), 0) || 0

    res.json({
      users: {
        total: totalUsers || 0,
        new_today: newUsersToday || 0
      },
      bets: {
        total: totalBets,
        total_wagered: totalWagered,
        total_paid_out: totalPaidOut
      },
      revenue: {
        ggr_total: ggr,
        ggr_today: todayGGR,
        deposits_today: depositsToday
      },
      pending: {
        withdrawals: pendingWithdrawals || 0
      }
    })
  } catch (error) {
    console.error('Dashboard stats error:', error)
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})

// Revenue report
router.get('/revenue', authenticate, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const end = endDate ? new Date(endDate) : new Date()

    // Get bets in date range
    const { data: bets } = await supabase
      .from('bets')
      .select('stake, win_amount, created_at')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at')

    // Get deposits in date range
    const { data: deposits } = await supabase
      .from('transactions')
      .select('amount, created_at')
      .eq('type', 'deposit')
      .eq('status', 'completed')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())

    // Get withdrawals in date range
    const { data: withdrawals } = await supabase
      .from('transactions')
      .select('amount, created_at')
      .eq('type', 'withdrawal')
      .eq('status', 'completed')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())

    // Group by day
    const dailyStats = {}
    
    bets?.forEach(bet => {
      const date = bet.created_at.split('T')[0]
      if (!dailyStats[date]) {
        dailyStats[date] = { wagered: 0, paidOut: 0, deposits: 0, withdrawals: 0 }
      }
      dailyStats[date].wagered += bet.stake || 0
      dailyStats[date].paidOut += bet.win_amount || 0
    })

    deposits?.forEach(tx => {
      const date = tx.created_at.split('T')[0]
      if (!dailyStats[date]) {
        dailyStats[date] = { wagered: 0, paidOut: 0, deposits: 0, withdrawals: 0 }
      }
      dailyStats[date].deposits += tx.amount || 0
    })

    withdrawals?.forEach(tx => {
      const date = tx.created_at.split('T')[0]
      if (!dailyStats[date]) {
        dailyStats[date] = { wagered: 0, paidOut: 0, deposits: 0, withdrawals: 0 }
      }
      dailyStats[date].withdrawals += Math.abs(tx.amount) || 0
    })

    // Convert to array
    const report = Object.entries(dailyStats)
      .map(([date, stats]) => ({
        date,
        wagered: stats.wagered,
        paid_out: stats.paidOut,
        ggr: stats.wagered - stats.paidOut,
        deposits: stats.deposits,
        withdrawals: stats.withdrawals,
        net_flow: stats.deposits - stats.withdrawals
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Totals
    const totals = report.reduce((acc, day) => ({
      wagered: acc.wagered + day.wagered,
      paid_out: acc.paid_out + day.paid_out,
      ggr: acc.ggr + day.ggr,
      deposits: acc.deposits + day.deposits,
      withdrawals: acc.withdrawals + day.withdrawals,
      net_flow: acc.net_flow + day.net_flow
    }), { wagered: 0, paid_out: 0, ggr: 0, deposits: 0, withdrawals: 0, net_flow: 0 })

    res.json({
      report,
      totals,
      period: {
        start: start.toISOString(),
        end: end.toISOString()
      }
    })
  } catch (error) {
    console.error('Revenue report error:', error)
    res.status(500).json({ error: 'Failed to generate report' })
  }
})

// Users report
router.get('/users', authenticate, requireStaff, async (req, res) => {
  try {
    const { startDate, endDate } = req.query

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const end = endDate ? new Date(endDate) : new Date()

    // New registrations by day
    const { data: users } = await supabase
      .from('profiles')
      .select('created_at')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())

    const dailyRegistrations = {}
    users?.forEach(user => {
      const date = user.created_at.split('T')[0]
      dailyRegistrations[date] = (dailyRegistrations[date] || 0) + 1
    })

    // Role distribution
    const { data: roleData } = await supabase
      .from('profiles')
      .select('role')

    const roles = {}
    roleData?.forEach(user => {
      roles[user.role] = (roles[user.role] || 0) + 1
    })

    // VIP distribution
    const { data: vipData } = await supabase
      .from('profiles')
      .select('vip_level')

    const vipLevels = {}
    vipData?.forEach(user => {
      const level = `Level ${user.vip_level || 0}`
      vipLevels[level] = (vipLevels[level] || 0) + 1
    })

    res.json({
      registrations: Object.entries(dailyRegistrations)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      total_new: users?.length || 0,
      roles,
      vip_levels: vipLevels,
      period: {
        start: start.toISOString(),
        end: end.toISOString()
      }
    })
  } catch (error) {
    console.error('Users report error:', error)
    res.status(500).json({ error: 'Failed to generate report' })
  }
})

// Games report
router.get('/games', authenticate, requireStaff, async (req, res) => {
  try {
    const { startDate, endDate } = req.query

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const end = endDate ? new Date(endDate) : new Date()

    // Get bets with game info
    const { data: bets } = await supabase
      .from('bets')
      .select('game_id, stake, win_amount, outcome, created_at')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())

    // Group by game
    const gameStats = {}
    bets?.forEach(bet => {
      const gameId = bet.game_id || 'unknown'
      if (!gameStats[gameId]) {
        gameStats[gameId] = { 
          bets: 0, 
          wagered: 0, 
          paid_out: 0, 
          wins: 0, 
          losses: 0 
        }
      }
      gameStats[gameId].bets++
      gameStats[gameId].wagered += bet.stake || 0
      gameStats[gameId].paid_out += bet.win_amount || 0
      if (bet.outcome === 'win') gameStats[gameId].wins++
      if (bet.outcome === 'loss') gameStats[gameId].losses++
    })

    // Convert to array and calculate RTP
    const report = Object.entries(gameStats)
      .map(([game_id, stats]) => ({
        game_id,
        total_bets: stats.bets,
        total_wagered: stats.wagered,
        total_paid_out: stats.paid_out,
        ggr: stats.wagered - stats.paid_out,
        rtp: stats.wagered > 0 ? ((stats.paid_out / stats.wagered) * 100).toFixed(2) : 0,
        wins: stats.wins,
        losses: stats.losses
      }))
      .sort((a, b) => b.total_wagered - a.total_wagered)

    res.json({
      games: report,
      totals: {
        bets: bets?.length || 0,
        wagered: bets?.reduce((sum, b) => sum + (b.stake || 0), 0) || 0,
        paid_out: bets?.reduce((sum, b) => sum + (b.win_amount || 0), 0) || 0
      },
      period: {
        start: start.toISOString(),
        end: end.toISOString()
      }
    })
  } catch (error) {
    console.error('Games report error:', error)
    res.status(500).json({ error: 'Failed to generate report' })
  }
})

// Top players report
router.get('/top-players', authenticate, requireStaff, async (req, res) => {
  try {
    const { limit = 10, metric = 'wagered' } = req.query

    const { data: bets } = await supabase
      .from('bets')
      .select('user_id, stake, win_amount')

    // Group by user
    const playerStats = {}
    bets?.forEach(bet => {
      const userId = bet.user_id
      if (!playerStats[userId]) {
        playerStats[userId] = { wagered: 0, won: 0, bets: 0 }
      }
      playerStats[userId].wagered += bet.stake || 0
      playerStats[userId].won += bet.win_amount || 0
      playerStats[userId].bets++
    })

    // Sort and limit
    const sorted = Object.entries(playerStats)
      .map(([user_id, stats]) => ({
        user_id,
        ...stats,
        profit: stats.won - stats.wagered
      }))
      .sort((a, b) => b[metric] - a[metric])
      .slice(0, parseInt(limit))

    // Get user details
    const userIds = sorted.map(p => p.user_id)
    const { data: users } = await supabase
      .from('profiles')
      .select('id, email, username, vip_level')
      .in('id', userIds)

    const userMap = {}
    users?.forEach(u => { userMap[u.id] = u })

    const report = sorted.map(p => ({
      ...p,
      user: userMap[p.user_id] || { id: p.user_id, username: 'Unknown' }
    }))

    res.json({ players: report })
  } catch (error) {
    console.error('Top players report error:', error)
    res.status(500).json({ error: 'Failed to generate report' })
  }
})

export default router
