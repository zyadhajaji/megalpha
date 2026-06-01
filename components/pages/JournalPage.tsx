"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BRIDGE_HTTP as BASE } from "@/lib/bridge";

// ── design tokens ─────────────────────────────────────────────────────────────
const mono = "var(--font-mono, 'IBM Plex Mono', monospace)";
const sans = "var(--font-sans, Inter, sans-serif)";
const BG        = "#070707";
const SURFACE   = "#0c0c0c";
const BORDER    = "#1c1c1c";
const TEXT      = "#e8e8e8";
const SUB       = "#888";
const DIM       = "#444";
const DIMMER    = "#2a2a2a";
const GREEN     = "#4ecf8a";
const BLUE      = "#4e8ecf";
const BLUE_DIM  = "#1c3050";

// ── types ─────────────────────────────────────────────────────────────────────
interface Entry {
  id: number;
  date: string;
  title: string;
  body?: string;
  created_at: number;
  updated_at: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── main component ────────────────────────────────────────────────────────────
export default function JournalPage() {
  // entry list
  const [entries, setEntries]       = useState<Entry[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // editor
  const [title, setTitle]   = useState("");
  const [body, setBody]     = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<{ title: string; body: string } | null>(null);

  // AI chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]       = useState("");
  const [streaming, setStreaming]       = useState(false);
  const chatEndRef  = useRef<HTMLDivElement>(null);
  const abortRef    = useRef<AbortController | null>(null);

  // ── load entry list on mount ──────────────────────────────────────────────
  useEffect(() => {
    fetchEntries();
  }, []);

  async function fetchEntries() {
    try {
      const r = await fetch(`${BASE}/journal`);
      if (r.ok) setEntries(await r.json());
    } catch { /* bridge offline */ }
  }

  // ── select an entry ───────────────────────────────────────────────────────
  async function selectEntry(id: number) {
    // auto-save current before switching
    if (selectedId !== null) await doSave(selectedId, title, body);
    try {
      const r = await fetch(`${BASE}/journal/${id}`);
      if (r.ok) {
        const e: Entry = await r.json();
        setSelectedId(e.id);
        setTitle(e.title);
        setBody(e.body ?? "");
        lastSaved.current = { title: e.title, body: e.body ?? "" };
        setSaveStatus("saved");
      }
    } catch { /* bridge offline */ }
  }

  // ── create new entry ──────────────────────────────────────────────────────
  async function newEntry() {
    if (selectedId !== null) await doSave(selectedId, title, body);
    try {
      const r = await fetch(`${BASE}/journal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: todayISO(), title: "Untitled", body: "" }),
      });
      if (r.ok) {
        const e: Entry = await r.json();
        await fetchEntries();
        setSelectedId(e.id);
        setTitle(e.title);
        setBody("");
        lastSaved.current = { title: e.title, body: "" };
        setSaveStatus("saved");
        setChatMessages([]);
      }
    } catch { /* bridge offline */ }
  }

  // ── delete entry ──────────────────────────────────────────────────────────
  async function deleteEntry(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this entry?")) return;
    try {
      await fetch(`${BASE}/journal/${id}`, { method: "DELETE" });
      setEntries(prev => prev.filter(x => x.id !== id));
      if (selectedId === id) {
        setSelectedId(null); setTitle(""); setBody("");
        lastSaved.current = null; setSaveStatus("saved");
      }
    } catch { /* bridge offline */ }
  }

  // ── debounced auto-save ───────────────────────────────────────────────────
  const scheduleAutoSave = useCallback((t: string, b: string) => {
    setSaveStatus("unsaved");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (selectedId !== null) await doSave(selectedId, t, b);
    }, 1500);
  }, [selectedId]);

  async function doSave(id: number, t: string, b: string) {
    if (lastSaved.current?.title === t && lastSaved.current?.body === b) return;
    setSaveStatus("saving");
    try {
      const r = await fetch(`${BASE}/journal/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: todayISO(), title: t, body: b }),
      });
      if (r.ok) {
        lastSaved.current = { title: t, body: b };
        setSaveStatus("saved");
        setEntries(prev =>
          prev.map(x => x.id === id ? { ...x, title: t } : x)
        );
      }
    } catch { setSaveStatus("unsaved"); }
  }

  function onTitleChange(v: string) {
    setTitle(v);
    scheduleAutoSave(v, body);
  }

  function onBodyChange(v: string) {
    setBody(v);
    scheduleAutoSave(title, v);
  }

  // ── AI chat ───────────────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, streaming]);

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || streaming) return;
    setChatInput("");

    const userMsg: ChatMessage = { role: "user", content: text };
    const newHistory = [...chatMessages, userMsg];
    setChatMessages(newHistory);
    setStreaming(true);

    // placeholder assistant message
    setChatMessages(prev => [...prev, { role: "assistant", content: "" }]);

    abortRef.current = new AbortController();
    try {
      const resp = await fetch(`${BASE}/journal/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newHistory.map(m => ({ role: m.role, content: m.content })),
          entry_body: body,
        }),
        signal: abortRef.current.signal,
      });

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data.trim() === "[DONE]") { reader.cancel(); break; }
          try {
            const parsed = JSON.parse(data);
            if (parsed.chunk) {
              setChatMessages(prev => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                copy[copy.length - 1] = { ...last, content: last.content + parsed.chunk };
                return copy;
              });
            }
          } catch { /* non-JSON line */ }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError") {
        setChatMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: "[bridge offline — start the Python server]" };
          return copy;
        });
      }
    } finally {
      setStreaming(false);
    }
  }

  function stopStream() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      height: "100%", display: "flex", overflow: "hidden",
      fontFamily: mono, background: BG,
    }}>

      {/* ── Left: entry list ── */}
      <div style={{
        width: 220, flexShrink: 0, display: "flex", flexDirection: "column",
        borderRight: `1px solid ${BORDER}`, background: SURFACE,
      }}>
        {/* header + new */}
        <div style={{
          padding: "10px 12px", borderBottom: `1px solid ${BORDER}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 9, color: DIM, letterSpacing: "0.1em" }}>JOURNAL</span>
          <button
            onClick={newEntry}
            style={{
              fontFamily: mono, fontSize: 9, padding: "2px 8px",
              background: BLUE_DIM, border: `1px solid #1c4080`,
              borderRadius: 2, color: BLUE, cursor: "pointer",
            }}
          >
            + NEW
          </button>
        </div>

        {/* entry list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {entries.length === 0 ? (
            <div style={{ padding: 16, fontSize: 9, color: DIMMER, lineHeight: 1.7 }}>
              No entries yet.<br />
              <span style={{ color: "#1a1a1a" }}>Click + NEW to start.</span>
            </div>
          ) : (
            entries.map(e => (
              <div
                key={e.id}
                onClick={() => selectEntry(e.id)}
                style={{
                  padding: "9px 12px", cursor: "pointer",
                  borderBottom: `1px solid #0e0e0e`,
                  background: selectedId === e.id ? "#10181f" : "transparent",
                  borderLeft: selectedId === e.id ? `2px solid ${BLUE}` : "2px solid transparent",
                  transition: "background 0.1s",
                  display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 4,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 10, color: selectedId === e.id ? TEXT : SUB,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    marginBottom: 2,
                  }}>
                    {e.title || "Untitled"}
                  </div>
                  <div style={{ fontSize: 8, color: DIM }}>
                    {fmtDate(e.created_at)}
                  </div>
                </div>
                <button
                  onClick={ev => deleteEntry(e.id, ev)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "#2a2a2a", fontSize: 10, padding: "0 2px", flexShrink: 0,
                    lineHeight: 1,
                  }}
                  title="Delete"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Center: editor ── */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", minWidth: 0,
        borderRight: `1px solid ${BORDER}`,
      }}>
        {selectedId === null ? (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: 8,
          }}>
            <div style={{ fontSize: 9, color: DIMMER, letterSpacing: "0.1em" }}>NO ENTRY SELECTED</div>
            <div style={{ fontSize: 9, color: "#1a1a1a" }}>Create one or pick from the list</div>
          </div>
        ) : (
          <>
            {/* title bar */}
            <div style={{
              padding: "10px 16px", borderBottom: `1px solid ${BORDER}`,
              display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
            }}>
              <input
                value={title}
                onChange={e => onTitleChange(e.target.value)}
                placeholder="Entry title…"
                style={{
                  flex: 1, fontFamily: sans, fontWeight: 700, fontSize: 14,
                  color: TEXT, background: "none", border: "none", outline: "none",
                }}
              />
              <span style={{
                fontFamily: mono, fontSize: 8,
                color: saveStatus === "saved" ? DIM : saveStatus === "saving" ? BLUE : "#cfad4e",
              }}>
                {saveStatus === "saved" ? "saved" : saveStatus === "saving" ? "saving…" : "unsaved"}
              </span>
            </div>

            {/* body */}
            <textarea
              value={body}
              onChange={e => onBodyChange(e.target.value)}
              placeholder={
                "Write your trade notes here…\n\n" +
                "What was your thesis? What happened? What did you learn?"
              }
              style={{
                flex: 1, resize: "none", padding: "16px",
                fontFamily: mono, fontSize: 11, color: TEXT,
                background: "none", border: "none", outline: "none",
                lineHeight: 1.75,
              }}
            />
          </>
        )}
      </div>

      {/* ── Right: AI analyst ── */}
      <div style={{
        width: 300, flexShrink: 0, display: "flex", flexDirection: "column",
        background: SURFACE,
      }}>
        {/* header */}
        <div style={{
          padding: "10px 12px", borderBottom: `1px solid ${BORDER}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 5, height: 5, borderRadius: "50%",
              background: GREEN, boxShadow: `0 0 5px ${GREEN}`,
            }} />
            <span style={{ fontSize: 9, color: DIM, letterSpacing: "0.1em" }}>AI ANALYST</span>
          </div>
          {chatMessages.length > 0 && (
            <button
              onClick={() => setChatMessages([])}
              style={{
                fontFamily: mono, fontSize: 8, color: DIMMER, background: "none",
                border: "none", cursor: "pointer", padding: "1px 4px",
              }}
            >
              clear
            </button>
          )}
        </div>

        {/* messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          {chatMessages.length === 0 && (
            <div style={{ fontSize: 9, color: DIMMER, lineHeight: 1.8, marginTop: 8 }}>
              Ask anything about your trade, the market, or your journal entry.<br />
              <span style={{ color: "#1a1a1a" }}>
                The AI sees live prices, the RL agent state, and what you're writing.
              </span>
            </div>
          )}
          {chatMessages.map((msg, i) => (
            <div key={i} style={{
              display: "flex", flexDirection: "column",
              alignItems: msg.role === "user" ? "flex-end" : "flex-start",
            }}>
              <div style={{
                maxWidth: "90%", padding: "7px 10px",
                background: msg.role === "user" ? BLUE_DIM : "#111",
                border: `1px solid ${msg.role === "user" ? "#1c4080" : BORDER}`,
                borderRadius: 4,
                fontSize: 10, color: TEXT, lineHeight: 1.6,
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {msg.content || (streaming && i === chatMessages.length - 1 ? (
                  <span style={{ color: BLUE }}>▋</span>
                ) : null)}
                {streaming && i === chatMessages.length - 1 && msg.content && (
                  <span style={{ color: BLUE, marginLeft: 1 }}>▋</span>
                )}
              </div>
              <div style={{ fontSize: 7, color: "#2a2a2a", marginTop: 2, padding: "0 2px" }}>
                {msg.role === "user" ? "you" : "MEGALPHA AI"}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* input */}
        <div style={{
          borderTop: `1px solid ${BORDER}`, padding: "8px 10px",
          display: "flex", gap: 6, alignItems: "flex-end",
        }}>
          <textarea
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
            }}
            placeholder="Ask the AI analyst…"
            rows={2}
            style={{
              flex: 1, resize: "none", padding: "6px 8px",
              fontFamily: mono, fontSize: 9, color: TEXT,
              background: "#0a0a0a", border: `1px solid ${BORDER}`,
              borderRadius: 3, outline: "none", lineHeight: 1.5,
            }}
          />
          <button
            onClick={streaming ? stopStream : sendChat}
            disabled={!streaming && !chatInput.trim()}
            style={{
              fontFamily: mono, fontSize: 9, padding: "6px 10px",
              background: streaming ? "#3a1010" : BLUE_DIM,
              border: `1px solid ${streaming ? "#6e1010" : "#1c4080"}`,
              borderRadius: 3, color: streaming ? "#cf4e4e" : BLUE,
              cursor: streaming || chatInput.trim() ? "pointer" : "default",
              opacity: !streaming && !chatInput.trim() ? 0.4 : 1,
              alignSelf: "flex-end",
            }}
          >
            {streaming ? "stop" : "send"}
          </button>
        </div>
      </div>

    </div>
  );
}
