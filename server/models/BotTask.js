// server/models/BotTask.js
// One run of the AI bot on a GitHub issue (issue -> branch -> PR)
import mongoose from 'mongoose';

const botTaskSchema = new mongoose.Schema({
  team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  repo: { type: String, required: true }, // "owner/name"
  issueNumber: { type: Number, required: true },
  issueTitle: { type: String, default: '' },
  status: {
    type: String,
    enum: ['queued', 'running', 'pr_opened', 'failed'],
    default: 'queued',
  },
  step: { type: String, default: 'Queued' }, // human-readable progress
  provider: { type: String, required: true },
  model: { type: String, default: '' },
  branch: { type: String, default: null },
  prNumber: { type: Number, default: null },
  prUrl: { type: String, default: null },
  error: { type: String, default: null },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

botTaskSchema.index({ team: 1, issueNumber: 1, createdAt: -1 });

const BotTask = mongoose.model('BotTask', botTaskSchema);
export default BotTask;
