import mongoose from 'mongoose';
import crypto from 'crypto';

const meetingRecordSchema = new mongoose.Schema({
    sessionId: { type: String, default: () => crypto.randomUUID() },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    roomName: { type: String, required: true },
    joinTime: { type: Date, default: Date.now },
    leaveTime: { type: Date },
    duration: { type: Number, default: 0 }, // in seconds
    momStatus: { type: String, enum: ['None', 'Generating', 'Generated', 'Error'], default: 'None' },
    momContent: { type: String, default: null },
    transcriptContent: { type: String, default: null }
}, { timestamps: true });

export default mongoose.model('MeetingRecord', meetingRecordSchema);
