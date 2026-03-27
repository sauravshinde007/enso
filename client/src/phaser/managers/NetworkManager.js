
import socketService from "../../services/socketService";
import peerService from "../../services/peerService";
import Phaser from "phaser";

export default class NetworkManager {
    constructor(scene, playerManager, mapManager, voiceManager) {
        this.scene = scene;
        this.playerManager = playerManager;
        this.mapManager = mapManager;
        this.voiceManager = voiceManager;

        this.socketHandlers = {};

        // State
        this.myRole = 'employee';
        this.disconnectTimers = new Map();
        this.currentNearbyPlayers = new Set();

        this.lastSentState = { x: 0, y: 0, anim: "" };
        this.movementInterval = null;

        // Config
        this.nearbyPlayersUpdateInterval = 1000;
        this.lastNearbyPlayersUpdate = 0;
    }

    setupListeners() {
        this.scene.events.on('shutdown', this.cleanup, this);
        this.scene.events.on('destroy', this.cleanup, this);

        this.setupSocketHandlers();

        // Start movement loop
        this.movementInterval = setInterval(() => this.sendMovementUpdate(), 100);
    }

    setupSocketHandlers() {
        // Players Init
        this.socketHandlers.onPlayers = (players) => {
            if (!this.scene.sys.isActive()) return;
            Object.keys(players).forEach((id) => {
                const myId = socketService.socket?.id;
                if (id !== myId) {
                    this.playerManager.addOtherPlayer(id, players[id]);
                } else {
                    // Sync my pos
                    const p = players[id];
                    if (p.x !== undefined && p.y !== undefined && this.playerManager.player) {
                        this.playerManager.player.setPosition(p.x, p.y);
                        if (this.playerManager.playerUsernameText) {
                            this.playerManager.playerUsernameText.setPosition(p.x, p.y - 30);
                        }
                    }
                    if (p.role) {
                        this.myRole = p.role;
                        console.log("👮 My Role is:", this.myRole);
                        this.mapManager.updateZoneVisuals(this.myRole);
                    }
                }
            });
        };
        socketService.onPlayers(this.socketHandlers.onPlayers);

        // Game Rules
        this.socketHandlers.onGameRules = (rules) => {
            if (!this.scene.sys.isActive()) return;
            console.log("📜 Received Game Rules:", rules);
            if (rules.roomAccess) {
                this.mapManager.setRoomAccessRules(rules.roomAccess, this.myRole);
            }
        };
        socketService.onGameRules(this.socketHandlers.onGameRules);

        // Join
        this.socketHandlers.onPlayerJoined = (playerData) => {
            if (!this.scene.sys.isActive()) return;
            this.playerManager.addOtherPlayer(playerData.id, playerData);
        };
        socketService.onPlayerJoined(this.socketHandlers.onPlayerJoined);

        // Move
        this.socketHandlers.onPlayerMoved = ({ id, pos, anim }) => {
            if (!this.scene.sys.isActive()) return;
            this.playerManager.moveRemotePlayer(id, pos, anim);
        };
        socketService.onPlayerMoved(this.socketHandlers.onPlayerMoved);

        // Left
        this.socketHandlers.onPlayerLeft = (id) => {
            if (!this.scene.sys.isActive()) return;
            this.playerManager.removePlayer(id);

            // Also cleanup voice
            this.voiceManager.handleCallEnded(id);
            this.currentNearbyPlayers.delete(id);
            if (this.disconnectTimers.has(id)) {
                clearTimeout(this.disconnectTimers.get(id));
                this.disconnectTimers.delete(id);
            }
        };
        socketService.onPlayerLeft(this.socketHandlers.onPlayerLeft);

        // Reaction
        this.socketHandlers.onPlayerReaction = ({ id, emoji }) => {
            if (!this.scene.sys.isActive()) return;
            let entity = null;
            if (id === socketService.socket.id) {
                entity = this.playerManager.player;
            } else {
                entity = this.playerManager.players[id];
            }

            if (entity) {
                this.playerManager.showReaction(entity, emoji);
            }
        };
        socketService.onPlayerReaction(this.socketHandlers.onPlayerReaction);

        // Proximity Calls
        this.socketHandlers.onInitiateProximityCalls = (data) => {
            this.handleProximityCalls(data);
        };
        socketService.onInitiateProximityCalls(this.socketHandlers.onInitiateProximityCalls);
    }

    sendMovementUpdate() {
        const player = this.playerManager.player;
        if (!player) return;

        const currentState = {
            x: Math.round(player.x),
            y: Math.round(player.y),
            anim: this.playerManager.currentAnimation,
        };

        if (
            currentState.x !== this.lastSentState.x ||
            currentState.y !== this.lastSentState.y ||
            currentState.anim !== this.lastSentState.anim
        ) {
            socketService.emitMove(currentState);
            this.lastSentState = currentState;
        }
    }

