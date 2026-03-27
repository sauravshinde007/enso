import mongoose from 'mongoose';

const scheduledMeetingSchema = new mongoose.Schema({
    leader: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    roomName: {
        type: String,
        required: true
    },
    startTime: {
        type: Date,
        required: true
    },
    endTime: {
        type: Date,
        required: true
    },
    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    status: {
        type: String,
        enum: ['Scheduled', 'Active', 'Ended'],
        default: 'Scheduled'
    }
}, { timestamps: true });

export default mongoose.model('ScheduledMeeting', scheduledMeetingSchema);
