import mongoose from 'mongoose';
import dotenv from 'dotenv';
import MeetingRecord from './models/MeetingRecord.js';

dotenv.config({ path: './.env' });

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const docs = await MeetingRecord.find().sort({ joinTime: -1 }).limit(5);
    console.log(JSON.stringify(docs, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
})();
