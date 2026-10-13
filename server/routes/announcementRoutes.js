import express from 'express';
import mongoose from 'mongoose';
import jwtAuthMiddleware from '../middleware/auth.js';
import checkAdmin from '../middleware/admin.js';
import Announcement from '../models/Announcement.js';
import User from '../models/User.js';
import { MAX_ANNOUNCEMENT_MINUTES } from '../config/announcementHall.js';
import {
    getAnnouncementState,
    notifyEveryone,
    runAnnouncementTick,
    announcementDeclaredMessage,
} from '../services/announcementService.js';

const router = express.Router();

// Current live announcement + upcoming slots (everyone)
router.get('/', jwtAuthMiddleware, (req, res) => {
    res.json(getAnnouncementState());
});

// 👑 Admin: allot a time slot to a speaker
router.post('/', jwtAuthMiddleware, checkAdmin, async (req, res) => {
    try {
        const { title, description, speakerId, startTime, endTime } = req.body;
        const start = new Date(startTime);
        const end = new Date(endTime);

        if (!title?.trim()) return res.status(400).json({ message: 'Title is required' });
        if (!mongoose.Types.ObjectId.isValid(speakerId)) return res.status(400).json({ message: 'Pick a speaker' });
        const speaker = await User.findById(speakerId, 'username');
        if (!speaker) return res.status(400).json({ message: 'Speaker not found' });
        if (isNaN(start) || isNaN(end)) return res.status(400).json({ message: 'Invalid start or end time' });
        if (end <= start) return res.status(400).json({ message: 'End time must be after the start time' });
        if (end <= new Date()) return res.status(400).json({ message: 'This time slot is already over' });
        if ((end - start) / 60000 > MAX_ANNOUNCEMENT_MINUTES) {
            return res.status(400).json({ message: `A slot can be at most ${MAX_ANNOUNCEMENT_MINUTES} minutes` });
        }

        // One hall -> no overlapping slots
        const clash = await Announcement.findOne({
            status: { $in: ['scheduled', 'live'] },
            startTime: { $lt: end },
            endTime: { $gt: start },
        }).populate('speaker', 'username');
        if (clash) {
            return res.status(409).json({ message: `The hall is already booked for "${clash.title}" (${clash.speaker?.username}) in that time` });
        }

        const announcement = await Announcement.create({
            title: title.trim(),
            description: description?.trim() || '',
            speaker: speaker._id,
            startTime: start,
            endTime: end,
            createdBy: req.userData.userId,
        });

        await notifyEveryone(announcementDeclaredMessage(announcement, speaker.username), announcement._id);
        await runAnnouncementTick(); // builds the stage for everyone right away

        res.status(201).json(announcement);
    } catch (err) {
        console.error('Create announcement error:', err);
        res.status(500).json({ message: 'Failed to create announcement' });
    }
});

// 👑 Admin: cancel (or end early)
router.delete('/:id', jwtAuthMiddleware, checkAdmin, async (req, res) => {
    try {
        const announcement = await Announcement.findById(req.params.id).populate('speaker', 'username');
        if (!announcement || !['scheduled', 'live'].includes(announcement.status)) {
            return res.status(404).json({ message: 'No active announcement with that id' });
        }
        const wasLive = announcement.status === 'live';
        announcement.status = wasLive ? 'ended' : 'cancelled';
        if (wasLive) announcement.endTime = new Date();
        await announcement.save();

        await notifyEveryone(
            wasLive
                ? `The announcement "${announcement.title}" has ended.`
                : `❌ Cancelled: "${announcement.title}" by ${announcement.speaker?.username} will not take place.`,
            announcement._id
        );
        await runAnnouncementTick();
        res.json({ message: wasLive ? 'Announcement ended' : 'Announcement cancelled' });
    } catch (err) {
        console.error('Cancel announcement error:', err);
        res.status(500).json({ message: 'Failed to cancel announcement' });
    }
});

// Speaker (or an admin) ends a live announcement early
router.post('/:id/end', jwtAuthMiddleware, async (req, res) => {
    try {
        const announcement = await Announcement.findById(req.params.id).populate('speaker', 'username');
        if (!announcement || announcement.status !== 'live') {
            return res.status(404).json({ message: 'This announcement is not live' });
        }
        const isSpeaker = String(announcement.speaker?._id) === String(req.userData.userId);
        if (!isSpeaker && req.userData.role !== 'admin') {
            return res.status(403).json({ message: 'Only the speaker or an admin can end this announcement' });
        }

        announcement.status = 'ended';
        announcement.endTime = new Date();
        await announcement.save();

        await notifyEveryone(`The announcement "${announcement.title}" has ended.`, announcement._id);
        await runAnnouncementTick(); // lifts the hall mute + removes the stage right away
        res.json({ message: 'Announcement ended' });
    } catch (err) {
        console.error('End announcement error:', err);
        res.status(500).json({ message: 'Failed to end announcement' });
    }
});

export default router;
