// server/models/User.js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: {
    type: String,
    required: function () { return !this.googleId; } // Password required only if not using Google
  },
  googleId: { type: String, unique: true, sparse: true }, // For Google OAuth
  avatar: { type: String, default: "" },
  role: {
    type: String,
    enum: ['employee', 'admin', 'hr', 'ceo'],
    default: 'employee'
  },
  activeSocketId: { type: String, default: null },
  resetPasswordToken: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null },
  lastX: { type: Number, default: 1162 },
  lastY: { type: Number, default: 1199 },
  assignedComputerId: { type: String, default: null }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
export default User;