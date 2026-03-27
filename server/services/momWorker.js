import { Worker } from 'bullmq';
import Redis from 'ioredis';
import axios from 'axios';
import Groq from 'groq-sdk';
import MeetingRecord from '../models/MeetingRecord.js';
import MeetingTranscript from '../models/MeetingTranscript.js';
import User from '../models/User.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

dotenv.config();

// Ensure Groq is instantiated safely. Since user's .env had placeholder, if key is missing or invalid, it might throw.
const groqApiKey = process.env.GROQ_API_KEY || 'dummy_key';
const groq = new Groq({ apiKey: groqApiKey });

// LiveKit handles transcripts via Agents or Egress. 
// For this setup without an active Egress service, we will rely on our mock transcript.

const redisConnection = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null,
});

export const momWorker = new Worker('momQueue', async job => {
    const { recordId, roomName, sessionId } = job.data;

    const finalizeMOM = async (status, content, transcript = null) => {
        const updateParams = { momStatus: status, momContent: content };
        if (transcript) updateParams.transcriptContent = transcript;

        if (sessionId) {
            await MeetingRecord.updateMany(
                { sessionId: sessionId },
                { $set: updateParams }
            );
        } else {
            await MeetingRecord.findByIdAndUpdate(recordId, updateParams);
        }
    };

    try {
        let transcriptText = '';

        // 1. Fetch transcript chunks
        if (sessionId) {
            const meetingsDir = path.join(os.tmpdir(), "metaverse_meetings");

            // Look for individual uploaded WebM chunks inside the tmp directory (per user)
            if (fs.existsSync(meetingsDir)) {
                const files = fs.readdirSync(meetingsDir)
                                .filter(f => f.startsWith(`${sessionId}__`))
                                .sort(); // Sorts chronologically thanks to Date.now() in filename

                let previousWhisperContext = "Meeting, discussion, work, collaboration.";
                
                for (const file of files) {
                    const fullPath = path.join(meetingsDir, file);
                    // Extract username from "sessionId__username__timestamp.webm"
                    const parts = file.split('__');
                    const parsedUsername = parts.length >= 2 ? parts[1] : "Unknown";
                    const wavPath = fullPath.replace('.webm', '.wav');

                    try {
                        // Convert to WAV 16kHz Mono
                        await new Promise((resolve, reject) => {
                            ffmpeg(fullPath)
                                .audioFrequency(16000)
                                .audioChannels(1)
                                .format('wav')
                                .on('end', resolve)
                                .on('error', reject)
                                .save(wavPath);
                        });

                        const stream = fs.createReadStream(wavPath);
                        const transcription = await groq.audio.transcriptions.create({
                            file: stream,
                            model: "whisper-large-v3",
                            prompt: previousWhisperContext,
                            temperature: 0.2,
                            language: "en"
                        });

                        let text = transcription.text.trim();

                        // Aggressively filter out Whisper silence hallucinations and dataset artifacts
                        const artifacts = [
                            "Thank you for watching", "Thanks for watching", "Thank you.", "Thank you",
                            "Transcription by", "Translation by", "Amara.org", "Analog speech",
                            "Please do not use the speech", "Please ignore background noise",
                            "[Silence]", "[BLANK_AUDIO]", "Subscribe to", "Please subscribe",
                            "Meeting, discussion, work, collaboration."
                        ];

                        // Remove artifact loops
                        artifacts.forEach(artifact => {
                            const regex = new RegExp(artifact, "gi");
                            text = text.replace(regex, "");
                        });

                        // Clean up hanging non-word chunks often left behind by hallucination trimming
                        text = text.replace(/^[.\-\s]+|[.\-\s]+$/g, "").trim();

                        // Only append if there's meaningful text left
                        if (text && text.length > 3) {
                            transcriptText += `\n${parsedUsername}: ${text}`;
                            
                            // Capture rolling window 30 words context
                            const words = text.split(/\s+/);
                            const lastWords = words.slice(-30).join(' ');
                            previousWhisperContext = lastWords || "Meeting, discussion, work, collaboration.";
                        }
                    } catch (e) {
                        console.error(`Failed to completely transcribe file ${file}:`, e);
                    } finally {
                        // Cleanup
                        if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
                    }
                }
            }

            // Fallback: If no valid tmp stream files exist, fallback to the legacy db snippets
            if (!transcriptText || transcriptText.trim() === '') {
                const transcripts = await MeetingTranscript.find({ sessionId }).sort({ timestamp: 1 });
                if (transcripts && transcripts.length > 0) {
                    transcriptText = transcripts.map(t => `${t.username}: ${t.text}`).join("\n");
                }
            }
        }

        // 1.5 Extract Timeline and Participants
        let meetingDate = "Unknown Date";
        let durationMinutes = 0;
        let participantNames = ["Unknown"];

        if (sessionId) {
            try {
                const records = await MeetingRecord.find({ sessionId }).populate('user', 'username');
                if (records.length > 0) {
                    const startTimes = records.map(r => r.joinTime).filter(Boolean);
                    const endTimes = records.map(r => r.leaveTime || new Date()).filter(Boolean);
                    
                    if (startTimes.length > 0) {
                        const minStartTime = new Date(Math.min(...startTimes));
                        const maxEndTime = new Date(Math.max(...endTimes));
                        meetingDate = minStartTime.toLocaleString();
                        durationMinutes = Math.max(1, Math.round((maxEndTime - minStartTime) / 60000));
                    }

                    const uniqueUsers = new Set();
                    records.forEach(r => {
                        if (r.user && r.user.username) {
                            uniqueUsers.add(r.user.username);
                        }
                    });
                    if (uniqueUsers.size > 0) {
                        participantNames = Array.from(uniqueUsers);
                    }
                }
            } catch (err) {
                console.error("Error fetching meeting timeline info:", err);
            }
        }

        // 2. Generate MOM using Groq
        if (!transcriptText || transcriptText.trim().length === 0) {
            await finalizeMOM('Generated', "No conversation was recorded during this meeting.", transcriptText);
            console.log(`MOM generated successfully (Empty Transcript) for session ${sessionId}`);
            return;
        }

        if (groqApiKey === 'dummy_key' || groqApiKey === 'gsk_your_groq_api_key_here') {
            // Simulate MOM generation if key is fake
            await new Promise(res => setTimeout(res, 2000));
            const momContent = `**Mock MOM (Groq API Key missing):**\n- **Objective**: Implement MOM generation using BullMQ & Redis.\n- **Action Items**: Set up BullMQ Queue and Worker.\n\n_Transcript Received:_\n${transcriptText}`;

            await finalizeMOM('Generated', momContent, transcriptText);
            console.log(`Mock MOM generated successfully for session ${sessionId} (record ${recordId})`);
            return;
        }

        const prompt = `You are an expert executive assistant. Generate Minutes of Meeting (MOM) for the following transcript. If the transcript is a speech, monologue, or informal discussion, summarize its core themes and key takeaways instead of forcing formal meeting structures.

CRITICAL INSTRUCTIONS:
1. DO NOT mention any issues with the transcript, transcript quality, voice confusion, repetitions, or any difficulties you had in understanding the text.
2. DO NOT apologize or include meta-commentary about the transcription process.
3. Just provide the final, polished Minutes of Meeting based ON the text provided.

Format the output cleanly in Markdown, following exactly this structure:

### 🕒 Meeting Timeline & Participants
- **Date & Time:** ${meetingDate}
- **Duration:** ~${durationMinutes} minute(s)
- **Participants:** ${participantNames.join(', ')}

### 📌 Meeting Summary
[A concise paragraph summarizing the entire conversation or speech]

### 💡 Key Points Discussed
- [Bullet points of main ideas, themes, or topics covered]

### ✅ Action Items / Next Steps (If applicable)
- [Bullet points of tasks or actionable takeaways. If none exist, simply write "No specific action items required."]

### 🎯 Decisions Made (If applicable)
- [List any firm decisions. If none, do not include this section or write "N/A"]

Transcript:
${transcriptText}`;

        const groqRes = await groq.chat.completions.create({
            messages: [{ role: 'system', content: 'You are a meticulous assistant.' }, { role: 'user', content: prompt }],
            model: 'llama-3.1-8b-instant',
            temperature: 0.3,
        });

        const momContent = groqRes.choices[0]?.message?.content || 'Failed to generate content.';

        // 3. Save to DB
        await finalizeMOM('Generated', momContent, transcriptText);

        console.log(`MOM generated successfully for session ${sessionId} (record ${recordId})`);

    } catch (err) {
        console.error(`Failed to generate MOM for ${recordId}:`, err);
        await finalizeMOM('Error', null, null);
        throw err;
    }
}, { connection: redisConnection });

momWorker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed with error ${err.message}`);
});
