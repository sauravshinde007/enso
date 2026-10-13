// client/src/components/NoticeBoardModal.jsx
// Team notice board (opened from the board in the desk area). Shows open GitHub issues + PRs
// for every team the user belongs to, as a sliding carousel of cards.
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, ChevronLeft, ChevronRight, RefreshCw, Settings, CircleDot, GitPullRequest,
  Bot, Loader, ExternalLink, AlertTriangle, CheckCircle2, Pause, Play, ClipboardList,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "../context/AuthContext";
import socketService from "../services/socketService";
import teamApi, { errorMessage } from "../services/teamApi";
import TeamSettings from "./TeamSettings";

const AUTOPLAY_MS = 7000;
const TEAM_COLORS = ["#9b99fe", "#34d399", "#f59e0b", "#60a5fa", "#f472b6", "#a3e635", "#fb923c", "#22d3ee"];

const teamColor = (teamId, teamIds) => TEAM_COLORS[Math.max(0, teamIds.indexOf(String(teamId))) % TEAM_COLORS.length];

// Readable text on GitHub label colors
const labelStyle = (hex) => {
  const c = /^[0-9a-f]{6}$/i.test(hex || "") ? hex : "6b7280";
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.18)`,
    borderColor: `rgba(${r}, ${g}, ${b}, 0.55)`,
    color: `rgb(${Math.min(255, r + 90)}, ${Math.min(255, g + 90)}, ${Math.min(255, b + 90)})`,
  };
};

const useCardsPerView = (ref) => {
  const [perView, setPerView] = useState(3);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setPerView(w < 560 ? 1 : w < 900 ? 2 : 3);
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return perView;
};

function BotStatus({ notice, onAssign, busy }) {
  const task = notice.botTask;

  if (task?.status === "queued" || task?.status === "running") {
    return (
      <div className="flex items-center gap-2 text-xs text-[#b8b6ff]">
        <Loader size={14} className="animate-spin shrink-0" />
        <span className="truncate">Bot: {task.step || "Working"}…</span>
      </div>
    );
  }

  if (task?.status === "pr_opened") {
    return (
      <a href={task.prUrl} target="_blank" rel="noreferrer"
        className="flex items-center gap-2 text-xs text-emerald-400 hover:text-emerald-300">
        <CheckCircle2 size={14} className="shrink-0" />
        Bot opened PR #{task.prNumber}
        <ExternalLink size={12} />
      </a>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {task?.status === "failed" && (
        <div className="flex items-start gap-2 text-xs text-red-400" title={task.error}>
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span className="line-clamp-2">Bot failed: {task.error}</span>
        </div>
      )}
      {notice.canManage ? (
        <button
          onClick={onAssign}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-lg bg-[#9b99fe]/15 border border-[#9b99fe]/40 px-3 py-1.5 text-xs font-medium text-[#c9c8ff] hover:bg-[#9b99fe]/25 disabled:opacity-50 transition-colors"
        >
          {busy ? <Loader size={14} className="animate-spin" /> : <Bot size={14} />}
          {task?.status === "failed" ? "Retry with bot" : "Assign to bot"}
        </button>
      ) : (
        !task && <div className="flex items-center gap-2 text-xs text-gray-500"><Bot size={14} /> Eligible for the bot</div>
      )}
    </div>
  );
}

function NoticeCard({ notice, color, onAssign, busy }) {
  const isPR = notice.type === "pr";
  return (
    <div className="h-full flex flex-col gap-3 rounded-xl border border-gray-800 bg-[#151a23] p-4 hover:border-gray-700 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold truncate max-w-[55%]"
          style={{ color, backgroundColor: `${color}22`, border: `1px solid ${color}55` }}>
          {notice.teamName}
        </span>
        <span className={`flex items-center gap-1 text-xs font-medium ${isPR ? "text-sky-400" : "text-emerald-400"}`}>
          {isPR ? <GitPullRequest size={14} /> : <CircleDot size={14} />}
          {isPR ? "PR" : "Issue"} #{notice.number}
          {notice.draft && <span className="text-gray-500 ml-1">(draft)</span>}
        </span>
      </div>

      <a href={notice.url} target="_blank" rel="noreferrer"
        className="text-[15px] font-semibold leading-snug text-gray-100 hover:text-white line-clamp-3">
        {notice.title}
      </a>

      <div className="flex flex-wrap gap-1.5 min-h-[22px]">
        {notice.isLowPriority && (
          <span className="rounded-full border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
            Low priority
          </span>
        )}
        {notice.labels.slice(0, 4).map((l) => (
          <span key={l.name} className="rounded-full border px-2 py-0.5 text-[11px]" style={labelStyle(l.color)}>
            {l.name}
          </span>
        ))}
        {notice.labels.length > 4 && <span className="text-[11px] text-gray-500">+{notice.labels.length - 4}</span>}
      </div>

      <div className="mt-auto flex items-center gap-2 text-xs text-gray-500">
        {notice.authorAvatar && <img src={notice.authorAvatar} alt="" className="h-5 w-5 rounded-full" />}
        <span className="truncate">{notice.author}</span>
        <span>·</span>
        <span className="shrink-0">updated {formatDistanceToNow(new Date(notice.updatedAt), { addSuffix: true })}</span>
      </div>

      {notice.isLowPriority && (
        <div className="border-t border-gray-800 pt-3">
          <BotStatus notice={notice} onAssign={onAssign} busy={busy} />
        </div>
      )}
    </div>
  );
}

export default function NoticeBoardModal() {
  const { token, user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState("board"); // 'board' | 'settings'
  const [data, setData] = useState(null); // { teams: [...] }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [teamFilter, setTeamFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all"); // all | issue | pr | low
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [toast, setToast] = useState(null);
  const viewportRef = useRef(null);
  const perView = useCardsPerView(viewportRef);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!token) return;
    if (!silent) setLoading(true);
    try {
      setData(await teamApi.getNotices(token));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Failed to load the notice board"));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token]);

  const close = useCallback(() => {
    setIsOpen(false);
    window.dispatchEvent(new CustomEvent("close-noticeboard"));
  }, []);

  // Open from Phaser
  useEffect(() => {
    const onOpen = () => {
      setIsOpen(true);
      setView("board");
      load();
    };
    window.addEventListener("open-noticeboard", onOpen);
    return () => window.removeEventListener("open-noticeboard", onOpen);
  }, [load]);

  // While open: block game keyboard input, Escape closes, live updates via socket
  useEffect(() => {
    if (!isOpen) return;
    window.dispatchEvent(new CustomEvent("chat-focus-change", { detail: { focused: true } }));

    const onKey = (e) => { if (e.key === "Escape") close(); };
    const onUpdate = () => load({ silent: true });
    window.addEventListener("keydown", onKey);
    socketService.on("noticeBoardUpdate", onUpdate);

    return () => {
      window.removeEventListener("keydown", onKey);
      socketService.off("noticeBoardUpdate", onUpdate);
      window.dispatchEvent(new CustomEvent("chat-focus-change", { detail: { focused: false } }));
    };
  }, [isOpen, close, load]);

  const teams = useMemo(() => data?.teams || [], [data]);
  const teamIds = useMemo(() => teams.map((t) => String(t.teamId)), [teams]);
  const canManageAny = user?.role === "admin" || teams.some((t) => t.canManage);

  const notices = useMemo(() => {
    const all = teams
      .filter((t) => teamFilter === "all" || String(t.teamId) === teamFilter)
      .flatMap((t) => t.notices.map((n) => ({ ...n, teamId: t.teamId, teamName: t.teamName, canManage: t.canManage })));
    return all
      .filter((n) => typeFilter === "all" || (typeFilter === "low" ? n.isLowPriority : n.type === typeFilter))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }, [teams, teamFilter, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(notices.length / perView));
  const safePage = Math.min(page, pageCount - 1);

  useEffect(() => { setPage(0); }, [teamFilter, typeFilter]);

  // Auto-advance the slider (paused on hover or by the user)
  useEffect(() => {
    if (!isOpen || view !== "board" || paused || hovering || pageCount <= 1) return;
    const id = setInterval(() => setPage((p) => (p + 1) % pageCount), AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [isOpen, view, paused, hovering, pageCount]);

  const go = (delta) => setPage((p) => (Math.min(p, pageCount - 1) + delta + pageCount) % pageCount);

  const assign = async (notice) => {
    const key = `${notice.teamId}:${notice.number}`;
    setBusyKey(key);
    try {
      await teamApi.assignToBot(token, notice.teamId, notice.number);
      setToast({ type: "ok", text: `Issue #${notice.number} handed to the bot` });
      load({ silent: true });
    } catch (err) {
      setToast({ type: "error", text: errorMessage(err, "Could not assign the issue") });
    } finally {
      setBusyKey(null);
      setTimeout(() => setToast(null), 4000);
    }
  };

  const teamProblems = teams.filter((t) => (teamFilter === "all" || String(t.teamId) === teamFilter) && (t.error || !t.repo));

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[4000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="w-full max-w-5xl max-h-[90vh] bg-[#0e1116] border border-gray-800 rounded-2xl shadow-[0_0_80px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden text-gray-100"
          >
            {/* Header */}
            <div className="p-4 border-b border-gray-800 flex items-center justify-between gap-3 bg-[#13171f]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-[#9b99fe]/15 text-[#9b99fe]"><ClipboardList size={20} /></div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">{view === "settings" ? "Manage Teams" : "Notice Board"}</h2>
                  <p className="text-xs text-gray-500 truncate">
                    {view === "settings" ? "Members, repository and bot settings" : "Open issues & pull requests from your teams"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {view === "board" && (
                  <button onClick={() => load()} title="Refresh"
                    className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
                    <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
                  </button>
                )}
                {canManageAny && (
                  <button
                    onClick={() => { setView(view === "board" ? "settings" : "board"); if (view === "settings") load(); }}
                    title={view === "board" ? "Manage teams" : "Back to board"}
                    className={`p-2 rounded-lg transition-colors ${view === "settings" ? "text-white bg-gray-800" : "text-gray-400 hover:text-white hover:bg-gray-800"}`}>
                    <Settings size={18} />
                  </button>
                )}
                <button onClick={close} title="Close (Esc)"
                  className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
                  <X size={18} />
                </button>
              </div>
            </div>

            {view === "settings" ? (
              <TeamSettings onChanged={() => load({ silent: true })} />
            ) : (
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col gap-4">
                {/* Filters */}
                {teams.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      {[{ id: "all", name: "All teams" }, ...teams.map((t) => ({ id: String(t.teamId), name: t.teamName }))].map((t) => {
                        const active = teamFilter === t.id;
                        const color = t.id === "all" ? "#9ca3af" : teamColor(t.id, teamIds);
                        return (
                          <button key={t.id} onClick={() => setTeamFilter(t.id)}
                            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${active ? "text-white" : "text-gray-400 border-gray-800 hover:border-gray-600"}`}
                            style={active ? { borderColor: color, backgroundColor: `${color}26` } : undefined}>
                            {t.name}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex rounded-lg border border-gray-800 p-0.5 text-xs">
                      {[["all", "All"], ["issue", "Issues"], ["pr", "PRs"], ["low", "Low priority"]].map(([id, label]) => (
                        <button key={id} onClick={() => setTypeFilter(id)}
                          className={`px-3 py-1 rounded-md transition-colors ${typeFilter === id ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-200"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Per-team problems */}
                {teamProblems.map((t) => (
                  <div key={t.teamId} className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>
                      <strong>{t.teamName}:</strong>{" "}
                      {t.error || (t.canManage ? "No GitHub repository linked yet. Add one in Manage Teams." : "The team leader hasn't linked a GitHub repository yet.")}
                    </span>
                  </div>
                ))}

                {/* Body */}
                {loading && !data ? (
                  <div className="flex-1 flex items-center justify-center py-16 text-gray-500 gap-2">
                    <Loader size={18} className="animate-spin" /> Loading notices…
                  </div>
                ) : error ? (
                  <div className="py-16 text-center text-red-400 text-sm">{error}</div>
                ) : teams.length === 0 ? (
                  <div className="py-16 text-center text-gray-500 text-sm">
                    You're not in any team yet. Ask an admin to add you to one.
                  </div>
                ) : notices.length === 0 ? (
                  <div className="py-16 text-center text-gray-500 text-sm">Nothing here. No open {typeFilter === "pr" ? "pull requests" : typeFilter === "issue" ? "issues" : "notices"} for this selection.</div>
                ) : (
                  <div className="flex flex-col gap-4" onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
                    {/* Slider */}
                    <div className="relative">
                      <div ref={viewportRef} className="overflow-hidden">
                        <div className="flex transition-transform duration-500 ease-out"
                          style={{ transform: `translateX(-${safePage * 100}%)` }}>
                          {notices.map((n) => (
                            <div key={`${n.teamId}-${n.type}-${n.number}`} className="shrink-0 px-1.5"
                              style={{ width: `${100 / perView}%` }}>
                              <NoticeCard
                                notice={n}
                                color={teamColor(n.teamId, teamIds)}
                                onAssign={() => assign(n)}
                                busy={busyKey === `${n.teamId}:${n.number}`}
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      {pageCount > 1 && (
                        <>
                          <button onClick={() => go(-1)} aria-label="Previous"
                            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 p-2 rounded-full bg-[#13171f] border border-gray-700 text-gray-300 hover:text-white shadow-lg">
                            <ChevronLeft size={18} />
                          </button>
                          <button onClick={() => go(1)} aria-label="Next"
                            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 p-2 rounded-full bg-[#13171f] border border-gray-700 text-gray-300 hover:text-white shadow-lg">
                            <ChevronRight size={18} />
                          </button>
                        </>
                      )}
                    </div>

                    {/* Dots + autoplay */}
                    <div className="flex items-center justify-center gap-3">
                      <div className="flex flex-wrap justify-center gap-1.5">
                        {Array.from({ length: pageCount }).map((_, i) => (
                          <button key={i} onClick={() => setPage(i)} aria-label={`Slide ${i + 1}`}
                            className={`h-2 rounded-full transition-all ${i === safePage ? "w-6 bg-[#9b99fe]" : "w-2 bg-gray-700 hover:bg-gray-500"}`} />
                        ))}
                      </div>
                      {pageCount > 1 && (
                        <button onClick={() => setPaused((p) => !p)} title={paused ? "Resume auto-slide" : "Pause auto-slide"}
                          className="p-1 text-gray-500 hover:text-gray-300">
                          {paused ? <Play size={14} /> : <Pause size={14} />}
                        </button>
                      )}
                      <span className="text-xs text-gray-600">{notices.length} notice{notices.length === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {toast && (
              <div className={`mx-4 mb-4 rounded-lg px-3 py-2 text-sm ${toast.type === "ok" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" : "bg-red-500/15 text-red-300 border border-red-500/30"}`}>
                {toast.text}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
