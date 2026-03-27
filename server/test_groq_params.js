import Groq from 'groq-sdk';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
async function run() {
    try {
        fs.writeFileSync('dummy.txt', 'dummy'); 
        // using dummy file instead of webm to test param validation
        await groq.audio.transcriptions.create({
            file: fs.createReadStream('dummy.txt'),
            model: "whisper-large-v3",
            prompt: "test",
            temperature: 0.2,
            language: "en",
            condition_on_previous_text: true,
            no_speech_threshold: 0.6
        });
        console.log("SUCCESS");
    } catch (e) {
        console.log("ERROR:", e.message);
    }
}
run();
