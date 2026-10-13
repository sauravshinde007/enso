// server/socket/socketHandler.js
import User from "../models/User.js";
import ScheduledMeeting from "../models/ScheduledMeeting.js";
import MeetingRecord from "../models/MeetingRecord.js";
import { ROOM_ACCESS_LEVELS } from "../config/roles.js";
import { createProximityToken, getLivekitUrl, PROXIMITY_ROOM, setProximityCanPublish } from "../services/livekitService.js";
import { isInHall } from "../config/announcementHall.js";
import { getAnnouncementState, onLiveAnnouncementChange } from "../services/announcementService.js";

export default (io) => {
  // id -> player state
  const players = Object.create(null);

  // computerId -> { socketId, peerId, username }
  const computerScreens = Object.create(null);

  // socketId -> Set of socketIds that client reported as nearby
  const reportedNearby = Object.create(null);
  // socketId -> last proximity list sent (to only emit on change)
  const lastProximityKey = Object.create(null);

  // Proximity is symmetric: A and B are connected if EITHER side reports the other.
  // This avoids one-sided media when the two clients' range/LOS checks disagree.
  const symmetricPeers = (id) => {
    const peers = new Set(reportedNearby[id] || []);
    for (const otherId in reportedNearby) {
      if (otherId !== id && reportedNearby[otherId].has(id)) peers.add(otherId);
    }
    return peers;
  };

  // --- Announcement Hall ---
  const liveSpeakerSocket = () => {
    const live = getAnnouncementState().live;
    if (!live) return null;
    return Object.keys(players).find((id) => players[id].username === live.speakerName) || null;
  };

  /**
   * While an announcement is live:
   *  - everyone in the hall hears ONLY the speaker (if the speaker is in the hall)
   *  - the speaker hears nobody
   *  - people outside the hall keep normal proximity, but never with people inside it
   */
  const peersFor = (id) => {
    if (!getAnnouncementState().live) return symmetricPeers(id);

    const speaker = liveSpeakerSocket();
    if (isInHall(players[id])) {
      const speakerOnStage = speaker && speaker !== id && isInHall(players[speaker]);
      return new Set(speakerOnStage ? [speaker] : []);
    }
    return new Set([...symmetricPeers(id)].filter((pid) => !isInHall(players[pid])));
  };

  // Audience in the hall may not publish (server-enforced via LiveKit permissions)
  const shouldPublish = (id) =>
    !(getAnnouncementState().live && isInHall(players[id]) && id !== liveSpeakerSocket());

  const reconcilePublish = async (id) => {
    const p = players[id];
    // canPublish is undefined until the player has a LiveKit token
    if (!p || p.canPublish === undefined || p.publishUpdating) return;
    const desired = shouldPublish(id);
    if (p.canPublish === desired) return;

    p.publishUpdating = true;
    const applied = await setProximityCanPublish(id, desired);
    p.publishUpdating = false;
    if (applied && players[id]) {
      players[id].canPublish = desired;
      io.to(id).emit("hallMute", { muted: !desired });
    }
  };

  const refreshAllProximity = () => {
    Object.keys(players).forEach((id) => {
      emitProximity(id);
      reconcilePublish(id);
    });
  };

  onLiveAnnouncementChange(() => refreshAllProximity());
  // Retries permission updates that failed (e.g. participant was still connecting)
  setInterval(() => {
    if (getAnnouncementState().live || Object.values(players).some((p) => p.canPublish === false)) {
      Object.keys(players).forEach((id) => reconcilePublish(id));
    }
  }, 5000);

  const emitProximity = (id, force = false) => {
    if (!players[id]) return;

    const peers = peersFor(id);
    const list = [...peers].filter((pid) => players[pid]).sort();
    const key = list.join(",");
    if (!force && lastProximityKey[id] === key) return;
    lastProximityKey[id] = key;

    io.to(id).emit("proximityPeers", {
      peers: list.map((pid) => ({ id: pid, username: players[pid].username })),
    });
  };

  io.on("connection", (socket) => {
    console.log("New connection:", socket.id);

    // Player joins with their username
    socket.on("joinGame", async (username) => {
      try {
        const user = await User.findOne({ username });
        if (!user) {
          console.error(`User '${username}' not found in database.`);
          return;
        }

        // Get role from user (default to employee if missing)
        const userRole = user.role || 'employee';

        // If user already has an active session, force old session to logout
        if (user.activeSocketId && user.activeSocketId !== socket.id) {
          const oldSocketId = user.activeSocketId;

          console.log(
            `User '${username}' already active (${oldSocketId}). Forcing old session to disconnect.`
          );

          // Tell old client to log out
          io.to(oldSocketId).emit(
            "forceDisconnect",
            "You have logged in from another device."
          );

          // 🔴 Immediately clean up old player on the server
          const oldPlayer = players[oldSocketId];
          if (oldPlayer) {
            // Transfer position to current user object so new session uses it
            if (oldPlayer.x !== undefined && oldPlayer.y !== undefined) {
              user.lastX = oldPlayer.x;
              user.lastY = oldPlayer.y;
            }

            delete players[oldSocketId];
            io.emit("playerLeft", oldSocketId);
          }

          // 🔴 Optionally, hard-disconnect the old socket if it's still alive
          const oldSocket = io.sockets.sockets.get(oldSocketId);
          if (oldSocket) {
            oldSocket.disconnect(true);
          }
        }

        // Mark THIS socket as the active session
        user.activeSocketId = socket.id;
        await user.save();

        console.log(`${username} joined with socket: ${socket.id}`);

        // Check if player exists on this socket to preserve position
        const existingPlayer = players[socket.id];

        // Use existing (hot-reload) OR saved (db) OR default
        const startX = existingPlayer ? existingPlayer.x : (user.lastX || 1162);
        const startY = existingPlayer ? existingPlayer.y : (user.lastY || 1199);

        players[socket.id] = {
          username,
          x: startX,
          y: startY,
          anim: existingPlayer ? existingPlayer.anim : "idle-down",
          peerId: existingPlayer ? existingPlayer.peerId : null,
          videoEnabled: existingPlayer ? existingPlayer.videoEnabled : false,
          nearbyPlayers: [],
          role: userRole,
          assignedComputerId: user.assignedComputerId || null,
        };

        // Send full state to the new player
        socket.emit("players", players);

        // Send game configuration (room access rules)
        socket.emit("gameRules", {
          roomAccess: ROOM_ACCESS_LEVELS
        });

        // Announcement Hall: live / upcoming announcements (stage is built client-side)
        socket.emit("announcementState", getAnnouncementState());

        if (!existingPlayer) {
          // Announce to others only if they weren't already in the game
          socket.broadcast.emit("playerJoined", {
            id: socket.id,
            ...players[socket.id],
          });
        }
      } catch (error) {
        console.error("Error during joinGame:", error);
      }
    });

    // Movement updates
    socket.on("move", (data) => {
      const p = players[socket.id];
      if (!p) return;

      // minimal shape validation
      const { x, y, anim } = data ?? {};
      const wasInHall = isInHall(p);
      if (typeof x === "number") p.x = x;
      if (typeof y === "number") p.y = y;
      if (typeof anim === "string") p.anim = anim;

      // Entering/leaving the hall during a live announcement changes who hears whom
      if (wasInHall !== isInHall(p) && getAnnouncementState().live) {
        refreshAllProximity();
      }

      socket.broadcast.emit("playerMoved", {
        id: socket.id,
        pos: { x: p.x, y: p.y },
        anim: p.anim,
      });
    });

    // Proximity: client reports nearby players; server sends back the symmetric set
    // of peers whose LiveKit tracks the client should subscribe to.
    socket.on("nearbyPlayers", (data) => {
      const me = players[socket.id];
      if (!me) return;

      const nearby = Array.isArray(data?.nearbyPlayers)
        ? data.nearbyPlayers
        : [];

      // Store on server (optional, useful for debugging/analytics)
      me.nearbyPlayers = nearby;

      const prev = reportedNearby[socket.id] || new Set();
      const next = new Set(
        nearby
          .map((p) => p?.id)
          .filter((id) => typeof id === "string" && id !== socket.id && players[id])
      );
      reportedNearby[socket.id] = next;

      // Always answer the reporter (self-heals any missed update),
      // and notify anyone else whose symmetric set may have changed.
      emitProximity(socket.id, true);
      new Set([...prev, ...next]).forEach((id) => emitProximity(id));
    });

    // LiveKit (SFU) token for proximity audio/video. Identity = socket.id.
    socket.on("getProximityToken", async (ack) => {
      if (typeof ack !== "function") return;
      const p = players[socket.id];
      if (!p) return ack({ error: "NOT_JOINED" });

      try {
        const canPublish = shouldPublish(socket.id);
        const token = await createProximityToken(socket.id, p.username, { canPublish });
        p.canPublish = canPublish;
        console.log(`🎧 LiveKit SFU token issued: ${p.username} (${socket.id}) -> room "${PROXIMITY_ROOM}"`);
        ack({ token, url: getLivekitUrl(), roomName: PROXIMITY_ROOM });
      } catch (error) {
        console.error("Failed to create proximity token:", error);
        ack({ error: "TOKEN_FAILED" });
      }
    });

    // Register PeerJS id for this socket
    socket.on("registerPeerId", (peerId) => {
      const p = players[socket.id];
      if (!p) return;
      p.peerId = String(peerId || "");
      console.log(`Registered PeerID ${p.peerId} for ${p.username}`);
    });

    // Broadcast video toggle
    socket.on("videoStatus", (enabled) => {
      const p = players[socket.id];
      if (!p) return;
      p.videoEnabled = !!enabled; // persist on server
      socket.broadcast.emit("playerVideoStatus", { id: socket.id, videoEnabled: p.videoEnabled });
    });

    // Broadcast Reaction (Emoji)
    socket.on("reaction", (emoji) => {
      // Broadcast to everyone (including sender, simplifies client logic if we just listen to one event)
      io.emit("playerReaction", { id: socket.id, emoji });
    });

    // Broadcast working status
    socket.on("working", (isWorking) => {
      const p = players[socket.id];
      if (!p) return;
      p.isWorking = !!isWorking;
      socket.broadcast.emit("playerWorking", { id: socket.id, isWorking: p.isWorking });
    });

    // Computer Screen Sharing Methods
    socket.on("checkComputer", (computerId) => {
      socket.emit("computerScreenState", computerScreens[computerId] || null);
    });

    socket.on("startComputerScreen", (data) => {
      const { computerId, peerId } = data;
      const p = players[socket.id];
      if (!p) return;
      
      // If not already shared, allow sharing
      if (!computerScreens[computerId]) {
        computerScreens[computerId] = {
          socketId: socket.id,
          peerId: peerId,
          username: p.username
        };
        io.emit("computerScreenStarted", { computerId, state: computerScreens[computerId] });
      }
    });

    socket.on("stopComputerScreen", (computerId) => {
      if (computerScreens[computerId] && computerScreens[computerId].socketId === socket.id) {
        delete computerScreens[computerId];
        io.emit("computerScreenStopped", { computerId });
      }
    });

    socket.on("disconnect", async () => {
      // Proximity cleanup (also needed when the player entry was already removed by a forced logout)
      const prevNearby = reportedNearby[socket.id] || new Set();
      delete reportedNearby[socket.id];
      delete lastProximityKey[socket.id];
      const affected = new Set(prevNearby);
      for (const otherId in reportedNearby) {
        if (reportedNearby[otherId].delete(socket.id)) affected.add(otherId);
      }

      const p = players[socket.id];
      if (!p) {
        console.log("Disconnected before joining:", socket.id);
        affected.forEach((id) => emitProximity(id));
        return;
      }

      console.log(`${p.username} disconnected: ${socket.id}`);

      try {
        const user = await User.findOne({ activeSocketId: socket.id });
        if (user) {
          user.activeSocketId = null;

          // Save last position
          if (p && p.x !== undefined && p.y !== undefined) {
            user.lastX = p.x;
            user.lastY = p.y;
            console.log(`Saving position for ${p.username}: ${p.x}, ${p.y}`);
          }

          await user.save();
          console.log(`Cleared active session for ${user.username}`);

          // --- AUTO-END MEETINGS IF USER DISCONNECTS ---
          try {
              const activeRecord = await MeetingRecord.findOne({
                  user: user._id,
                  leaveTime: { $exists: false }
              });
              
              if (activeRecord) {
                  activeRecord.leaveTime = new Date();
                  activeRecord.duration = Math.floor((activeRecord.leaveTime - activeRecord.joinTime) / 1000);
                  await activeRecord.save();
                  
                  const scheduledRoomName = activeRecord.roomName.startsWith("meta-") 
                      ? activeRecord.roomName.substring(5) 
                      : activeRecord.roomName;

                  // End scheduled meeting if this user was the leader
                  const activeSchedule = await ScheduledMeeting.findOne({
                      roomName: scheduledRoomName,
                      leader: user._id,
                      status: 'Active'
                  });
                  
                  if (activeSchedule) {
                      activeSchedule.status = 'Ended';
                      activeSchedule.endTime = new Date();
                      await activeSchedule.save();
                      console.log(`Ended scheduled meeting ${activeSchedule._id} because leader disconnected.`);
                  }
              }
          } catch (meetErr) {
              console.error("Error auto-ending meeting on disconnect:", meetErr);
          }
          // ---------------------------------------------
        }
      } catch (error) {
        console.error("Error clearing socketId on disconnect:", error);
      }

      // Cleanup computer screens if user was sharing
      Object.keys(computerScreens).forEach((compId) => {
        if (computerScreens[compId].socketId === socket.id) {
          delete computerScreens[compId];
          io.emit("computerScreenStopped", { computerId: compId });
        }
      });

      delete players[socket.id];
      io.emit("playerLeft", socket.id);
      affected.forEach((id) => emitProximity(id));
    });
  });
};
