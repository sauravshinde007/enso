# Agent Coding Guidelines & Principles

These guidelines define the specific coding principles and conventions that should be followed when contributing to this project. AI Agents and developers should strictly adhere to these rules to maintain consistency across the stack.

## 1. General Principles
- **Separation of Concerns:** Keep business logic outside of React components where possible. Use services for API and socket communications.
- **Client-Server Trust:** The backend is the source of truth. The frontend (React + Phaser) should primarily reflect backend state and send intents/commands. Never trust client-side data for permissions or security.

## 2. Frontend (React)
- **Functional Components & Hooks:** Use functional components and React Hooks (`useState`, `useEffect`, `useContext`) instead of class components.
- **State Management:** Use Context API for global states like `AuthContext` and `NotificationContext`. For local component state, use `useState`.
- **Styling:** Use TailwindCSS for styling. Avoid writing custom CSS unless absolutely necessary.
- **Routing:** Use `react-router-dom` for navigation between non-game views (e.g., login, dashboard).

## 3. Game Engine (Phaser 3)
- **Scene Management:** Keep `scenes/World.js` focused on the main game loop (`update`) and bootstrapping. Delegate specific functionalities to "Managers" (e.g., `MapManager`, `PlayerManager`, `NetworkManager`).
- **Performance:** Throttling is critical for network events. Do not emit socket events on every frame. Use intervals or distance thresholds (e.g., throttling movement and audio updates).
- **Physics:** Utilize Phaser's raycasting for line-of-sight calculations to ensure walls block proximity audio correctly.

## 4. Backend (Node.js & Express)
- **RESTful APIs:** Follow REST conventions for standard HTTP routes (`/api/auth`, `/api/meeting`).
- **Controllers & Services:** Keep routes clean by delegating business logic to controllers, and database interactions to services or Mongoose models.
- **Background Processing:** Any heavy processing (e.g., calling Groq LLM for MOM generation) must be offloaded to `BullMQ` + `Redis` workers to avoid blocking the main Event Loop.

## 5. Real-Time Communication (Socket.io & PeerJS)
- **Socket Events:** Use clear, consistent naming conventions for socket events (e.g., camelCase like `playerJoined`, `movementUpdate`).
- **Broadcasting:** Optimize broadcasts. Only send data to clients who need it. Use Socket.io rooms for private areas or localized events if the map scales up.
- **WebRTC:** Use `PeerJS` (or LiveKit) strictly for peer-to-peer audio and video streams. Do not send standard game state (like positions) over WebRTC data channels; use Socket.io for that.

