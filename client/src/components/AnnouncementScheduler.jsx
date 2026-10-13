// client/src/components/AnnouncementScheduler.jsx
// Admin: allot an Announcement Hall time slot to a speaker; list / cancel upcoming slots.
import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { Megaphone, Loader, XCircle, Radio, CalendarClock } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_SERVER_URL || "http://localhost:3001";
const inputCls = "w-full bg-[#111] border border-[#444] text-sm rounded px-3 py-2 text-gray-200 focus:outline-none focus:border-blue-500";

const pad = (n) => String(n).padStart(2, "0");
const toDateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmt = (d) => new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

const defaultStart = () => {
  const d = new Date(Date.now() + 30 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return d;
};

export default function AnnouncementScheduler({ users, token }) {
  const start = defaultStart();
  const [form, setForm] = useState({
    title: "",
    description: "",
    speakerId: "",
    date: toDateInput(start),
    time: toTimeInput(start),
    duration: 30,
  });
  const [state, setState] = useState({ live: null, upcoming: [] });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(() => {
    axios.get(`${API_URL}/api/announcements`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setState(r.data))
      .catch(() => {});
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const startDate = new Date(`${form.date}T${form.time}`);
  const endDate = new Date(startDate.getTime() + form.duration * 60000);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await axios.post(`${API_URL}/api/announcements`, {
        title: form.title,
        description: form.description,
        speakerId: form.speakerId,
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
      }, { headers });
      setMessage({ ok: true, text: "Scheduled. Everyone has been notified and the stage is up." });
      setForm((f) => ({ ...f, title: "", description: "" }));
      load();
    } catch (err) {
      setMessage({ ok: false, text: err.response?.data?.message || "Failed to schedule" });
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (a) => {
    const live = a.status === "live";
    if (!window.confirm(live ? `End "${a.title}" now?` : `Cancel "${a.title}"? Everyone will be notified.`)) return;
    try {
      await axios.delete(`${API_URL}/api/announcements/${a._id}`, { headers });
      load();
    } catch (err) {
      alert(err.response?.data?.message || "Failed");
    }
  };

  const slots = [...(state.live ? [state.live] : []), ...(state.upcoming || [])];

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-3 bg-[#222] p-4 rounded-lg border border-[#333]">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white">
          <Megaphone size={16} className="text-amber-400" /> Allot an Announcement Hall slot
        </h3>
        <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Title (e.g. Q3 all-hands update)" className={inputCls} />
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Instructions / agenda (optional)" rows={2} className={inputCls} />
        <select required value={form.speakerId} onChange={(e) => setForm({ ...form, speakerId: e.target.value })} className={inputCls}>
          <option value="">Select speaker…</option>
          {users.map((u) => <option key={u._id} value={u._id}>{u.username} ({u.role})</option>)}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} />
          <input type="time" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className={inputCls} />
        </div>
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Duration: <strong className="text-gray-200">{form.duration} min</strong></span>
            {!isNaN(startDate) && <span>{fmt(startDate)} → {endDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
          </div>
          <input type="range" min={5} max={240} step={5} value={form.duration}
            onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })} className="w-full accent-amber-400" />
        </div>
        {message && <div className={`text-sm ${message.ok ? "text-green-400" : "text-red-400"}`}>{message.text}</div>}
        <button disabled={saving} className="flex items-center gap-2 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-50">
          {saving ? <Loader size={16} className="animate-spin" /> : <CalendarClock size={16} />} Schedule & notify everyone
        </button>
      </form>

      <div className="space-y-2">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Live & upcoming</h3>
        {slots.length === 0 && <div className="text-sm text-gray-500">Nothing scheduled.</div>}
        {slots.map((a) => (
          <div key={a._id} className="flex items-center gap-3 bg-[#222] p-3 rounded-lg border border-[#333]">
            {a.status === "live" && <Radio size={16} className="text-red-500 animate-pulse shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-200 truncate">{a.title}</div>
              <div className="text-xs text-gray-500 truncate">
                {a.speakerName} · {fmt(a.startTime)} – {new Date(a.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
            <button onClick={() => cancel(a)} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 shrink-0">
              <XCircle size={14} /> {a.status === "live" ? "End now" : "Cancel"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
