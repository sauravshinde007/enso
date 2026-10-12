
import Phaser from "phaser";
import proximityService from "../../services/proximityService";
import peerService from "../../services/peerService";
import { PROXIMITY_EXIT_RADIUS } from "../../config/proximity";

export default class VoiceManager {
    constructor(scene) {
        this.scene = scene;
        this.audioElements = {}; // socketId -> HTMLAudioElement
        this.peerUnsubscribes = [];
        this.blockedAudio = new Set(); // elements the browser refused to autoplay

        this.myVideoElement = null;
        this.isProximityMode = false;
        this.localVideoEnabled = false;

        // Cache canvas rect to prevent severe 60FPS layout thrashing!
        this.canvasRect = null;
        this.lastCanvasRectUpdate = 0;

        // We rely on socket events triggering methods here via NetworkManager
    }

    async initialize(socketId) {
        // Stream handlers (keyed by socket id == LiveKit identity)
        const unsubStream = proximityService.onStreamReceived((id, stream) => {
            console.log("🔊 Receiving proximity media from:", id);
            this.handleRemoteStream(id, stream);
        });
        this.peerUnsubscribes.push(unsubStream);

        const unsubCallEnd = proximityService.onCallEnded((id) => {
            console.log("📴 Proximity media ended with:", id);
            this.handleCallEnded(id);
        });
        this.peerUnsubscribes.push(unsubCallEnd);

        // Listen for UI toggles (Video)
        this.setupUIListeners();

        try {
            console.log("🎤 Connecting to LiveKit proximity room...");
            await proximityService.connect();
        } catch (error) {
            console.error("❌ Failed to connect to proximity voice/video:", error);
            alert("Could not initialize voice/video service. Please refresh and try again.");
        }

        // PeerJS is only used for computer screen sharing; failure must not affect proximity.
        try {
            await peerService.initialize(socketId);
        } catch (error) {
            console.error("❌ Failed to initialize PeerJS (screen sharing):", error);
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

        // Browsers block audio autoplay until a user gesture; retry on the next one.
        const onUserGesture = () => {
            this.blockedAudio.forEach(audio => {
                audio.play().then(() => this.blockedAudio.delete(audio)).catch(() => {});
            });
        };

        window.addEventListener('local-video-toggle', onLocalVideoToggle);
        window.addEventListener('proximity-video-active', onProximityActive);
        window.addEventListener('pointerdown', onUserGesture);
        window.addEventListener('keydown', onUserGesture);

        this.cleanupUI = () => {
            window.removeEventListener('local-video-toggle', onLocalVideoToggle);
            window.removeEventListener('proximity-video-active', onProximityActive);
            window.removeEventListener('pointerdown', onUserGesture);
            window.removeEventListener('keydown', onUserGesture);
        }
    }

    handleRemoteStream(id, stream) {
        let audio = this.audioElements[id];
        if (!audio) {
            audio = document.createElement("audio");
            audio.autoplay = true;
            audio.volume = 1.0;
            audio.style.display = "none";
            document.body.appendChild(audio);
            this.audioElements[id] = audio;
        }

        // The service hands us a new MediaStream whenever the track set changes
        if (audio.srcObject !== stream) {
            audio.srcObject = stream;
            audio.play().catch(err => {
                console.warn("Audio autoplay blocked, will retry on next interaction", err);
                this.blockedAudio.add(audio);
            });
        }
    }

    handleCallEnded(id) {
        const audio = this.audioElements[id];
        if (audio) {
            audio.pause();
            audio.srcObject = null;
            if (audio.parentNode) audio.parentNode.removeChild(audio);
            this.blockedAudio.delete(audio);
            delete this.audioElements[id];
        }
    }

    // Fades out to 0 exactly where the connection drops, so you never see someone you can't hear
    updateAudioVolume(myPlayer, otherPlayer, id, maxDist = PROXIMITY_EXIT_RADIUS) {
        const audioElement = this.audioElements[id];
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

        if (proximityService.localStream) {
            vid.srcObject = proximityService.localStream;
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
        this.blockedAudio.clear();

        this.removeVideoBubble();
        if (this.cleanupUI) this.cleanupUI();

        proximityService.disconnect();
        peerService.destroy();
    }
}
