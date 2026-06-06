"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BRIDGE_HTTP as BASE } from "@/lib/bridge";

// ── design tokens ─────────────────────────────────────────────────────────────
const mono    = "var(--font-mono, 'IBM Plex Mono', monospace)";
const sans    = "var(--font-sans, Inter, sans-serif)";
const BG      = "#070707";
const SURFACE = "#0c0c0c";
const BORDER  = "#1c1c1c";
const TEXT    = "#e8e8e8";
const SUB     = "#999";
const DIM     = "#666";
const DIMMER  = "#555";
const GREEN   = "#3aaa72";
const RED     = "#aa3a3a";
const AMBER   = "#cfad4e";
const BLUE    = "#4e8ecf";
const BLUE_DIM = "#1c3050";

// ── types ─────────────────────────────────────────────────────────────────────
type Tab = "notes" | "trades" | "sessions";

interface Entry {
  id: number;
  date: string;
  title: string;
  body?: string;
  created_at: number;
  updated_at: number;
}

interface Trade {
  id?: number;
  date: string;
  asset: string;
  direction: "LONG" | "SHORT";
  strategy?: string;
  entry?: number;
  exit?: number;
  sl?: number;
  rr_target?: number;
  rr_achieved?: number;
  result: "WIN" | "LOSS" | "BREAKEVEN";
  pnl?: number;
  ib_lots?: number;
  d_score?: number;
  session?: string;
  notes?: string;
}

interface SessionRecord {
  id?: number;
  date: string;
  trades?: number;
  wins?: number;
  losses?: number;
  total_r?: number;
  pnl?: number;
  ib_rebate?: number;
  phase?: string;
  notes?: string;
}

interface IBSummary {
  total_rebates?: number;
  current_phase?: string;
  current_equity?: number;
  trades_to_next?: number;
}

