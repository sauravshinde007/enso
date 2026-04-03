// client/src/pages/Metaverse.jsx

import { useEffect, useState } from "react"; // <-- Import useState
import "../styles/App.css";
import startGame from "../phaser";
import Sidebar from "../components/Sidebar";
import VoiceChat from "../components/VoiceChat";
import VideoGrid from "../components/VideoGrid";

import { ChatProvider } from "../context/ChatContext";
import { useAuth } from "../context/AuthContext";

import ServerStats from "../components/ServerStats"; // Import

import ZoomControls from "../components/ZoomControls"; // Import

import Minimap from "../components/Minimap"; // Import
import MeetingModal from "../components/MeetingModal"; // Import meeting modal
import ComputerModal from "../components/ComputerModal"; // Import computer modal
import FPSCounter from "../components/FPSCounter"; // Import FPS Counter
import { NotificationDisplay } from "../context/NotificationContext"; // Import Notifications

function Metaverse() {
    const { user } = useAuth();
    // 2. "Lift state up" - Manage video state here
    const [isVideoEnabled, setIsVideoEnabled] = useState(false);

    useEffect(() => {
        if (user && user.username) {
            const game = startGame(user.username);

            return () => {
                //if game already loadaed, destroy it on unmount
                if (window._phaserGame) {
                    window._phaserGame.destroy(true);
                    window._phaserGame = null;
                }
            };
        }
    }, [user]);

    // Dispatch event to Phaser when video state changes
    useEffect(() => {
        window.dispatchEvent(new CustomEvent('local-video-toggle', { detail: isVideoEnabled }));
    }, [isVideoEnabled]);

    return (
        <ChatProvider>
            <div className="app-root">
                <NotificationDisplay />
                <div id="game-container" className="game-container" />

                {/* Local Video handled by Phaser now */}

                <VideoGrid isVideoEnabled={isVideoEnabled} />

                {/* New Server Stats Widget */}
                <ServerStats />

                {/* Debug FPS Counter */}
                {/* <FPSCounter /> */}

                {/* Manual Zoom Controls */}
                <ZoomControls />

                {/* React Minimap Overlay */}
                <Minimap />


                {/* Meeting Room Modal */}
                <MeetingModal />

                {/* Computer UI Modal */}
                <ComputerModal />

                {/* 4. Pass the state and setter down to the controls */}
                <VoiceChat
                    isVideoEnabled={isVideoEnabled}
                    setIsVideoEnabled={setIsVideoEnabled}
                />

                <Sidebar />
            </div>
        </ChatProvider>
    );
}

export default Metaverse;