    handleProximityCalls(data) {
        if (!this.scene.sys.isActive() || !peerService.peer) return;
        const newNearbyIds = new Set(data.nearbyPlayers.map((p) => p.id));

        // End calls (Grace period)
        this.currentNearbyPlayers.forEach((pid) => {
            if (!newNearbyIds.has(pid)) {
                if (this.disconnectTimers.has(pid)) return;

                console.log(`⏳ Player ${pid} moved away, scheduling disconnect...`);
                const timerId = setTimeout(() => {
                    console.log("👋 Grace period over, ending call:", pid);
                    peerService.endCall(pid);
                    this.currentNearbyPlayers.delete(pid);
                    this.disconnectTimers.delete(pid);
                }, 1000);

                this.disconnectTimers.set(pid, timerId);
            }
        });

        // Start calls
        data.nearbyPlayers.forEach((p) => {
            if (this.disconnectTimers.has(p.id)) {
                console.log(`✨ Player ${p.username} returned within grace period!`);
                clearTimeout(this.disconnectTimers.get(p.id));
                this.disconnectTimers.delete(p.id);
                return;
            }

            if (!this.currentNearbyPlayers.has(p.id)) {
                if (peerService.peer) {
                    peerService.callPeer(p.id);
                    this.currentNearbyPlayers.add(p.id);
                }
            }
        });
    }

    update(currTime) {
        // Throttled nearby update
        if (currTime - this.lastNearbyPlayersUpdate >= this.nearbyPlayersUpdateInterval) {
            const nearby = this.getNearbyPlayersToEmit(150);
            socketService.emitNearbyPlayers({ nearbyPlayers: nearby });
            this.lastNearbyPlayersUpdate = currTime;
        }
    }

    getNearbyPlayersToEmit(radius) {
        // We rely on map manager for raycaster
        // This duplicates World.js logic but uses managers
        const players = this.playerManager.players;
        const myPlayer = this.playerManager.player;
        if (!myPlayer) return [];

        const raycaster = this.scene.raycasterPlugin; // Still attached to scene?
        // MapManager maps objects to raycaster.
        // We need to implement getNearByPlayers logic here or in PlayerManager/MapManager.
        // Since it involves Raycaster (Map) and Players (PlayerManager), let's keep logic here or in MapManager.
        // Let's implement a simplified version here or call helper.

        const nearbyPlayers = [];

        // Fallback if no raycaster or complex check
        // Note: We need access to map boundaries / obstacles.
        // Creating rays requires the raycaster plugin instance.

        if (!raycaster) {
            Object.keys(players).forEach((id) => {
                const other = players[id];
                const distance = Phaser.Math.Distance.Between(myPlayer.x, myPlayer.y, other.x, other.y);
                if (distance <= radius) {
                    // accessing 'other.list[1].text' for username might be fragile if structure changes
                    const username = this.playerManager.playerUsernames.get(id);
                    nearbyPlayers.push({ id, username, x: other.x, y: other.y, distance: Math.round(distance) });
                }
            });
            return nearbyPlayers;
        }

        // Raycaster logic
        // Efficient Raycaster Logic:
        // 1. Filter by distance first (cheap)
        // 2. Raycast only to those candidates (expensive but fewer)

        // 1. Distance Filter
        const candidates = [];
        Object.keys(players).forEach(id => {
            const other = players[id];
            const dist = Phaser.Math.Distance.Between(myPlayer.x, myPlayer.y, other.x, other.y);
            if (dist <= radius) {
                candidates.push({ id, other, dist });
            }
        });

        if (candidates.length === 0) return [];

        // 2. Line of Sight Check
        candidates.forEach(cand => {
            const { id, other, dist } = cand;
            let blocked = false;
            // Create or reuse a ray from me to them
            if (!this.audioRay) {
                this.audioRay = raycaster.createRay();
            }
            this.audioRay.setOrigin(myPlayer.x, myPlayer.y);
            this.audioRay.setAngle(Phaser.Math.Angle.Between(myPlayer.x, myPlayer.y, other.x, other.y));
            this.audioRay.setRayRange(dist); // Only check up to the target

            const intersection = this.audioRay.cast();

            // If intersection exists, it means we hit a wall/obstacle
            if (intersection) {
                blocked = true;
            }

            if (!blocked) {
                const username = this.playerManager.playerUsernames.get(id);
                nearbyPlayers.push({
                    id,
                    username,
                    x: other.x,
                    y: other.y,
                    distance: Math.round(dist)
                });
            }
        });

        return nearbyPlayers;
    }

    cleanup() {
        console.log("🧹 Cleaning up socket listeners...");
        if (this.socketHandlers.onPlayers) socketService.off("players", this.socketHandlers.onPlayers);
        if (this.socketHandlers.onGameRules) socketService.off("gameRules", this.socketHandlers.onGameRules);
        if (this.socketHandlers.onPlayerJoined) socketService.off("playerJoined", this.socketHandlers.onPlayerJoined);
        if (this.socketHandlers.onPlayerMoved) socketService.off("playerMoved", this.socketHandlers.onPlayerMoved);
        if (this.socketHandlers.onPlayerLeft) socketService.off("playerLeft", this.socketHandlers.onPlayerLeft);
        if (this.socketHandlers.onInitiateProximityCalls) socketService.off("initiateProximityCalls", this.socketHandlers.onInitiateProximityCalls);
        if (this.socketHandlers.onPlayerReaction) socketService.off("playerReaction", this.socketHandlers.onPlayerReaction);

        this.socketHandlers = {};
        if (this.movementInterval) clearInterval(this.movementInterval);
    }
}
