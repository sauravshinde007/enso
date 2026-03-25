import express from "express";
import axios from "axios";
import authMiddleware from "../middleware/auth.js";
import MeetingRecord from "../models/MeetingRecord.js";
import MeetingTranscript from "../models/MeetingTranscript.js";
import ScheduledMeeting from "../models/ScheduledMeeting.js";
import User from "../models/User.js";
import { addMomJob } from "../services/momQueue.js";
import multer from "multer";
import os from "os";
import fs from "fs";
import path from "path";
import Groq from "groq-sdk";

const upload = multer({ dest: os.tmpdir() });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'devkey' });


const router = express.Router();

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "devkey";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "secret";
const LIVEKIT_URL = process.env.LIVEKIT_URL || "ws://localhost:7880";

// ================================
// Create / Get Meeting Room
// ================================
// ================================
// Create / Get Meeting Token
// ================================

import { AccessToken } from 'livekit-server-sdk';

router.post("/create", authMiddleware, async (req, res) => {
    try {
        const { roomId } = req.body;
        const participantName = req.userData.username;

        if (!roomId) {
            return res.status(400).json({
                error: "roomId is required",
            });
        }

        // --- ENFORCE SCHEDULED MEETING ACCESS ---
        const now = new Date();
        const activeSchedule = await ScheduledMeeting.findOne({
            roomName: roomId,
            startTime: { $lte: now },
            endTime: { $gte: now },
            status: { $in: ['Scheduled', 'Active'] }
        });

        let isLeader = false;
        let scheduledMeetingId = null;

        if (activeSchedule) {
            // Check authorization
            isLeader = activeSchedule.leader.toString() === req.userData.userId;
            const isAuth = isLeader || activeSchedule.participants.some(p => p.toString() === req.userData.userId);

            if (!isAuth) {
                return res.status(403).json({
                    error: "This room is currently reserved for a scheduled meeting that you are not part of."
                });
            } else if (activeSchedule.status === 'Scheduled') {
                activeSchedule.status = 'Active';
                await activeSchedule.save();
            }
            scheduledMeetingId = activeSchedule._id;
        }
        // ----------------------------------------

        // Unique room name
        const livekitRoomName = `meta-${roomId}`;

        // Create a new token for the participant
        const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
            identity: participantName,
        });

        at.addGrant({ roomJoin: true, room: livekitRoomName });
        const token = await at.toJwt();

        return res.json({
            token: token,
            url: LIVEKIT_URL,
            roomName: livekitRoomName,
            isLeader,
            scheduledMeetingId
        });
    } catch (error) {
        console.error("LiveKit error:", error.message);

        return res.status(500).json({
            error: "Failed to create meeting token",
        });
    }
});

// ================================
// Track Meetings
// ================================

import crypto from "crypto";

router.post("/join", authMiddleware, async (req, res) => {
    try {
        const { roomName } = req.body;
        const userId = req.userData.userId;

        // Find an active meeting in this room (within the last 4 hours)
        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
        const activeMeeting = await MeetingRecord.findOne({
            roomName: roomName,
            joinTime: { $gte: fourHoursAgo },
            leaveTime: { $exists: false } // Still inside the meeting
        }).sort({ joinTime: -1 });

        const sessionId = activeMeeting && activeMeeting.sessionId
            ? activeMeeting.sessionId
            : crypto.randomUUID();

        // Also check if they ALREADY have a record (in case of reconnection)
        let record = await MeetingRecord.findOne({
            user: userId,
            roomName: roomName,
            leaveTime: { $exists: false },
            joinTime: { $gte: fourHoursAgo }
        });

        if (!record) {
            record = new MeetingRecord({
                sessionId: sessionId,
                user: userId,
                roomName: roomName,
                joinTime: new Date()
            });
            await record.save();
        }

        return res.json({ recordId: record._id, sessionId: record.sessionId });
    } catch (error) {
        console.error("Meeting join error:", error);
        return res.status(500).json({ error: "Failed to record meeting join" });
    }
});

