const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const crypto   = require('crypto');
const path     = require('path');
const { Readable } = require('stream');
const UploadedImage = require('../models/UploadedImage');
const { protect }   = require('../middleware/auth');

// ─── Cloudinary setup ─────────────────────────────────
// Lazy-load so the server still starts if credentials missing
let cloudinary = null;

const getCloudinary = () => {
  if (cloudinary) return cloudinary;
  const { v2 } = require('cloudinary');
  v2.config({
    cloud_name:  process.env.CLOUDINARY_CLOUD_NAME,
    api_key:     process.env.CLOUDINARY_API_KEY,
    api_secret:  process.env.CLOUDINARY_API_SECRET,
    secure:      true,
  });
  cloudinary = v2;
  return cloudinary;
};

const useCloudinary = () =>
  !!(process.env.CLOUDINARY_CLOUD_NAME &&
     process.env.CLOUDINARY_API_KEY    &&
     process.env.CLOUDINARY_API_SECRET);

// ─── Multer — memory storage ───────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif|svg/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase())
            && allowed.test(file.mimetype);
    ok ? cb(null, true) : cb(new Error('Only images allowed (jpg, png, webp, gif, svg)'));
  },
});

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');

// Upload buffer to Cloudinary, returns secure URL
const uploadToCloudinary = (buffer, publicId, mimeType) => {
  return new Promise((resolve, reject) => {
    const cld    = getCloudinary();
    const stream = cld.uploader.upload_stream(
      {
        public_id:      `noted-app/${publicId}`,
        resource_type:  'image',
        overwrite:      false,          // dedup — same public_id returns existing
        unique_filename: false,
        format:         mimeType.includes('png')  ? 'png'
                      : mimeType.includes('gif')  ? 'gif'
                      : mimeType.includes('svg')  ? 'svg'
                      : mimeType.includes('webp') ? 'webp'
                      : 'jpg',
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result.secure_url);
      }
    );
    Readable.from(buffer).pipe(stream);
  });
};

// ─── POST /api/images/upload ───────────────────────────
router.post('/upload', protect, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image provided' });
    }

    const buf      = req.file.buffer;
    const hash     = md5(buf);
    const ext      = path.extname(req.file.originalname).toLowerCase();
    const publicId = `${hash}`;   // no extension — Cloudinary handles format

    // Check for existing record — full deduplication
    const existing = await UploadedImage.findById(hash);
    if (existing && existing.cloudinaryUrl) {
      return res.json({
        success:  true,
        url:      existing.cloudinaryUrl,
        fileName: existing.fileName,
        isNew:    false,
      });
    }

    let imageUrl;

    if (useCloudinary()) {
      // ── Upload to Cloudinary ──
      imageUrl = await uploadToCloudinary(buf, publicId, req.file.mimetype);
    } else {
      // ── Fallback: local disk (dev only) ──
      const fs   = require('fs');
      const fsp  = require('fs').promises;
      const UPLOAD_DIR = path.join(__dirname, '../uploads');
      if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      const fileName = `${hash}${ext}`;
      await fsp.writeFile(path.join(UPLOAD_DIR, fileName), buf);
      const host = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
      imageUrl   = `${host}/api/images/${fileName}`;
    }

    // Save / update record
    if (!existing) {
      await UploadedImage.create({
        _id:           hash,
        fileName:      `${hash}${ext}`,
        originalName:  req.file.originalname,
        mimeType:      req.file.mimetype,
        size:          req.file.size,
        uploadDate:    new Date(),
        uploadedBy:    req.user._id.toString(),
        cloudinaryUrl: useCloudinary() ? imageUrl : null,
      });
    } else {
      // Backfill cloudinaryUrl on existing record if missing
      await UploadedImage.updateOne({ _id: hash }, { cloudinaryUrl: imageUrl });
    }

    return res.status(201).json({
      success:  true,
      url:      imageUrl,
      fileName: `${hash}${ext}`,
      isNew:    true,
    });

  } catch (err) {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
    }
    console.error('Image upload error:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Upload failed' });
  }
});

// ─── GET /api/images/:fileName ─────────────────────────
// Kept for backward compatibility with old local URLs
// New uploads use direct Cloudinary URLs — this route won't be hit for those
router.get('/:fileName', async (req, res) => {
  const fileName = path.basename(req.params.fileName);

  // Check DB for Cloudinary URL
  try {
    const hash   = path.parse(fileName).name;
    const record = await UploadedImage.findById(hash);
    if (record?.cloudinaryUrl) {
      return res.redirect(301, record.cloudinaryUrl);
    }
  } catch (_) {}

  // Fallback: try local disk (dev / pre-Cloudinary uploads)
  const fs       = require('fs');
  const UPLOAD_DIR = path.join(__dirname, '../uploads');
  const filePath = path.join(UPLOAD_DIR, fileName);

  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }

  return res.status(404).json({ success: false, message: 'Image not found' });
});

// ─── DELETE /api/images/:fileName ─────────────────────
router.delete('/:fileName', protect, async (req, res) => {
  try {
    const fileName = path.basename(req.params.fileName);
    const hash     = path.parse(fileName).name;

    const record = await UploadedImage.findById(hash);

    // Delete from Cloudinary if stored there
    if (record?.cloudinaryUrl && useCloudinary()) {
      try {
        await getCloudinary().uploader.destroy(`noted-app/${hash}`)
      } catch (_) {}
    }

    // Delete local file if exists
    try {
      const fs = require('fs').promises;
      await fs.unlink(path.join(__dirname, '../uploads', fileName));
    } catch (_) {}

    await UploadedImage.deleteOne({ _id: hash });

    res.json({ success: true, message: 'Image deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;