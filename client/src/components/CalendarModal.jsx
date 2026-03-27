import React, { useState, useEffect } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import format from 'date-fns/format';
import parse from 'date-fns/parse';
import startOfWeek from 'date-fns/startOfWeek';
import getDay from 'date-fns/getDay';
import enUS from 'date-fns/locale/en-US';
import {
    X,
    Search,
    Filter,
    ArrowLeft,
    ArrowRight,
    LayoutList,
    LayoutGrid,
    Plus,
    Calendar as CalendarIcon,
    Users,
    Settings,
    LayoutDashboard,
    Briefcase,
    Loader2
} from 'lucide-react';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import AddEventDialog from './AddEventDialog';
import { useNotification } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';

// Setup the localizer for react-big-calendar
const locales = {
    'en-US': enUS,
};

const localizer = dateFnsLocalizer({
    format,
    parse,
    startOfWeek,
    getDay,
    locales,
});

// Custom Toolbar Component to match the design
const CustomToolbar = (toolbar) => {
    const goToBack = () => {
        toolbar.onNavigate('PREV');
    };

    const goToNext = () => {
        toolbar.onNavigate('NEXT');
    };

    const goToCurrent = () => {
        toolbar.onNavigate('TODAY');
    };

    const handleViewChange = (view) => {
        toolbar.onView(view);
    };

    const label = () => {
        const date = toolbar.date;
        return format(date, 'MMMM yyyy');
    };

    return (
        <div className="flex flex-col gap-4 mb-4">
            {/* Top Toolbar Row */}
            <div className="flex items-center justify-between">
                {/* Left: Navigation */}
                <div className="flex items-center gap-2">
                    <button onClick={goToBack} className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white transition-colors">
                        <ArrowLeft size={16} />
                    </button>
                    <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg min-w-[180px] justify-between cursor-pointer hover:bg-zinc-800/50 transition-colors" onClick={goToCurrent}>
                        <span className="text-sm font-semibold text-white">{label()}</span>
                    </div>
                    <button onClick={goToNext} className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white transition-colors">
                        <ArrowRight size={16} />
                    </button>
                </div>

                {/* Right: View Switcher */}
                <div className="flex items-center gap-2">
                    <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg p-1">
                        {['month', 'week', 'day', 'agenda'].map(view => (
                            <button
                                key={view}
                                onClick={() => handleViewChange(view)}
                                className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition-colors ${toolbar.view === view ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                                {view}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default function CalendarModal({ isOpen, onClose }) {
    const { addNotification } = useNotification();
    const { token } = useAuth();
    const serverUrl = import.meta.env.VITE_SOCKET_SERVER_URL || 'http://localhost:3001';
    
    const [isConnected, setIsConnected] = useState(false);
    const [events, setEvents] = useState([]);
    const [isConnecting, setIsConnecting] = useState(false);
    const [activeTab, setActiveTab] = useState('Calendar'); // Requested, Balances, Calendar

    // Dialog State
    const [isAddEventOpen, setIsAddEventOpen] = useState(false);
    const [selectedSlot, setSelectedSlot] = useState({ start: null, end: null });
    const [selectedEvent, setSelectedEvent] = useState(null);

    // Load state from local storage on mount
    useEffect(() => {
        const savedConnected = localStorage.getItem('google_calendar_connected');
        if (savedConnected === 'true') {
            setIsConnected(true);
        }

        const savedEvents = localStorage.getItem('metaverse_calendar_events');
        if (savedEvents) {
            const parsed = JSON.parse(savedEvents).map(evt => ({
                ...evt,
                id: evt.id || crypto.randomUUID(), // Backfill ID if missing
                start: new Date(evt.start),
                end: new Date(evt.end),
            }));
            setEvents(parsed);
        }
    }, []);

    // Save events to local storage
    useEffect(() => {
        if (events.length > 0) {
            localStorage.setItem('metaverse_calendar_events', JSON.stringify(events));
        }
    }, [events]);

    // Fetch scheduled meetings from backend
    useEffect(() => {
        const fetchRemoteEvents = async () => {
             if (!isOpen || !token) return;
             try {
                 const res = await axios.get(`${serverUrl}/api/meeting/scheduled`, {
                     headers: { Authorization: `Bearer ${token}` }
                 });
                 if (res.data && res.data.meetings) {
                     const mappedEvents = res.data.meetings.map(m => {
                         const leaderName = m.leader?.username || "Team Leader";
                         const cleanRoom = (m.roomName || '').replace('meta-', '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                         return {
                             id: m._id,
                             title: `Meeting: ${cleanRoom} (${leaderName})`,
                             start: new Date(m.startTime),
                             end: new Date(m.endTime),
                             allDay: false,
                             resource: 'system',
                             type: 'work',
                             rawMeeting: m // hold ref if needed
                         };
                     });
                     
                     setEvents(prev => {
                         const existingIds = new Set(prev.map(e => e.id));
                         const newRemote = mappedEvents.filter(e => !existingIds.has(e.id));
                         return [...prev, ...newRemote];
                     });
                 }
             } catch (err) {
                 console.error("Failed to fetch scheduled meetings for calendar", err);
             }
        };

        fetchRemoteEvents();
        
        const handleRefresh = () => fetchRemoteEvents();
        window.addEventListener('meeting-scheduled', handleRefresh);
        return () => window.removeEventListener('meeting-scheduled', handleRefresh);
    }, [isOpen, token, serverUrl]);

    const handleConnect = () => {
        setIsConnecting(true);
        setTimeout(() => {
            setIsConnected(true);
            setIsConnecting(false);
            localStorage.setItem('google_calendar_connected', 'true');

            const newEvents = [
                ...events,
                {
                    id: crypto.randomUUID(),
                    title: 'Team Sync',
                    start: new Date(new Date().setHours(10, 0, 0, 0)),
                    end: new Date(new Date().setHours(11, 0, 0, 0)),
                    allDay: false,
                    resource: 'google',
                    type: 'work'
                },
                {
                    id: crypto.randomUUID(),
                    title: 'Design Review',
                    start: new Date(new Date().setDate(new Date().getDate() + 1)),
                    end: new Date(new Date().setDate(new Date().getDate() + 1)),
                    allDay: true,
                    resource: 'google',
                    type: 'critical'
                },
                {
                    id: crypto.randomUUID(),
                    title: 'Lunch',
                    start: new Date(new Date().setHours(13, 0, 0, 0)),
                    end: new Date(new Date().setHours(14, 0, 0, 0)),
                    allDay: false,
                    resource: 'google',
                    type: 'personal' // Maps to 'Annual leave' style in image?
                },
            ];
            setEvents(newEvents);
            addNotification('Connected to Google Calendar', 'success');
        }, 1500);
    };

    const handleSelectSlot = ({ start, end }) => {
        setSelectedSlot({ start, end });
        setIsAddEventOpen(true);
    };

    const handleSelectEvent = (event) => {
        setSelectedEvent(event);
        setSelectedSlot({ start: event.start, end: event.end }); // helpful fallback
        setIsAddEventOpen(true);
    };

    const handleSaveEvent = (savedEvent) => {
        // If editing existing event
        if (selectedEvent) {
            const updatedEvents = events.map(evt =>
                (evt.id === selectedEvent.id)
                    ? { ...savedEvent, id: selectedEvent.id, resource: isConnected ? 'google' : 'user' }
                    : evt
            );
            setEvents(updatedEvents);
            setSelectedEvent(null);
            addNotification('Event updated successfully', 'success');
        } else {
            // New Event
            const eventToAdd = {
                ...savedEvent,
                id: crypto.randomUUID(),
                resource: isConnected ? 'google' : 'user'
            };
            setEvents([...events, eventToAdd]);
            addNotification('Event created successfully', 'success');
        }
    };

    const handleDeleteEvent = (eventToDelete) => {
        const updatedEvents = events.filter(evt => evt.id !== eventToDelete.id);
        setEvents(updatedEvents);
        setSelectedEvent(null);
        addNotification('Event deleted', 'info');
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[2500] flex bg-black text-white font-sans">


            {/* Main Content Area */}
            <div className="flex-1 flex flex-col bg-zinc-950 overflow-hidden relative">
                {/* Close Button Absolute */}
                <button onClick={onClose} className="absolute top-6 right-6 z-50 p-2 rounded-full bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors">
                    <X size={20} />
                </button>

                {/* Header */}
                <div className="h-20 border-b border-zinc-800 flex items-center justify-between px-8 bg-zinc-950">
                    <h1 className="text-xl font-bold text-white">Events & Schedule</h1>
                    <div className="flex items-center gap-4 mr-12">
                        <button className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-700/50 rounded-lg text-sm font-medium text-zinc-300 hover:text-white transition-colors">
                            <span className="text-zinc-500">Export CSV</span>
                        </button>

                        {/* Google Connect Button Moved Here */}
                        {isConnected ? (
                            <button
                                onClick={() => { setIsConnected(false); localStorage.removeItem('google_calendar_connected'); }}
                                className="flex items-center gap-2 px-4 py-2 bg-green-900/20 border border-green-900/50 rounded-lg text-sm font-medium text-green-400 hover:bg-green-900/30 transition-colors"
                            >
                                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                Google Connected
                            </button>
                        ) : (
                            <button
                                onClick={handleConnect}
                                disabled={isConnecting}
                                className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-700/50 rounded-lg text-sm font-medium text-zinc-300 hover:text-white transition-colors"
                            >
                                {isConnecting ? <Loader2 className="animate-spin" size={14} /> : 'Sync Google Cal'}
                            </button>
                        )}
                        <button className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition-all hover:scale-105" onClick={() => {
                            setSelectedSlot({ start: new Date(), end: new Date(new Date().setHours(new Date().getHours() + 1)) });
                            setIsAddEventOpen(true);
                        }}>
                            <Plus size={16} />
                            Add event
                        </button>
                    </div>
                </div>

                {/* Sub Header & Tabs */}
                <div className="px-8 pt-8 pb-0">
                    <div className="flex items-center justify-between mb-6">
                        {/* Tabs */}
                        <div className="flex p-1 bg-zinc-900/50 rounded-xl border border-zinc-800/50 w-fit">
                            {['Overview', 'Team View', 'Calendar'].map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`px-6 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>

                        {/* Search & Filters */}
                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
                                <input
                                    type="text"
                                    placeholder="Search events..."
                                    className="bg-transparent border border-zinc-800 rounded-lg py-1.5 pl-9 pr-4 text-sm text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 w-48"
                                />
                            </div>
                            <button className="flex items-center gap-2 px-3 py-1.5 border border-zinc-800 rounded-lg text-sm text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors">
                                <Filter size={14} />
                                Filter
                            </button>
                        </div>
                    </div>
                </div>

                {/* Calendar Area */}
                <div className="flex-1 px-8 pb-8 overflow-hidden">
                    <div className="h-full rounded-2xl border border-zinc-800 bg-[#09090b] shadow-xl overflow-hidden flex flex-col p-4">

                        {/* Render Big Calendar */}
                        <style>{`
                            .rbc-calendar { font-family: inherit; }
                            .rbc-header { padding: 16px 0; font-weight: 500; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: #71717a; border-bottom: 1px solid #27272a; }
                            .rbc-month-view { border: none; border-radius: 0; }
                            .rbc-month-row + .rbc-month-row { border-top: 1px solid #27272a; }
                            .rbc-day-bg + .rbc-day-bg { border-left: 1px solid #27272a; }
                            .rbc-day-bg { background-color: transparent; }
                            .rbc-off-range-bg { background-color: #0e0e0e; /* Stripes */ background-image: linear-gradient(45deg, #18181b 25%, transparent 25%, transparent 75%, #18181b 75%, #18181b), linear-gradient(45deg, #18181b 25%, transparent 25%, transparent 75%, #18181b 75%, #18181b); background-size: 20px 20px; background-position: 0 0, 10px 10px; opacity: 0.2; }
                            .rbc-date-cell { padding: 8px 12px; font-size: 0.9rem; font-weight: 500; color: #a1a1aa; }
                            .rbc-today { background-color: transparent; }
                            .rbc-current-time-indicator { background-color: #6366f1; }
                            
                            /* Week & Day View - Faint Lines */
                            .rbc-time-view { border: none; }
                            .rbc-time-header-content { border-left: 1px solid #27272a; }
                            .rbc-timeslot-group { border-bottom: 1px solid #27272a; min-height: 60px; }
                            .rbc-day-slot { border-left: 1px solid #27272a; }
                            .rbc-time-content { border-top: 1px solid #27272a; }
                            .rbc-time-gutter .rbc-timeslot-group { border-bottom: 1px solid #27272a; }
                            .rbc-day-slot .rbc-time-slot { border-top: none; } /* Hide 5-minute grid lines for cleaner look */
                            
                            /* Hide All-Day Row (The "Extra Row" above 12:00 AM) */
                            .rbc-allday-cell { display: none !important; }
                            .rbc-time-header-content > .rbc-row.rbc-allday-cell { display: none !important; }

                            /* Events */
                            .rbc-event { padding: 2px 4px; border-radius: 4px; font-size: 11px; font-weight: 600; line-height: 1.4; border: none; margin-bottom: 2px; }
                         `}</style>

                        <Calendar
                            localizer={localizer}
                            events={events}
                            startAccessor="start"
                            endAccessor="end"
                            style={{ height: '100%' }}
                            selectable
                            step={5}
                            timeslots={12}
                            dayLayoutAlgorithm="no-overlap"
                            onSelectSlot={handleSelectSlot}
                            onSelectEvent={handleSelectEvent}
                            defaultView="month"
                            views={['month', 'week', 'day', 'agenda']}
                            components={{
                                toolbar: CustomToolbar
                            }}
                            eventPropGetter={(event) => {
                                // Custom Colors based on type
                                let bg = '#3f3f46';
                                let text = '#e4e4e7';
                                let border = '1px solid #52525b';

                                if (event.resource === 'google') {
                                    bg = '#1e1b4b'; // Indigo 950
                                    text = '#c7d2fe'; // Indigo 200
                                    border = '1px solid #4f46e5'; // Indigo 600
                                }
                                if (event.type === 'personal') {
                                    bg = '#451a03'; // Amber 950
                                    text = '#fde68a'; // Amber 200
                                    border = '1px solid #d97706'; // Amber 600
                                }
                                if (event.resource === 'user') {
                                    bg = '#064e3b'; // Emerald 950
                                    text = '#a7f3d0'; // Emerald 200
                                    border = '1px solid #059669'; // Emerald 600
                                }
                                if (event.resource === 'system') {
                                    bg = '#082f49'; // Sky 950
                                    text = '#bae6fd'; // Sky 200
                                    border = '1px solid #0284c7'; // Sky 600
                                }

                                return {
                                    style: {
                                        backgroundColor: bg,
                                        color: text,
                                        border: border,
                                        fontSize: '11px',
                                        padding: '1px 6px',
                                        borderRadius: '6px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }
                                };
                            }}
                        />
                    </div>
                </div>
            </div>

            {/* Add Event Dialog */}
            <AddEventDialog
                isOpen={isAddEventOpen}
                onClose={() => setIsAddEventOpen(false)}
                onSave={handleSaveEvent}
                onDelete={handleDeleteEvent}
                initialDate={selectedSlot.start}
                initialEndDate={selectedSlot.end}
                initialEvent={selectedEvent}
            />
        </div>
    );
}


