const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const User     = require('../models/User');
const Note     = require('../models/Note');
const Notebook = require('../models/Notebook');
const { protect } = require('../middleware/auth');

// ─── Admin token helpers ───────────────────────────────────
// Separate secret + short expiry (15 min) so admin token
// is completely independent of the user access token
const ADMIN_SECRET  = () => process.env.ADMIN_SECRET || process.env.JWT_SECRET + '_admin'
const ADMIN_EXPIRY  = '15m'

const signAdminToken  = (userId) =>
  jwt.sign({ id: userId, role: 'admin' }, ADMIN_SECRET(), { expiresIn: ADMIN_EXPIRY })

const verifyAdminToken = (token) => {
  try {
    return jwt.verify(token, ADMIN_SECRET())
  } catch (_) {
    return null
  }
}

// ─── Middleware: must be owner email + valid admin token ───
const requireAdmin = (req, res, next) => {
  const ownerEmail = process.env.OWNER_EMAIL
  if (!ownerEmail || req.user.email !== ownerEmail) {
    return res.status(403).json({ success: false, code: 'NOT_OWNER', message: 'Not authorized' })
  }

  const adminToken = req.headers['x-admin-token']
  if (!adminToken) {
    return res.status(401).json({ success: false, code: 'ADMIN_TOKEN_MISSING', message: 'Admin token required' })
  }

  const decoded = verifyAdminToken(adminToken)
  if (!decoded || decoded.id !== req.user._id.toString()) {
    return res.status(401).json({ success: false, code: 'ADMIN_TOKEN_INVALID', message: 'Invalid or expired admin token' })
  }

  next()
}

// All routes below require normal auth
router.use(protect)

// ─── POST /api/users/admin-verify ─────────────────────────
// Verify owner password → returns short-lived admin token
// Called once before opening the admin panel
router.post('/admin-verify', async (req, res) => {
  const ownerEmail = process.env.OWNER_EMAIL

  // Must be the owner account
  if (!ownerEmail || req.user.email !== ownerEmail) {
    return res.status(403).json({ success: false, message: 'Not authorized' })
  }

  const { password } = req.body
  if (!password) {
    return res.status(400).json({ success: false, message: 'Password is required' })
  }

  try {
    // Fetch user with password field to verify
    const user = await User.findById(req.user._id).select('+password')
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect password' })
    }

    // Issue admin token — valid for 15 minutes
    const adminToken = signAdminToken(user._id.toString())

    return res.json({
      success: true,
      adminToken,
      expiresIn: 15 * 60, // seconds
      message: 'Admin access granted',
    })
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message })
  }
})

// ─── GET /api/users/public-stats ──────────────────────────
// Visible to ALL logged-in users — safe aggregate numbers only
router.get('/public-stats', async (req, res) => {
  try {
    const [totalUsers, totalNotes] = await Promise.all([
      User.countDocuments({}),
      Note.countDocuments({ isTrashed: false }),
    ])
    res.json({ success: true, data: { totalUsers, totalNotes } })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// ─── GET /api/users/app-stats ──────────────────────────────
// OWNER ONLY — requires email match + valid admin token
router.get('/app-stats', requireAdmin, async (req, res) => {
  try {
    const now        = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekStart  = new Date(now - 7 * 24 * 60 * 60 * 1000)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const [
      totalUsers,
      activeToday,
      activeThisWeek,
      activeThisMonth,
      totalNotes,
      totalNotebooks,
      newUsersThisWeek,
      recentUsers,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ 'stats.lastActive': { $gte: todayStart } }),
      User.countDocuments({ 'stats.lastActive': { $gte: weekStart } }),
      User.countDocuments({ 'stats.lastActive': { $gte: monthStart } }),
      Note.countDocuments({ isTrashed: false }),
      Notebook.countDocuments({}),
      User.countDocuments({ createdAt: { $gte: weekStart } }),
      User.find({}).sort({ createdAt: -1 }).limit(5)
        .select('name email createdAt stats.lastActive'),
    ])

    res.json({
      success: true,
      data: {
        totalUsers, activeToday, activeThisWeek, activeThisMonth,
        totalNotes, totalNotebooks, newUsersThisWeek,
        recentUsers: recentUsers.map(u => ({
          name:       u.name,
          email:      u.email,
          joinedAt:   u.createdAt,
          lastActive: u.stats?.lastActive,
        })),
      }
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// ─── GET /api/users/all-users ─────────────────────────────
// OWNER ONLY — full user list with per-user stats
router.get('/all-users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find({})
      .sort({ createdAt: -1 })
      .select('name email createdAt stats.lastActive status')
      .lean()

    // Get note + notebook counts per user in one aggregation each
    const [noteCounts, notebookCounts] = await Promise.all([
      Note.aggregate([
        { $match: { isTrashed: false } },
        { $group: { _id: '$user', count: { $sum: 1 } } },
      ]),
      Notebook.aggregate([
        { $group: { _id: '$user', count: { $sum: 1 } } },
      ]),
    ])

    const noteMap     = Object.fromEntries(noteCounts.map(x    => [x._id.toString(), x.count]))
    const notebookMap = Object.fromEntries(notebookCounts.map(x => [x._id.toString(), x.count]))

    const result = users.map(u => ({
      _id:        u._id,
      name:       u.name,
      email:      u.email,
      status:     u.status,
      joinedAt:   u.createdAt,
      lastActive: u.stats?.lastActive,
      notes:      noteMap[u._id.toString()]     || 0,
      notebooks:  notebookMap[u._id.toString()] || 0,
    }))

    res.json({ success: true, data: result, total: result.length })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// ─── POST /api/users/reset-password ───────────────────────
// OWNER ONLY — set temp password, force change on next login
router.post('/reset-password', requireAdmin, async (req, res) => {
  try {
    const { userId, newPassword } = req.body
    if (!userId)
      return res.status(400).json({ success: false, message: 'userId is required' })
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' })

    const user = await User.findById(userId)
    if (!user)
      return res.status(404).json({ success: false, message: 'User not found' })

    if (user._id.toString() === req.user._id.toString())
      return res.status(400).json({ success: false, message: 'Use change-password to update your own password' })

    user.password           = newPassword  // pre-save hook hashes it
    user.mustChangePassword = true          // force change on next login
    await user.save()

    res.json({ success: true, message: `Password reset for ${user.name}` })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

router.put('/preferences', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { preferences: { ...req.user.preferences, ...req.body } },
      { new: true }
    )
    res.json({ success: true, data: user.preferences })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// ─── PUT /api/users/profile ───────────────────────────────
router.put('/profile', async (req, res) => {
  try {
    const { name, avatar } = req.body
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { name, avatar },
      { new: true, runValidators: true }
    )
    res.json({ success: true, data: { id: user._id, name: user.name, email: user.email, avatar: user.avatar } })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router