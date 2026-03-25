import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { X, User, CreditCard, Users, Building, FileText, Bell, Settings, Mail, Lock, Search, Plus, Eye, EyeOff, Video, Clock, Calendar } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";

export default function UserSettingsModal({ isOpen, onClose, onNotificationsViewed, unseenCount = 0 }) {
    const { user, token, setUser } = useAuth();
    const [activeTab, setActiveTab] = useState("account");

    // Meetings State
    const [meetingsHistory, setMeetingsHistory] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [viewMomContent, setViewMomContent] = useState(null);
    const [viewTranscriptContent, setViewTranscriptContent] = useState(null);

    // Notifications State
    const [upcomingMeetings, setUpcomingMeetings] = useState([]);
    const [loadingUpcoming, setLoadingUpcoming] = useState(false);

    // Account State
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);

    const [currentAvatarUrl, setCurrentAvatarUrl] = useState("");
    const [selectedFile, setSelectedFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState("");

    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [success, setSuccess] = useState(false);
    const [loading, setLoading] = useState(false);
    const fileInputRef = useRef(null);

    const serverUrl = import.meta.env.VITE_SOCKET_SERVER_URL;

    useEffect(() => {
        if (isOpen && user) {
            // Split username into first and last name if possible
            const names = (user.username || "").split(" ");
            setFirstName(names[0] || "");
            setLastName(names.slice(1).join(" ") || "");

            setEmail(user.email || "");
            setCurrentAvatarUrl(user.avatar || "");
            setPreviewUrl("");
            setSelectedFile(null);
            setMessage("");
            setError("");
            setSuccess(false); // Reset success state
            setCurrentPassword("");
            setNewPassword("");
        }
    }, [user, isOpen]);

    useEffect(() => {
        let interval;
        if (activeTab === 'meetings' && isOpen) {
            const fetchHistory = async () => {
                try {
                    const res = await axios.get(`${serverUrl}/api/meeting/history`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    setMeetingsHistory(res.data.history || []);
                } catch (e) {
                    if (e.response && e.response.status === 401) {
                        console.warn("Session expired on meetings history fetch");
                        // Optional: could call logout() here if imported
                    } else {
                        console.error("Failed to load meetings history:", e);
                    }
                } finally {
                    setLoadingHistory(false);
                }
            };
            setLoadingHistory(true);
            fetchHistory();

            interval = setInterval(() => {
                fetchHistory(); // Poll every 5s for MOM status updates
            }, 5000);
        } else if (activeTab === 'notifications' && isOpen) {
            const fetchNotifications = async () => {
                try {
                    const res = await axios.get(`${serverUrl}/api/meeting/notifications`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    setUpcomingMeetings(res.data.notifications || []);
                    
                    // If there are unseen notifications, mark them seen
                    const hasUnseen = res.data.notifications.some(n => !n.seen);
                    if (hasUnseen) {
                        await axios.post(`${serverUrl}/api/meeting/notifications/mark-seen`, {}, {
                            headers: { Authorization: `Bearer ${token}` }
                        });
                        if (onNotificationsViewed) onNotificationsViewed();
                    }
                } catch (e) {
                    console.error("Failed to load notifications:", e);
                } finally {
                    setLoadingUpcoming(false);
                }
            };
            setLoadingUpcoming(true);
            fetchNotifications();

            // Just fetch once when tab is opened, no need to over-poll in settings since it's history
        }
        return () => {
            if (interval) clearInterval(interval);
            setViewMomContent(null);
            setViewTranscriptContent(null);
        };
    }, [activeTab, serverUrl, token, isOpen, onNotificationsViewed]);

    const handleGenerateMOM = async (recordId) => {
        try {
            setMeetingsHistory(prev => prev.map(m => m._id === recordId ? { ...m, momStatus: 'Generating' } : m));
            await axios.post(`${serverUrl}/api/meeting/${recordId}/generate-mom`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (e) {
            console.error("Failed to start MOM generation:", e);
            alert(e.response?.data?.error || "Failed to start MOM generation");
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 15 * 1024 * 1024) {
                setError("File size should be less than 15MB");
                return;
            }
            setSelectedFile(file);
            setPreviewUrl(URL.createObjectURL(file));
            setError("");
        }
    };

    const handleDeleteAvatar = () => {
        setPreviewUrl("");
        setSelectedFile(null);
        setCurrentAvatarUrl("");
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setMessage("");
        setSuccess(false); // Reset success state
        setLoading(true);

        try {
            const formData = new FormData();
            const fullName = `${firstName} ${lastName}`.trim() || firstName;
            formData.append("username", fullName);
            formData.append("email", email);
            if (selectedFile) {
                formData.append("avatar", selectedFile);
            }

            if (currentPassword && newPassword) {
                formData.append("currentPassword", currentPassword);
                formData.append("newPassword", newPassword);
            }

            const response = await axios.put(
                `${serverUrl}/api/users/update-profile`,
                formData,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "multipart/form-data"
                    }
                }
            );

            const updatedUser = { ...user, ...response.data.user };
            setUser(updatedUser);
            localStorage.setItem("user", JSON.stringify(updatedUser)); // Persist update

            setMessage("Profile updated successfully!");
            setSuccess(true); // Set success state

            if (response.data.user.avatar) {
                setCurrentAvatarUrl(response.data.user.avatar);
                setPreviewUrl("");
                setSelectedFile(null);
            }

            setTimeout(() => {
                onClose();
            }, 1500);

        } catch (err) {
            console.error(err);
            setError(err.response?.data?.message || "Failed to update profile.");
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const NAVIGATION = {
        GENERAL: [
            { id: 'account', label: 'Account', icon: User },
            { id: 'meetings', label: 'Meetings', icon: Video }
        ],
        SYSTEM: [
            { id: 'notifications', label: 'Notifications', icon: Bell },
            { id: 'preferences', label: 'Preferences', icon: Settings }
        ]
    };

    const renderNavigationItem = (item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;
        return (
            <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive
                    ? 'bg-[#e7f5f0] text-[#136c50] shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`}
            >
                <div className="flex items-center gap-3">
                    <Icon size={18} className={isActive ? "text-[#136c50]" : "text-gray-400"} />
                    {item.label}
                </div>
                {item.id === 'notifications' && unseenCount > 0 && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                        {unseenCount}
                    </span>
                )}
            </button>
        );
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[2000] flex bg-white"
                >
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ duration: 0.2 }}
                        className="w-full h-full bg-white flex flex-col overflow-hidden"
                    >
                        {/* Top Navbar */}
                        <div className="flex items-center bg-[#f8f9fa] justify-between px-6 py-4 border-b border-gray-200">
                            <div className="flex items-center gap-4">
                                <button onClick={onClose} className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-colors shadow-sm">
                                    <X size={18} />
                                </button>
                                <h1 className="text-lg font-medium text-gray-800">Settings</h1>
                            </div>

                            {/* Expand icon placeholder */}
                        </div>

                        {/* Main Content Area */}
                        <div className="flex flex-1 overflow-hidden">

                            {/* Left Sidebar */}
                            <div className="w-64 border-r border-gray-200 bg-[#f8f9fa] flex flex-col px-3 py-6 overflow-y-auto">
                                <div className="mb-6">
                                    <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-4">General</h3>
                                    <div className="space-y-0.5">
                                        {NAVIGATION.GENERAL.map(renderNavigationItem)}
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-4">System</h3>
                                    <div className="space-y-0.5">
                                        {NAVIGATION.SYSTEM.map(renderNavigationItem)}
                                    </div>
                                </div>
                            </div>

                            {/* Right Content */}
                            <div className="flex-1 overflow-y-auto custom-scrollbar bg-white">
                                {/* Header Search Bar Inside Right Content */}
                                <div className="px-10 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
                                    <div className="relative max-w-2xl mx-auto md:mx-0 w-full">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                        <input
                                            type="text"
                                            placeholder="Search"
                                            className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-10 pr-4 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#136c50] focus:border-[#136c50]"
                                        />
                                    </div>
                                </div>

                                <div className="p-10 max-w-3xl">
                                    {activeTab === 'account' ? (
                                        <>
                                            <div className="mb-8">
                                                <h2 className="text-[16px] font-bold text-gray-900 mb-1">Account</h2>
                                                <p className="text-[13px] text-gray-500">Real-time information and activities of your property.</p>
                                            </div>

                                            <form onSubmit={handleSubmit} className="space-y-8">
                                                {/* Profile Picture */}
                                                <div className="flex items-center justify-between py-6 border-y border-gray-100">
                                                    <div className="flex items-center gap-6">
                                                        <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center overflow-hidden">
                                                            {previewUrl ? (
                                                                <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                                                            ) : currentAvatarUrl ? (
                                                                <img src={currentAvatarUrl} alt="Profile" className="w-full h-full object-cover" />
                                                            ) : (
                                                                <img src="https://i.pravatar.cc/150?u=a042581f4e29026704d" alt="Profile" className="w-full h-full object-cover" />
                                                            )}
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-semibold text-gray-900">Profile picture</h3>
                                                            <p className="text-[13px] text-gray-500 mt-0.5">PNG, JPEG under 15MB</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2 flex-wrap justify-end">
                                                        <button
                                                            type="button"
                                                            onClick={() => fileInputRef.current?.click()}
                                                            className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors bg-white shadow-sm"
                                                        >
                                                            Upload new picture
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={handleDeleteAvatar}
                                                            className="px-3 py-1.5 text-[13px] font-medium text-gray-600 hover:text-gray-900 border border-transparent hover:border-gray-200 hover:bg-gray-50 rounded-lg transition-colors"
                                                        >
                                                            Delete
                                                        </button>
                                                        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
                                                    </div>
                                                </div>

                                                {/* Full Name */}
                                                <div className="py-2 border-b border-gray-100 pb-8">
                                                    <h3 className="text-sm font-semibold text-gray-900 mb-4">Full name</h3>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                        <div className="space-y-1.5">
                                                            <label className="text-[12px] font-medium text-gray-600">First name</label>
                                                            <input
                                                                type="text"
                                                                value={firstName}
                                                                onChange={(e) => setFirstName(e.target.value)}
                                                                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-[#136c50] focus:border-[#136c50]"
                                                            />
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            <label className="text-[12px] font-medium text-gray-600">Last name</label>
                                                            <input
                                                                type="text"
                                                                value={lastName}
                                                                onChange={(e) => setLastName(e.target.value)}
                                                                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-[#136c50] focus:border-[#136c50]"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Contact Email */}
                                                <div className="py-2 border-b border-gray-100 pb-8">
                                                    <div className="mb-4">
                                                        <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Contact email</h3>
                                                        <p className="text-[13px] text-gray-500">Manage your accounts email address for the invoices.</p>
                                                    </div>
                                                    <div className="flex flex-col sm:flex-row gap-4 items-end">
                                                        <div className="space-y-1.5 flex-[2] w-full">
                                                            <label className="text-[12px] font-medium text-gray-600">Email</label>
                                                            <div className="relative">
                                                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                                                <input
                                                                    type="email"
                                                                    value={email}
                                                                    onChange={(e) => setEmail(e.target.value)}
                                                                    className="w-full bg-white border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-[#136c50] focus:border-[#136c50]"
                                                                />
                                                            </div>
                                                        </div>
                                                        <button type="button" className="flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-[13px] font-medium text-[#136c50] border border-gray-200 bg-white shadow-sm rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap h-[38px]">
                                                            <Plus size={16} className="text-[#136c50]" />
                                                            Add another email
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Password */}
                                                <div className="py-2 border-b border-gray-100 pb-8">
                                                    <div className="mb-4">
                                                        <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Password</h3>
                                                        <p className="text-[13px] text-gray-500">Modify your current password.</p>
                                                    </div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                        <div className="space-y-1.5">
                                                            <label className="text-[12px] font-medium text-gray-600">Current password</label>
                                                            <div className="relative">
                                                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                                                <input
                                                                    type={showCurrentPassword ? "text" : "password"}
                                                                    value={currentPassword}
                                                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                                                    placeholder="••••••••••••"
                                                                    className="w-full bg-white border border-gray-200 rounded-lg pl-9 pr-9 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-[#136c50] focus:border-[#136c50]"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                                                >
                                                                    {showCurrentPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            <label className="text-[12px] font-medium text-gray-600">New password</label>
                                                            <div className="relative">
                                                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                                                <input
                                                                    type={showNewPassword ? "text" : "password"}
                                                                    value={newPassword}
                                                                    onChange={(e) => setNewPassword(e.target.value)}
                                                                    placeholder="••••••••••••"
                                                                    className="w-full bg-white border border-gray-200 rounded-lg pl-9 pr-9 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-[#136c50] focus:border-[#136c50]"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setShowNewPassword(!showNewPassword)}
                                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                                                >
                                                                    {showNewPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Integrated account */}
                                                <div className="py-2 mb-4">
                                                    <div className="mb-4">
                                                        <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Integrated account</h3>
                                                        <p className="text-[13px] text-gray-500">Manage your current integrated accounts.</p>
                                                    </div>
                                                    <div className="space-y-3">
                                                        <div className="flex items-center justify-between p-3.5 border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-8 h-8 rounded-lg flex items-center justify-center">
                                                                    {/* Simple logo placeholder for google analytics */}
                                                                    <div className="flex items-end gap-[2px] h-4">
                                                                        <div className="w-1.5 h-2 bg-yellow-400 rounded-sm"></div>
                                                                        <div className="w-1.5 h-3 bg-red-400 rounded-sm"></div>
                                                                        <div className="w-1.5 h-4 bg-orange-400 rounded-sm"></div>
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <h4 className="text-[13px] font-bold text-gray-900">Google analytics</h4>
                                                                    <p className="text-[12px] text-gray-500 mt-0.5">Navigate the Google Analytics interface and reports.</p>
                                                                </div>
                                                            </div>
                                                            <button type="button" className="px-3 py-1 text-[12px] font-semibold text-[#136c50] bg-white border border-gray-200 shadow-sm rounded-lg hover:bg-gray-50">
                                                                Connected
                                                            </button>
                                                        </div>

                                                        <div className="flex items-center justify-between p-3.5 border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-8 h-8 rounded-lg flex items-center justify-center">
                                                                    <div className="w-5 h-5 rounded-full border-2 border-red-500 border-t-yellow-400 border-r-green-500 border-b-blue-500"></div>
                                                                </div>
                                                                <div>
                                                                    <h4 className="text-[13px] font-bold text-gray-900">Google analytics</h4>
                                                                    <p className="text-[12px] text-gray-500 mt-0.5">Navigate the Google Analytics interface and reports.</p>
                                                                </div>
                                                            </div>
                                                            <button type="button" className="px-3 py-1 text-[12px] font-semibold text-[#136c50] bg-white border border-gray-200 shadow-sm rounded-lg hover:bg-gray-50">
                                                                Connected
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Messages */}
                                                {error && <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg">{error}</div>}
                                                {message && <div className="p-3 text-sm text-[#136c50] bg-[#e7f5f0] border border-[#aae0cb] rounded-lg">{message}</div>}

                                                {/* Bottom Actions */}
                                                <div className="pt-6 flex justify-end gap-3 sticky bottom-0 bg-white pb-4">
                                                    <button
                                                        type="button"
                                                        onClick={onClose}
                                                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 shadow-sm transition-colors"
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        type="submit"
                                                        disabled={loading}
                                                        className="px-4 py-2 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-800 disabled:opacity-50 shadow-sm transition-colors"
                                                    >
                                                        {loading ? "Saving..." : "Save changes"}
                                                    </button>
                                                </div>

                                            </form>
                                        </>
                                    ) : activeTab === 'meetings' ? (
                                        <div className="mb-8">
                                            <h2 className="text-[16px] font-bold text-gray-900 mb-1">Meetings History</h2>
                                            <p className="text-[13px] text-gray-500">View all the Daily.co meetings you have attended in the metaverse.</p>

                                            <div className="mt-8 space-y-4">
                                                {loadingHistory ? (
                                                    <div className="text-sm text-gray-500">Loading history...</div>
                                                ) : meetingsHistory.length === 0 ? (
                                                    <div className="text-sm text-gray-500 p-6 border border-gray-100 rounded-xl bg-gray-50 text-center">No meetings attended yet.</div>
                                                ) : (
                                                    meetingsHistory.map(meeting => (
                                                        <div key={meeting._id} className="p-4 border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.02)] bg-white flex flex-col gap-4">
                                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                                                <div className="flex items-start gap-4">
                                                                    <div className="w-10 h-10 rounded-full bg-[#e7f5f0] flex items-center justify-center flex-shrink-0 mt-1 sm:mt-0">
                                                                        <Video size={18} className="text-[#136c50]" />
                                                                    </div>
                                                                    <div>
                                                                        <h4 className="text-sm font-bold text-gray-900">
                                                                            {meeting.roomName ? meeting.roomName.replace('meta-', '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : "Meeting Room"}
                                                                        </h4>
                                                                        <div className="flex items-center gap-4 mt-1.5 text-xs text-gray-500 font-medium">
                                                                            <div className="flex items-center gap-1.5">
                                                                                <Calendar size={13} className="text-gray-400" />
                                                                                {new Date(meeting.joinTime).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} • {new Date(meeting.joinTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                                                            </div>
                                                                            <div className="flex items-center gap-1.5 hover:text-gray-700 transition-colors">
                                                                                <Clock size={13} className="text-gray-400" />
                                                                                {Math.floor(meeting.duration / 60)}m {meeting.duration % 60}s
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    {(!meeting.momStatus || meeting.momStatus === 'None' || meeting.momStatus === 'Error') && (
                                                                        <button
                                                                            onClick={() => handleGenerateMOM(meeting._id)}
                                                                            className="px-3 py-1.5 text-[12px] font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
                                                                        >
                                                                            Generate MOM
                                                                        </button>
                                                                    )}
                                                                    {meeting.momStatus === 'Generating' && (
                                                                        <span className="px-3 py-1.5 text-[12px] font-medium bg-yellow-100 text-yellow-800 rounded-lg flex items-center gap-1.5">
                                                                            <div className="w-3 h-3 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin"></div>
                                                                            Generating...
                                                                        </span>
                                                                    )}
                                                                    {meeting.momStatus === 'Generated' && (
                                                                        <>
                                                                            {meeting.transcriptContent && (
                                                                                <button
                                                                                    onClick={() => { setViewMomContent(null); setViewTranscriptContent(meeting.transcriptContent); }}
                                                                                    className="px-3 py-1.5 text-[12px] font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-1.5"
                                                                                >
                                                                                    <FileText size={14} /> Transcript
                                                                                </button>
                                                                            )}
                                                                            <button
                                                                                onClick={() => { setViewTranscriptContent(null); setViewMomContent(meeting.momContent); }}
                                                                                className="px-3 py-1.5 text-[12px] font-medium bg-[#e7f5f0] text-[#136c50] rounded-lg hover:bg-[#d0efe3] transition-colors flex items-center gap-1.5"
                                                                            >
                                                                                <FileText size={14} /> View MOM
                                                                            </button>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>

                                            {viewMomContent && (
                                                <div className="mt-8 p-6 bg-gray-50 border border-gray-200 rounded-xl relative">
                                                    <button onClick={() => setViewMomContent(null)} className="absolute top-4 right-4 p-1.5 bg-white border border-gray-200 rounded-md text-gray-500 hover:text-gray-900 shadow-sm transition-colors">
                                                        <X size={14} />
                                                    </button>
                                                    <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                                                        <FileText size={16} className="text-[#136c50]" /> Minutes of Meeting
                                                    </h3>
                                                    <div className="text-sm text-gray-700 leading-relaxed max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
                                                        <ReactMarkdown
                                                            components={{
                                                                h1: ({ node, ...props }) => <h1 className="text-xl font-bold mb-4 mt-2 text-gray-900" {...props} />,
                                                                h2: ({ node, ...props }) => <h2 className="text-lg font-bold mb-3 mt-6 text-gray-800" {...props} />,
                                                                h3: ({ node, ...props }) => <h3 className="text-md font-semibold mb-2 mt-4 text-gray-800" {...props} />,
                                                                ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-4 space-y-1" {...props} />,
                                                                ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-4 space-y-1" {...props} />,
                                                                li: ({ node, ...props }) => <li className="mb-1" {...props} />,
                                                                p: ({ node, ...props }) => <p className="mb-4 last:mb-0" {...props} />,
                                                                strong: ({ node, ...props }) => <strong className="font-semibold text-gray-900" {...props} />,
                                                                em: ({ node, ...props }) => <em className="italic text-gray-600" {...props} />
                                                            }}
                                                        >
                                                            {viewMomContent}
                                                        </ReactMarkdown>
                                                    </div>
                                                </div>
                                            )}

                                            {viewTranscriptContent && (
                                                <div className="mt-8 p-6 bg-gray-50 border border-gray-200 rounded-xl relative">
                                                    <button onClick={() => setViewTranscriptContent(null)} className="absolute top-4 right-4 p-1.5 bg-white border border-gray-200 rounded-md text-gray-500 hover:text-gray-900 shadow-sm transition-colors">
                                                        <X size={14} />
                                                    </button>
                                                    <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                                                        <FileText size={16} className="text-gray-700" /> Full Meeting Transcript
                                                    </h3>
                                                    <div className="text-sm text-gray-700 leading-relaxed max-h-[60vh] overflow-y-auto custom-scrollbar pr-2 whitespace-pre-wrap">
                                                        {viewTranscriptContent}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ) : activeTab === 'notifications' ? (
                                        <div className="mb-8">
                                            <h2 className="text-[16px] font-bold text-gray-900 mb-1">Notifications</h2>
                                            <p className="text-[13px] text-gray-500">View your upcoming meeting invitations and alerts.</p>

                                            <div className="mt-8 space-y-4">
                                                {loadingUpcoming ? (
                                                    <div className="text-sm text-gray-500">Loading notifications...</div>
                                                ) : upcomingMeetings.length === 0 ? (
                                                    <div className="text-sm text-gray-500 p-6 border border-gray-100 rounded-xl bg-gray-50 text-center">No upcoming meetings or invites.</div>
                                                ) : (
                                                    upcomingMeetings.map(notification => (
                                                        <div key={notification._id} className={`p-4 border ${notification.seen ? 'border-gray-200 bg-white' : 'border-blue-200 bg-blue-50/50'} rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.02)] flex flex-col gap-4 transition-colors`}>
                                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                                                <div className="flex items-start gap-4">
                                                                    <div className={`w-10 h-10 rounded-full ${notification.seen ? 'bg-gray-100' : 'bg-blue-100'} flex items-center justify-center flex-shrink-0 mt-1 sm:mt-0`}>
                                                                        <Bell size={18} className={notification.seen ? 'text-gray-500' : 'text-blue-600'} />
                                                                    </div>
                                                                    <div>
                                                                        <h4 className={`text-sm ${notification.seen ? 'font-medium text-gray-800' : 'font-bold text-gray-900'} leading-snug`}>
                                                                            {notification.message}
                                                                        </h4>
                                                                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 font-medium">
                                                                            <div className="flex items-center gap-1.5">
                                                                                <Calendar size={13} className="text-gray-400" />
                                                                                {new Date(notification.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} • {new Date(notification.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                {!notification.seen && (
                                                                    <div className="flex items-center gap-2 shrink-0">
                                                                        <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                                                        <span className="text-[12px] font-bold text-blue-600">New</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-center h-[50vh] text-gray-400 flex-col">
                                            <Settings size={40} className="mb-4 opacity-50" />
                                            <h3 className="text-base font-medium text-gray-800 mb-1">Coming Soon</h3>
                                            <p className="text-sm">Settings for this section will be available here.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
