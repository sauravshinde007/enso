// client/src/services/peerService.js
// PeerJS is now only used for 1:N computer screen sharing (ComputerModal).
// Proximity audio/video lives in proximityService.js (LiveKit SFU).
import Peer from 'peerjs';

class PeerService {
  constructor() {
    this.peer = null;

    // Screen sharing
    this.screenStream = null;
    this.activeScreenCalls = new Map(); // incoming view requests from others
    this.viewingScreenCall = null; // when we view someone else's screen
    this.viewingScreenStream = null; // someone else's screen stream
  }


  /**
   * Helper to sanitize ID for PeerJS (alphanumeric only)
   */
  getPeerId(id) {
    if (!id) return '';
    return id.replace(/[^a-zA-Z0-9]/g, '');
  }

  async initialize(userId) {
    // Sanitize ID
    const peerId = this.getPeerId(userId);

    // Don't re-initialize if already connected with same ID
    if (this.peer && !this.peer.destroyed && this.peer.id === peerId) {
      console.log('⚠️ PeerJS already initialized');
      return this.peer.id;
    }

    // If completely new or different ID, cleanup old
    if (this.peer) this.destroy();

    // 🔧 Derive host/port/secure from your SOCKET_SERVER_URL
    const socketUrl = import.meta.env.VITE_SOCKET_SERVER_URL;
    const url = new URL(socketUrl);

    const host = url.hostname;                 // e.g. w1npgpv2-3001.inc1.devtunnels.ms or localhost
    const secure = url.protocol === 'https:';  // true for https devtunnel, false for http://localhost
    const port = url.port
      ? Number(url.port)
      : secure
        ? 443
        : 80;                                  // sensible defaults when no port is specified

    console.log('🌐 PeerJS config:', { host, port, secure, peerId });

    return new Promise((resolve, reject) => {
      try {
        this.peer = new Peer(peerId, {
          host,
          port,
          path: '/peerjs',  // must match server mount
          secure,
          debug: 2,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
            ]
          }
        });

        this.peer.on('open', (id) => {
          console.log('✅ PeerJS connected with ID:', id);
          resolve(id);
        });

        this.peer.on('error', (error) => {
          console.error('❌ PeerJS error:', error);
          console.error('Error type:', error.type);

          if (error.type === 'network' || error.type === 'server-error') {
            console.error('⚠️ Cannot connect to PeerJS server. Check host/port and devtunnel.');
          } else if (error.type === 'peer-unavailable') {
            console.error('⚠️ Remote peer is not available');
          } else if (error.type === 'invalid-id') {
            console.error('⚠️ Invalid Peer ID generated:', peerId);
          }

          if (error.type !== 'network') {
            reject(error);
          }
        });

        this.peer.on('call', (call) => {
          this.handleIncomingCall(call);
        });

        this.peer.on('disconnected', () => {
          console.log('⚠️ PeerJS disconnected. Attempting to reconnect...');
          this.peer.reconnect();
        });

        this.peer.on('close', () => {
          console.log('❌ PeerJS connection closed');
        });

      } catch (error) {
        console.error('Failed to initialize PeerJS:', error);
        reject(error);
      }
    });
  }

  /**
   * Handle incoming call (only screen-view requests are expected)
   * @param {Object} call - PeerJS call object
   */
  handleIncomingCall(call) {
    if (call.metadata?.type !== 'screen-view') {
      call.close();
      return;
    }

    console.log('👀 Incoming screen view request from:', call.peer);
    if (this.screenStream) {
      // We are currently sharing our screen, answer with it
      call.answer(this.screenStream);
      this.activeScreenCalls.set(call.peer, call);
      call.on('close', () => {
        this.activeScreenCalls.delete(call.peer);
      });
      call.on('error', () => {
        this.activeScreenCalls.delete(call.peer);
      });
    } else {
      console.warn("Screen view request received but we are not sharing a screen");
      call.close();
    }
  }

  // ============== SCREEN SHARING =================

  async startScreenShare() {
     try {
       this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
       
       // Handle when user clicks "Stop Sharing" on the native browser bar
       this.screenStream.getVideoTracks()[0].onended = () => {
           this.stopScreenShare();
       };

       return this.screenStream;
     } catch (err) {
       console.error("Failed to get display media:", err);
       this.screenStream = null;
       throw err;
     }
  }

  stopScreenShare() {
    if (this.screenStream) {
       this.screenStream.getTracks().forEach(track => track.stop());
       this.screenStream = null;
    }
    // Close all viewers
    this.activeScreenCalls.forEach(call => call.close());
    this.activeScreenCalls.clear();
  }

  viewScreen(hostPeerId, onStream) {
    if (!this.peer || this.peer.disconnected) {
       console.error("PeerJS not connected, cannot view screen");
       return null;
    }

    // PeerJS needs a stream to place a call; send a 1x1 canvas placeholder
    const canvas = document.createElement("canvas");
    canvas.width = 1; canvas.height = 1;
    const sendStream = canvas.captureStream(1);

    const call = this.peer.call(hostPeerId, sendStream, { metadata: { type: 'screen-view' } });
    this.viewingScreenCall = call;

    call.on('stream', (stream) => {
       console.log("Receiving screen stream from", hostPeerId);
       this.viewingScreenStream = stream;
       if (onStream) onStream(stream);
    });

    call.on('close', () => {
       console.log("Screen share viewing ended");
       this.viewingScreenCall = null;
       this.viewingScreenStream = null;
       if (onStream) onStream(null);
    });

    call.on('error', (err) => {
       console.error("Screen view call error", err);
       this.viewingScreenCall = null;
       this.viewingScreenStream = null;
       if (onStream) onStream(null);
    });

    return call;
  }

  stopViewingScreen() {
    if (this.viewingScreenCall) {
       this.viewingScreenCall.close();
       this.viewingScreenCall = null;
    }
    this.viewingScreenStream = null;
  }

  // ===============================================

  /**
   * Cleanup and destroy peer connection
   */
  destroy() {
    this.stopScreenShare();
    this.stopViewingScreen();

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}

export default new PeerService();
