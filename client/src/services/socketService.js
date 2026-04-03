// src/services/socketService.js
import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_SERVER_URL;
let socket = null;
let globalPlayers = {};

const socketService = {
  connect() {
    if (socket) return;

    console.log("🔌 Connecting to socket server.");
    socket = io(SOCKET_URL);

    socket.on("connect", () =>
      console.log("✅ Socket connected with ID:", socket.id)
    );
    socket.on("disconnect", () => {
      console.log("❌ Socket disconnected.");
      globalPlayers = {};
    });

    socket.on("players", (players) => {
        globalPlayers = { ...players };
    });
    socket.on("playerJoined", (player) => {
        globalPlayers[player.id] = player;
    });
    socket.on("playerLeft", (id) => {
        delete globalPlayers[id];
    });
  },

  getGlobalPlayers() {
      return globalPlayers;
  },

  // Generic event listener
  on(eventName, callback) {
    if (socket) {
      socket.on(eventName, callback);
    }
  },

  //NEW: remove listener
  off(eventName, callback) {
    if (socket) {
      socket.off(eventName, callback);
    }
  },

  get socket() {
    return socket;
  },

  disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  },

  // ====== EMIT EVENTS ======
  emitMove(positionData) {
    socket?.emit("move", positionData);
  },

  emitNearbyPlayers(nearbyPlayersData) {
    socket?.emit("nearbyPlayers", nearbyPlayersData);
  },

  registerPeerId(peerId) {
    socket?.emit("registerPeerId", peerId);
  },

  emitVideoStatus(enabled) {
    socket?.emit("videoStatus", enabled);
  },

  emitReaction(emoji) {
    socket?.emit("reaction", emoji);
  },

  emitWorking(isWorking) {
    socket?.emit("working", isWorking);
  },

  emitCheckComputer(computerId) {
    socket?.emit("checkComputer", computerId);
  },

  emitStartComputerScreen(computerId, peerId) {
    socket?.emit("startComputerScreen", { computerId, peerId });
  },

  emitStopComputerScreen(computerId) {
    socket?.emit("stopComputerScreen", computerId);
  },

  // ====== LISTEN EVENTS ======
  onPlayers(callback) {
    socket?.on("players", callback);
  },

  onPlayerReaction(callback) {
    socket?.on("playerReaction", callback);
  },

  onPlayerWorking(callback) {
    socket?.on("playerWorking", callback);
  },

  onPlayerJoined(callback) {
    socket?.on("playerJoined", callback);
  },

  onPlayerMoved(callback) {
    socket?.on("playerMoved", callback);
  },

  onPlayerLeft(callback) {
    socket?.on("playerLeft", callback);
  },

  onInitiateProximityCalls(callback) {
    socket?.on("initiateProximityCalls", callback);
  },

  onPlayerInProximity(callback) {
    socket?.on("playerInProximity", callback);
  },

  onPlayerVideoStatus(callback) {
    socket?.on("playerVideoStatus", callback);
  },

  onGameRules(callback) {
    socket?.on("gameRules", callback);
  },

  onComputerScreenState(callback) {
    socket?.on("computerScreenState", callback);
  },

  onComputerScreenStarted(callback) {
    socket?.on("computerScreenStarted", callback);
  },

  onComputerScreenStopped(callback) {
    socket?.on("computerScreenStopped", callback);
  },

  removeAllListeners() {
    socket?.removeAllListeners();
  }
};

export default socketService;
