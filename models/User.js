const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type:      String,
    required:  [true, 'Name is required'],
    trim:      true,
    maxlength: [50, 'Name cannot exceed 50 characters'],
  },
  email: {
    type:      String,
    required:  [true, 'Email is required'],
    unique:    true,
    lowercase: true,
    trim:      true,
    match:     [/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Please enter a valid email'],
  },
  password: {
    type:      String,
    required:  [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select:    false, // never returned in queries by default
  },
  avatar:     { type: String, default: '' },
  status:     { type: Number, default: 1 },
  mustChangePassword: { type: Boolean, default: false }, // set true after admin reset
  preferences: {
    theme:       { type: String, enum: ['dark', 'light'], default: 'light' },
    defaultView: { type: String, enum: ['grid', 'list'],  default: 'grid'  },
    fontSize:    { type: String, enum: ['small', 'medium', 'large'], default: 'medium' },
  },
  stats: {
    totalNotes: { type: Number, default: 0 },
    totalTags:  { type: Number, default: 0 },
    lastActive: { type: Date,   default: Date.now },
  },
}, { timestamps: true });

// Hash password before save (only when modified)
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare plain password against stored hash
userSchema.methods.comparePassword = async function (entered) {
  return bcrypt.compare(entered, this.password);
};

module.exports = mongoose.model('User', userSchema);