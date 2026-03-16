const express   = require('express');
const router    = express.Router();
const jwt       = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User      = require('../models/User');
const { protect } = require('../middleware/auth');

// ─── Cookie helpers ───────────────────────────────────────────────────────────

const IS_PROD = () => process.env.NODE_ENV === 'production';

/**
 * Set both tokens as secure httpOnly cookies.
 *
 * access_token  — 15 min,  available to all routes
 * refresh_token — 7 days,  scoped to /api/auth/refresh only
 *                           (browser never sends it anywhere else)
 */
const setTokenCookies = (res, accessToken, refreshToken) => {
  const secure   = IS_PROD();
  const sameSite = IS_PROD() ? 'none' : 'lax';

  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: 15 * 60 * 1000,          // 15 minutes
    path:   '/',
  });

  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path:   '/api/auth/refresh',      // browser only sends this cookie here
  });
};

/**
 * Clear both auth cookies on logout
 */
const clearTokenCookies = (res) => {
  const secure   = IS_PROD();
  const sameSite = IS_PROD() ? 'none' : 'lax';

  res.clearCookie('access_token',  { httpOnly: true, secure, sameSite, path: '/' });
  res.clearCookie('refresh_token', { httpOnly: true, secure, sameSite, path: '/api/auth/refresh' });
};

// ─── Token generators ─────────────────────────────────────────────────────────

/**
 * Short-lived access token — 15 minutes
 * Used by the protect middleware to verify every API request
 */
const generateAccessToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '15m' });

/**
 * Long-lived refresh token — 7 days
 * Signed with a separate secret so it cannot be used as an access token.
 * No DB storage needed — the signature is the proof of validity.
 */
const generateRefreshToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });

// ─── Safe user response object ────────────────────────────────────────────────

const safeUser = (user) => ({
  id:                  user._id,
  name:                user.name,
  email:               user.email,
  avatar:              user.avatar,
  preferences:         user.preferences,
  stats:               user.stats,
  mustChangePassword:  user.mustChangePassword || false,
});

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/register
 * Create account, set tokens in cookies
 */
router.post('/register', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  try {
    const { name, email, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists' });
    }

    const user = await User.create({ name, email, password });

    setTokenCookies(res, generateAccessToken(user._id), generateRefreshToken(user._id));

    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      user:    safeUser(user),
    });
  } catch (err) {
    console.error('Register error:', err.message);
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }
    return res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

/**
 * POST /api/auth/login
 * Verify credentials, set tokens in cookies
 */
router.post('/login', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (user.status !== 1) {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated. Please contact support.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Update last active
    user.stats.lastActive = new Date();
    await user.save({ validateBeforeSave: false });

    setTokenCookies(res, generateAccessToken(user._id), generateRefreshToken(user._id));

    return res.json({
      success: true,
      message: 'Login successful',
      user:    safeUser(user),
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
});

/**
 * POST /api/auth/refresh
 * Browser sends refresh_token cookie (only reaches here due to path scoping).
 * Verifies it, issues a fresh pair of tokens.
 */
router.post('/refresh', async (req, res) => {
  const token = req.cookies?.refresh_token;

  if (!token) {
    return res.status(401).json({
      success: false,
      code:    'REFRESH_TOKEN_MISSING',
      message: 'No refresh token — please log in',
    });
  }

  try {
    // Verify against the refresh secret (separate from access secret)
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);

    const user = await User.findById(decoded.id).select('-password');
    if (!user || user.status !== 1) {
      clearTokenCookies(res);
      return res.status(401).json({
        success: false,
        code:    'USER_INACTIVE',
        message: 'User not found or deactivated',
      });
    }

    // Issue a fresh pair
    setTokenCookies(res, generateAccessToken(user._id), generateRefreshToken(user._id));

    return res.json({
      success: true,
      message: 'Tokens refreshed',
      user:    safeUser(user),
    });
  } catch (err) {
    clearTokenCookies(res);

    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        code:    'REFRESH_TOKEN_EXPIRED',
        message: 'Session expired — please log in again',
      });
    }
    return res.status(401).json({
      success: false,
      code:    'INVALID_REFRESH_TOKEN',
      message: 'Invalid refresh token — please log in again',
    });
  }
});

/**
 * GET /api/auth/me
 * Protected — return current user + silently update lastActive
 */
router.get('/me', protect, async (req, res) => {
  try {
    // Update lastActive so "active today" stats are accurate
    // Only write if it's been more than 5 minutes since last update (avoid hammering DB)
    const user = req.user
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
    if (!user.stats?.lastActive || user.stats.lastActive < fiveMinAgo) {
      await User.findByIdAndUpdate(user._id, { 'stats.lastActive': new Date() })
    }
    return res.json({ success: true, user: safeUser(user) })
  } catch (_) {
    return res.json({ success: true, user: safeUser(req.user) })
  }
});

/**
 * POST /api/auth/logout
 * Clear both cookies — works even without a valid access token
 */
router.post('/logout', (req, res) => {
  clearTokenCookies(res);
  return res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * POST /api/auth/change-password
 * Protected — verify current password, set new one, re-issue tokens
 */
router.post('/change-password', protect, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user._id).select('+password');

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ success: false, message: 'New password must be different from your current password' });
    }

    user.password           = newPassword  // pre-save hook hashes it
    user.mustChangePassword = false         // clear the forced-change flag
    await user.save()

    // Re-issue fresh tokens so user stays logged in with updated state
    setTokenCookies(res, generateAccessToken(user._id), generateRefreshToken(user._id))

    return res.json({ success: true, message: 'Password changed successfully' })
  } catch (err) {
    console.error('Change password error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to change password' });
  }
});

module.exports = router;