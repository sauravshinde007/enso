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
   - **LiveKit (SFU):** Proximity audio/video. Every player joins one LiveKit room (`metaverse-proximity`) and publishes once; clients subscribe only to players in proximity.
   - **PeerJS Server:** WebRTC signaling for computer screen sharing only.
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
- **Proximity set:** Clients report nearby players every second (`nearbyPlayers`). The server makes it symmetric (A and B are connected if either reports the other) and sends each client its set via `proximityPeers` only when it changes.
- **SFU media:** `proximityService` joins the LiveKit room (token via the `getProximityToken` socket ack, identity = socket id) with `autoSubscribe: false`, publishes mic/camera, and subscribes/unsubscribes to remote tracks as the proximity set changes (with a 1s leave grace period).
- **Dynamic Volume:** As players move closer or further apart, `VoiceManager` dynamically adjusts the volume of the respective HTML Audio elements.


### 3. Team Notice Board & Issue Bot
- **Map:** A cork board on the desk-area wall (Tiled object `type: noticeboard` in `map2.tmj`, drawn by `MapManager.drawNoticeBoard`). Pressing E opens `NoticeBoardModal`.
- **Teams (`Team` model):** An admin creates a team and picks its leader. The leader (or an admin) manages members, the GitHub repo URL, an optional GitHub token, the low-priority labels, and the bot's AI provider + API key. A user can belong to several teams. Tokens/keys are AES-256-GCM encrypted (`utils/secrets.js`) and never returned to clients.
- **Notices:** `GET /api/teams/notices` returns open issues and PRs for every team the user belongs to (GitHub REST, cached 60s per repo). The client shows them as a sliding card carousel filterable by team and type.
- **Issue bot:** For open issues carrying a low-priority label, the leader clicks *Assign to bot*. `issueBotService` (one task at a time) reads the issue, lets the chosen model (Claude / OpenAI / Gemini / Groq via `llmService`) pick files, generates full-file changes, commits them to an `ai-bot/issue-<n>-…` branch through the git data API, opens a PR (`Closes #n`) and comments on the issue. Progress is stored in `BotTask` and pushed to team members via the `noticeBoardUpdate` socket event. The bot never merges.
- **Optional env:** `GITHUB_TOKEN` (fallback token), `SECRETS_ENCRYPTION_KEY` (defaults to `JWT_SECRET`), and `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` / `GROQ_API_KEY` as fallback bot keys for testing.

### 4. Announcement Hall
- **Space:** The open hall on the right of the map (`x 1376–2016, y 416–960`, `config/announcementHall.js` on both client and server). A permanent "Announcement Hall" plaque marks it.
- **Scheduling:** Admin Panel → *Announcements* tab allots a time slot (title, speaker, start, duration). Overlapping slots are rejected (one hall). `Announcement` model; routes under `/api/announcements`.
- **Notifications:** On declaration, 10 minutes before start, when it goes live, and on cancel, every user gets a stored `Notification` (type `announcement`) plus a real-time toast (`announcementNotice`).
- **Stage:** As soon as a slot is declared the client (`StageManager`) builds a stage (banner, platform, podium, speakers, audience mats) with a construction animation; while live it adds spotlights and an ON AIR sign; it is removed when nothing is scheduled.
- **Audio rules while live** (`socketHandler` + `announcementService` tick every 10s): everyone inside the hall is subscribed only to the speaker (heard at full volume anywhere in the hall), the speaker hears no one, and people outside the hall never connect to people inside. The audience's LiveKit `canPublish` permission is revoked server-side (RoomServiceClient) so they cannot speak, and restored when they leave the hall or the slot ends.
