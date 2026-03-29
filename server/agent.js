import dotenv from 'dotenv';
dotenv.config();

import {
  cli,
  defineAgent,
  WorkerOptions,
} from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import { fileURLToPath } from 'url';

import mongoose from 'mongoose';
import MeetingRecord from './models/MeetingRecord.js';
import MeetingTranscript from './models/MeetingTranscript.js';

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('📦 Database Connected for STT Logging'))
  .catch(err => console.error('DB Connection Error:', err));

// 1. Configure Groq as our STT (Speech-to-Text) provider
// We use the OpenAI plugin but point the Base URL exactly to Groq's ChatGPT-compatible API endpoint
const stt = new openai.STT({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY,
  model: 'whisper-large-v3', // Groq's insanely fast Whisper model
});

// 2. Define the Agent that will join meetings
export default defineAgent({
  entry: async (ctx) => {
    // Attempt to connect to the meeting room
    await ctx.connect();
    console.log(`🤖 STT Agent connected to room: ${ctx.room.name}`);
    console.log(`Currently there are ${ctx.room.remoteParticipants.size} participants in the room.`);

    // Load VAD to know exactly when a user starts and stops talking
    const vad = await silero.VAD.load();

    // Helper to setup transcription for an audio track
    const setupTranscriptionForTrack = async (track, participant) => {
      // 1 means AUDIO in the LiveKit Node SDK protobuf enums
      if (track.kind === 1 || track.kind === 'audio') {
        console.log(`🎙️ Subscribed to audio track for: ${participant.identity}`);

        const { AudioStream } = await import('@livekit/rtc-node');
        const { stt: agentsStt } = await import('@livekit/agents');
        
        const streamingStt = new agentsStt.StreamAdapter(stt, vad);
        
        streamingStt.on('error', (err) => console.error("🚨 StreamAdapter Error:", err));
        stt.on('error', (err) => console.error("🚨 Groq STT Error:", err));

        const speechStream = streamingStt.stream();
        
        // 1. Pipe audio
        const rtcStream = new AudioStream(track);
        (async () => {
          for await (const frame of rtcStream) {
            speechStream.pushFrame(frame);
          }
        })().catch(err => console.error("Audio piping error:", err));
        
        // 2. Listen for the finalized transcripts from Groq
        for await (const event of speechStream) {
          // In the Node SDK, SpeechEventType.FINAL_TRANSCRIPT is the integer 2
          if (event.type === 2 || event.type === agentsStt.SpeechEventType.FINAL_TRANSCRIPT) {
             const text = event.alternatives?.[0]?.text;
             if (text && text.trim().length > 0) {
                console.log(`[${participant.identity}]: ${text}`);
                
                try {
                   // Map this exact room to its active MeetingRecord to get the correct Session ID
                   const record = await MeetingRecord.findOne({ 
                       roomName: ctx.room.name, 
                       leaveTime: { $exists: false } 
                   }).sort({ joinTime: -1 });

                   const sessionId = record ? record.sessionId : ctx.room.name;
                   
                   await MeetingTranscript.create({
                       sessionId: sessionId,
                       username: participant.identity,
                       text: text
                   });
                } catch (dbErr) {
                   console.error("DB Save Error:", dbErr);
                }
             }
          }
        }
      }
    };

    // Explicitly auto-subscribe to all audio tracks
    ctx.room.on('trackPublished', (publication, participant) => {
      console.log(`📡 New track published: ${publication.kind} for ${participant.identity}`);
      if (publication.kind === 1 || publication.kind === 'audio') {
        publication.setSubscribed(true);
      }
    });

    // Listen for when the subscription actually completes and the track is ready
    ctx.room.on('trackSubscribed', (track, publication, participant) => {
      console.log(`✅ Track actually subscribed: ${track.kind} for ${participant.identity}`);
      setupTranscriptionForTrack(track, participant);
    });

    // Sub to EXISTING participants who were already in the room
    for (const participant of Array.from(ctx.room.remoteParticipants.values())) {
      console.log(`🔍 Checking existing participant: ${participant.identity} with ${participant.trackPublications.size} tracks`);
      for (const publication of Array.from(participant.trackPublications.values())) {
        // Log to double check properties
        console.log(`  - Found track: ${publication.kind}, has track? ${!!publication.track}`);
        if (publication.kind === 1 || publication.kind === 'audio') {
          if (!publication.track) {
            console.log(`  - Subscribing to audio track manually...`);
            publication.setSubscribed(true);
          } else {
            setupTranscriptionForTrack(publication.track, participant);
          }
        }
      }
    }
  },
});

// 3. Start the worker wrapper when executing this file directly
cli.runApp(new WorkerOptions({
  agent: fileURLToPath(import.meta.url),
}));
