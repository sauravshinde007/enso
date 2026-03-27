import mongoose from 'mongoose';

const meetingTranscriptSchema = new mongoose.Schema({
    sessionId: { type: String, required: true },
    username: { type: String, required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

// Index for fast query by sessionId and sorted by timestamp
meetingTranscriptSchema.index({ sessionId: 1, timestamp: 1 });

export default mongoose.model('MeetingTranscript', meetingTranscriptSchema);
