const jwt  = require('jsonwebtoken');
const User = require('../models/User');

/**
 * protect
 * --------------------------------------------------
 * Reads the JWT access token from the httpOnly cookie.
 * Returns structured error codes so the frontend knows
 * exactly what to do:
 *
 *   ACCESS_TOKEN_MISSING → no cookie present, redirect to login
 *   TOKEN_EXPIRED        → cookie exists but expired, call /api/auth/refresh
 *   INVALID_TOKEN        → tampered/bad token, redirect to login
 *   USER_INACTIVE        → account deactivated, redirect to login
 */
const protect = async (req, res, next) => {
  const token = req.cookies?.access_token;

  if (!token) {
    return res.status(401).json({
      success: false,
      code:    'ACCESS_TOKEN_MISSING',
      message: 'Not authenticated',
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select('-password');
    if (!user || user.status !== 1) {
      return res.status(401).json({
        success: false,
        code:    'USER_INACTIVE',
        message: 'User not found or account deactivated',
      });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(403).json({
        success: false,
        code:    'TOKEN_EXPIRED',
        message: 'Access token expired',
      });
    }
    return res.status(401).json({
      success: false,
      code:    'INVALID_TOKEN',
      message: 'Invalid access token',
    });
  }
};

module.exports = { protect };