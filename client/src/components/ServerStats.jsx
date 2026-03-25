import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Users, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import socketService from '../services/socketService';
import { motion, AnimatePresence } from 'framer-motion';

export default function ServerStats() {
    const { token, user } = useAuth();
    const [allUsers, setAllUsers] = useState([]);
    const [onlineUsers, setOnlineUsers] = useState({});
    const [isOpen, setIsOpen] = useState(false);
    const serverUrl = import.meta.env.VITE_SOCKET_SERVER_URL;

    // 1. Fetch All Users (Directory)
    useEffect(() => {
        const fetchAllUsers = async () => {
            try {
                const res = await axios.get(`${serverUrl}/api/users`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                // API returns everyone EXCEPT current user. So we add current user manually if defined.
                const list = res.data || [];
                // Check if current user is already in list (just in case)
                if (user && !list.find(u => u.username === user.username)) {
                    list.push({
                        _id: user.userId || user._id,
                        username: user.username,
                        avatar: user.avatar,
                        role: user.role
                    });
                }
                setAllUsers(list);
            } catch (err) {
                console.error("Stats fetch error", err);
            }
        };
        if (token && user) fetchAllUsers();
    }, [token, user]);

    // 2. Track Online Users via Socket
    useEffect(() => {
        // Initialize immediately to catch any players that joined before mount
        setOnlineUsers(socketService.getGlobalPlayers() || {});

        const onPlayers = (players) => {
            setOnlineUsers(players);
        };
        const onPlayerJoined = (player) => {
            setOnlineUsers(prev => ({ ...prev, [player.id]: player }));
        };
        const onPlayerLeft = (id) => {
            setOnlineUsers(prev => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
        };

        socketService.on('players', onPlayers);
        socketService.on('playerJoined', onPlayerJoined);
        socketService.on('playerLeft', onPlayerLeft);

        return () => {
            socketService.off('players', onPlayers);
            socketService.off('playerJoined', onPlayerJoined);
            socketService.off('playerLeft', onPlayerLeft);
        };
    }, []);

    // 3. Compute Display List
    const displayList = useMemo(() => {
        const onlineUsernames = new Set(Object.values(onlineUsers).map(u => u.username));
        // Add current user to online set explicitly
        if (user) onlineUsernames.add(user.username);

        // Create a Map of unique users by username to merge API list and Online list
        const uniqueUsers = new Map();

        // 1. Add all API users
        allUsers.forEach(u => {
            uniqueUsers.set(u.username, { ...u, isOnline: onlineUsernames.has(u.username) });
        });

        // 2. Add any online users that are missing from API list (e.g. joined after fetch)
        Object.values(onlineUsers).forEach(u => {
            if (!uniqueUsers.has(u.username)) {
                uniqueUsers.set(u.username, {
                    _id: u.id || u._id,
                    username: u.username,
                    avatar: u.avatar || null,
                    role: u.role || 'guest',
                    isOnline: true
                });
            }
        });

        // 3. Ensure current user is in list
        if (user && !uniqueUsers.has(user.username)) {
            uniqueUsers.set(user.username, {
                _id: user.userId || user._id,
                username: user.username,
                avatar: user.avatar,
                role: user.role,
                isOnline: true
            });
        }

        const mapped = Array.from(uniqueUsers.values());

        // Sort: Current User -> Online -> Offline -> Alphabetical
        return mapped.sort((a, b) => {
            if (user && a.username === user.username) return -1;
            if (user && b.username === user.username) return 1;

            if (a.isOnline === b.isOnline) return a.username.localeCompare(b.username);
            return a.isOnline ? -1 : 1;
        });
    }, [allUsers, onlineUsers, user]);

    const onlineCount = displayList.filter(u => u.isOnline).length;
    const totalCount = displayList.length;

    // Helper: Get initials
    const getInitials = (name) => name ? name.charAt(0).toUpperCase() : '?';

    return (
        <>
            {/* Widget Button */}
            <div
                className="fixed top-4 right-4 z-[150] flex flex-col items-end gap-2 pointer-events-auto"
            >
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex items-center gap-3 bg-black/60 backdrop-blur-md border border-zinc-700/50 rounded-full px-4 py-2 hover:bg-zinc-800/80 transition-all shadow-lg group"
                >
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Users size={18} className="text-zinc-300" />
                            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                            </span>
                        </div>
                        <div className="flex flex-col items-start leading-none gap-0.5">
                            <span className="text-xs font-bold text-white uppercase tracking-wider">Metaverse</span>
                            <span className="text-[10px] text-zinc-400 font-mono">
                                {onlineCount} Online / {totalCount} Total
                            </span>
                        </div>
                    </div>
                </button>
            </div>

            {/* Expanded List Panel */}
            <AnimatePresence>
                {isOpen && (
                    <div className="fixed inset-0 z-[2000] flex justify-end p-4 pointer-events-none">
                        {/* Backdrop for mobile */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsOpen(false)}
                            className="absolute inset-0 bg-black/20 backdrop-blur-[1px] md:hidden pointer-events-auto"
                        />

                        <motion.div
                            initial={{ x: 20, opacity: 0, scale: 0.95 }}
                            animate={{ x: 0, opacity: 1, scale: 1 }}
                            exit={{ x: 20, opacity: 0, scale: 0.95 }}
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                            className="bg-[#0f0f11] border border-zinc-800 w-72 h-[calc(100vh-2rem)] rounded-2xl shadow-2xl flex flex-col overflow-hidden pointer-events-auto mt-0"
                        >
                            {/* Header */}
                            <div className="p-4 border-b border-zinc-800/50 flex justify-between items-center bg-zinc-900/50">
                                <h3 className="font-bold text-white flex items-center gap-2">
                                    <Users size={16} /> Members
                                </h3>
                                <button onClick={() => setIsOpen(false)} className="text-zinc-500 hover:text-white transition">
                                    <X size={18} />
                                </button>
                            </div>

                            {/* List */}
                            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                                <div className="space-y-1">
                                    {displayList.map((u) => (
                                        <div
                                            key={u.username}
                                            className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${u.isOnline ? 'bg-zinc-800/40 hover:bg-zinc-800' : 'hover:bg-zinc-800/30 opacity-60'}`}
                                        >
                                            {/* Avatar */}
                                            <div className="relative">
                                                <div className="h-9 w-9 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/50 shrink-0">
                                                    {u.avatar ? (
                                                        <img src={u.avatar} alt={u.username} className="h-full w-full object-cover" />
                                                    ) : (
                                                        <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-indigo-500/20 to-purple-500/20 text-xs font-bold text-zinc-300">
                                                            {getInitials(u.username)}
                                                        </div>
                                                    )}
                                                </div>
                                                {/* Status Dot */}
                                                <div className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#0f0f11] ${u.isOnline ? 'bg-emerald-500' : 'bg-zinc-500'}`} />
                                            </div>

                                            {/* Info */}
                                            <div className="flex flex-col min-w-0">
                                                <span className={`text-sm font-medium truncate ${u.isOnline ? 'text-white' : 'text-zinc-400'}`}>
                                                    {user?.username === u.username ? `You (${u.username})` : u.username}
                                                </span>
                                                <span className="text-[10px] uppercase tracking-wide text-zinc-500 truncate">
                                                    {u.role || 'Member'}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Footer Stats */}
                            <div className="p-3 bg-zinc-900/80 border-t border-zinc-800 text-[10px] text-zinc-500 text-center font-mono uppercase">
                                {onlineCount} Online &bull; {totalCount} Members
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </>
    );
}