router.post("/leave", authMiddleware, async (req, res) => {
    try {
        const { recordId } = req.body;
        if (!recordId) return res.status(400).json({ error: "recordId is required" });

        const record = await MeetingRecord.findById(recordId);
        if (!record) return res.status(404).json({ error: "Meeting record not found" });

        if (!record.leaveTime) {
            record.leaveTime = new Date();
            // Store duration in seconds instead of milliseconds for readibility
            record.duration = Math.floor((record.leaveTime - record.joinTime) / 1000);
            await record.save();

            // --- END SCHEDULED MEETING IF LEADER LEAVES ---
            // MeetingRecord.roomName may contain the 'meta-' prefix from LiveKit.
            const scheduledRoomName = record.roomName.startsWith("meta-") 
                ? record.roomName.substring(5) 
                : record.roomName;

            const activeSchedule = await ScheduledMeeting.findOne({
                roomName: scheduledRoomName,
                leader: req.userData.userId,
                status: 'Active'
            });
            if (activeSchedule) {
                activeSchedule.status = 'Ended';
                activeSchedule.endTime = new Date();
                await activeSchedule.save();
            }
            // ----------------------------------------------
        }

        return res.json({ message: "Meeting leave recorded", duration: record.duration });
    } catch (error) {
        console.error("Meeting leave error:", error);
        return res.status(500).json({ error: "Failed to record meeting leave" });
    }
});

router.get("/history", authMiddleware, async (req, res) => {
    try {
        const userId = req.userData.userId;
        const history = await MeetingRecord.find({ user: userId }).sort({ joinTime: -1 });
        return res.json({ history });
    } catch (error) {
        console.error("Meeting history fetch error:", error);
        return res.status(500).json({ error: "Failed to fetch meeting history" });
    }
});

// ================================
// Transcribe Audio
// ================================

router.post("/transcribe", authMiddleware, upload.single('audioFile'), async (req, res) => {
    try {
        const { sessionId } = req.body;
        const username = req.userData.username;

        if (!req.file || !sessionId) {
            return res.status(400).json({ error: "Missing audio or sessionId" });
        }

        const meetingsDir = path.join(os.tmpdir(), "metaverse_meetings");
        if (!fs.existsSync(meetingsDir)) {
            fs.mkdirSync(meetingsDir, { recursive: true });
        }

        // We store an appended webm file PER USER per session. 
        // This naturally merges the continuous WebM chunks into a single valid file stream.
        const safeUsername = username.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const targetPath = path.join(meetingsDir, `${sessionId}_${safeUsername}.webm`);

        const chunkData = fs.readFileSync(req.file.path);
        fs.appendFileSync(targetPath, chunkData);

        // Delete the multer temp file
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        return res.json({ success: true, message: "Audio chunk stored." });
    } catch (e) {
        console.error("Audio chunk append error:", e);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(500).json({ error: "Audio append failed" });
    }
});

// ================================
// Generate MOM
// ================================

router.post("/:recordId/generate-mom", authMiddleware, async (req, res) => {
    try {
        const { recordId } = req.params;
        const userId = req.userData.userId;

        const record = await MeetingRecord.findOne({ _id: recordId, user: userId });
        if (!record) return res.status(404).json({ error: "Meeting record not found" });

        if (record.momStatus === 'Generating' || record.momStatus === 'Generated') {
            return res.json({ message: "MOM is already generated or generating", status: record.momStatus });
        }

        const targetSessionId = record.sessionId;

        // Update all meeting records in this exact same session across ALL users!
        if (targetSessionId) {
            await MeetingRecord.updateMany(
                { sessionId: targetSessionId },
                { $set: { momStatus: 'Generating' } }
            );
        } else {
            record.momStatus = 'Generating';
            await record.save();
        }

        await addMomJob(record._id, record.roomName, targetSessionId);

        return res.json({ message: "MOM generation started", status: "Generating" });
    } catch (error) {
        console.error("MOM generation error:", error);
        return res.status(500).json({ error: "Failed to start MOM generation" });
    }
});

// ================================
// Scheduled Meetings
// ================================

