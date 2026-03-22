const mongoose = require('mongoose');

/**
 * UploadedImage Model
 * --------------------------------------------------
 * Uses file hash (MD5) as _id for automatic deduplication.
 * Same file uploaded twice = same DB record, same URL.
 * { _id: false } prevents Mongoose auto-id — we set it manually.
 */
const imageSchema = new mongoose.Schema({
  _id: {
    type:     String,   // MD5 hash of file content
    required: true,
  },
  fileName: {           // hash + extension, e.g. "a3f9b2c1.jpg"
    type:     String,
    required: true,
    unique:   true,
  },
  originalName: {
    type:     String,
    required: true,
  },
  mimeType: {
    type:     String,
    required: true,
  },
  size: {               // bytes
    type:     Number,
    required: true,
  },
  uploadDate: {
    type:    Date,
    default: Date.now,
  },
  uploadedBy: {
    type:    String,
    default: 'anonymous',
  },
  cloudinaryUrl: {        // permanent Cloudinary URL (null for local/legacy)
    type:    String,
    default: null,
  },
}, { _id: false });

module.exports = mongoose.model('sys_UploadedImages', imageSchema);