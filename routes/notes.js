const express = require('express');
const router = express.Router();
const Note = require('../models/Note');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// All routes protected
router.use(protect);

// @GET /api/notes - Get all notes
router.get('/', async (req, res) => {
  try {
    const { search, tag, subject, priority, archived, trashed, favorites, pinned, sort = '-createdAt', page = 1, limit = 50 } = req.query;

    let query = { user: req.user._id };

    if (trashed === 'true') {
      query.isTrashed = true;
    } else if (archived === 'true') {
      query.isArchived = true;
      query.isTrashed = false;
    } else {
      query.isTrashed = false;
      query.isArchived = false;
    }

    if (favorites === 'true') query.isFavorite = true;
    if (pinned === 'true') query.isPinned = true;
    if (tag) query.tags = { $in: [tag.toLowerCase()] };
    if (subject) query.subject = new RegExp(subject, 'i');
    if (priority) query.priority = priority;

    if (search) {
      // Escape special regex chars, then match across title/tags/subject as-is
      // For content — also strip HTML so we match plain text inside rich notes
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const rx = new RegExp(escaped, 'i')
      const rxHtml = new RegExp(escaped.replace(/</g, '&lt;'), 'i')
      query.$or = [
        { title:   rx },
        { subject: rx },
        { tags:    rx },
        // Match raw content (works for both markdown and HTML with text visible)
        { content: rx },
      ]
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Note.countDocuments(query);
    const notes = await Note.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .select('-__v');

    res.json({
      success: true,
      count: notes.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: notes
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @GET /api/notes/stats - Get note statistics
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user._id;

    const [totalNotes, pinned, favorites, archived, trashed, byPriority, bySubject, recentNotes] = await Promise.all([
      Note.countDocuments({ user: userId, isTrashed: false }),
      Note.countDocuments({ user: userId, isPinned: true, isTrashed: false }),
      Note.countDocuments({ user: userId, isFavorite: true, isTrashed: false }),
      Note.countDocuments({ user: userId, isArchived: true, isTrashed: false }),
      Note.countDocuments({ user: userId, isTrashed: true }),
      Note.aggregate([
        { $match: { user: userId, isTrashed: false } },
        { $group: { _id: '$priority', count: { $sum: 1 } } }
      ]),
      Note.aggregate([
        { $match: { user: userId, isTrashed: false, subject: { $ne: '' } } },
        { $group: { _id: '$subject', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ]),
      Note.find({ user: userId, isTrashed: false })
        .sort('-createdAt')
        .limit(5)
        .select('title createdAt tags subject')
    ]);

    // Get all unique tags
    const allNotes = await Note.find({ user: userId, isTrashed: false }).select('tags');
    const tagMap = {};
    allNotes.forEach(note => {
      note.tags.forEach(tag => {
        tagMap[tag] = (tagMap[tag] || 0) + 1;
      });
    });
    const topTags = Object.entries(tagMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    res.json({
      success: true,
      data: {
        totalNotes,
        pinned,
        favorites,
        archived,
        trashed,
        byPriority,
        bySubject,
        topTags,
        recentNotes
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @GET /api/notes/:id - Get single note
router.get('/:id', async (req, res) => {
  try {
    const note = await Note.findOne({ _id: req.params.id, user: req.user._id });
    if (!note) return res.status(404).json({ success: false, message: 'Note not found' });
    res.json({ success: true, data: note });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @POST /api/notes - Create note
router.post('/', async (req, res) => {
  try {
    const note = await Note.create({ ...req.body, user: req.user._id });

    // Update user stats
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { 'stats.totalNotes': 1 },
      'stats.lastActive': new Date()
    });

    res.status(201).json({ success: true, data: note });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @PUT /api/notes/:id - Update note
router.put('/:id', async (req, res) => {
  try {
    const note = await Note.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { ...req.body, lastEditedAt: new Date() },
      { new: true, runValidators: true }
    );
    if (!note) return res.status(404).json({ success: false, message: 'Note not found' });
    res.json({ success: true, data: note });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @DELETE /api/notes/:id - Soft delete (trash)
router.delete('/:id', async (req, res) => {
  try {
    const { permanent } = req.query;

    if (permanent === 'true') {
      await Note.findOneAndDelete({ _id: req.params.id, user: req.user._id });
      await User.findByIdAndUpdate(req.user._id, { $inc: { 'stats.totalNotes': -1 } });
    } else {
      await Note.findOneAndUpdate(
        { _id: req.params.id, user: req.user._id },
        { isTrashed: true, trashedAt: new Date() }
      );
    }

    res.json({ success: true, message: permanent === 'true' ? 'Note deleted permanently' : 'Note moved to trash' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @PUT /api/notes/:id/restore - Restore from trash
router.put('/:id/restore', async (req, res) => {
  try {
    const note = await Note.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { isTrashed: false, isArchived: false, trashedAt: null },
      { new: true }
    );
    if (!note) return res.status(404).json({ success: false, message: 'Note not found' });
    res.json({ success: true, data: note });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @POST /api/notes/:id/duplicate - Duplicate note
router.post('/:id/duplicate', async (req, res) => {
  try {
    const original = await Note.findOne({ _id: req.params.id, user: req.user._id });
    if (!original) return res.status(404).json({ success: false, message: 'Note not found' });

    const { _id, createdAt, updatedAt, ...noteData } = original.toObject();
    const duplicate = await Note.create({
      ...noteData,
      title: `${original.title} (Copy)`,
      isPinned: false
    });

    res.status(201).json({ success: true, data: duplicate });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;