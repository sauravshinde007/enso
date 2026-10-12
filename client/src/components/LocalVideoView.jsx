// client/src/components/LocalVideoView.jsx
import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import proximityService from '../services/proximityService';
import '../styles/localvideoview.css';

export default function LocalVideoView({ isVisible }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null); // Ref for constraints if needed

  useEffect(() => {
    if (isVisible && proximityService.localStream) {
      // Create a new stream with ONLY the video track
      // This is crucial to prevent audio feedback
      const videoStream = new MediaStream(
        proximityService.localStream.getVideoTracks()
      );
      if (videoRef.current) {
        videoRef.current.srcObject = videoStream;
      }
    }
  }, [isVisible]); // Re-run when visibility changes

  if (!isVisible) {
    return null; // Don't render anything if video is off
  }

  return (
    <motion.div
      className="local-video-container"
      drag
      dragMomentum={false} // Don't slide after release
      whileHover={{ cursor: 'grab' }}
      whileTap={{ cursor: 'grabbing', scale: 1.05 }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted // Mute your own video to prevent echo
        className="local-video-element"
      />
      <span className="local-video-label">Your View</span>
    </motion.div>
  );
}