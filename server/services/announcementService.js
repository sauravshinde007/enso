// server/services/announcementService.js
// Drives the Announcement Hall: status transitions (scheduled -> live -> ended), reminders,
// notifications to every user, and broadcasting the hall state to clients.
import Announcement from "../models/Announcement.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { ANNOUNCEMENT_REMINDER_MINUTES } from "../config/announcementHall.js";

const TICK_MS = 10 * 1000;

let io = null;
let state = { live: null, upcoming: [] };
let stateKey = "";
const liveChangeListeners = new Set();

const toDto = (a) => ({
  _id: String(a._id),
  title: a.title,
  description: a.description,
  speakerId: String(a.speaker?._id || a.speaker),
  speakerName: a.speaker?.username || "Speaker",
  speakerAvatar: a.speaker?.avatar || "",
  startTime: a.startTime,
  endTime: a.endTime,
  status: a.status,
});

const formatTime = (date) =>
  new Date(date).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: process.env.TZ || "Asia/Kolkata" });

/** Persist a notification for every user and show a toast to everyone online. */
export const notifyEveryone = async (message, announcementId) => {
  try {
    const users = await User.find({}, "_id");
    if (users.length) {
      await Notification.insertMany(users.map((u) => ({
        user: u._id,
        message,
        type: "announcement",
        relatedId: announcementId,
      })));
    }
  } catch (err) {
    console.error("Failed to store announcement notifications:", err.message);
  }
  io?.emit("announcementNotice", { message, announcementId: String(announcementId) });
};

export const getAnnouncementState = () => state;

/** Called with the live announcement (or null) whenever it changes. */
export const onLiveAnnouncementChange = (cb) => {
  liveChangeListeners.add(cb);
  return () => liveChangeListeners.delete(cb);
};

const refreshState = async () => {
  const now = new Date();
  const [live, upcoming] = await Promise.all([
    Announcement.findOne({ status: "live" }).populate("speaker", "username avatar"),
    Announcement.find({ status: "scheduled", endTime: { $gt: now } })
      .sort({ startTime: 1 })
      .limit(5)
      .populate("speaker", "username avatar"),
  ]);

  const next = { live: live ? toDto(live) : null, upcoming: upcoming.map(toDto) };
  const key = JSON.stringify(next);
  if (key === stateKey) return;

  const liveChanged = (state.live?._id || null) !== (next.live?._id || null);
  state = next;
  stateKey = key;
  io?.emit("announcementState", state);
  if (liveChanged) liveChangeListeners.forEach((cb) => cb(state.live));
};

const tick = async () => {
  const now = new Date();
  try {
    // End finished slots
    const finished = await Announcement.find({ status: { $in: ["scheduled", "live"] }, endTime: { $lte: now } });
    for (const a of finished) {
      a.status = "ended";
      await a.save();
    }

    // Go live
    const starting = await Announcement.find({ status: "scheduled", startTime: { $lte: now }, endTime: { $gt: now } })
      .populate("speaker", "username");
    for (const a of starting) {
      a.status = "live";
      a.reminderSent = true;
      await a.save();
      await notifyEveryone(`🔴 LIVE now in the Announcement Hall: "${a.title}" by ${a.speaker?.username}. Head to the hall to listen.`, a._id);
    }

    // Reminders
    const soon = new Date(now.getTime() + ANNOUNCEMENT_REMINDER_MINUTES * 60 * 1000);
    const remind = await Announcement.find({ status: "scheduled", reminderSent: false, startTime: { $gt: now, $lte: soon } })
      .populate("speaker", "username");
    for (const a of remind) {
      a.reminderSent = true;
      await a.save();
      const minutes = Math.max(1, Math.round((a.startTime - now) / 60000));
      await notifyEveryone(`⏰ Reminder: "${a.title}" by ${a.speaker?.username} starts in ${minutes} min in the Announcement Hall.`, a._id);
    }

    await refreshState();
  } catch (err) {
    console.error("Announcement tick failed:", err.message);
  }
};

export const initAnnouncements = (socketIo) => {
  io = socketIo;
  setInterval(tick, TICK_MS);
};

/** Run once Mongo is connected (also used after create/cancel for an instant update). */
export const runAnnouncementTick = () => tick();

export const announcementDeclaredMessage = (a, speakerName) =>
  `📢 New announcement: "${a.title}" by ${speakerName} on ${formatTime(a.startTime)} in the Announcement Hall.`;
