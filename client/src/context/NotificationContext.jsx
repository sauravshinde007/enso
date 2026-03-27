import { createContext, useContext, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const NotificationContext = createContext();

export const NotificationProvider = ({ children }) => {
    const [notifications, setNotifications] = useState([]);

    const addNotification = useCallback((message, type = 'info', duration = 4000) => {
        const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        setNotifications((prev) => [...prev, { id, message, type, duration }]);

        // Sound Logic
        try {
            const soundFile = type === 'reminder'
                ? '/assets/sounds/reminder.wav'
                : '/assets/sounds/message-popup.wav';

            const audio = new Audio(soundFile);
            audio.volume = 0.5; // Reasonable volume
            audio.play().catch(e => console.warn("Audio play failed (user interaction needed likely):", e));
        } catch (err) {
            console.error("Sound error:", err);
        }

        setTimeout(() => {
            removeNotification(id);
        }, duration);
    }, []);

    const removeNotification = useCallback((id) => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, []);

    return (
        <NotificationContext.Provider value={{ addNotification, removeNotification, notifications }}>
            {children}
        </NotificationContext.Provider>
    );
};

export const NotificationDisplay = () => {
    const { notifications, removeNotification } = useNotification();
    
    return (
        <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none">
            <AnimatePresence mode='popLayout'>
                {notifications.map((notif) => (
                    <NotificationItem key={notif.id} {...notif} onClose={() => removeNotification(notif.id)} />
                ))}
            </AnimatePresence>
        </div>
    );
};

const NotificationItem = ({ type, message, onClose }) => {
    // Theme colors for accent border
    const accentColor =
        type === 'success' ? '#22c55e' : // Green-500
            type === 'error' ? '#ef4444' :   // Red-500
                type === 'warning' ? '#f59e0b' : // Amber-500
                    type === 'reminder' ? '#a855f7' : // Purple-500 for reminders
                        '#3b82f6';                       // Blue-500

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.8, y: -20, rotateX: 90 }}
            animate={{ opacity: 1, scale: 1, y: 0, rotateX: 0 }}
            exit={{ opacity: 0, scale: 0.9, x: 100, transition: { duration: 0.2 } }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            style={{ borderLeft: `6px solid ${accentColor}` }}
            className={`
        pointer-events-auto
        relative
        flex w-full items-start gap-3
        overflow-hidden rounded-md
        bg-[#1e1e24] 
        p-3 shadow-2xl shadow-black/50
        min-w-[280px] max-w-sm
        font-sans
      `}
        >
            {/* Dynamic Background Gradient Glow */}
            <div
                className="absolute -right-10 -top-10 h-24 w-24 rounded-full opacity-10 blur-2xl"
                style={{ backgroundColor: accentColor }}
            />

            <div className="flex-1 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                        Metaverse
                    </span>
                    <span className="text-[10px] text-zinc-600 select-none">{time}</span>
                </div>

                <p className="text-sm font-medium leading-snug text-white/95 drop-shadow-sm pr-4">
                    {message}
                </p>
            </div>

            {/* Close 'X' */}
            <button
                onClick={onClose}
                className="absolute top-2 right-2 p-1 text-zinc-600 hover:text-zinc-300 transition-colors"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>

        </motion.div>
    );
};

export const useNotification = () => useContext(NotificationContext);
