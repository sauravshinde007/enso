![githubbanner](https://github.com/user-attachments/assets/d1efaa36-8561-475e-9fb9-3c0ebdd49f26)

Welcome to the future of work. This platform isn't just a video calling tool; it's a persistent, spatial virtual office designed to bring the spontaneity and connection of physical spaces to remote teams. Move, interact, and collaborate naturally.

---

## Key Features

### Proximity-Based Video & Audio
Forget scheduling links. Just walk up to a colleague to start talking. Our spatial audio engine simulates real-world acoustics, allowing for natural hallway conversations and quick sync-ups. As you move away, the audio fades, just like in real life.

<img width="100%" alt="Proximity Video Chat" src="https://github.com/user-attachments/assets/24eae04a-6360-4c58-bb3d-3473789a4642" />

### Role-Based Access Control (RBAC)
Security meets spatial design. Designated zones such as "CEO Office" or "Server Room" are restricted based on user roles. 
- **Admins** have full access and oversight.
- **Employees** access general work zones.
- **Guests** are limited to public lobbies.

<img width="100%" alt="Role-Based Access" src="https://github.com/user-attachments/assets/f63f642a-5a36-4aa2-a44a-81c84154c568" />

### Line-of-Sight Audio Architecture
Privacy matters. Our advanced audio engine respects physical boundaries—walls block sound, enabling private meetings right next to busy common areas without interference.

<img width="100%" alt="Line of Sight Audio" src="https://github.com/user-attachments/assets/fab494d8-e60d-4db3-a742-72fd8326d135" />

### Interactive Minimap & Navigation
Stay oriented with a real-time minimap. Locate team members instantly across the sprawling digital campus.

### Comprehensive Communication Suite
- **Global & Private Chat**: Integrated text communication alongside video.
- **Admin Panel**: Real-time server stats, user management, and moderation tools.
- **Profile Customization**: Verify identity with persistent profiles and avatars.

---

## Getting Started

Follow these instructions to set up and run the project locally.

### Prerequisites
- **Node.js**: Ensure you have Node.js (v16+) installed.
- **MongoDB**: A running instance of MongoDB (locally or via MongoDB Atlas).
- **Redis**: A running instance of Redis (required for BullMQ background jobs).

### Installation & Execution

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd enso
   ```

2. **Start Redis Server:**
   Ensure your Redis server is running locally on the default port (6379) or configure it in your `.env`.
   ```bash
   redis-server
   ```

3. **Start the Backend Server:**
   Open a new terminal tab/window:
   ```bash
   cd server
   npm install
   # Ensure you configure your .env file with MONGO_URI, REDIS_URL, etc.
   npm run dev
   ```

4. **Start the Transcription Agent:**
   Open a new terminal tab/window:
   ```bash
   cd server
   npm run agent
   ```

5. **Start the Frontend Client:**
   Open a new terminal tab/window:
   ```bash
   cd client
   npm install
   # Ensure you configure your .env file with the server URL if needed
   npm run dev
   ```

4. **Access the Application:**
   Open your browser and navigate to `http://localhost:3000` (or the respective port your React app runs on).

---

## Built With

Engineered for performance and scalability using a modern tech stack:

- **Frontend**: React, Phaser 3 (Game Engine), TailwindCSS, Framer Motion
- **Real-time**: Socket.io, Stream IO (Video/Audio), PeerJS
- **Backend**: Node.js, Express, MongoDB (Mongoose)
- **Security**: JWT, Google OAuth 2.0, BCrypt

---

*Experience the next evolution of remote work.*
