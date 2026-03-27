import dotenv from "dotenv";
dotenv.config();

console.log('--- In index.js ---');
console.log('STREAM_API_KEY:', process.env.STREAM_API_KEY);
console.log('STREAM_API_SECRET:', process.env.STREAM_API_SECRET ? 'Loaded' : 'NOT LOADED');
console.log('-------------------');

import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import mongoose from "mongoose";
import { ExpressPeerServer } from "peer";
import passport from 'passport';

// Import separated logic
import socketHandler from "./socket/socketHandler.js";
import authRoutes from "./routes/authRoutes.js";
import streamRoutes from "./routes/streamRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import configurePassport from './config/passport.js';
import User from './models/User.js'; // Import statically
import { syncUsersBatch } from "./services/streamService.js";
import meetingRoutes from "./routes/meetingRoutes.js";
import "./services/momWorker.js"; // Initialize MOM Worker

const app = express();
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    callback(null, true); // Allow all origins for dev
  },
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());

// Initialize Passport
configurePassport();
app.use(passport.initialize());

const server = http.createServer(app);

// --- PeerJS Server Setup ---
const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: "/",
  allow_discovery: true,
});
app.use("/peerjs", peerServer);

peerServer.on("connection", (client) => {
  console.log(`✅ PeerJS client connected: ${client.getId()}`);
});
peerServer.on("disconnect", (client) => {
  console.log(`❌ PeerJS client disconnected: ${client.getId()}`);
});

// --- Database Connection ---
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB connected");

    // --- SYNC USERS TO STREAM CHAT ON STARTUP ---
    try {
      const users = await User.find({});
      if (users.length > 0) {
        await syncUsersBatch(users);
      }
    } catch (err) {
      console.error("❌ Failed to sync users to Stream Chat on startup:", err);
    }

  })
  .catch((err) => console.error("MongoDB connection error:", err));

// --- Socket.IO ---
const io = new Server(server, { cors: { origin: "*" } });
app.set("io", io);

// --- API Routes ---
app.use("/api/auth", authRoutes);        // Authentication routes (signup/login)
app.use("/api/stream", streamRoutes);    // Stream Chat related routes
app.use("/api/users", userRoutes);       // Users routes
app.use("/api/meeting", meetingRoutes);  // Meeting routes

// --- Socket.IO Connection Handling ---
socketHandler(io);

// --- Global Error Handler ---
app.use((err, req, res, next) => {
  console.error("❌ Global Error Handler:", err);
  res.status(err.status || 500).json({
    message: err.message || "Internal Server Error",
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// --- Start Server ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ Server running on PORT ${PORT}`);
});
