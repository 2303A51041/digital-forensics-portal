import mongoose from 'mongoose';
import { ROLES } from '../permissions.js';
import './plugins.js';

const userSchema = new mongoose.Schema({
  username: {
    type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 100,
    match: [/^[\w.-]+$/, 'Username may contain only letters, digits, dot, dash and underscore'],
  },
  fullName: { type: String, required: true, trim: true, maxlength: 200 },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 200 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ROLES, required: true },
  isActive: { type: Boolean, default: true },
  // Incremented on password change or reset, which invalidates every token issued before it.
  tokenVersion: { type: Number, default: 0, select: false },
  lastLoginAt: { type: Date, default: null },
}, { timestamps: true });

userSchema.index({ role: 1, isActive: 1 });

export const User = mongoose.model('User', userSchema);
