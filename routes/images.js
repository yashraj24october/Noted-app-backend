const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const fsp      = require('fs').promises;
const UploadedImage = require('../models/UploadedImage');
const { protect }   = require('../middleware/auth');

// ─── Upload directory ─────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ─── Multer — memory storage so we can hash before writing ──
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10MB per image
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif|svg/;
    const ext  = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) cb(null, true);
    else cb(new Error('Only images are allowed (jpg, png, webp, gif, svg)'));
  },
});

// ─── Hash helper ─────────────────────────────────────
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');

// ─── POST /api/images/upload ─────────────────────────
// Protected — upload 1 image, returns { url, fileName, isNew }
router.post('/upload', protect, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image provided' });
    }

    const buf       = req.file.buffer;
    const hash      = md5(buf);
    const ext       = path.extname(req.file.originalname).toLowerCase();
    const fileName  = `${hash}${ext}`;
    const filePath  = path.join(UPLOAD_DIR, fileName);
    const host      = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const imageUrl  = `${host}/api/images/${fileName}`;

    // Check for existing record (deduplication)
    const existing = await UploadedImage.findById(hash);
    let fileOnDisk = false;
    try { await fsp.access(filePath); fileOnDisk = true; } catch (_) {}

    if (existing && fileOnDisk) {
      // Full duplicate — return existing URL
      return res.json({ success: true, url: imageUrl, fileName, isNew: false });
    }

    // Write file to disk (new or re-sync missing file)
    await fsp.writeFile(filePath, buf);

    if (!existing) {
      await UploadedImage.create({
        _id:          hash,
        fileName,
        originalName: req.file.originalname,
        mimeType:     req.file.mimetype,
        size:         req.file.size,
        uploadDate:   new Date(),
        uploadedBy:   req.user._id.toString(),
      });
    }

    return res.status(201).json({ success: true, url: imageUrl, fileName, isNew: true });
  } catch (err) {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
    }
    console.error('Image upload error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Upload failed' });
  }
});

// ─── GET /api/images/:fileName ────────────────────────
// Public — serve uploaded images (no auth — needed for shared notes too)
router.get('/:fileName', (req, res) => {
  const fileName = path.basename(req.params.fileName); // sanitize
  const filePath = path.join(UPLOAD_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'Image not found' });
  }

  res.sendFile(filePath);
});

// ─── DELETE /api/images/:fileName ────────────────────
// Protected — delete image and metadata
router.delete('/:fileName', protect, async (req, res) => {
  try {
    const fileName = path.basename(req.params.fileName);
    const hash     = path.parse(fileName).name;
    const filePath = path.join(UPLOAD_DIR, fileName);

    await UploadedImage.deleteOne({ _id: hash });

    try { await fsp.unlink(filePath); } catch (_) {}

    res.json({ success: true, message: 'Image deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;