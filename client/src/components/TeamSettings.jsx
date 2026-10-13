// client/src/components/TeamSettings.jsx
// Team management inside the notice board.
// Admin: create/delete teams, pick leader. Leader (or admin): members, GitHub repo/token, bot provider + key.
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Plus, Trash2, Loader, Search, Save, Github, Bot, Users, KeyRound, Crown } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import teamApi, { errorMessage } from "../services/teamApi";

const inputCls = "w-full rounded-lg bg-[#0b0e13] border border-gray-800 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-[#9b99fe]";
const labelCls = "block text-xs font-medium text-gray-400 mb-1.5";

function Section({ icon: Icon, title, children }) {
  return (
    <section className="rounded-xl border border-gray-800 bg-[#121620] p-4 flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
        <Icon size={16} className="text-[#9b99fe]" /> {title}
      </h3>
      {children}
    </section>
  );
}

function MemberPicker({ users, selected, onChange, excludeId }) {
  const [query, setQuery] = useState("");
  const filtered = users
    .filter((u) => String(u._id) !== String(excludeId))
    .filter((u) => u.username.toLowerCase().includes(query.toLowerCase()));

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search employees"
          className={`${inputCls} pl-8`} />
      </div>
      <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-800 divide-y divide-gray-800/70">
        {filtered.length === 0 && <div className="px-3 py-2 text-xs text-gray-500">No users found</div>}
        {filtered.map((u) => (
          <label key={u._id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-white/5">
            <input type="checkbox" checked={selected.has(String(u._id))} onChange={() => toggle(String(u._id))}
              className="accent-[#9b99fe]" />
            <span className="h-6 w-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-[11px] font-bold overflow-hidden shrink-0">
              {u.avatar ? <img src={u.avatar} alt="" className="h-full w-full object-cover" /> : u.username[0]?.toUpperCase()}
            </span>
            <span className="truncate">{u.username}</span>
            <span className="ml-auto text-[11px] uppercase text-gray-500">{u.role}</span>
          </label>
        ))}
      </div>
      <div className="text-xs text-gray-500">{selected.size} member{selected.size === 1 ? "" : "s"} selected</div>
    </div>
  );
}

