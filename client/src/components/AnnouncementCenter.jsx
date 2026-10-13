// client/src/components/AnnouncementCenter.jsx
// Announcement Hall glue on the React side:
//  - keeps the live/upcoming state in sync (socket + polling) and hands it to Phaser (stage)
//  - shows reminders / "declared" / "live now" toasts
//  - top banner while an announcement is live or about to start
import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { Megaphone, MicOff, Radio, MapPin, Clock, Square, Loader } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useNotification } from "../context/NotificationContext";
import socketService from "../services/socketService";
import { STAGE, ANNOUNCEMENT_HALL } from "../config/announcementHall";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_SERVER_URL || "http://localhost:3001";
const SOON_MS = 30 * 60 * 1000;

const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtLeft = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}h ${m}m` : `${m}:${String(s).padStart(2, "0")}`;
};

const publishState = (state) => {
  window.__announcementState = state;
  window.dispatchEvent(new CustomEvent("announcement-state", { detail: state }));
};

const teleport = (point) => window.dispatchEvent(new CustomEvent("teleport-to-point", { detail: point }));

export default function AnnouncementCenter() {
  const { token, user } = useAuth();
  const { addNotification } = useNotification();
  const [state, setState] = useState({ live: null, upcoming: [] });
  const [inHall, setInHall] = useState(!!window.__inAnnouncementHall);
  const [muted, setMuted] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [ending, setEnding] = useState(false);

  const applyState = useCallback((next) => {
    const safe = next || { live: null, upcoming: [] };
    setState(safe);
    publishState(safe);
  }, []);

  // Initial fetch + slow polling as a safety net
  useEffect(() => {
    if (!token) return;
    const load = () =>
      axios.get(`${API_URL}/api/announcements`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => applyState(r.data))
        .catch((err) => console.warn("Failed to load announcements", err.message));
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [token, applyState]);

  // Socket listeners (the socket is created by the Phaser scene, so wait for it)
  useEffect(() => {
    const onNotice = ({ message }) => addNotification(message, "reminder", 9000);
    const onHallMute = ({ muted: m }) => setMuted(m);
    let attachedTo = null;

    const attach = () => {
      const socket = socketService.socket;
      if (!socket || socket === attachedTo) return;
      attachedTo = socket;
      socket.on("announcementState", applyState);
      socket.on("announcementNotice", onNotice);
      socket.on("hallMute", onHallMute);
    };
    attach();
    const id = setInterval(attach, 1000);

    return () => {
      clearInterval(id);
      if (attachedTo) {
        attachedTo.off("announcementState", applyState);
        attachedTo.off("announcementNotice", onNotice);
        attachedTo.off("hallMute", onHallMute);
      }
    };
  }, [applyState, addNotification]);

  useEffect(() => {
    const onPresence = (e) => setInHall(e.detail.inHall);
    window.addEventListener("hall-presence", onPresence);
    return () => window.removeEventListener("hall-presence", onPresence);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Speaker (or an admin) can end a live announcement early
  const endEarly = async () => {
    if (!state.live || !window.confirm(`End "${state.live.title}" now for everyone?`)) return;
    setEnding(true);
    try {
      await axios.post(`${API_URL}/api/announcements/${state.live._id}/end`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // The server broadcasts the new state (stage removed, mics restored)
    } catch (err) {
      addNotification(err.response?.data?.message || "Failed to end the announcement", "error");
    } finally {
      setEnding(false);
    }
  };

  const live = state.live;
  const next = state.upcoming?.[0];
  const isSpeaker = live && user?.username === live.speakerName;
  const startsSoon = !live && next && new Date(next.startTime) - now < SOON_MS;

  if (!live && !startsSoon) return null;

  const audienceSpot = { x: STAGE.centerX, y: ANNOUNCEMENT_HALL.y + 230 };

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[3000] w-[min(640px,calc(100vw-32px))] pointer-events-none">
      <div className={`pointer-events-auto rounded-xl border shadow-2xl backdrop-blur-md px-4 py-2.5 flex items-center gap-3 text-sm
        ${live ? "bg-[#1a0f14]/90 border-red-500/40" : "bg-[#16130b]/90 border-amber-500/40"}`}>
        {live ? (
          <span className="flex items-center gap-1.5 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white shrink-0">
            <Radio size={12} className="animate-pulse" /> LIVE
          </span>
        ) : (
          <Megaphone size={18} className="text-amber-400 shrink-0" />
        )}

        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-white">{(live || next).title}</div>
          <div className="truncate text-xs text-gray-400">
            {live ? (
              isSpeaker
                ? <>You're on air in the Announcement Hall · {fmtLeft(new Date(live.endTime) - now)} left</>
                : <>{live.speakerName} is speaking · ends {fmtTime(live.endTime)}</>
            ) : (
              <><Clock size={11} className="inline mr-1" />{next.speakerName} · starts in {fmtLeft(new Date(next.startTime) - now)} ({fmtTime(next.startTime)})</>
            )}
          </div>
          {live && inHall && !isSpeaker && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-amber-300">
              <MicOff size={12} /> {muted ? "Your mic and camera are off" : "Mics are off"} while the announcement is live. Only the speaker can talk.
            </div>
          )}
        </div>

        {live && (isSpeaker || user?.role === "admin") && (
          <button onClick={endEarly} disabled={ending} title="End the announcement now"
            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-red-500/50 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/15 disabled:opacity-50">
            {ending ? <Loader size={14} className="animate-spin" /> : <Square size={12} fill="currentColor" />} End now
          </button>
        )}
        {isSpeaker && !inHall && (
          <button onClick={() => teleport(STAGE.speakerSpot)}
            className="shrink-0 flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500">
            <MapPin size={14} /> Go to stage
          </button>
        )}
        {!isSpeaker && !inHall && (
          <button onClick={() => teleport(audienceSpot)}
            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-white/10">
            <MapPin size={14} /> Go to hall
          </button>
        )}
      </div>
    </div>
  );
}
