
import Phaser from "phaser";
import peerService from "../../services/peerService";

export default class VoiceManager {
    constructor(scene) {
        this.scene = scene;
        this.audioElements = {}; // peerId -> HTMLAudioElement
        this.peerUnsubscribes = [];

        this.myVideoElement = null;
        this.isProximityMode = false;
        this.localVideoEnabled = false;

        // Cache canvas rect to prevent severe 60FPS layout thrashing!
        this.canvasRect = null;
        this.lastCanvasRectUpdate = 0;

        // We rely on socket events triggering methods here via NetworkManager
    }

    async initialize(socketId) {
        try {
            console.log("🎤 Initializing PeerJS with socket ID:", socketId);
            await peerService.initialize(socketId);
            console.log("✅ PeerJS connected");

            // Stream handlers
            const unsubStream = peerService.onStreamReceived((peerId, stream) => {
                console.log("🔊 Received audio stream from:", peerId);
                this.handleRemoteStream(peerId, stream);
            });
            this.peerUnsubscribes.push(unsubStream);

            const unsubCallEnd = peerService.onCallEnded((peerId) => {
                console.log("📴 Call ended with:", peerId);
                this.handleCallEnded(peerId);
            });
            this.peerUnsubscribes.push(unsubCallEnd);

            // Listen for UI toggles (Video)
            this.setupUIListeners();

        } catch (error) {
            console.error("❌ Failed to initialize PeerJS:", error);
            alert("Could not initialize voice/video service. Please refresh and try again.");
        }
    }

    setupUIListeners() {
        // We bind these to window events as React emits them
        const onLocalVideoToggle = (e) => {
            console.log("📺 Local video toggle event:", e.detail);
            this.localVideoEnabled = e.detail;
            this.toggleLocalVideo(e.detail);
        };

        const onProximityActive = (e) => {
            this.isProximityMode = e.detail;
            this.toggleLocalVideo(this.localVideoEnabled);
        };

        window.addEventListener('local-video-toggle', onLocalVideoToggle);
        window.addEventListener('proximity-video-active', onProximityActive);

        this.cleanupUI = () => {
            window.removeEventListener('local-video-toggle', onLocalVideoToggle);
            window.removeEventListener('proximity-video-active', onProximityActive);
        }
    }

    handleRemoteStream(peerId, stream) {
        if (!this.audioElements[peerId]) {
            const audio = document.createElement("audio");
            audio.autoplay = true;
            audio.volume = 1.0;
            audio.srcObject = stream;
            audio.style.display = "none";
            document.body.appendChild(audio);
            this.audioElements[peerId] = audio;

            audio.onloadedmetadata = () => {
                audio.play().catch(err => console.error("Audio play failed", err));
            };

            // We will update volume in update loop or when requested
        }
    }

    handleCallEnded(peerId) {
        if (this.audioElements[peerId]) {
            const audio = this.audioElements[peerId];
            audio.pause();
            audio.srcObject = null;
            if (audio.parentNode) audio.parentNode.removeChild(audio);
            delete this.audioElements[peerId];
        }
    }

    updateAudioVolume(myPlayer, otherPlayer, peerId, maxDist = 150) {
        const audioElement = this.audioElements[peerId];
        if (!audioElement || !myPlayer || !otherPlayer) return;

        const distance = Phaser.Math.Distance.Between(
            myPlayer.x, myPlayer.y,
            otherPlayer.x, otherPlayer.y
        );

        let volume = Math.max(0, 1 - distance / maxDist);

        // Raycast for Line of Sight (LOS) - Block audio if wall/obstacle is in between
        if (this.scene.raycasterPlugin && volume > 0) {
            // Use a cached ray to avoid creating new ray objects 60 times a second
            if (!this.audioRay) {
                this.audioRay = this.scene.raycasterPlugin.createRay();
            }

            this.audioRay.setOrigin(myPlayer.x, myPlayer.y);
            this.audioRay.setAngle(Phaser.Math.Angle.Between(myPlayer.x, myPlayer.y, otherPlayer.x, otherPlayer.y));
            this.audioRay.setRayRange(distance); // Only check up to the target

            // ray.cast() returns intersection object {x,y,object} or null/false
            const intersection = this.audioRay.cast();

            if (intersection) {
                // Obstacle detected between players
                volume = 0;
            }
        }

        audioElement.volume = volume;
    }