router.get("/locked-zones", authMiddleware, async (req, res) => {
    try {
        const now = new Date();
        const rawSchedules = await ScheduledMeeting.find({
            startTime: { $lte: now },
            endTime: { $gte: now },
            status: { $in: ['Scheduled', 'Active'] }
        });

        const blockedZones = [];
        for (const schedule of rawSchedules) {
            const leaderUser = await User.findById(schedule.leader);
            const isLeaderOnline = leaderUser && !!leaderUser.activeSocketId;
            
            if (isLeaderOnline) {
                const isLeader = schedule.leader.toString() === req.userData.userId;
                const isParticipant = schedule.participants.some(p => p.toString() === req.userData.userId);
                if (!isLeader && !isParticipant) {
                    blockedZones.push(schedule.roomName);
                }
            }
        }
        return res.json({ blockedZones });
    } catch (e) {
        console.error("Locked zones fetch error:", e);
        return res.status(500).json({ error: "Failed to fetch locked zones" });
    }
});

import Notification from "../models/Notification.js";

router.get("/notifications", authMiddleware, async (req, res) => {
    try {
        const userId = req.userData.userId;
        const notifications = await Notification.find({ user: userId }).sort({ createdAt: -1 });
        return res.json({ notifications });
    } catch (error) {
        console.error("Fetch notifications error:", error);
        return res.status(500).json({ error: "Failed to fetch notifications" });
    }
});

router.post("/notifications/mark-seen", authMiddleware, async (req, res) => {
    try {
        const userId = req.userData.userId;
        await Notification.updateMany({ user: userId, seen: false }, { $set: { seen: true } });
        return res.json({ success: true });
    } catch (error) {
        console.error("Mark notifications seen error:", error);
        return res.status(500).json({ error: "Failed to mark notifications unseen" });
    }
});

router.post("/schedule", authMiddleware, async (req, res) => {
    try {
        const { roomName, startTime, endTime, participantIds } = req.body;
        const leaderId = req.userData.userId;

        if (!roomName || !startTime || !endTime || !participantIds) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const start = new Date(startTime);
        const end = new Date(endTime);

        if (start < new Date(Date.now() - 5 * 60 * 1000)) {
            return res.status(400).json({ error: "Cannot schedule meetings in the past" });
        }
        if (end <= start) {
            return res.status(400).json({ error: "End time must be after start time" });
        }
        if (end - start > 60 * 60 * 1000) {
            return res.status(400).json({ error: "Meeting duration cannot exceed 1 hour" });
        }

        const scheduledMeeting = new ScheduledMeeting({
            leader: leaderId,
            roomName: roomName,
            startTime: start,
            endTime: end,
            participants: participantIds,
            status: 'Scheduled'
        });

        await scheduledMeeting.save();

        // Create Notifications for all participants
        const leaderUser = await User.findById(leaderId);
        const leaderUsername = leaderUser ? leaderUser.username : "Team Leader";
        const message = `${leaderUsername} scheduled a meeting in ${roomName.replace('meta-', '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`;
        
        const notifications = participantIds.map(participantId => ({
            user: participantId,
            message: message,
            type: 'meeting_invite',
            relatedId: scheduledMeeting._id,
        }));
        
        if (notifications.length > 0) {
            await Notification.insertMany(notifications);
        }

        // Optional: Emit real-time socket events for UI notification
        const io = req.app.get("io");
        if (io) {
            io.emit("meeting_invite", {
                roomName,
                startTime,
                leaderUsername,
                participantIds,
                meeting: scheduledMeeting
            });
        }

        return res.json({ message: "Meeting scheduled successfully", meeting: scheduledMeeting });
    } catch (error) {
        console.error("Schedule meeting error:", error);
        return res.status(500).json({ error: "Failed to schedule meeting" });
    }
});

router.post("/extend", authMiddleware, async (req, res) => {
    try {
        const { scheduledMeetingId, extraMinutes } = req.body;

        if (!scheduledMeetingId || !extraMinutes) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const meeting = await ScheduledMeeting.findById(scheduledMeetingId);
        if (!meeting) return res.status(404).json({ error: "Scheduled meeting not found" });

        // Verify caller is leader
        if (meeting.leader.toString() !== req.userData.userId) {
            return res.status(403).json({ error: "Only the leader can extend this meeting" });
        }

        // Add minutes to endTime
        const newEndTime = new Date(meeting.endTime.getTime() + extraMinutes * 60000);
        meeting.endTime = newEndTime;
        await meeting.save();

        return res.json({ message: "Meeting extended", newEndTime: meeting.endTime });
    } catch (error) {
        console.error("Extend meeting error:", error);
        return res.status(500).json({ error: "Failed to extend meeting time" });
    }
});

export default router;
