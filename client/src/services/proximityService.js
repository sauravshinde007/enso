// client/src/services/proximityService.js
//
// Proximity audio/video over a LiveKit SFU.
//
// Every player joins ONE LiveKit room and publishes their mic/camera once.
// The server tells us which players are in proximity ("proximityPeers"), and we
// only SUBSCRIBE to those players' tracks. Walking in/out of range just toggles
// subscriptions — no per-pair calls, no glare, no answer/offer races.
//
// Participant identity === socket.id, so remote streams are keyed by socket id.
import { Room, RoomEvent, Track } from 'livekit-client';
import socketService from './socketService';
import { PROXIMITY_LEAVE_GRACE_MS } from '../config/proximity';

const PROXIMITY_SOURCES = new Set([Track.Source.Microphone, Track.Source.Camera]);
const TOKEN_RETRIES = 20;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class ProximityService {
  constructor() {
    this.room = null;
    this.localStream = null;

    this.nearbyIds = new Set();          // socket ids we should be subscribed to
    this.leaveTimers = new Map();        // socketId -> timeout id (grace period)
    this.remoteTracks = new Map();       // socketId -> Map(trackSid -> MediaStreamTrack)
    this.remoteStreams = new Map();      // socketId -> MediaStream (rebuilt on every change)

    this.streamReceivedListeners = new Set();
    this.callEndedListeners = new Set();
    this.localStreamListeners = new Set();

    this._connecting = null;
    this._syncChain = Promise.resolve();
    this._destroyed = false;
  }

  // ===================== CONNECTION =====================

  async connect() {
    if (this.room) return this.room;
    if (this._connecting) return this._connecting;
    this._destroyed = false;

    this._connecting = (async () => {
      const { token, url } = await this._fetchToken();

      // adaptiveStream is off on purpose: we render raw MediaStreams, not track.attach() elements.
      const room = new Room({ adaptiveStream: false, dynacast: true });
      this._bindRoomEvents(room);

      await room.connect(url, token, { autoSubscribe: false });
      if (this._destroyed) {
        await room.disconnect();
        return null;
      }

      this.room = room;
      console.log('✅ Connected to LiveKit proximity room as', room.localParticipant.identity);

      room.remoteParticipants.forEach(p => this._applySubscription(p));
      this._queueSync();
      return room;
    })();

    try {
      return await this._connecting;
    } finally {
      this._connecting = null;
    }
  }

  async _fetchToken() {
    // joinGame is async on the server (DB lookup), so the first requests may race it.
    for (let attempt = 0; attempt < TOKEN_RETRIES; attempt++) {
      const res = await new Promise((resolve) => {
        const socket = socketService.socket;
        if (!socket?.connected) return resolve({ error: 'NO_SOCKET' });
        socket.timeout(5000).emit('getProximityToken', (err, data) => {
          resolve(err ? { error: 'TIMEOUT' } : data);
        });
      });

      if (res?.token) return res;
      if (res?.error === 'TOKEN_FAILED') throw new Error('Server failed to create LiveKit token');
      await sleep(500);
    }
    throw new Error('Could not obtain LiveKit proximity token');
  }

  _bindRoomEvents(room) {
    room
      .on(RoomEvent.ParticipantConnected, (participant) => {
        this._applySubscription(participant);
      })
      .on(RoomEvent.TrackPublished, (publication, participant) => {
        this._applySubscription(participant, publication);
      })
      .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (!PROXIMITY_SOURCES.has(publication.source)) return;
        const id = participant.identity;
        // Late arrival after the player already walked away -> undo it
        if (!this.nearbyIds.has(id)) {
          publication.setSubscribed(false);
          return;
        }
        if (!this.remoteTracks.has(id)) this.remoteTracks.set(id, new Map());
        this.remoteTracks.get(id).set(publication.trackSid, track.mediaStreamTrack);
        this._rebuildRemoteStream(id);
      })
      .on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        const tracks = this.remoteTracks.get(participant.identity);
        if (tracks) tracks.delete(publication.trackSid);
        this._rebuildRemoteStream(participant.identity);
      })
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        this._dropRemote(participant.identity);
      })
      // Announcement Hall: the server revokes/restores publishing for the audience
      .on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant) => {
        if (participant === room.localParticipant || !participant) this._queueSync();
      })
      .on(RoomEvent.Reconnected, () => {
        room.remoteParticipants.forEach(p => this._applySubscription(p));
        this._queueSync();
      })
      .on(RoomEvent.Disconnected, (reason) => {
        console.warn('⚠️ LiveKit proximity room disconnected:', reason);
        if (this.room !== room) return;
        this.room = null;
        [...this.remoteStreams.keys()].forEach(id => this._dropRemote(id));
        this.remoteTracks.clear();

        // LiveKit already retried internally; do a fresh join unless we left on purpose.
        if (!this._destroyed) {
          setTimeout(() => {
            if (!this._destroyed && !this.room) {
              this.connect().catch(e => console.error('LiveKit reconnect failed:', e));
            }
          }, 2000);
        }
      });
  }

  disconnect() {
    this._destroyed = true;
    this.leaveTimers.forEach(t => clearTimeout(t));
    this.leaveTimers.clear();
    this.nearbyIds.clear();

    const room = this.room;
    this.room = null;
    [...this.remoteStreams.keys()].forEach(id => this._dropRemote(id));
    this.remoteTracks.clear();
    if (room) room.disconnect();

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
      this.localStreamListeners.forEach(cb => cb(null));
    }
  }

  // ===================== PROXIMITY =====================

  /**
   * Set the socket ids currently in proximity (from the server's symmetric set).
   * Joins are applied immediately; leaves after a short grace period.
   */
  setNearby(ids) {
    const next = new Set(ids);

    next.forEach(id => {
      if (this.leaveTimers.has(id)) {
        clearTimeout(this.leaveTimers.get(id));
        this.leaveTimers.delete(id);
      }
      if (!this.nearbyIds.has(id)) {
        this.nearbyIds.add(id);
        this._applySubscriptionById(id);
      }
    });

    this.nearbyIds.forEach(id => {
      if (next.has(id) || this.leaveTimers.has(id)) return;
      const timer = setTimeout(() => {
        this.leaveTimers.delete(id);
        this.nearbyIds.delete(id);
        this._applySubscriptionById(id);
      }, PROXIMITY_LEAVE_GRACE_MS);
      this.leaveTimers.set(id, timer);
    });
  }

  _applySubscriptionById(id) {
    const participant = this.room?.remoteParticipants.get(id);
    if (participant) {
      this._applySubscription(participant);
    } else if (!this.nearbyIds.has(id)) {
      this._dropRemote(id);
    }
  }

  _applySubscription(participant, onlyPublication) {
    const id = participant.identity;
    const want = this.nearbyIds.has(id);
    const pubs = onlyPublication ? [onlyPublication] : [...participant.trackPublications.values()];

    for (const pub of pubs) {
      if (!PROXIMITY_SOURCES.has(pub.source)) continue;
      if (want) {
        // Note: pub.isDesired is true for never-touched publications, so check isSubscribed instead
        if (!pub.isSubscribed) pub.setSubscribed(true);
      } else if (pub.isDesired || pub.isSubscribed) {
        pub.setSubscribed(false);
      }
    }

    // Don't wait for the SFU to finish tearing tracks down; stop rendering/playing right away.
    if (!want && !onlyPublication) this._dropRemote(id);
  }

  _rebuildRemoteStream(id) {
    const tracks = [...(this.remoteTracks.get(id)?.values() || [])];
    if (tracks.length === 0) {
      this._dropRemote(id);
      return;
    }
    // A new MediaStream object per change so React/audio elements pick up the new track set.
    const stream = new MediaStream(tracks);
    this.remoteStreams.set(id, stream);
    this.streamReceivedListeners.forEach(cb => cb(id, stream));
  }

  _dropRemote(id) {
    this.remoteTracks.delete(id);
    if (this.remoteStreams.delete(id)) {
      this.callEndedListeners.forEach(cb => cb(id));
    }
  }

  // ===================== LOCAL PUBLISHING =====================

  _queueSync() {
    this._syncChain = this._syncChain
      .then(() => this._syncLocalTracks())
      .catch(err => console.error('Failed to sync local tracks to LiveKit:', err));
  }

  /** Make the published mic/camera match whatever is live in localStream. */
  async _syncLocalTracks() {
    const room = this.room;
    if (!room || room.state !== 'connected') return;
    const lp = room.localParticipant;

    // Muted by the server (live announcement audience): nothing may be published
    if (lp.permissions && lp.permissions.canPublish === false) {
      for (const pub of [...lp.trackPublications.values()]) {
        if (pub.track) await lp.unpublishTrack(pub.track, false).catch(() => {});
      }
      return;
    }

    const wanted = [
      ['audio', Track.Source.Microphone],
      ['video', Track.Source.Camera],
    ];

    for (const [kind, source] of wanted) {
      const desired = this.localStream
        ?.getTracks()
        .find(t => t.kind === kind && t.readyState === 'live') || null;
      const pub = lp.getTrackPublication(source);
      const published = pub?.track;

      if (!desired) {
        if (published) await lp.unpublishTrack(published, false);
      } else if (!published) {
        await lp.publishTrack(desired, { source, name: source });
      } else if (published.mediaStreamTrack !== desired) {
        await published.replaceTrack(desired, true);
      }
    }
  }

  // ===================== LOCAL MEDIA =====================

  notifyLocalStreamListeners() {
    this._queueSync();
    const stream = this.localStream;
    this.localStreamListeners.forEach(cb => cb(stream));
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

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia is not supported in this browser');
      }

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('✅ Local media stream obtained',
        'audio:', this.localStream.getAudioTracks().length,
        'video:', this.localStream.getVideoTracks().length);

      this.notifyLocalStreamListeners();
      return this.localStream;
    } catch (error) {
      console.error('❌ Failed to get user media:', error);

      if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        throw new Error('CAMERA_IN_USE: Your camera appears to be in use by another application or browser tab.');
      }

      throw error;
    }
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
        this.localStream.addTrack(tempStream.getAudioTracks()[0]);
        this.notifyLocalStreamListeners();
      } catch (err) {
        console.error("Failed to enable audio:", err);
      }
    } else {
      this.localStream.getAudioTracks().forEach(track => {
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
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
        this.localStream.getVideoTracks().forEach(t => {
          t.stop();
          this.localStream.removeTrack(t);
        });
        this.localStream.addTrack(tempStream.getVideoTracks()[0]);
        this.notifyLocalStreamListeners();
      } catch (err) {
        console.error("Failed to enable video:", err);
      }
    } else {
      // With an SFU there is no renegotiation cost, so we simply unpublish the camera.
      this.localStream.getVideoTracks().forEach(track => {
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
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'audioinput');
    } catch (e) {
      console.error("Failed to list devices", e);
      return [];
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

  async setAudioInputDevice(deviceId) {
    return this._switchInputDevice('audio', deviceId);
  }

  async setVideoInputDevice(deviceId) {
    return this._switchInputDevice('video', deviceId);
  }

  async _switchInputDevice(kind, deviceId) {
    if (!deviceId) return;

    try {
      console.log(`Switching ${kind} input to ${deviceId}`);
      const newStream = await navigator.mediaDevices.getUserMedia({
        [kind]: { deviceId: { exact: deviceId } }
      });
      const newTrack = newStream.getTracks().find(t => t.kind === kind);

      if (!this.localStream) {
        this.localStream = newStream;
      } else {
        this.localStream.getTracks().filter(t => t.kind === kind).forEach(t => {
          t.stop();
          this.localStream.removeTrack(t);
        });
        this.localStream.addTrack(newTrack);
      }

      this.notifyLocalStreamListeners();
      return newTrack;
    } catch (err) {
      console.error(`Failed to switch ${kind} device:`, err);
    }
  }

  // ===================== LISTENERS / QUERIES =====================

  onStreamReceived(callback) {
    this.streamReceivedListeners.add(callback);
    return () => this.streamReceivedListeners.delete(callback);
  }

  onCallEnded(callback) {
    this.callEndedListeners.add(callback);
    return () => this.callEndedListeners.delete(callback);
  }

  /** Socket ids we currently receive media from */
  getActiveCalls() {
    return Array.from(this.remoteStreams.keys());
  }

  /** [socketId, MediaStream] pairs */
  getRemoteStreams() {
    return Array.from(this.remoteStreams.entries());
  }
}

export default new ProximityService();