    // --- Local Video Bubble Logic ---

    toggleLocalVideo(enabled) {
        // If NOT enabled, remove bubble always
        if (!enabled) {
            this.removeVideoBubble();
            return;
        }

        // IF enabled, we want to SHOW the video.
        // BUT:
        // 1. If in Proximity Mode -> The UI (VideoGrid) handles it. So we hide our bubble.
        // 2. If NOT in Proximity Mode -> We show our bubble (so user sees themselves).

        if (this.isProximityMode) {
            // Let VideoGrid handle it
            this.removeVideoBubble();
        } else {
            // Show Bubble
            if (!this.myVideoElement) {
                this.createVideoBubble();
            }
        }
    }

    createVideoBubble() {
        const vid = document.createElement("video");
        vid.id = "local-video-bubble";
        vid.autoplay = true;
        vid.muted = true;
        vid.playsInline = true;

        Object.assign(vid.style, {
            position: 'absolute',
            width: '60px', height: '60px',
            objectFit: 'cover',
            borderRadius: '8px',
            border: '2px solid #9b99fe',
            zIndex: '50',
            boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
            pointerEvents: 'none'
        });

        document.body.appendChild(vid);
        this.myVideoElement = vid;

        if (peerService.localStream) {
            vid.srcObject = peerService.localStream;
        }
    }

    removeVideoBubble() {
        if (this.myVideoElement) {
            if (this.myVideoElement.parentNode) {
                this.myVideoElement.parentNode.removeChild(this.myVideoElement);
            }
            this.myVideoElement = null;
        }
    }

    updateLocalVideoPosition(player, camera) {
        if (this.isProximityMode) {
            if (this.myVideoElement) this.myVideoElement.style.display = 'none';
            return;
        }

        if (this.myVideoElement && player) {
            const vid = this.myVideoElement;

            // Read bounding rect efficiently (throttle the expensive DOM read!)
            const now = Date.now();
            if (!this.canvasRect || now - this.lastCanvasRectUpdate > 1000) {
                this.canvasRect = this.scene.game.canvas.getBoundingClientRect();
                this.lastCanvasRectUpdate = now;
            }

            const rect = this.canvasRect;
            const zoom = camera.zoom;

            const screenX = (player.x - camera.worldView.x) * zoom;
            const screenY = (player.y - camera.worldView.y) * zoom;

            const baseW = 60; const baseH = 60; const baseVOffset = 50;

            const curW = baseW * zoom;
            const curH = baseH * zoom;
            const curOffset = baseVOffset * zoom;

            // GPU Accelerated Transform (No Layout Thrashing)
            vid.style.width = `${curW}px`;
            vid.style.height = `${curH}px`;
            const tx = rect.left + screenX - (curW / 2);
            const ty = rect.top + screenY - curH - curOffset;
            vid.style.transform = `translate3d(${Math.round(tx)}px, ${Math.round(ty)}px, 0)`;
            vid.style.left = '0px'; // Reset left/top
            vid.style.top = '0px';

            // Hide if off-screen
            if (
                screenX < -curW || screenX > camera.width + curW ||
                screenY < -curH || screenY > camera.height + curH
            ) {
                vid.style.display = 'none';
            } else {
                vid.style.display = 'block';
            }
        }
    }

    destroy() {
        this.peerUnsubscribes.forEach(u => u && u());
        this.peerUnsubscribes = [];

        Object.values(this.audioElements).forEach(audio => {
            audio.pause();
            audio.srcObject = null;
            if (audio.parentNode) audio.parentNode.removeChild(audio);
        });
        this.audioElements = {};

        this.removeVideoBubble();
        if (this.cleanupUI) this.cleanupUI();
    }
}
