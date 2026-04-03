import User from '../models/User.js';
import { ROLES } from '../config/roles.js';
import mongoose from 'mongoose';
import { syncUserToStream } from '../services/streamService.js';

export const getAllUsers = async (req, res) => {
    try {
        const users = await User.find({}, 'username email role avatar assignedComputerId _id');
        res.json(users);
    } catch (err) {
        console.error("Admin fetch users error:", err);
        res.status(500).json({ message: "Server error" });
    }
};

export const updateUserRole = async (req, res) => {
    try {
        const { role } = req.body;
        const validRoles = Object.values(ROLES);

        if (!validRoles.includes(role)) {
            return res.status(400).json({ message: "Invalid role" });
        }

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        user.role = role;
        await user.save();

        res.json({ message: `User role updated to ${role}`, user });
    } catch (err) {
        console.error("Admin update role error:", err);
        res.status(500).json({ message: "Server error" });
    }
};

export const assignComputer = async (req, res) => {
    try {
        const { computerId } = req.body;
        const user = await User.findById(req.params.id);
        
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (computerId) {
            const existingUser = await User.findOne({ assignedComputerId: computerId });
            if (existingUser && existingUser._id.toString() !== user._id.toString()) {
                return res.status(400).json({ message: `Computer currently assigned to ${existingUser.username}` });
            }
        }

        user.assignedComputerId = computerId || null;
        await user.save();

        res.json({ message: `Computer ${computerId || 'cleared'} assigned to user`, user });
    } catch (err) {
        console.error("Admin assign computer error:", err);
        res.status(500).json({ message: "Server error" });
    }
};

export const getMetaverseUsers = async (req, res) => {
    try {
        const { userId } = req.userData;

        if (!userId) {
            return res.status(400).json({ message: 'User ID not found in token.' });
        }

        let currentUserId;
        try {
            currentUserId = new mongoose.Types.ObjectId(userId);
        } catch (castError) {
            console.error("Failed to cast userId:", userId, castError.message);
            return res.status(400).json({ message: 'Invalid user ID format.' });
        }

        const users = await User.find({ _id: { $ne: currentUserId } })
            .select('_id username avatar role');

        if (!users) {
            return res.status(404).json({ msg: 'No users found' });
        }

        res.json(users);

    } catch (err) {
        console.error("Error in getMetaverseUsers:", err.message);
        res.status(500).json({ message: err.message || 'Server error while fetching users.' });
    }
};

export const updateProfile = async (req, res) => {
    try {
        const { userId } = req.userData;
        const { email, username } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        // 1. Check Email Uniqueness provided it changed
        if (email && email !== user.email) {
            const existingEmail = await User.findOne({ email });
            if (existingEmail && existingEmail._id.toString() !== userId) {
                return res.status(400).json({ message: 'Email already in use.' });
            }
            user.email = email;
        }

        // 2. Check Username Uniqueness provided it changed
        if (username && username !== user.username) {
            const existingUsername = await User.findOne({ username });
            if (existingUsername && existingUsername._id.toString() !== userId) {
                return res.status(400).json({ message: 'Username already taken.' });
            }
            user.username = username;
        }

        // 3. Update Avatar if provided
        if (req.file) {
            user.avatar = req.file.path; // Cloudinary URL
        }

        await user.save();

        // 4. SYNC WITH STREAM CHAT
        try {
            await syncUserToStream(user);
            console.log("✅ Synced user profile with Stream Chat");
        } catch (streamError) {
            console.error("❌ Failed to sync with Stream Chat:", streamError);
        }

        res.json({
            message: 'Profile updated successfully.',
            user: {
                _id: user._id,
                username: user.username,
                email: user.email,
                avatar: user.avatar,
                role: user.role
            }
        });

    } catch (err) {
        console.error("Error updating profile:", err);
        res.status(500).json({ message: 'Server error updating profile.' });
    }
};
