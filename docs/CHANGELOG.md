# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Investigated / Notes
- **Proximity Video:** A reported issue where "remote video never displays in proximity calls" was traced to same-device multi-tab camera contention during testing. When two browser tabs on the same machine share one physical webcam, only one tab can hold an exclusive capture session, causing the losing tab's video track to stay permanently muted on the receiving end. This is expected OS/browser behavior and not an application defect. Added specific `CAMERA_IN_USE` error handling for better failure surfacing when this occurs.

### Fixed
- Proximity video calls: remote peers never received the real camera feed after a user joined audio-only and later enabled video, because `setVideoEnabled` mistook the black placeholder video track (used to avoid WebRTC renegotiation) for an already-active camera track and skipped re-acquiring/replacing it. Fixed by tagging placeholder tracks and only short-circuiting for genuine live camera tracks.
- **Proximity Video:** Fixed an issue where remote user videos would not display when coming into proximity. The `VideoGrid` component now correctly synchronizes initial video states from `socketService.getGlobalPlayers()` and correctly subscribes to `players` and `playerJoined` events to establish the correct signaling status (`isVideoEnabledBySignaling`) before a user enters proximity.
- **WebRTC Glare & Track Swapping:** Resolved WebRTC glare (where both users attempt to call each other simultaneously upon entering proximity, dropping the stream) by forcing a lexicographical Peer ID comparison to ensure only one user initiates the PeerJS call. Added a "dummy video track" pattern during media initialization so the WebRTC connection always negotiates a video transceiver, allowing users to seamlessly toggle their camera on/off mid-call.

