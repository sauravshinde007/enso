import { Queue } from 'bullmq';
import Redis from 'ioredis';

const redisConnection = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null,
});

export const momQueue = new Queue('momQueue', { connection: redisConnection });

export const addMomJob = async (recordId, roomName, sessionId) => {
    await momQueue.add('generate-mom', { recordId, roomName, sessionId });
};
