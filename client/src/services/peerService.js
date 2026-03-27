// client/src/services/peerService.js
import Peer from 'peerjs';

class PeerService {
  constructor() {
    this.peer = null;
    this.localStream = null;
    this.activeCalls = new Map(); // Map of peerId -> call object
    this.remoteStreams = new Map(); // Map of peerId -> remote stream
    this.streamReceivedListeners = new Set();
    this.callEndedListeners = new Set();
    this.localStreamListeners = new Set();
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
          console.log('📞 Incoming call from:', call.peer);
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

  notifyLocalStreamListeners() {
    if (this.localStreamListeners.size > 0) {
      const stream = this.localStream; // Pass the reference
      this.localStreamListeners.forEach(cb => cb(stream));
    }
  }

  onLocalStreamUpdated(callback) {
    this.localStreamListeners.add(callback);
    return () => this.localStreamListeners.delete(callback);
  }

  /**
   * Get user's media stream (audio/video)
   * @param {Object} constraints - MediaStream constraints object (e.g., { audio: true, video: { ... } })
   */
  async getUserMedia(constraints) {
    try {
      console.log('Requesting media with constraints:', constraints);

      // Check if mediaDevices is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia is not supported in this browser');
      }

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

      console.log('✅ Local media stream obtained');
      console.log('Audio tracks:', this.localStream.getAudioTracks().length);
      console.log('Video tracks:', this.localStream.getVideoTracks().length);

      // Verify audio track is enabled
      const audioTracks = this.localStream.getAudioTracks();
      if (audioTracks.length > 0) {
        console.log('Audio track label:', audioTracks[0].label);
        console.log('Audio track enabled:', audioTracks[0].enabled);
        console.log('Audio track ready state:', audioTracks[0].readyState);
      }

      this.notifyLocalStreamListeners();

      // We do NOT disable video by default here. 
      // If the caller requested video, they likely want it on.
      // this.setVideoEnabled(false);

      return this.localStream;
    } catch (error) {
      console.error('❌ Failed to get user media:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      throw error;
    }
  }

  /**
   * Call another peer
   * @param {string} remoteUserId - The socket ID of the user to call
   */
  callPeer(remoteUserId) {
    if (!this.peer || this.peer.disconnected) {
      console.log('PeerJS server not connected, cannot call.');
      return;
    }

    // In Metaverse games, we might want to initiate connections even if *we* don't have mic/video, 
    // so we can still RECEIVE audio from other people (listen-only mode). 
    // Usually Peer.js allows `.call(id, stream)` with a blank stream or no stream but it behaves weirdly.
    // If we have no localStream, we will not call. 
    if (!this.localStream) {
      console.warn('Local stream not initialized. Cannot send audio/video to peer.');
      return;
    }

    const remotePeerId = this.getPeerId(remoteUserId);

    // Don't call if already in a call with this peer
    if (this.activeCalls.has(remotePeerId)) {
      console.log('Already in call with', remotePeerId);
      return;
    }

    console.log('📞 Calling peer:', remotePeerId, '(User:', remoteUserId, ')');
    const call = this.peer.call(remotePeerId, this.localStream);

    call.on('stream', (remoteStream) => {
      console.log('✅ Received stream from:', remotePeerId);
      this.activeCalls.set(remotePeerId, call);
      this.remoteStreams.set(remotePeerId, remoteStream);

      this.streamReceivedListeners.forEach(cb => cb(remotePeerId, remoteStream));
    });

    call.on('close', () => {
      console.log('📴 Call closed with:', remotePeerId);
      this.activeCalls.delete(remotePeerId);
      this.remoteStreams.delete(remotePeerId);
      this.callEndedListeners.forEach(cb => cb(remotePeerId));
    });

    call.on('error', (error) => {
      console.error('Call error with', remotePeerId, ':', error);
      this.activeCalls.delete(remotePeerId);
      this.remoteStreams.delete(remotePeerId);
    });
  }

  /**
   * Handle incoming call
   * @param {Object} call - PeerJS call object
   */
  handleIncomingCall(call) {
    if (!this.localStream) {
      console.error('No local stream available to answer call');
      return;
    }

    const callerPeerId = call.peer;

    // Don't answer if already in a call with this peer
    if (this.activeCalls.has(callerPeerId)) {
      console.log('Already in call with', callerPeerId);
      return;
    }

    console.log('✅ Answering call from:', callerPeerId);
    call.answer(this.localStream);

    call.on('stream', (remoteStream) => {
      console.log('✅ Received stream from:', callerPeerId);
      this.activeCalls.set(callerPeerId, call);
      this.remoteStreams.set(callerPeerId, remoteStream);

      this.streamReceivedListeners.forEach(cb => cb(callerPeerId, remoteStream));
    });

    call.on('close', () => {
      console.log('📴 Call closed with:', callerPeerId);
      this.activeCalls.delete(callerPeerId);
      this.remoteStreams.delete(callerPeerId);
      this.callEndedListeners.forEach(cb => cb(callerPeerId));
    });

    call.on('error', (error) => {
      console.error('Call error with', callerPeerId, ':', error);
      this.activeCalls.delete(callerPeerId);
      this.remoteStreams.delete(callerPeerId);
    });
  }

  /**
   * End call with a specific peer
   * @param {string} userId - Socket ID
   */
  endCall(userId) {
    const peerId = this.getPeerId(userId);
    const call = this.activeCalls.get(peerId);
    if (call) {
      call.close();
      this.activeCalls.delete(peerId);
      this.remoteStreams.delete(peerId);
      console.log('Ended call with:', peerId);
    }
  }

  /**
   * End all active calls
   */
  endAllCalls() {
    this.activeCalls.forEach((call, peerId) => {
      call.close();
      console.log('Ended call with:', peerId);
    });
    this.activeCalls.clear();
    this.remoteStreams.clear();
  }

  async setAudioEnabled(enabled) {
    if (!this.localStream) return;

    if (enabled) {
      const existingTrack = this.localStream.getAudioTracks()[0];
      if (existingTrack && existingTrack.readyState === 'live') {
        existingTrack.enabled = true;
        this.notifyLocalStreamListeners();
        return;
      }

      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const newAudioTrack = tempStream.getAudioTracks()[0];
        this.localStream.addTrack(newAudioTrack);

        // Update peer connections
        this.updateSenders('audio', newAudioTrack);

        this.notifyLocalStreamListeners();
      } catch (err) {
        console.error("Failed to enable audio:", err);
      }
    } else {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = false;
        track.stop();
        this.localStream.removeTrack(track);
      });
      this.notifyLocalStreamListeners();
    }
  }

  async setVideoEnabled(enabled) {
    if (!this.localStream) return;

    if (enabled) {
      const existingTrack = this.localStream.getVideoTracks()[0];
      if (existingTrack && existingTrack.readyState === 'live') {
        existingTrack.enabled = true;
        this.notifyLocalStreamListeners();
        return;
      }

      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const newVideoTrack = tempStream.getVideoTracks()[0];
        this.localStream.addTrack(newVideoTrack);

        // Update peer connections
        this.updateSenders('video', newVideoTrack);

        this.notifyLocalStreamListeners();
      } catch (err) {
        console.error("Failed to enable video:", err);
      }
    } else {
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = false;
        track.stop();
        this.localStream.removeTrack(track);
      });
      this.notifyLocalStreamListeners();
    }
  }

  /**
   * Get available audio input devices (microphones)
   */
  async getAudioInputDevices() {
    try {
      // Ensure we have permission first, or enumerateDevices might return empty labels
      // check if we already have a stream, otherwise we might need to ask quickly?
      // actually enumerateDevices works better if permission is granted.
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'audioinput');
    } catch (e) {
      console.error("Failed to list devices", e);
      return [];
    }
  }

  /**
   * Switch the audio input device
   * @param {string} deviceId 
   */
  async setAudioInputDevice(deviceId) {
    if (!deviceId) return;

    try {
      console.log(`Switching audio input to ${deviceId}`);
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } }
      });
      const newAudioTrack = newStream.getAudioTracks()[0];

      if (!this.localStream) {
        this.localStream = newStream;
      } else {
        // Replace track in local stream
        const oldTracks = this.localStream.getAudioTracks();
        oldTracks.forEach(t => {
          t.stop();
          this.localStream.removeTrack(t);
        });
        this.localStream.addTrack(newAudioTrack);
      }

      // Update peer connections
      this.updateSenders('audio', newAudioTrack);

      this.notifyLocalStreamListeners();
      return newAudioTrack;

    } catch (err) {
      console.error("Failed to switch audio device:", err);
    }
  }

  /**
   * Get available video input devices (cameras)
   */
  async getVideoInputDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'videoinput');
    } catch (e) {
      console.error("Failed to list video devices", e);
      return [];
    }
  }

  /**
   * Switch the video input device
   * @param {string} deviceId 
   */
  async setVideoInputDevice(deviceId) {
    if (!deviceId) return;

    try {
      console.log(`Switching video input to ${deviceId}`);
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } }
      });
      const newVideoTrack = newStream.getVideoTracks()[0];

      if (!this.localStream) {
        this.localStream = newStream;
      } else {
        // Replace track in local stream
        const oldTracks = this.localStream.getVideoTracks();
        oldTracks.forEach(t => {
          t.stop();
          this.localStream.removeTrack(t);
        });
        this.localStream.addTrack(newVideoTrack);
      }

      // Update peer connections
      this.updateSenders('video', newVideoTrack);

      this.notifyLocalStreamListeners();
      return newVideoTrack;

    } catch (err) {
      console.error("Failed to switch video device:", err);
    }
  }

  updateSenders(kind, newTrack) {
    this.activeCalls.forEach(call => {
      if (call.peerConnection) {
        const senders = call.peerConnection.getSenders();
        const sender = senders.find(s => s.track && s.track.kind === kind) ||
          senders.find(s => !s.track && s.track === null);

        if (sender) {
          sender.replaceTrack(newTrack).catch(e => console.error(`Replace ${kind} track failed`, e));
        } else {
          // Special handling for adding track if missing sender... won't do for now.
        }
      }
    });
  }

  /**
   * Set callback for when stream is received
   * @param {Function} callback 
   * @returns {Function} unsubscribe
   */
  onStreamReceived(callback) {
    this.streamReceivedListeners.add(callback);
    return () => this.streamReceivedListeners.delete(callback);
  }

  /**
   * Set callback for when call ends
   * @param {Function} callback 
   * @returns {Function} unsubscribe
   */
  onCallEnded(callback) {
    this.callEndedListeners.add(callback);
    return () => this.callEndedListeners.delete(callback);
  }

  /**
   * Get list of active call peer IDs
   */
  getActiveCalls() {
    return Array.from(this.activeCalls.keys());
  }

  /**
   * Get list of [peerId, remoteStream] pairs
   */
  getRemoteStreams() {
    return Array.from(this.remoteStreams.entries());
  }

  /**
   * Cleanup and destroy peer connection
   */
  destroy() {
    this.endAllCalls();

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }

    this.streamReceivedListeners.clear();
    this.callEndedListeners.clear();
    this.localStreamListeners.clear();
  }
}

export default new PeerService();
