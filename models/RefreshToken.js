const mongoose = require('mongoose');

/**
 * RefreshToken Model
 * --------------------------------------------------
 * Stores hashed refresh tokens in DB for:
 *  - Rotation (invalidate old token on each use)
 *  - Family-based theft detection (if stolen token is reused,
 *    entire family gets revoked)
 *  - Device/session tracking via IP and user-agent
 */
const refreshTokenSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  // Stored as SHA-256 hash — never plain text
  token: {
    type: String,
    required: true,
    unique: true,
  },
  // Links all tokens from the same login session/device.
  // If a token is reused (theft detected), entire family is revoked.
  family: {
    type: String,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }, // MongoDB TTL — auto-deletes expired docs
  },
  // Audit info
  ip:        { type: String, default: null },
  userAgent: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
