import React from 'react';
import { Plus, Minus, Home } from 'lucide-react';
import '../styles/zoomcontrols.css';

export default function ZoomControls() {
    const handleZoomIn = () => {
        // Dispatch custom event that Phaser scene will listen to
        window.dispatchEvent(new CustomEvent('zoom-in'));
    };

    const handleZoomOut = () => {
        window.dispatchEvent(new CustomEvent('zoom-out'));
    };

    const handleWalkToDesk = () => {
        window.dispatchEvent(new CustomEvent('walk-to-desk'));
    };

    return (
        <div className="zoom-controls-container">
            <button className="zoom-button" onClick={handleWalkToDesk} title="Walk to My Desk">
                <Home size={20} />
            </button>
            <button className="zoom-button" onClick={handleZoomIn} title="Zoom In">
                <Plus size={20} />
            </button>
            <button className="zoom-button" onClick={handleZoomOut} title="Zoom Out">
                <Minus size={20} />
            </button>
        </div>
    );
}
