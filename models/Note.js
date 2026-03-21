const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  content: {
    type: String,
    default: ''
  },
  contentType: {
    type: String,
    enum: ['text', 'markdown', 'html', 'code'],
    default: 'markdown'
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  color: {
    type: String,
    default: '#1a1a2e'
  },
  isPinned: {
    type: Boolean,
    default: false
  },
  isFavorite: {
    type: Boolean,
    default: false
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  isTrashed: {
    type: Boolean,
    default: false
  },
  trashedAt: {
    type: Date,
    default: null
  },
  subject: {
    type: String,
    trim: true,
    default: ''
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  wordCount: {
    type: Number,
    default: 0
  },
  readTime: {
    type: Number, // in minutes
    default: 0
  },
  attachments: [{
    name: String,
    url: String,
    type: String,
    size: Number
  }],
  lastEditedAt: {
    type: Date,
    default: Date.now
  },
  isShared: {
    type: Boolean,
    default: false
  },
  shareToken: {
    type: String,
    default: null,
    index: true,
    sparse: true
  },
  sharedAt: {
    type: Date,
    default: null
  },
  // References to notebooks this note belongs to (many-to-many)
  notebooks: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Notebook',
    default: [],
  }],
}, { timestamps: true });

// Index for search
noteSchema.index({ title: 'text', content: 'text', tags: 'text', subject: 'text' });
noteSchema.index({ user: 1, createdAt: -1 });
noteSchema.index({ user: 1, isPinned: -1 });

// Auto-calculate word count and read time
noteSchema.pre('save', function(next) {
  if (this.isModified('content')) {
    const plainText = this.content.replace(/<[^>]*>/g, ' ').trim()
    const words = plainText.split(/\s+/).filter(w => w).length;
    this.wordCount = words;
    this.readTime = Math.ceil(words / 200);
    this.lastEditedAt = new Date();
  }
  next();
});

module.exports = mongoose.model('Note', noteSchema);