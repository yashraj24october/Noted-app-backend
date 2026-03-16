const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const Note = require("../models/Note");
const {protect} = require("../middleware/auth.js");

// ── PUBLIC: GET /api/shared/:token ──────────────────────────────────────────
// No auth required — anyone with the token can view
router.get("/:token", async (req, res) => {
  try {
    const note = await Note.findOne({shareToken: req.params.token, isShared: true, isTrashed: false}).select("title content tags subject priority color wordCount readTime createdAt updatedAt sharedAt");

    if (!note) {
      return res.status(404).json({success: false, message: "Shared note not found or link has been revoked."});
    }

    res.json({success: true, data: note});
  } catch (err) {
    res.status(500).json({success: false, message: err.message});
  }
});

// ── PROTECTED: POST /api/shared/:id/share — generate share link ─────────────
router.post("/:id/share", protect, async (req, res) => {
  try {
    const note = await Note.findOne({_id: req.params.id, user: req.user._id});
    if (!note) 
      return res.status(404).json({success: false, message: "Note not found"});
    
    // Generate a cryptographically random token
    const token = crypto.randomBytes(20).toString("hex");

    note.isShared = true;
    note.shareToken = token;
    note.sharedAt = new Date();
    await note.save({validateBeforeSave: false});

    res.json({
      success: true,
      data: {
        shareToken: token,
        sharedAt: note.sharedAt
      }
    });
  } catch (err) {
    res.status(500).json({success: false, message: err.message});
  }
});

// ── PROTECTED: DELETE /api/shared/:id/share — revoke share link ─────────────
router.delete("/:id/share", protect, async (req, res) => {
  try {
    const note = await Note.findOne({_id: req.params.id, user: req.user._id});
    if (!note) 
      return res.status(404).json({success: false, message: "Note not found"});
    
    note.isShared = false;
    note.shareToken = null;
    note.sharedAt = null;
    await note.save({validateBeforeSave: false});

    res.json({success: true, message: "Share link revoked"});
  } catch (err) {
    res.status(500).json({success: false, message: err.message});
  }
});

module.exports = router;
