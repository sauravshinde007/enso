import React, { useEffect, useState, useRef } from 'react';
import { PROXIMITY_RADIUS } from '../config/proximity';

export default function Minimap() {
    const [mapDim, setMapDim] = useState({ width: 0, height: 0 });
    const [positions, setPositions] = useState(null);
    const canvasRef = useRef(null);

    // 1. Listen for Map Initialization (Dimensions)
    useEffect(() => {
        const handleInit = (e) => {
            setMapDim(e.detail);
        };
        window.addEventListener('map-init', handleInit);
        return () => window.removeEventListener('map-init', handleInit);
    }, []);

    // 2. Listen for Realtime Updates
    useEffect(() => {
        const handleUpdate = (e) => {
            setPositions(e.detail);
        };
        window.addEventListener('minimap-update', handleUpdate);
        return () => window.removeEventListener('minimap-update', handleUpdate);
    }, []);

    // 3. Draw Loop
    useEffect(() => {
        if (!positions || !mapDim.width || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const size = 160; // Size of the box
        const dpr = window.devicePixelRatio || 1;

        // Reset transform to avoid accumulation
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Scale fitting logic
        const scaleX = size / mapDim.width;
        const scaleY = size / mapDim.height;
        const scale = Math.min(scaleX, scaleY);

        // Center within square
        const offsetX = (size - mapDim.width * scale) / 2;
        const offsetY = (size - mapDim.height * scale) / 2;

        const project = (x, y) => ({
            x: (offsetX + x * scale) * dpr,
            y: (offsetY + y * scale) * dpr
        });

        // Background
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.beginPath();
        ctx.roundRect(0, 0, size * dpr, size * dpr, 12 * dpr);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();

        // Dots
        // Others (White)
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        positions.others.forEach(p => {
            const pos = project(p.x, p.y);
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 2.5 * dpr, 0, Math.PI * 2);
            ctx.fill();
        });

        // Me (Green)
        const myPos = project(positions.me.x, positions.me.y);
        ctx.fillStyle = "#22c55e";
        ctx.beginPath();
        ctx.arc(myPos.x, myPos.y, 4 * dpr, 0, Math.PI * 2);
        ctx.fill();

        // Proximity (Green Halo)
        // proximity world radius -> scale -> dpr
        const rad = PROXIMITY_RADIUS * scale * dpr;
        ctx.strokeStyle = "rgba(34, 197, 94, 0.4)";
        ctx.setLineDash([4 * dpr, 4 * dpr]); // Dotted
        ctx.beginPath();
        ctx.arc(myPos.x, myPos.y, rad, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]); // Reset

    }, [positions, mapDim]);

    if (!mapDim.width) return null; // Don't render until map is ready

    return (
        <div style={{
            position: 'fixed',
            bottom: '20px',
            left: '80px', // Right of Sidebar
            width: '160px',
            height: '160px',
            zIndex: 90, // Above game, below modals
            pointerEvents: 'none' // Click through
        }}>
            <canvas
                ref={canvasRef}
                width={160 * (window.devicePixelRatio || 1)}
                height={160 * (window.devicePixelRatio || 1)}
                style={{ width: '100%', height: '100%' }}
            />
        </div>
    );
}
