
import socketService from "../../services/socketService";
import peerService from "../../services/peerService";
import Phaser from "phaser";
import { QuadTree } from "../utils/QuadTree";

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
                    if (p.assignedComputerId !== undefined) {
                        this.playerManager.assignedComputerId = p.assignedComputerId;
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

        // Working Status
        this.socketHandlers.onPlayerWorking = ({ id, isWorking }) => {
            if (!this.scene.sys.isActive()) return;
            let entity = null;
            if (id === socketService.socket.id) {
                entity = this.playerManager.player;
            } else {
                entity = this.playerManager.players[id];
            }

            if (entity) {
                this.playerManager.setWorkingStatus(entity, isWorking, id === socketService.socket.id);
            }
        };
        socketService.onPlayerWorking(this.socketHandlers.onPlayerWorking);

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
                    // Prevent glare by only letting one side initiate the call
                    const myId = peerService.peer.id;
                    const theirId = peerService.getPeerId(p.id);
                    
                    if (myId > theirId) {
                        peerService.callPeer(p.id);
                    } else {
                        console.log(`Waiting for ${theirId} to initiate call to us (${myId}) to prevent glare.`);
                    }
                    this.currentNearbyPlayers.add(p.id);
                }
            }
        });
    }

    update(currTime) {
        // Throttled nearby update
        if (currTime - this.lastNearbyPlayersUpdate >= this.nearbyPlayersUpdateInterval) {
            const nearby = this.getNearbyPlayersToEmit(150, 200);
            socketService.emitNearbyPlayers({ nearbyPlayers: nearby });
            this.lastNearbyPlayersUpdate = currTime;
        }
    }

    getNearbyPlayersToEmit(innerRadius, outerRadius = 150) {
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

        // 1. Rigid Proximity Box Filter (Spatial Partitioning via QuadTree)
        // Ensure QuadTree handles points across map boundaries dynamically.
        const mapWidth = this.mapManager?.map?.widthInPixels || 3200;
        const mapHeight = this.mapManager?.map?.heightInPixels || 3200;
        
        // Boundary is defined by its center (x, y) and half-widths (w, h)
        const boundary = { 
            x: mapWidth / 2, 
            y: mapHeight / 2, 
            w: mapWidth / 2, 
            h: mapHeight / 2 
        };
        const qt = new QuadTree(boundary, 4);

        // Insert all active players into QuadTree
        Object.keys(players).forEach(id => {
            const other = players[id];
            qt.insert({ x: other.x, y: other.y, id, other });
        });

        // Query QuadTree with a strict rigid rectangular proximity box using the maximum radius
        const queryRange = { 
            x: myPlayer.x, 
            y: myPlayer.y, 
            w: outerRadius, 
            h: outerRadius 
        };
        
        const candidatePoints = qt.query(queryRange);
        const candidates = [];

        // Exact distance check for the subset of points gathered by the QuadTree (Hysteresis applied)
        candidatePoints.forEach(p => {
            const dist = Phaser.Math.Distance.Between(myPlayer.x, myPlayer.y, p.other.x, p.other.y);
            
            // Hysteresis: Use the outer radius if they are already connected, otherwise inner radius
            const isCurrentlyConnected = this.currentNearbyPlayers.has(p.id);
            const appliedRadius = isCurrentlyConnected ? outerRadius : innerRadius;

            if (dist <= appliedRadius) {
                candidates.push({ id: p.id, other: p.other, dist });
            }
        });

        if (!raycaster) {
            candidates.forEach(cand => {
                const username = this.playerManager.playerUsernames.get(cand.id);
                nearbyPlayers.push({ id: cand.id, username, x: cand.other.x, y: cand.other.y, distance: Math.round(cand.dist) });
            });
            return nearbyPlayers;
        }

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
        if (this.socketHandlers.onPlayerWorking) socketService.off("playerWorking", this.socketHandlers.onPlayerWorking);

        this.socketHandlers = {};
        if (this.movementInterval) clearInterval(this.movementInterval);
    }
}
