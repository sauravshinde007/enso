import { useState, useEffect } from "react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { X, Shield, ShieldCheck, User as UserIcon } from "lucide-react";

const ROLES = ['employee', 'admin', 'hr', 'ceo'];

export default function AdminPanel({ isOpen, onClose }) {
    const { user, token } = useAuth();
    const [users, setUsers] = useState([]);
    const [computers, setComputers] = useState([]); // All computer IDs
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (isOpen && user?.role === 'admin') {
            fetchUsers();
            fetchComputers();
        }
    }, [isOpen, user]);

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const response = await axios.get(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/users/all`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setUsers(response.data);
            setError(null);
        } catch (err) {
            console.error("Failed to fetch users", err);
            setError("Failed to load users");
        } finally {
            setLoading(false);
        }
    };

    const fetchComputers = async () => {
        try {
            const res = await axios.get('/assets/map/map2.tmj');
            const mapData = res.data;
            const interactablesLayer = mapData.layers.find(l => l.name === 'Interactables');
            
            if (interactablesLayer && interactablesLayer.objects) {
                const computerObjects = interactablesLayer.objects.filter(obj => {
                    const typeProp = obj.properties && obj.properties.find(p => p.name === 'type');
                    const compType = typeProp ? typeProp.value : obj.name;
                    return compType && compType.toLowerCase() === 'computer';
                });

                const compIds = computerObjects.map(obj => {
                    const idProp = obj.properties && obj.properties.find(p => p.name === 'id');
                    const baseId = idProp ? idProp.value : obj.id;
                    return baseId ? String(baseId) : `computer_${obj.x}_${obj.y}`;
                });
                
                setComputers(compIds);
            }
        } catch (err) {
            console.error("Failed to load map data", err);
        }
    };

    const handleRoleChange = async (userId, newRole) => {
        try {
            const response = await axios.put(
                `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/users/${userId}/role`,
                { role: newRole },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            // Update local state
            setUsers(prev => prev.map(u =>
                u._id === userId ? { ...u, role: newRole } : u
            ));

            // If updating self, alert user they might need to rejoin to see effects
            if (userId === user.id || userId === user._id) {
                alert("You updated your own role. Please rejoin/refresh to apply changes.");
            }

        } catch (err) {
            console.error("Failed to update role", err);
            alert("Failed to update role");
        }
    };

    const handleComputerChange = async (userId, newComputerId) => {
        try {
            const response = await axios.put(
                `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/users/${userId}/computer`,
                { computerId: newComputerId.trim() || null },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            // Update local state
            setUsers(prev => prev.map(u =>
                u._id === userId ? { ...u, assignedComputerId: newComputerId.trim() || null } : u
            ));

            if (userId === user.id || userId === user._id) {
                alert("You updated your own desk. Please refresh the page to sync changes!");
            }
        } catch (err) {
            console.error("Failed to assign computer", err);
            const msg = err.response && err.response.data && err.response.data.message 
                ? err.response.data.message 
                : "Failed to assign computer";
            alert(msg);
            
            // Re-fetch users to revert UI to source of truth
            fetchUsers();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-[#1a1a1a] w-full max-w-2xl rounded-xl border border-[#333] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-[#333] bg-[#111]">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="text-green-500 w-6 h-6" />
                        <h2 className="text-xl font-bold text-white">Admin Panel</h2>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1">
                    {loading ? (
                        <div className="text-center text-gray-400 py-8">Loading users...</div>
                    ) : error ? (
                        <div className="text-center text-red-400 py-8">{error}</div>
                    ) : (
                        <div className="space-y-4">
                            <div className="grid grid-cols-12 gap-4 text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 px-2">
                                <div className="col-span-3">User</div>
                                <div className="col-span-4">Email</div>
                                <div className="col-span-2">Role</div>
                                <div className="col-span-3">Assigned Desk</div>
                            </div>

                            {(() => {
                                const globallyAssignedIds = new Set(users.map(u => String(u.assignedComputerId)).filter(id => id !== "null" && id !== "undefined"));

                                return users.map((u) => {
                                    const userDesk = String(u.assignedComputerId || "");
                                    const availableComputers = computers.filter(cId => !globallyAssignedIds.has(String(cId)) || String(cId) === userDesk);

                                    return (
                                        <div key={u._id} className="grid grid-cols-12 gap-4 items-center bg-[#222] p-3 rounded-lg border border-[#333] hover:border-[#444] transition-all">

                                    {/* User Info */}
                                    <div className="col-span-3 flex items-center gap-3">
                                        <div className="w-8 h-8 flex-shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm overflow-hidden">
                                            {u.avatar ? (
                                                <img
                                                    src={u.avatar}
                                                    alt={u.username}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                u.username.charAt(0).toUpperCase()
                                            )}
                                        </div>
                                        <span className="text-gray-200 font-medium truncate">{u.username}</span>
                                    </div>

                                    {/* Email */}
                                    <div className="col-span-4 text-gray-400 text-sm truncate">
                                        {u.email}
                                    </div>

                                    {/* Role Selector */}
                                    <div className="col-span-2">
                                        <div className="relative">
                                            <select
                                                value={u.role}
                                                onChange={(e) => handleRoleChange(u._id, e.target.value)}
                                                className={`w-full bg-[#111] border border-[#444] text-xs rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 appearance-none cursor-pointer
                          ${u.role === 'admin' ? 'text-green-400 font-bold' :
                                                        u.role === 'ceo' ? 'text-purple-400 font-bold' :
                                                            u.role === 'hr' ? 'text-yellow-400' : 'text-gray-300'}
                        `}
                                            >
                                                {ROLES.map(role => (
                                                    <option key={role} value={role}>{role.toUpperCase()}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Desk Assignment */}
                                    <div className="col-span-3">
                                        <div className="relative">
                                            <select
                                                value={userDesk}
                                                onChange={(e) => {
                                                    if (e.target.value !== userDesk) {
                                                        handleComputerChange(u._id, e.target.value);
                                                    }
                                                }}
                                                className="w-full bg-[#111] border border-[#444] text-xs rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 appearance-none cursor-pointer text-gray-200"
                                            >
                                                <option value="">Unassigned</option>
                                                {availableComputers.map(cId => (
                                                    <option key={cId} value={cId}>
                                                        Desk {cId}
                                                    </option>
                                                ))}
                                                {/* Fallback if their current desk isn't in the map file for some reason */}
                                                {userDesk && !availableComputers.includes(userDesk) && (
                                                    <option value={userDesk} disabled>Desk {userDesk} (Not Found)</option>
                                                )}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                    );
                                });
                            })()}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
