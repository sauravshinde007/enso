import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const ScheduleModal = ({ zone, onClose, onSuccess }) => {
    const { token } = useAuth();
    const [users, setUsers] = useState([]);
    const [startTime, setStartTime] = useState('');
    const [duration, setDuration] = useState('30');
    const [selectedParticipants, setSelectedParticipants] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const serverUrl = import.meta.env.VITE_SOCKET_SERVER_URL || 'http://localhost:3001';

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const res = await axios.get(`${serverUrl}/api/users`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setUsers(res.data || []);
            } catch (err) {
                console.error("Failed to fetch users", err);
            }
        };
        fetchUsers();
    }, [serverUrl, token]);

    const handleToggleUser = (userId) => {
        setSelectedParticipants(prev => 
            prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
        );
    };

    const handleSchedule = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        if (!startTime) {
            setError("Start time is required.");
            setLoading(false);
            return;
        }

        const start = new Date(startTime);
        if (start < new Date(Date.now() - 5 * 60 * 1000)) {
            setError("Start time cannot be in the past.");
            setLoading(false);
            return;
        }

        const end = new Date(start.getTime() + parseInt(duration) * 60000);

        try {
            await axios.post(`${serverUrl}/api/meeting/schedule`, {
                roomName: zone.zoneId,
                startTime: start.toISOString(),
                endTime: end.toISOString(),
                participantIds: selectedParticipants
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            window.dispatchEvent(new CustomEvent('meeting-scheduled')); // <-- ADDED EVENT TO UPDATE CALENDAR
            onSuccess();
        } catch (err) {
            setError(err.response?.data?.error || "Failed to schedule meeting.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 text-white pointer-events-auto">
            <div className="bg-gray-900 border border-white/10 p-6 rounded-2xl shadow-2xl w-full max-w-lg relative">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold">📅 Schedule Meeting in {zone.zoneName || zone.zoneId}</h2>
                    <button onClick={onClose} type="button" className="p-2 hover:bg-white/10 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {error && <div className="bg-red-500/20 text-red-200 p-3 rounded-lg mb-4 text-sm border border-red-500/30">{error}</div>}

                <form onSubmit={handleSchedule} className="flex flex-col gap-4">
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="block text-sm text-gray-400 mb-1">Start Time</label>
                            <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500" required />
                        </div>
                        <div className="flex-1">
                            <label className="block text-sm text-gray-400 mb-1">Duration</label>
                            <select value={duration} onChange={(e) => setDuration(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500" required>
                                <option value="15">15 Minutes</option>
                                <option value="30">30 Minutes</option>
                                <option value="45">45 Minutes</option>
                                <option value="60">1 Hour</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-2">Invite Participants</label>
                        <div className="max-h-48 overflow-y-auto bg-gray-800/50 border border-gray-700 rounded-xl p-2 flex flex-col gap-1">
                            {users.map(u => (
                                <label key={u._id} className="flex items-center gap-3 p-2 hover:bg-gray-700/50 rounded-lg cursor-pointer transition-colors">
                                    <input 
                                        type="checkbox" 
                                        checked={selectedParticipants.includes(u._id)}
                                        onChange={() => handleToggleUser(u._id)}
                                        className="w-4 h-4 rounded text-cyan-500 focus:ring-cyan-500 bg-gray-700 border-gray-600 cursor-pointer pointer-events-auto"
                                    />
                                    <div className="flex-1 flex justify-between items-center">
                                        <span className="font-medium">{u.username}</span>
                                        <span className="text-xs text-gray-400 uppercase tracking-wider">{u.role}</span>
                                    </div>
                                </label>
                            ))}
                            {users.length === 0 && <div className="text-gray-500 text-center py-4 text-sm">No users found</div>}
                        </div>
                    </div>

                    <button type="submit" disabled={loading}
                        className="w-full mt-2 px-6 py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl transition-colors disabled:opacity-50">
                        {loading ? 'Scheduling...' : 'Reserve Room & Send Invites'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default ScheduleModal;