interface TradeStats {
  win_rate_30d?: number;
  avg_rr?: number;
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

function fmt2(n?: number | null): string {
  if (n == null) return "—";
  return n.toFixed(2);
}

function fmtPct(n?: number | null): string {
  if (n == null) return "—";
  return (n * 100).toFixed(1) + "%";
}

function resultColor(r: string): string {
  if (r === "WIN") return GREEN;
  if (r === "LOSS") return RED;
  return AMBER;
}

// ── stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 4,
      padding: "10px 14px", minWidth: 130, flex: "1 1 130px",
    }}>
      <div style={{ fontSize: 8, color: DIM, letterSpacing: "0.1em", marginBottom: 5 }}>{label}</div>
      <div style={{ fontFamily: mono, fontSize: 14, color: TEXT }}>{value}</div>
      {sub && <div style={{ fontFamily: mono, fontSize: 8, color: SUB, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────
export default function JournalPage() {
  const [activeTab, setActiveTab] = useState<Tab>("notes");

  // ── notes state ──────────────────────────────────────────────────────────
  const [entries, setEntries]       = useState<Entry[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [title, setTitle]           = useState("");
  const [body, setBody]             = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const saveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved  = useRef<{ title: string; body: string } | null>(null);

  // ── trade log state ───────────────────────────────────────────────────────
  const [trades, setTrades]         = useState<Trade[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [ibSummary, setIBSummary]   = useState<IBSummary | null>(null);
  const [tradeStats, setTradeStats] = useState<TradeStats | null>(null);
  const [assetFilter, setAssetFilter]     = useState("All");
  const [dirFilter, setDirFilter]         = useState("All");
  const [resultFilter, setResultFilter]   = useState("All");
  const [dateFilter, setDateFilter]       = useState("30d");

  // ── session state ─────────────────────────────────────────────────────────
  const [sessions, setSessions]     = useState<SessionRecord[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // ── load entries on mount ────────────────────────────────────────────────
  useEffect(() => { fetchEntries(); }, []);

  // ── load trade data when trade tab opens ──────────────────────────────────
  useEffect(() => {
    if (activeTab === "trades") {
      fetchTrades();
      fetchIBSummary();
      fetchTradeStats();
    }
    if (activeTab === "sessions") {
      fetchSessions();
    }
  }, [activeTab]);

  // ── notes CRUD ────────────────────────────────────────────────────────────
  async function fetchEntries() {
    try {
      const r = await fetch(`${BASE}/journal`);
      if (r.ok) setEntries(await r.json());
    } catch { /* bridge offline */ }
  }

  async function selectEntry(id: number) {
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
      }
    } catch { /* bridge offline */ }
  }

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
        setEntries(prev => prev.map(x => x.id === id ? { ...x, title: t } : x));
      }
    } catch { setSaveStatus("unsaved"); }
  }

  function onTitleChange(v: string) { setTitle(v); scheduleAutoSave(v, body); }
  function onBodyChange(v: string)  { setBody(v);  scheduleAutoSave(title, v); }

  // ── trade log fetches ─────────────────────────────────────────────────────
  async function fetchTrades() {
    setTradesLoading(true);
    try {
      const daysParam = dateFilter === "all" ? "" : `?days=${dateFilter.replace("d", "")}`;
      const r = await fetch(`${BASE}/journal/trades${daysParam}`);
      if (r.ok) setTrades(await r.json());
      else setTrades([]);
    } catch { setTrades([]); } finally { setTradesLoading(false); }
  }

  async function fetchIBSummary() {
    try {
      const r = await fetch(`${BASE}/ib/summary`);
      if (r.ok) setIBSummary(await r.json());
    } catch { /* ignore */ }
  }

  async function fetchTradeStats() {
    try {
      const r = await fetch(`${BASE}/journal/trades?days=30`);
      if (r.ok) {
        const data: Trade[] = await r.json();
        if (data.length > 0) {
          const wins = data.filter(t => t.result === "WIN").length;
          const win_rate_30d = wins / data.length;
          const rrs = data.filter(t => t.rr_achieved != null).map(t => t.rr_achieved!);
          const avg_rr = rrs.length ? rrs.reduce((a, b) => a + b, 0) / rrs.length : undefined;
          setTradeStats({ win_rate_30d, avg_rr });
        }
      }
    } catch { /* ignore */ }
  }

  async function fetchSessions() {
    setSessionsLoading(true);
    try {
      const r = await fetch(`${BASE}/journal/sessions`);
      if (r.ok) setSessions(await r.json());
      else setSessions([]);
    } catch { setSessions([]); } finally { setSessionsLoading(false); }
  }

  // ── date filter refetch ───────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab === "trades") fetchTrades();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFilter]);

  // ── filtered trades ───────────────────────────────────────────────────────
  const filteredTrades = trades.filter(t => {
    if (assetFilter !== "All" && t.asset !== assetFilter) return false;
    if (dirFilter !== "All" && t.direction !== dirFilter) return false;
    if (resultFilter !== "All" && t.result !== resultFilter) return false;
    return true;
  });

  // ── CSV export ────────────────────────────────────────────────────────────
  function exportCSV() {
    const cols = ["Date","Asset","Direction","Strategy","Entry","Exit","SL","RR Target","RR Achieved","Result","P&L $","IB Lots","D-Score","Session","Notes"];
    const rows = filteredTrades.map(t => [
      t.date, t.asset, t.direction, t.strategy ?? "",
      t.entry ?? "", t.exit ?? "", t.sl ?? "",
      t.rr_target ?? "", t.rr_achieved ?? "",
      t.result, t.pnl ?? "", t.ib_lots ?? "",
      t.d_score ?? "", t.session ?? "", (t.notes ?? "").replace(/,/g, ";"),
    ]);
    const csv = [cols, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "trade_log.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  // ── tab bar styles ────────────────────────────────────────────────────────
  const tabStyle = (t: Tab): React.CSSProperties => ({
    fontFamily: mono, fontSize: 9, padding: "0 16px",
    minHeight: 44, display: "flex", alignItems: "center",
    cursor: "pointer", border: "none", background: "none",
    color: activeTab === t ? TEXT : DIM,
    borderBottom: activeTab === t ? `2px solid ${BLUE}` : "2px solid transparent",
    letterSpacing: "0.08em",
    WebkitTapHighlightColor: "transparent",
    flex: 1, justifyContent: "center",
  });

  // ── select / filter button style ──────────────────────────────────────────
  const selStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: mono, fontSize: 8, padding: "3px 8px",
    background: active ? BLUE_DIM : "transparent",
    border: `1px solid ${active ? "#1c4080" : BORDER}`,
    borderRadius: 2, color: active ? BLUE : SUB,
    cursor: "pointer",
  });

  // ── th / td styles ────────────────────────────────────────────────────────
  const th: React.CSSProperties = {
    fontFamily: mono, fontSize: 8, color: DIM, letterSpacing: "0.08em",
    padding: "6px 10px", textAlign: "left", borderBottom: `1px solid ${BORDER}`,
    whiteSpace: "nowrap", fontWeight: 400,
  };
  const td: React.CSSProperties = {
    fontFamily: mono, fontSize: 9, color: TEXT,
    padding: "6px 10px", borderBottom: `1px solid #0e0e0e`,
    whiteSpace: "nowrap",
  };

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: mono, background: BG,
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
    }}>

      {/* ── Tab bar ── */}
      <div style={{ display: "flex", borderBottom: `1px solid ${BORDER}`, background: SURFACE, flexShrink: 0 }}>
        {(["notes", "trades", "sessions"] as Tab[]).map(t => (
          <button key={t} style={tabStyle(t)} onClick={() => setActiveTab(t)}>
            {t === "notes" ? "NOTES" : t === "trades" ? "TRADE LOG" : "SESSION RECORDS"}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>

        {/* ════════════════ NOTES TAB ════════════════ */}
        {activeTab === "notes" && (
          <>
            {/* left: entry list */}
            <div style={{
              width: 220, flexShrink: 0, display: "flex", flexDirection: "column",
              borderRight: `1px solid ${BORDER}`, background: SURFACE,
            }}>
              <div style={{
                padding: "10px 12px", borderBottom: `1px solid ${BORDER}`,
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <span style={{ fontSize: 9, color: DIM, letterSpacing: "0.1em" }}>JOURNAL</span>
                <button
                  onClick={newEntry}
                  style={{
                    fontFamily: mono, fontSize: 9, padding: "2px 8px",
                    background: BLUE_DIM, border: "1px solid #1c4080",
                    borderRadius: 2, color: BLUE, cursor: "pointer",
                  }}
                >
                  + NEW
                </button>
              </div>
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
                        borderBottom: "1px solid #0e0e0e",
                        background: selectedId === e.id ? "#10181f" : "transparent",
                        borderLeft: selectedId === e.id ? `2px solid ${BLUE}` : "2px solid transparent",
                        transition: "background 0.1s",
                        display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 4,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{
                          fontSize: 10, color: selectedId === e.id ? TEXT : SUB,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 2,
                        }}>
                          {e.title || "Untitled"}
                        </div>
                        <div style={{ fontSize: 8, color: DIM }}>{fmtDate(e.created_at)}</div>
                      </div>
                      <button
                        onClick={ev => deleteEntry(e.id, ev)}
                        style={{
                          background: "none", border: "none", cursor: "pointer",
                          color: "#2a2a2a", fontSize: 10, padding: "0 2px", flexShrink: 0, lineHeight: 1,
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

            {/* right: editor */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
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
                      color: saveStatus === "saved" ? DIM : saveStatus === "saving" ? BLUE : AMBER,
                    }}>
                      {saveStatus === "saved" ? "saved" : saveStatus === "saving" ? "saving…" : "unsaved"}
                    </span>
                  </div>
                  <textarea
                    value={body}
                    onChange={e => onBodyChange(e.target.value)}
                    placeholder={"Write your trade notes here…\n\nWhat was your thesis? What happened? What did you learn?"}
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
          </>
        )}

        {/* ════════════════ TRADE LOG TAB ════════════════ */}
        {activeTab === "trades" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* stats cards */}
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 10, padding: "14px 16px",
              borderBottom: `1px solid ${BORDER}`, flexShrink: 0,
            }}>
              <StatCard
                label="WIN RATE (30D)"
                value={fmtPct(tradeStats?.win_rate_30d)}
              />
              <StatCard
                label="AVG R:R ACHIEVED"
                value={fmt2(tradeStats?.avg_rr)}
              />
              <StatCard
                label="TOTAL IB REBATES"
                value={ibSummary?.total_rebates != null ? `$${ibSummary.total_rebates.toFixed(2)}` : "—"}
              />
              <StatCard
                label="PHASE / EQUITY"
                value={ibSummary?.current_phase ?? "—"}
                sub={ibSummary?.current_equity != null ? `$${ibSummary.current_equity.toLocaleString()}` : undefined}
              />
              <StatCard
                label="TRADES TO NEXT TARGET"
                value={ibSummary?.trades_to_next != null ? String(ibSummary.trades_to_next) : "—"}
              />
            </div>

            {/* filter controls */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "10px 16px",
              borderBottom: `1px solid ${BORDER}`, flexShrink: 0, flexWrap: "wrap",
            }}>
              {/* asset */}
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <span style={{ fontSize: 8, color: DIM, letterSpacing: "0.08em", marginRight: 2 }}>ASSET</span>
                {["All","BTC","ETH","SOL","XAUUSD"].map(a => (
                  <button key={a} style={selStyle(assetFilter === a)} onClick={() => setAssetFilter(a)}>{a}</button>
                ))}
              </div>
              <div style={{ width: 1, height: 16, background: BORDER }} />
              {/* direction */}
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <span style={{ fontSize: 8, color: DIM, letterSpacing: "0.08em", marginRight: 2 }}>DIR</span>
                {["All","LONG","SHORT"].map(d => (
                  <button key={d} style={selStyle(dirFilter === d)} onClick={() => setDirFilter(d)}>{d}</button>
                ))}
              </div>
              <div style={{ width: 1, height: 16, background: BORDER }} />
              {/* result */}
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <span style={{ fontSize: 8, color: DIM, letterSpacing: "0.08em", marginRight: 2 }}>RESULT</span>
                {["All","WIN","LOSS","BREAKEVEN"].map(r => (
                  <button key={r} style={selStyle(resultFilter === r)} onClick={() => setResultFilter(r)}>{r}</button>
                ))}
              </div>
              <div style={{ width: 1, height: 16, background: BORDER }} />
              {/* date range */}
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <span style={{ fontSize: 8, color: DIM, letterSpacing: "0.08em", marginRight: 2 }}>RANGE</span>
                {["7d","30d","90d","all"].map(d => (
                  <button key={d} style={selStyle(dateFilter === d)} onClick={() => setDateFilter(d)}>{d}</button>
                ))}
              </div>
              <div style={{ flex: 1 }} />
              <button
                onClick={exportCSV}
                disabled={filteredTrades.length === 0}
                style={{
                  fontFamily: mono, fontSize: 8, padding: "3px 10px",
                  background: "transparent", border: `1px solid ${BORDER}`,
                  borderRadius: 2, color: SUB, cursor: filteredTrades.length > 0 ? "pointer" : "default",
                  opacity: filteredTrades.length === 0 ? 0.4 : 1,
                }}
              >
                EXPORT CSV
              </button>
            </div>

            {/* table */}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {tradesLoading ? (
                <div style={{ padding: 32, fontSize: 9, color: DIM, textAlign: "center" }}>Loading…</div>
              ) : filteredTrades.length === 0 ? (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  height: "100%", flexDirection: "column", gap: 8,
                }}>
                  <div style={{ fontSize: 9, color: DIMMER, letterSpacing: "0.1em" }}>NO TRADES RECORDED YET</div>
                  <div style={{ fontSize: 9, color: "#1a1a1a" }}>Trades appear here after the bridge logs them.</div>
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Date","Asset","Dir","Strategy","Entry","Exit","SL","RR Tgt","RR Act","Result","P&L $","IB Lots","D-Score","Session","Notes"].map(h => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrades.map((t, i) => (
                      <tr key={t.id ?? i} style={{ background: i % 2 === 0 ? "transparent" : "#090909" }}>
                        <td style={td}>{t.date}</td>
                        <td style={{ ...td, color: BLUE }}>{t.asset}</td>
                        <td style={{ ...td, color: t.direction === "LONG" ? GREEN : RED }}>{t.direction}</td>
                        <td style={{ ...td, color: SUB }}>{t.strategy ?? "—"}</td>
                        <td style={td}>{fmt2(t.entry)}</td>
                        <td style={td}>{fmt2(t.exit)}</td>
                        <td style={td}>{fmt2(t.sl)}</td>
                        <td style={td}>{fmt2(t.rr_target)}</td>
                        <td style={td}>{fmt2(t.rr_achieved)}</td>
                        <td style={{ ...td, color: resultColor(t.result), fontWeight: 600 }}>{t.result}</td>
                        <td style={{ ...td, color: (t.pnl ?? 0) >= 0 ? GREEN : RED }}>
                          {t.pnl != null ? `$${t.pnl.toFixed(2)}` : "—"}
                        </td>
                        <td style={td}>{t.ib_lots ?? "—"}</td>
                        <td style={td}>{t.d_score ?? "—"}</td>
                        <td style={{ ...td, color: SUB }}>{t.session ?? "—"}</td>
                        <td style={{ ...td, color: SUB, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {t.notes ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ════════════════ SESSION RECORDS TAB ════════════════ */}
        {activeTab === "sessions" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {sessionsLoading ? (
                <div style={{ padding: 32, fontSize: 9, color: DIM, textAlign: "center" }}>Loading…</div>
              ) : sessions.length === 0 ? (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  height: "100%", flexDirection: "column", gap: 8,
                }}>
                  <div style={{ fontSize: 9, color: DIMMER, letterSpacing: "0.1em" }}>NO SESSION RECORDS YET</div>
                  <div style={{ fontSize: 9, color: "#2a2a2a" }}>
                    Sessions auto-populate after the 9–11 AM NY window closes.
                  </div>
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Date","Trades","W/L","Total R","P&L $","IB Rebate","Phase","Notes"].map(h => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s, i) => (
                      <tr key={s.id ?? i} style={{ background: i % 2 === 0 ? "transparent" : "#090909" }}>
                        <td style={td}>{s.date}</td>
                        <td style={td}>{s.trades ?? "—"}</td>
                        <td style={td}>
                          {s.wins != null && s.losses != null
                            ? <><span style={{ color: GREEN }}>{s.wins}W</span> / <span style={{ color: RED }}>{s.losses}L</span></>
                            : "—"
                          }
                        </td>
                        <td style={{ ...td, color: (s.total_r ?? 0) >= 0 ? GREEN : RED }}>
                          {s.total_r != null ? `${s.total_r >= 0 ? "+" : ""}${s.total_r.toFixed(2)}R` : "—"}
                        </td>
                        <td style={{ ...td, color: (s.pnl ?? 0) >= 0 ? GREEN : RED }}>
                          {s.pnl != null ? `$${s.pnl.toFixed(2)}` : "—"}
                        </td>
                        <td style={{ ...td, color: AMBER }}>
                          {s.ib_rebate != null ? `$${s.ib_rebate.toFixed(2)}` : "—"}
                        </td>
                        <td style={{ ...td, color: BLUE }}>{s.phase ?? "—"}</td>
                        <td style={{ ...td, color: SUB, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {s.notes ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
