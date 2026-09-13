import React, { useState, useEffect, useRef, useCallback } from 'react';
import peerService from '../services/peerService';
import socketService from '../services/socketService';
import '../styles/videogrid.css';

const MAX_REMOTE_VIDEOS = 4;
const ANIMATION_DURATION = 300; // ms, matches CSS

function getUsernameFromPeerId(peerId) {
  try {
    const game = window._phaserGame;
    if (!game) return peerId.slice(0, 6) + '...';

    const worldScene = game.scene.getScene('WorldScene');
    if (worldScene && worldScene.playerManager) {
      // Try fuzzy match using sanitized ID
      for (const [socketId, name] of worldScene.playerManager.playerUsernames.entries()) {
        if (peerService.getPeerId(socketId) === peerId) {
          return name;
        }
      }
    }
  } catch (e) {
    console.error("Error getting username:", e);
  }
  return peerId.slice(0, 6) + '...';
}

const VideoPlayer = ({ stream, peerId, isVideoEnabledBySignaling, isExiting, onVisibilityChange }) => {
  const videoRef = useRef(null);
  const [hasVideo, setHasVideo] = useState(false);
  const username = getUsernameFromPeerId(peerId);

  // 1. Monitor stream state (tracks, mute/unmute)
  useEffect(() => {
    if (!stream) return;

    const checkVideoState = () => {
      const videoTracks = stream.getVideoTracks();
      const videoTrack = videoTracks[0];

      // Robust check: active ONLY if:
      // 1. Track exists
      // 2. Track is not muted (WebRTC level)
      // 3. Signaling says it should be enabled (Server level truth)
      const isVideoActive = !!(videoTrack && !videoTrack.muted && isVideoEnabledBySignaling);
      
      setHasVideo(prev => {
        if (prev !== isVideoActive) {
          return isVideoActive;
        }
        return prev;
      });
    };

    // Check immediately
    checkVideoState();

    // Track listeners
    const handleTrackChange = () => checkVideoState();
    const handleMute = () => checkVideoState();
    const handleUnmute = () => checkVideoState();

    const checkInterval = setInterval(checkVideoState, 1000);

    stream.addEventListener('addtrack', handleTrackChange);
    stream.addEventListener('removetrack', handleTrackChange);

    const videoTracks = stream.getVideoTracks();
    videoTracks.forEach(track => {
      track.addEventListener('mute', handleMute);
      track.addEventListener('unmute', handleUnmute);
      track.addEventListener('ended', handleTrackChange);
    });

    return () => {
      clearInterval(checkInterval);
      stream.removeEventListener('addtrack', handleTrackChange);
      stream.removeEventListener('removetrack', handleTrackChange);
      videoTracks.forEach(track => {
        track.removeEventListener('mute', handleMute);
        track.removeEventListener('unmute', handleUnmute);
        track.removeEventListener('ended', handleTrackChange);
      });
    };
  }, [stream, isVideoEnabledBySignaling]);
  useEffect(() => {
    onVisibilityChange(peerId, hasVideo);
  }, [hasVideo, peerId, onVisibilityChange]);

  // 2. Attach stream to DOM when visible
  useEffect(() => {
    // Only update if different to avoid flickering
    if (hasVideo && videoRef.current && stream) {
      if (videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
    }
  }, [hasVideo, stream, peerId]);

  if (!hasVideo && !isExiting) {
    // Render nothing if no valid video track logic
    // UNLESS we are exiting, where we might want to fade out whatever state we had
    if (!isExiting) return null;
  }

  return (
    <div className={`video-container ${isExiting ? 'exiting' : ''}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="video-element"
        style={{ opacity: hasVideo ? 1 : 0 }} // Smooth fade in/out of video content itself
      />
      <span className="peer-id-label">{username}</span>
    </div>
  );
};

export default function VideoGrid({ isVideoEnabled }) {
  const [displayStreams, setDisplayStreams] = useState([]); // { peerId, stream, isExiting, exitStart }
  const [videoStatusMap, setVideoStatusMap] = useState({});
  const [localStream, setLocalStream] = useState(null);
  const visiblePeersRef = useRef(new Set());

  const handleVisibilityChange = useCallback((peerId, isVisible) => {
    if (isVisible) {
      visiblePeersRef.current.add(peerId);
    } else {
      visiblePeersRef.current.delete(peerId);
    }
  }, []);

  useEffect(() => {
    const updateLocalStream = () => {
      if (peerService.localStream) {
        console.log("VideoGrid: Updating local stream tracks:", peerService.localStream.getTracks().map(t => `${t.kind}:${t.readyState}:${t.enabled}`));
        // Only set non-null if we actually have video tracks (if video is enabled)
        // Or just pass it and let video element handle blankness?
        // Creating new MediaStream forces React to re-eval the ref.
        setLocalStream(new MediaStream(peerService.localStream.getTracks()));
      } else {
        setLocalStream(null);
      }
    };

    // Initial check
    updateLocalStream();

    // Subscribe to updates
    const unsubscribe = peerService.onLocalStreamUpdated(() => {
      updateLocalStream();
    });

    return () => {
      unsubscribe();
    };
  }, [isVideoEnabled]);

  useEffect(() => {
    const handleVideoStatus = ({ id, videoEnabled }) => {
      const peerId = peerService.getPeerId(id);
      setVideoStatusMap(prev => ({
        ...prev,
        [peerId]: videoEnabled
      }));
    };

    const handlePlayers = (players) => {
      setVideoStatusMap(prev => {
        const next = { ...prev };
        for (const [id, player] of Object.entries(players)) {
          next[peerService.getPeerId(id)] = player.videoEnabled;
        }
        return next;
      });
    };

    const handlePlayerJoined = (player) => {
      const peerId = peerService.getPeerId(player.id);
      setVideoStatusMap(prev => ({
        ...prev,
        [peerId]: player.videoEnabled
      }));
    };

    // Use direct 'on' and 'off' from socketService
    socketService.on("playerVideoStatus", handleVideoStatus);
    socketService.on("players", handlePlayers);
    socketService.on("playerJoined", handlePlayerJoined);

    // Initial load check if globalPlayers are already available in socketService
    if (socketService.getGlobalPlayers) {
        const currentPlayers = socketService.getGlobalPlayers();
        if (currentPlayers && Object.keys(currentPlayers).length > 0) {
            handlePlayers(currentPlayers);
        }
    }

    return () => {
      socketService.off("playerVideoStatus", handleVideoStatus);
      socketService.off("players", handlePlayers);
      socketService.off("playerJoined", handlePlayerJoined);
    };
  }, []);

  useEffect(() => {
    let lastSize = 0;
    const update = () => {
      // Get current active streams from service
      const allRemoteStreams = peerService.getRemoteStreams();
      const currentSize = allRemoteStreams.length;
      
      lastSize = currentSize;

      const activeData = allRemoteStreams.slice(0, MAX_REMOTE_VIDEOS);
      const activeMap = new Map(activeData); // peerId -> stream

      setDisplayStreams(prev => {
        const next = [];
        const now = Date.now();
        const processedIds = new Set();
        let hasChanges = false;

        // 1. Process previous items (Handle Exit/Rescue/Keep)
        prev.forEach(item => {
          if (activeMap.has(item.peerId)) {
            // Still active - KEEP
            // Check if we need to "Rescue" from exiting state
            if (item.isExiting) {
              next.push({
                peerId: item.peerId,
                stream: activeMap.get(item.peerId),
                isExiting: false,
                exitStart: null
              });
              hasChanges = true;
            } else {
              // Nothing changed, preserve ref
              next.push(item);
            }
            processedIds.add(item.peerId);
          } else {
            // Not active - handle EXIT
            if (item.isExiting) {
              // Already exiting. Check time.
              if (now - item.exitStart < ANIMATION_DURATION) {
                next.push(item); // Keep processing animation
              } else {
                // Timeout done, drop it.
                hasChanges = true;
              }
            } else {
              // Newly missing.
              // ONLY animate exit if the video was actually visible!
              if (visiblePeersRef.current.has(item.peerId)) {
                next.push({ ...item, isExiting: true, exitStart: now });
              }
              // If not visible, we just drop it (don't push to next) which equals "instant remove"
              hasChanges = true;
            }
          }
        });

        // 2. Process NEW items (Remaining in activeMap)
        activeMap.forEach((stream, peerId) => {
          if (!processedIds.has(peerId)) {
            next.push({ peerId, stream, isExiting: false, exitStart: null });
            hasChanges = true;
          }
        });

        // Debugging info
        if (activeMap.size > 0) {
            console.log("VideoGrid Update:", {
                activeStreamsCount: activeMap.size,
                displayStreamsCount: next.length,
                videoStatusMapKeys: Object.keys(videoStatusMap), // THIS IS BUGGY BECAUSE OF CLOSURE!
            });
        }

        return hasChanges ? next : prev;
      });
    };

    const interval = setInterval(update, 100); // Poll for smooth frame updates
    return () => clearInterval(interval);
  }, []);

  // Determine if we are in "Proximity Mode" (active remote video calls)
  const isProximityMode = displayStreams.length > 0;

  // Check if grid is entirely in exiting state (everyone left)
  const isGridExiting = isProximityMode && displayStreams.every(s => s.isExiting);

  // Dispatch event to World.js to control avatar bubble
  useEffect(() => {
    const event = new CustomEvent('proximity-video-active', { detail: isProximityMode });
    window.dispatchEvent(event);
  }, [isProximityMode]);

  return (
    <div className="remote-video-grid-container">
      {/*
        Render Local Video if:
        1. We are in proximity mode (rendering remote videos)
        2. Local video is enabled (Self-view)
        AND we have a valid local stream.
      */}
      {isProximityMode && isVideoEnabled && localStream && (
        <div className={`video-container ${isGridExiting ? 'exiting' : ''}`}>
          <video
            ref={ref => {
              if (ref && localStream) {
                ref.srcObject = localStream;
              }
            }}
            autoPlay
            playsInline
            muted // ALWAYS mute local video
            className="video-element"
            style={{ opacity: 1 }}
          />
          <span className="peer-id-label">You</span>
        </div>
      )}

      {displayStreams.map(({ peerId, stream, isExiting }) => (
        <VideoPlayer
          key={peerId}
          peerId={peerId}
          stream={stream}
          isVideoEnabledBySignaling={!!videoStatusMap[peerId]}
          isExiting={isExiting}
          onVisibilityChange={handleVisibilityChange}
        />
      ))}
    </div>
  );
}