const mongoose = require('mongoose');

const notebookSchema = new mongoose.Schema({
  user: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
    index:    true,
  },
  name: {
    type:      String,
    required:  [true, 'Notebook name is required'],
    trim:      true,
    maxlength: [100, 'Name cannot exceed 100 characters'],
  },
  emoji: {
    type:    String,
    default: '📓',
  },
  color: {
    type:    String,
    default: 'indigo',   // indigo | rose | amber | green | blue | purple | orange
  },
  description: {
    type:    String,
    default: '',
    trim:    true,
    maxlength: [300, 'Description cannot exceed 300 characters'],
  },
}, { timestamps: true });

notebookSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Notebook', notebookSchema);