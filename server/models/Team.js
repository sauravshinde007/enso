// server/models/Team.js
import mongoose from 'mongoose';

export const BOT_PROVIDERS = ['claude', 'openai', 'gemini', 'groq'];

// GitHub labels (case-insensitive) that make an issue "low priority" -> eligible for the bot
export const DEFAULT_LOW_PRIORITY_LABELS = [
  'priority: low', 'priority:low', 'priority/low', 'low priority', 'low-priority', 'p3',
];

const teamSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  description: { type: String, default: '' },
  leader: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // A user can be a member of several teams
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  repo: {
    owner: { type: String, default: null },
    name: { type: String, default: null },
    url: { type: String, default: null },
  },

  // Secrets are stored encrypted and never returned to clients
  githubTokenEnc: { type: String, default: null, select: false },
  githubTokenHint: { type: String, default: null },

  bot: {
    provider: { type: String, enum: BOT_PROVIDERS, default: 'groq' },
    model: { type: String, default: '' },
    apiKeyEnc: { type: String, default: null, select: false },
    apiKeyHint: { type: String, default: null },
  },

  lowPriorityLabels: { type: [String], default: () => [...DEFAULT_LOW_PRIORITY_LABELS] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

teamSchema.index({ members: 1 });
teamSchema.index({ leader: 1 });

const Team = mongoose.model('Team', teamSchema);
export default Team;
