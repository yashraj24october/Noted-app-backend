const express = require("express");
const router = express.Router();
const Note = require("../models/Note");
const {protect} = require("../middleware/auth.js");

router.use(protect);

// @GET /api/tags - Get all unique tags for user
router.get("/", async (req, res) => {
  try {
    const notes = await Note.find({user: req.user._id, isTrashed: false}).select("tags");
    const tagMap = {};
    notes.forEach(note => {
      note.tags.forEach(tag => {
        tagMap[tag] = (tagMap[tag] || 0) + 1;
      });
    });

    const tags = Object.entries(tagMap).map(([name, count]) => ({name, count})).sort((a, b) => b.count - a.count);

    res.json({success: true, data: tags});
  } catch (err) {
    res.status(500).json({success: false, message: err.message});
  }
});

module.exports = router;
