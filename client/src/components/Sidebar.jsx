import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useChat } from '../context/ChatContext'
import { useAuth } from '../context/AuthContext'
import { ShieldCheck, CalendarDays } from 'lucide-react'
import WorldChat from './WorldChat'
import PrivateChatManager from './PrivateChatManager'
import UserSettingsModal from './UserSettingsModal'
import AdminPanel from './AdminPanel'
import CalendarModal from './CalendarModal'
import CalendarReminders from './CalendarReminders'
import axios from 'axios'
import socketService from '../services/socketService'

export default function Sidebar() {
  const { chatClient, channel, isConnecting, unreadCounts, markAsRead } = useChat()
  const { logout, user, token } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const [activePanel, setActivePanel] = useState(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAdminOpen, setIsAdminOpen] = useState(false)
  const [unseenCount, setUnseenCount] = useState(0)

  const serverUrl = import.meta.env.VITE_SOCKET_SERVER_URL;

  // Fetch initial notifications for unseen count
  useEffect(() => {
      const fetchUnseen = async () => {
          if (!token || !user) return;
          try {
              const res = await axios.get(`${serverUrl}/api/meeting/notifications`, {
                  headers: { Authorization: `Bearer ${token}` }
              });
              const unread = res.data.notifications.filter(n => !n.seen).length;
              setUnseenCount(unread);
          } catch (e) {
              console.error("Failed to fetch initial notifications", e);
          }
      };
      fetchUnseen();

      // Listen for incoming invites to increment
      const onNewInvite = (data) => {
          if (data.participantIds && data.participantIds.includes(user._id || user.userId)) {
              setUnseenCount(prev => prev + 1);
          }
      };
      
      const socket = socketService.socket;
      if (socket) {
          socket.on("meeting_invite", onNewInvite);
      }
      return () => {
          if (socket) socket.off("meeting_invite", onNewInvite);
      };
  }, [token, user, serverUrl]);

  const isCalendarOpen = location.pathname === '/calendar'

  const togglePanel = (panelName) => {
    const newPanel = activePanel === panelName ? null : panelName
    setActivePanel(newPanel)

    // Reset unread count when opening panel
    if (newPanel === 'WORLD') markAsRead('world')
    if (newPanel === 'PRIVATE') markAsRead('private')

    window.dispatchEvent(
      new CustomEvent('chat-focus-change', { detail: { focused: !!newPanel } })
    )
  }

  const handleClose = () => {
    setActivePanel(null)
    window.dispatchEvent(
      new CustomEvent('chat-focus-change', { detail: { focused: false } })
    )
  }

  return (
    <>
      <CalendarReminders />
      {/* Sidebar — SHARP box */}
      <div className="flex h-full w-16 flex-col items-center justify-between border border-zinc-800 bg-zinc-950/70 p-3 shadow-2xl backdrop-blur-xl relative z-[200]">
        <div className="flex flex-col items-center gap-3">
          <RoundedIconButton
            active={activePanel === 'WORLD'}
            title="World Chat"
            onClick={() => togglePanel('WORLD')}
          >
            {/* World icon */}
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none"
              viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {/* Badge */}
            {unreadCounts.world > 0 && <Badge count={unreadCounts.world} />}
          </RoundedIconButton>

          <RoundedIconButton
            active={activePanel === 'PRIVATE'}
            title="Private Chats"
            onClick={() => togglePanel('PRIVATE')}
          >
            {/* Private icon */}
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none"
              viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            {/* Badge */}
            {unreadCounts.private > 0 && <Badge count={unreadCounts.private} />}
          </RoundedIconButton>

          <RoundedIconButton
            active={isCalendarOpen}
            title="Calendar"
            onClick={() => navigate('/calendar')}
          >
            <CalendarDays size={24} />
          </RoundedIconButton>

          <RoundedIconButton
            active={isSettingsOpen}
            title="Settings"
            onClick={() => setIsSettingsOpen(true)}
          >
            {/* Settings icon */}
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {unseenCount > 0 && <Badge count={unseenCount} />}
          </RoundedIconButton>

          {/* ADMIN — Only visible to admins */}
          {user?.role === 'admin' && (
            <RoundedIconButton
              active={isAdminOpen}
              title="Admin Panel"
              onClick={() => setIsAdminOpen(true)}
            >
              <ShieldCheck size={24} />
            </RoundedIconButton>
          )}
        </div>

        <RoundedIconButton title="Logout" onClick={logout}>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none"
            viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </RoundedIconButton>
      </div>

      {/* WORLD CHAT — ROUNDED panel */}
      {activePanel === 'WORLD' && (
        <div className="ml-4 h-full max-h-[70vh] w-[320px] max-w-sm rounded-xl border border-zinc-800 bg-zinc-950/85 shadow-2xl backdrop-blur-xl relative z-[150]">
          <WorldChat
            chatClient={chatClient}
            channel={channel}
            isConnecting={isConnecting}
            onClose={handleClose}
          />
        </div>
      )}

      {/* PRIVATE CHAT — fullscreen overlay with ROUNDED window */}
      {activePanel === 'PRIVATE' && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 backdrop-blur-lg">
          <div className="h-[80vh] w-[90vw] max-w-5xl rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
            <PrivateChatManager onClose={handleClose} />
          </div>
        </div>
      )}

      {/* Settings Modal */}
      <UserSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onNotificationsViewed={() => setUnseenCount(0)}
        unseenCount={unseenCount}
      />

      {/* Calendar Modal */}
      <CalendarModal
        isOpen={isCalendarOpen}
        onClose={() => navigate('/metaverse')}
      />

      {/* Admin Panel */}
      <AdminPanel
        isOpen={isAdminOpen}
        onClose={() => setIsAdminOpen(false)}
      />
    </>
  )
}

/* Rounded icon button — only element that keeps rounded corners */
function RoundedIconButton({ active, title, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={[
        'relative flex h-11 w-11 items-center justify-center rounded-xl text-zinc-400 transition-all', // 'relative' needed for badge positioning
        'hover:text-white hover:bg-zinc-800',
        active
          ? 'bg-zinc-900 text-white ring-2 ring-[#9b99fe] shadow-lg'
          : 'bg-zinc-900/50',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function Badge({ count }) {
  return (
    <div className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-[#121212]">
      {count > 99 ? '99+' : count}
    </div>
  )
}
