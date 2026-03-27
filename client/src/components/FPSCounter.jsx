import React, { useState, useEffect } from 'react';

const FPSCounter = () => {
    const [fps, setFps] = useState(0);

    useEffect(() => {
        let frameCount = 0;
        let lastTime = performance.now();
        let animationFrameId;

        const updateFps = () => {
            frameCount++;
            const currentTime = performance.now();

            // Update FPS every second
            if (currentTime - lastTime >= 1000) {
                setFps(Math.round((frameCount * 1000) / (currentTime - lastTime)));
                frameCount = 0;
                lastTime = currentTime;
            }

            animationFrameId = requestAnimationFrame(updateFps);
        };

        animationFrameId = requestAnimationFrame(updateFps);

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, []);

    const getColor = (fps) => {
        if (fps >= 55) return 'text-green-400';
        if (fps >= 30) return 'text-yellow-400';
        return 'text-red-500';
    };

    return (
        <div className="fixed top-4 right-4 z-[9999] bg-black/70 backdrop-blur-sm border border-white/10 px-3 py-1.5 rounded-lg shadow-lg pointer-events-none flex items-center justify-center gap-2 font-mono text-sm font-bold">
            <span className="text-gray-400">FPS</span>
            <span className={`${getColor(fps)} min-w-[3ch] text-right`}>{fps}</span>
        </div>
    );
};

export default FPSCounter;
