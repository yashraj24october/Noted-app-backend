const express    = require('express');
const router     = express.Router();
const mongoose   = require('mongoose');
const Notebook   = require('../models/Notebook');
const Note       = require('../models/Note');
const { protect } = require('../middleware/auth');

router.use(protect);

// ─── GET /api/notebooks ──────────────────────────────
// List all notebooks for the user, with note counts
router.get('/', async (req, res) => {
  try {
    const { search } = req.query
    const query = { user: req.user._id }

    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      query.$or = [{ name: rx }, { description: rx }]
    }

    const notebooks = await Notebook.find(query)
      .sort({ createdAt: -1 })
      .lean();

    // Attach note count to each notebook
    const ids = notebooks.map(n => n._id);
    const counts = await Note.aggregate([
      { $match: { user: req.user._id, notebooks: { $in: ids }, isTrashed: false } },
      { $unwind: '$notebooks' },
      { $match: { notebooks: { $in: ids } } },
      { $group: { _id: '$notebooks', count: { $sum: 1 } } },
    ]);

    const countMap = {};
    counts.forEach(c => { countMap[c._id.toString()] = c.count; });

    const result = notebooks.map(nb => ({
      ...nb,
      noteCount: countMap[nb._id.toString()] || 0,
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/notebooks ─────────────────────────────
// Create a new notebook
router.post('/', async (req, res) => {
  try {
    const { name, emoji, color, description } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Notebook name is required' });
    }

    const notebook = await Notebook.create({
      user: req.user._id,
      name: name.trim(),
      emoji:       emoji       || '📓',
      color:       color       || 'indigo',
      description: description || '',
    });

    res.status(201).json({ success: true, data: { ...notebook.toObject(), noteCount: 0 } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── PUT /api/notebooks/:id ──────────────────────────
// Update notebook name / emoji / color / description
router.put('/:id', async (req, res) => {
  try {
    const notebook = await Notebook.findOne({ _id: req.params.id, user: req.user._id });
    if (!notebook) return res.status(404).json({ success: false, message: 'Notebook not found' });

    const { name, emoji, color, description } = req.body;
    if (name !== undefined)        notebook.name        = name.trim();
    if (emoji !== undefined)       notebook.emoji       = emoji;
    if (color !== undefined)       notebook.color       = color;
    if (description !== undefined) notebook.description = description;

    await notebook.save();
    res.json({ success: true, data: notebook });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DELETE /api/notebooks/:id ───────────────────────
// Delete notebook — notes are NOT deleted, just unlinked
router.delete('/:id', async (req, res) => {
  try {
    const notebook = await Notebook.findOne({ _id: req.params.id, user: req.user._id });
    if (!notebook) return res.status(404).json({ success: false, message: 'Notebook not found' });

    // Remove this notebook from all notes
    await Note.updateMany(
      { user: req.user._id, notebooks: notebook._id },
      { $pull: { notebooks: notebook._id } }
    );

    await notebook.deleteOne();
    res.json({ success: true, message: 'Notebook deleted. Notes were not affected.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/notebooks/:id/notes ────────────────────
// Get all notes inside a notebook
router.get('/:id/notes', async (req, res) => {
  try {
    const notebook = await Notebook.findOne({ _id: req.params.id, user: req.user._id });
    if (!notebook) return res.status(404).json({ success: false, message: 'Notebook not found' });

    const notes = await Note.find({
      user:      req.user._id,
      notebooks: notebook._id,
      isTrashed: false,
    }).sort({ updatedAt: -1 });

    res.json({ success: true, data: notes, notebook });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/notebooks/:id/notes ───────────────────
// Add existing notes to a notebook (array of noteIds)
router.post('/:id/notes', async (req, res) => {
  try {
    const notebook = await Notebook.findOne({ _id: req.params.id, user: req.user._id });
    if (!notebook) return res.status(404).json({ success: false, message: 'Notebook not found' });

    const { noteIds } = req.body;
    if (!Array.isArray(noteIds) || noteIds.length === 0) {
      return res.status(400).json({ success: false, message: 'noteIds array is required' });
    }

    // Validate all notes belong to user
    const validIds = noteIds.filter(id => mongoose.Types.ObjectId.isValid(id));

    await Note.updateMany(
      { _id: { $in: validIds }, user: req.user._id },
      { $addToSet: { notebooks: notebook._id } }  // addToSet = no duplicates
    );

    res.json({ success: true, message: `${validIds.length} note(s) added to notebook` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DELETE /api/notebooks/:id/notes ─────────────────
// Remove notes from a notebook (array of noteIds)
router.delete('/:id/notes', async (req, res) => {
  try {
    const notebook = await Notebook.findOne({ _id: req.params.id, user: req.user._id });
    if (!notebook) return res.status(404).json({ success: false, message: 'Notebook not found' });

    const { noteIds } = req.body;
    if (!Array.isArray(noteIds) || noteIds.length === 0) {
      return res.status(400).json({ success: false, message: 'noteIds array is required' });
    }

    await Note.updateMany(
      { _id: { $in: noteIds }, user: req.user._id },
      { $pull: { notebooks: notebook._id } }
    );

    res.json({ success: true, message: `${noteIds.length} note(s) removed from notebook` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;