function SecretInput({ label, hint, value, onChange, cleared, onClear, placeholder }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="flex gap-2">
        <input type="password" autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={cleared ? "Will be removed on save" : hint ? `Saved ${hint}. Leave blank to keep` : placeholder}
          className={inputCls} />
        {hint && !cleared && (
          <button type="button" onClick={onClear}
            className="shrink-0 rounded-lg border border-gray-800 px-3 text-xs text-gray-400 hover:text-red-400 hover:border-red-500/40">
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

const emptyForm = (team) => ({
  name: team?.name || "",
  description: team?.description || "",
  leaderId: team?.leader?._id ? String(team.leader._id) : "",
  members: new Set((team?.members || []).map((m) => String(m._id))),
  repoUrl: team?.repo?.url || "",
  githubToken: "",
  githubTokenCleared: false,
  provider: team?.bot?.provider || "groq",
  model: team?.bot?.model || "",
  apiKey: "",
  apiKeyCleared: false,
  lowPriorityLabels: (team?.lowPriorityLabels || ["priority: low", "low-priority"]).join(", "),
});

export default function TeamSettings({ onChanged }) {
  const { token, user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [teams, setTeams] = useState([]);
  const [providers, setProviders] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedId, setSelectedId] = useState(null); // team id or "new"
  const [form, setForm] = useState(emptyForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const manageable = useMemo(() => teams.filter((t) => t.canManage), [teams]);
  const selected = manageable.find((t) => String(t._id) === selectedId) || null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ teams: list, providers: provs }, directory] = await Promise.all([
        teamApi.getTeams(token),
        teamApi.getDirectory(token).catch(() => []),
      ]);
      setTeams(list);
      setProviders(provs);
      setUsers(directory);
      return list;
    } catch (err) {
      setMessage({ type: "error", text: errorMessage(err, "Failed to load teams") });
      return [];
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load().then((list) => {
      const first = list.find((t) => t.canManage);
      if (first) {
        setSelectedId(String(first._id));
        setForm(emptyForm(first));
      } else if (isAdmin) {
        setSelectedId("new");
        setForm(emptyForm());
      }
    });
  }, [load, isAdmin]);

  const select = (id) => {
    setMessage(null);
    setSelectedId(id);
    setForm(emptyForm(id === "new" ? null : manageable.find((t) => String(t._id) === id)));
  };

  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      if (selectedId === "new") {
        if (!form.leaderId) throw new Error("Pick a team leader");
        const created = await teamApi.createTeam(token, {
          name: form.name,
          description: form.description,
          leaderId: form.leaderId,
          memberIds: [...form.members],
        });
        // Repo/bot settings can be saved right away too
        if (form.repoUrl || form.githubToken || form.apiKey) {
          await teamApi.updateTeam(token, created._id, buildUpdate(created));
        }
        await load();
        setSelectedId(String(created._id));
        setMessage({ type: "ok", text: `Team "${created.name}" created` });
      } else {
        const updated = await teamApi.updateTeam(token, selectedId, buildUpdate(selected));
        await load();
        setForm(emptyForm(updated));
        setMessage({ type: "ok", text: "Saved" });
      }
      onChanged?.();
    } catch (err) {
      setMessage({ type: "error", text: errorMessage(err, "Failed to save") });
    } finally {
      setSaving(false);
    }
  };

  // Only send secrets when they were typed or explicitly removed
  const buildUpdate = (team) => {
    const body = {
      name: form.name,
      description: form.description,
      memberIds: [...form.members],
      repoUrl: form.repoUrl.trim(),
      bot: { provider: form.provider, model: form.model.trim() },
      lowPriorityLabels: form.lowPriorityLabels,
    };
    if (isAdmin && form.leaderId && form.leaderId !== String(team?.leader?._id)) body.leaderId = form.leaderId;
    if (form.githubToken) body.githubToken = form.githubToken;
    else if (form.githubTokenCleared) body.githubToken = "";
    if (form.apiKey) body.bot.apiKey = form.apiKey;
    else if (form.apiKeyCleared) body.bot.apiKey = "";
    return body;
  };

  const remove = async () => {
    if (!selected || !window.confirm(`Delete team "${selected.name}"? This cannot be undone.`)) return;
    try {
      await teamApi.deleteTeam(token, selected._id);
      const list = await load();
      const next = list.find((t) => t.canManage);
      select(next ? String(next._id) : "new");
      onChanged?.();
    } catch (err) {
      setMessage({ type: "error", text: errorMessage(err, "Failed to delete team") });
    }
  };

  if (loading && teams.length === 0) {
    return <div className="flex-1 flex items-center justify-center py-16 text-gray-500 gap-2"><Loader size={18} className="animate-spin" /> Loading teams…</div>;
  }

  const provider = providers.find((p) => p.id === form.provider);
  const isNew = selectedId === "new";

  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
      {/* Team list */}
      <aside className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-gray-800 p-3 flex md:flex-col gap-2 overflow-x-auto md:overflow-y-auto">
        {manageable.map((t) => (
          <button key={t._id} onClick={() => select(String(t._id))}
            className={`shrink-0 text-left rounded-lg px-3 py-2 text-sm transition-colors ${selectedId === String(t._id) ? "bg-[#9b99fe]/15 text-white border border-[#9b99fe]/40" : "text-gray-400 border border-transparent hover:bg-white/5"}`}>
            <div className="font-medium truncate">{t.name}</div>
            <div className="text-[11px] text-gray-500 truncate">{t.members.length + 1} people{t.repo ? ` · ${t.repo.owner}/${t.repo.name}` : ""}</div>
          </button>
        ))}
        {isAdmin && (
          <button onClick={() => select("new")}
            className={`shrink-0 flex items-center gap-2 rounded-lg px-3 py-2 text-sm border border-dashed transition-colors ${isNew ? "border-[#9b99fe] text-white" : "border-gray-700 text-gray-400 hover:text-white"}`}>
            <Plus size={16} /> New team
          </button>
        )}
        {manageable.length === 0 && !isAdmin && (
          <div className="text-xs text-gray-500 p-2">You don't lead any team.</div>
        )}
      </aside>

      {/* Form */}
      {(selected || isNew) && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col gap-4">
          <Section icon={Users} title={isNew ? "New team" : "Team"}>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Team name</label>
                <input value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="e.g. Team A" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><Crown size={12} className="inline mr-1 text-amber-400" />Team leader</label>
                {isAdmin ? (
                  <select value={form.leaderId} onChange={(e) => set("leaderId")(e.target.value)} className={inputCls}>
                    <option value="">Select leader…</option>
                    {users.map((u) => <option key={u._id} value={u._id}>{u.username}</option>)}
                  </select>
                ) : (
                  <div className={`${inputCls} text-gray-400`}>{selected?.leader?.username}</div>
                )}
              </div>
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <input value={form.description} onChange={(e) => set("description")(e.target.value)} placeholder="Optional" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Members (an employee can be in several teams)</label>
              <MemberPicker users={users} selected={form.members} onChange={set("members")} excludeId={form.leaderId} />
            </div>
          </Section>

          <Section icon={Github} title="GitHub repository">
            <div>
              <label className={labelCls}>Repository URL</label>
              <input value={form.repoUrl} onChange={(e) => set("repoUrl")(e.target.value)}
                placeholder="https://github.com/owner/repo" className={inputCls} />
            </div>
            <SecretInput
              label="GitHub token (needed for private repos and for the bot to open PRs)"
              hint={!isNew && selected?.githubTokenHint}
              value={form.githubToken}
              onChange={(v) => setForm((f) => ({ ...f, githubToken: v, githubTokenCleared: false }))}
              cleared={form.githubTokenCleared}
              onClear={() => setForm((f) => ({ ...f, githubToken: "", githubTokenCleared: true }))}
              placeholder="ghp_… or fine-grained token (Contents + Pull requests + Issues: read/write)"
            />
            <div>
              <label className={labelCls}>Low-priority labels (comma separated). Issues with these labels can go to the bot</label>
              <input value={form.lowPriorityLabels} onChange={(e) => set("lowPriorityLabels")(e.target.value)} className={inputCls} />
            </div>
          </Section>

          <Section icon={Bot} title="Issue bot">
            <div>
              <label className={labelCls}>AI provider</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {providers.map((p) => (
                  <button key={p.id} type="button" onClick={() => set("provider")(p.id)}
                    className={`rounded-lg border px-3 py-2 text-xs text-left transition-colors ${form.provider === p.id ? "border-[#9b99fe] bg-[#9b99fe]/15 text-white" : "border-gray-800 text-gray-400 hover:border-gray-600"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Model (optional)</label>
                <input value={form.model} onChange={(e) => set("model")(e.target.value)}
                  placeholder={provider ? `Default: ${provider.defaultModel}` : ""} className={inputCls} />
              </div>
              <SecretInput
                label={<><KeyRound size={12} className="inline mr-1" />{provider?.label || "Provider"} API key</>}
                hint={!isNew && selected?.bot?.provider === form.provider && selected?.bot?.apiKeyHint}
                value={form.apiKey}
                onChange={(v) => setForm((f) => ({ ...f, apiKey: v, apiKeyCleared: false }))}
                cleared={form.apiKeyCleared}
                onClear={() => setForm((f) => ({ ...f, apiKey: "", apiKeyCleared: true }))}
                placeholder="Paste API key"
              />
            </div>
            <p className="text-xs text-gray-500">
              Keys are encrypted on the server and never shown again. The bot reads the issue, edits code through the GitHub API and opens a pull request for review. It never merges.
            </p>
          </Section>

          {message && (
            <div className={`rounded-lg px-3 py-2 text-sm ${message.type === "ok" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" : "bg-red-500/15 text-red-300 border border-red-500/30"}`}>
              {message.text}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            {isAdmin && !isNew ? (
              <button onClick={remove} className="flex items-center gap-2 rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10">
                <Trash2 size={16} /> Delete team
              </button>
            ) : <span />}
            <button onClick={save} disabled={saving || !form.name.trim()}
              className="flex items-center gap-2 rounded-lg bg-[#9b99fe] px-4 py-2 text-sm font-semibold text-black hover:bg-[#b3b1ff] disabled:opacity-50">
              {saving ? <Loader size={16} className="animate-spin" /> : isNew ? <Plus size={16} /> : <Save size={16} />}
              {isNew ? "Create team" : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
