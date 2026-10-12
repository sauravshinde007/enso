import React, { useState, useEffect, useRef, useCallback } from 'react';
import proximityService from '../services/proximityService';
import '../styles/videogrid.css';

const MAX_REMOTE_VIDEOS = 4;
const ANIMATION_DURATION = 300; // ms, matches CSS

// Remote streams are keyed by socket id (== LiveKit participant identity)
function getUsername(id) {
  try {
    const worldScene = window._phaserGame?.scene.getScene('WorldScene');
    const name = worldScene?.playerManager?.playerUsernames.get(id);
    if (name) return name;
  } catch (e) {
    console.error("Error getting username:", e);
  }
  return id.slice(0, 6) + '...';
}

const VideoPlayer = ({ stream, peerId, isExiting, onVisibilityChange }) => {
  const videoRef = useRef(null);
  const [hasVideo, setHasVideo] = useState(false);
  const username = getUsername(peerId);

  // 1. Monitor stream state (tracks, mute/unmute)
  useEffect(() => {
    if (!stream) return;

    const checkVideoState = () => {
      const videoTracks = stream.getVideoTracks();
      const videoTrack = videoTracks[0];

      // With the SFU, a camera that is off is unpublished, so the track simply isn't there.
      // `muted` covers the gap before the first frame arrives.
      const isVideoActive = !!(videoTrack && videoTrack.readyState === 'live' && !videoTrack.muted);
      
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
  }, [stream]);
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
      if (proximityService.localStream) {
        // Creating new MediaStream forces React to re-eval the ref.
        setLocalStream(new MediaStream(proximityService.localStream.getVideoTracks()));
      } else {
        setLocalStream(null);
      }
    };

    // Initial check
    updateLocalStream();

    // Subscribe to updates
    const unsubscribe = proximityService.onLocalStreamUpdated(() => {
      updateLocalStream();
    });

    return () => {
      unsubscribe();
    };
  }, [isVideoEnabled]);

  useEffect(() => {
    const update = () => {
      // Get current active streams from service
      const allRemoteStreams = proximityService.getRemoteStreams();

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
            } else if (item.stream !== activeMap.get(item.peerId)) {
              // Track set changed (e.g. camera turned on) -> new MediaStream
              next.push({ ...item, stream: activeMap.get(item.peerId) });
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
          isExiting={isExiting}
          onVisibilityChange={handleVisibilityChange}
        />
      ))}
    </div>
  );
}