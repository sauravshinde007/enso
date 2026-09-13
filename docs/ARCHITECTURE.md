# System Architecture

This document describes the high-level architecture of the 2D Metaverse project, a real-time multiplayer virtual office platform.

## High-Level Architecture

The project is built on a Client-Server model, divided into three primary layers:

1. **Frontend (React UI)**
   - Manages user authentication, navigation, and overlays.
   - Handles web-based interfaces like modals, chat sidebars, and WebRTC video grids.
   - Built with React, TailwindCSS, and Framer Motion.

2. **Game Engine (Phaser 3)**
   - Integrated within the React frontend to manage the 2D virtual world.
   - Handles `.tmj` tilemaps, sprite rendering, physics (collisions), and player movement.
   - Performs line-of-sight (raycasting) calculations for spatial audio logic.

3. **Backend (Node.js + Express + Socket.io)**
   - **Express Server:** Handles REST API routes for authentication and meeting management.
   - **Socket.io Server:** Manages real-time, low-latency multiplayer synchronization (player positions, state changes).
   - **PeerJS Server:** Facilitates WebRTC signaling for peer-to-peer proximity audio and video connections.
   - **MongoDB:** Serves as the persistent database for users, roles, and meeting records.
   - **BullMQ + Redis:** Manages background job queues (e.g., asynchronous AI processing for meeting summaries).

---

## Core Components & Modules

### Frontend (`/client/src/`)
- **React Components:** Overlay the game canvas (`ComputerModal`, `VideoGrid`, `ChatSidebar`).
- **Services:** Singleton wrappers like `socketService.js` and `peerService.js` to manage WebSocket and WebRTC connections cleanly outside of React components.
- **Phaser Engine (`/client/src/phaser/`):**
  - `World.js`: Main scene and game loop.
  - `MapManager.js`: Tilemap and collision zones.
  - `NetworkManager.js`: Bridges Phaser with `socketService.js` to sync game state.
  - `VoiceManager.js`: Adjusts local audio volumes dynamically based on spatial distance.

### Backend (`/server/`)
- **API Routes:** standard HTTP endpoints.
- **Socket Handler (`socketHandler.js`):** Tracks connected players, coordinates game state broadcasts, and validates movements.
- **Background Workers (`momWorker.js`):** A BullMQ worker that connects to Redis, processes meeting transcripts, and queries an external LLM (Groq Llama-3) to generate Minutes of Meeting without blocking the main Node server.

---

## Key Data Flows

### 1. Real-Time Movement Sync
- **Client:** Phaser captures keypresses and updates local sprite position.
- **Client Network:** `NetworkManager` throttles updates and sends `{x, y}` coordinates via Socket.io.
- **Server:** Validates movement (checking Role-Based Access Control zones) and broadcasts the new position to all other connected clients.
- **Peers:** Other clients receive the broadcast and interpolate the movement of the remote player's sprite.

### 2. Proximity-Based Audio & Line-of-Sight
- **Client Engine:** Phaser periodically calculates the distance between the local player and other players.
- **Raycasting:** It checks if any map walls block the line of sight between two players.
- **Signaling:** If players are near and visible, `peerService` initiates WebRTC connections.
- **Dynamic Volume:** As players move closer or further apart, `VoiceManager` dynamically adjusts the volume of the respective HTML Audio elements.

