"use client";

import { useEffect, useState } from "react";
import type { HLStreamData } from "@/hooks/useHLStream";
import { BRIDGE_HTTP } from "@/lib/bridge";
import { useTrading } from "@/hooks/useTrading";

const mono = "var(--font-mono, 'IBM Plex Mono', monospace)";
const sans = "var(--font-sans, Inter, sans-serif)";

const GREEN = "#4ecf8a";
const RED = "#cf4e4e";
const BLUE = "#4e8ecf";
const GRAY = "#9a9a9a";

interface Feature { key: string; label: string; value: number; }
interface Paper {
  equity: number; realized: number; unrealized: number;
  trades: number; win_rate: number; max_dd: number; position: number;
}
interface RLState {
  status: string;
  confidence: number;
  action_probs: [number, number, number]; // [long, hold, short]
  episode: number;
  session: string;
  last_action: string | null;
  position?: number;
  features?: Feature[];
  paper?: Paper;
  last_pnl?: number | null;
}
interface HistPoint { t: number; price: number; position: number; equity: number; }
interface RLStatus {
  loaded: boolean;
  meta: { coin?: string; interval?: string; size_usd?: number; leverage?: number };
  state: RLState | null;
  history?: HistPoint[];
}

const fmtUsd = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`;
const posWord = (p?: number) => (p == null || p === 0 ? "FLAT" : p > 0 ? "LONG" : "SHORT");

export default function RLAgentPage({ hl }: { hl: HLStreamData }) {
  const [status, setStatus] = useState<RLStatus | null>(null);

  // live-execution form state
  const [execSize, setExecSize]         = useState("200");
  const [execLev, setExecLev]           = useState("5");
  const [execStop, setExecStop]         = useState("0");
  const [execMaxDD, setExecMaxDD]       = useState("0");
  const [execSlip, setExecSlip]         = useState("5");
  const [execPostOnly, setExecPostOnly] = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);
  const [execMsg, setExecMsg]           = useState<string | null>(null);

  const { loading: execLoading, hlOpen, hlClose } = useTrading();

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`${BRIDGE_HTTP}/rl/status`);
        if (!r.ok) return;
        const d = await r.json();
        if (alive) setStatus(d);
      } catch { /* server offline */ }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const st = status?.state ?? null;
  const loaded = status?.loaded ?? false;
  const meta = status?.meta ?? {};
  const history = status?.history ?? [];
  const paper = st?.paper ?? null;
  const coin = (meta.coin ?? "BTC").toLowerCase();
  const livePx = hl.prices ? (hl.prices as unknown as Record<string, number>)[coin] ?? 0 : 0;

  const decision = st?.last_action?.split(" ").pop() ?? "—";
  const decisionColor = decision === "LONG" ? GREEN : decision === "SHORT" ? RED : GRAY;

  return (
    <div style={{ height: "100%", padding: 16, display: "flex", flexDirection: "column", gap: 14, overflow: "auto" }}>

      {/* ── Status banner ── */}
      <div className="panel" style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{
          width: 9, height: 9, borderRadius: "50%",
          background: loaded ? GREEN : "#cfad4e",
          boxShadow: loaded ? `0 0 8px ${GREEN}` : "none",
        }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 16, color: "#e8e8e8" }}>
            {loaded ? "RL AGENT ONLINE" : "RL AGENT NOT TRAINED"}
          </div>
          <div style={{ fontFamily: mono, fontSize: 10, color: "#666", marginTop: 2 }}>
            {loaded
              ? `PPO · ${(meta.coin ?? "?")} ${meta.interval ?? ""} · ${meta.leverage ?? "?"}× · $${meta.size_usd ?? "?"}/trade · paper-forward (simulated $)`
              : "Train a policy to bring the agent online (steps below)"}
          </div>
        </div>
        {loaded && livePx > 0 && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: mono, fontSize: 9, color: "#444" }}>{(meta.coin ?? "").toUpperCase()} MARK</div>
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 16, color: "#e8e8e8" }}>
              ${livePx.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
        )}
      </div>

      {loaded && st && (
        <>
          {/* ── Live decision + paper-forward ── */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>

            {/* Decision */}
            <div className="panel" style={{ padding: "14px 18px", flex: "1 1 300px", minWidth: 280 }}>
              <SectionLabel>LIVE DECISION · {st.session?.toUpperCase()} · EP {st.episode}</SectionLabel>
              <div style={{ display: "flex", gap: 24, alignItems: "flex-end", marginBottom: 16 }}>
                <div>
                  <div style={{ fontFamily: mono, fontSize: 9, color: "#444", marginBottom: 3 }}>DECISION</div>
                  <div style={{ fontFamily: sans, fontWeight: 800, fontSize: 30, color: decisionColor, lineHeight: 1 }}>
                    {decision}
                  </div>
                </div>
                <Stat label="Confidence" value={`${(st.confidence * 100).toFixed(0)}%`} />
                <Stat label="Holding" value={posWord(st.position)}
                      color={st.position ? (st.position > 0 ? GREEN : RED) : GRAY} />
              </div>
              <ProbBar label="LONG"  pct={st.action_probs[0]} color={GREEN} />
              <ProbBar label="HOLD"  pct={st.action_probs[1]} color={GRAY} />
              <ProbBar label="SHORT" pct={st.action_probs[2]} color={RED} />
            </div>

            {/* Paper-forward */}
            <div className="panel" style={{ padding: "14px 18px", flex: "1.3 1 340px", minWidth: 320 }}>
              <SectionLabel>PAPER-FORWARD · SIMULATED $ ON LIVE PRICES</SectionLabel>
              <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginBottom: 14 }}>
                <Stat label="Equity" big
                      value={paper ? fmtUsd(paper.equity) : "—"}
                      color={paper && paper.equity < 0 ? RED : GREEN} />
                <Stat label="Realized" value={paper ? fmtUsd(paper.realized) : "—"}
                      color={paper && paper.realized < 0 ? RED : GREEN} />
                <Stat label="Open P&L" value={paper ? fmtUsd(paper.unrealized) : "—"}
                      color={paper && paper.unrealized < 0 ? RED : GREEN} />
                <Stat label="Trades" value={paper ? String(paper.trades) : "—"} />
                <Stat label="Win rate" value={paper ? `${paper.win_rate}%` : "—"} />
                <Stat label="Max DD" value={paper ? `$${paper.max_dd.toFixed(2)}` : "—"} color={RED} />
              </div>
              <Sparkline points={history.map((h) => h.equity)} />
              <div style={{ fontFamily: mono, fontSize: 9, color: "#555", marginTop: 6 }}>
                equity path · last {history.length} ticks · resets on bridge restart
              </div>
            </div>
          </div>

          {/* ── What the agent sees ── */}
          <div className="panel" style={{ padding: "14px 18px" }}>
            <SectionLabel>WHAT THE AGENT SEES · 12-FEATURE OBSERVATION</SectionLabel>
            {st.features && st.features.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 28, rowGap: 0 }}>
                {st.features.map((f) => <FeatureGauge key={f.key} label={f.label} value={f.value} />)}
              </div>
            ) : (
              <div style={{ fontFamily: mono, fontSize: 11, color: "#666" }}>waiting for first inference…</div>
            )}
            <div style={{ fontFamily: mono, fontSize: 9, color: "#555", marginTop: 10, lineHeight: 1.7 }}>
              Each value is normalized to [−1, +1]. Reward in training = leveraged return − fees − turnover − drawdown.<br />
              Inference + paper fill run every 10s against the latest live price.
            </div>
          </div>

          {/* ── Live execution (only when HL trading is configured) ── */}
          {hl.hlConfigured && (
            <div className="panel" style={{ padding: "14px 18px", border: "1px solid #2a1a1a" }}>
              <SectionLabel>LIVE EXECUTION · REAL HYPERLIQUID ORDERS · NOT PAPER TRADING</SectionLabel>

              {hl.liveHalted && (
                <div style={{ fontFamily: mono, fontSize: 10, color: "#cf4e4e", background: "#1a0808", border: "1px solid #3a1010", borderRadius: 3, padding: "6px 10px", marginBottom: 12 }}>
                  ⚠ MAX-DRAWDOWN KILL-SWITCH ACTIVE — restart the bridge to reset
                </div>
              )}

              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
                <ExecInput label="Size USD" value={execSize} onChange={setExecSize} prefix="$" width={72} />
                <ExecInput label="Leverage" value={execLev} onChange={setExecLev} suffix="×" width={44} />
                <ExecInput label="Stop %" value={execStop} onChange={setExecStop} width={44} />
                <ExecInput label="Max DD %" value={execMaxDD} onChange={setExecMaxDD} width={44} />
                <ExecInput label="Slip bps" value={execSlip} onChange={setExecSlip} width={44} />
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: mono, fontSize: 10, color: "#888", cursor: "pointer" }}>
                  <input type="checkbox" checked={execPostOnly} onChange={(e) => setExecPostOnly(e.target.checked)} style={{ accentColor: "#4e8ecf" }} />
                  post-only
                </label>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  disabled={execLoading || decision === "HOLD" || decision === "—" || hl.liveHalted}
                  onClick={() => { setExecMsg(null); setShowConfirm(true); }}
                  style={{
                    fontFamily: mono, fontSize: 11, fontWeight: 700, padding: "7px 18px",
                    background: execLoading || decision === "HOLD" || hl.liveHalted ? "#111" : (decision === "LONG" ? "#071a0e" : "#1a0808"),
                    border: `1px solid ${execLoading || decision === "HOLD" || hl.liveHalted ? "#1a1a1a" : (decision === "LONG" ? "#0e3320" : "#3a1010")}`,
                    borderRadius: 3, color: execLoading || decision === "HOLD" || hl.liveHalted ? "#333" : decisionColor,
                    cursor: execLoading || decision === "HOLD" || hl.liveHalted ? "not-allowed" : "pointer",
                  }}
                >
                  {execLoading ? "EXECUTING…" : `EXECUTE ${decision} (CONFIRM)`}
                </button>

                {hl.hlAccount && (
                  <button
                    disabled={execLoading}
                    onClick={async () => {
                      const coin = (meta.coin ?? "BTC").toUpperCase();
                      setExecMsg(null);
                      const r = await hlClose(coin);
                      setExecMsg(r.ok ? `Closed ${coin}` : (r.error ?? "Close failed"));
                    }}
                    style={{ fontFamily: mono, fontSize: 10, padding: "5px 14px", background: "none", border: "1px solid #2a1a1a", borderRadius: 3, color: "#aa3a3a", cursor: execLoading ? "not-allowed" : "pointer" }}
                  >
                    CLOSE POSITION
                  </button>
                )}

                {execMsg && (
                  <span style={{ fontFamily: mono, fontSize: 10, color: execMsg.startsWith("Closed") || execMsg.startsWith("Order") ? GREEN : RED }}>
                    {execMsg}
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Confirm modal ── */}
      {showConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ background: "#0c0c0c", border: "1px solid #3a1010", borderRadius: 4, padding: 24, width: 380, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: "#cf4e4e", letterSpacing: "0.1em" }}>⚠ REAL ORDER CONFIRMATION</div>
            <div style={{ fontFamily: mono, fontSize: 11, color: "#e8e8e8", lineHeight: 1.7 }}>
              You are about to place a <strong style={{ color: decisionColor }}>{decision}</strong> order on Hyperliquid.<br />
              <span style={{ color: "#888" }}>This is NOT paper trading — real USDC will be used.</span>
            </div>
            <div style={{ background: "#070707", border: "1px solid #1c1c1c", borderRadius: 3, padding: "10px 14px", fontFamily: mono, fontSize: 10, lineHeight: 2, color: "#aaa" }}>
              <div><span style={{ color: "#555" }}>coin</span>     {(meta.coin ?? "BTC").toUpperCase()}</div>
              <div><span style={{ color: "#555" }}>direction</span>  <span style={{ color: decisionColor }}>{decision}</span></div>
              <div><span style={{ color: "#555" }}>margin</span>    ${parseFloat(execSize) || 0}</div>
              <div><span style={{ color: "#555" }}>leverage</span>  {parseInt(execLev) || 5}×</div>
              <div><span style={{ color: "#555" }}>notional</span>  ~${((parseFloat(execSize) || 0) * (parseInt(execLev) || 5)).toFixed(0)}</div>
              {parseFloat(execStop) > 0 && <div><span style={{ color: "#555" }}>stop loss</span> {execStop}% margin</div>}
              {parseFloat(execMaxDD) > 0 && <div><span style={{ color: "#555" }}>kill DD</span>   {execMaxDD}%</div>}
              {execPostOnly && <div><span style={{ color: "#555" }}>order type</span> post-only (ALO)</div>}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setShowConfirm(false)} style={{ fontFamily: mono, fontSize: 11, padding: "6px 16px", background: "none", border: "1px solid #1c1c1c", borderRadius: 3, color: "#888", cursor: "pointer" }}>
                CANCEL
              </button>
              <button
                onClick={async () => {
                  setShowConfirm(false);
                  const coin    = (meta.coin ?? "BTC").toUpperCase();
                  const is_buy  = decision === "LONG";
                  const r = await hlOpen(coin, is_buy, parseFloat(execSize) || 200, parseInt(execLev) || 5, {
                    slippage_tolerance_bps: parseFloat(execSlip) || 0,
                    stop_loss_pct:   (parseFloat(execStop) || 0) / 100,
                    max_drawdown_pct:(parseFloat(execMaxDD) || 0) / 100,
                    post_only: execPostOnly,
                  });
                  setExecMsg(r.ok ? `Order sent — ${coin} ${decision}` : (r.error ?? "Order failed"));
                }}
                style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, padding: "6px 18px", background: decision === "LONG" ? "#071a0e" : "#1a0808", border: `1px solid ${decision === "LONG" ? "#0e3320" : "#3a1010"}`, borderRadius: 3, color: decisionColor, cursor: "pointer" }}
              >
                CONFIRM {decision}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Retrain-to-activate panel (when not loaded or no active inference) ── */}
      {(!loaded || !st?.status) && (
        <div className="panel" style={{
          padding: "20px 22px",
          border: "1px solid #cfad4e33",
          borderLeft: "3px solid #cfad4e",
          background: "rgba(207,173,78,0.03)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: "#cfad4e",
            }} />
            <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: "#cfad4e", letterSpacing: "0.06em" }}>
              RL AGENT — INFERENCE DISABLED
            </div>
          </div>
          <div style={{ fontFamily: mono, fontSize: 10, color: "#888", lineHeight: 1.8, marginBottom: 16 }}>
            The PPO model is loaded but inference is paused. The current ETH 4h model learned to HOLD (abstention).
            Retrain to activate.
          </div>
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontFamily: mono, fontSize: 8, color: "#444", letterSpacing: "0.08em", marginBottom: 6 }}>
              DEFAULT — ETH 4H · 500K STEPS
            </div>
            <div style={{
              fontFamily: mono, fontSize: 11, color: "#cfad4e",
              background: "#0c0c0c", border: "1px solid #cfad4e22",
              borderRadius: 3, padding: "9px 14px",
              letterSpacing: "0.02em",
            }}>
              python server/train_rl.py
            </div>
          </div>
          <div style={{ fontFamily: mono, fontSize: 9, color: "#555", marginTop: 10 }}>
            After training, restart the bridge to load the new policy.
          </div>
        </div>
      )}

      {/* ── How to train (when offline) ── */}
      {!loaded && (
        <div className="panel" style={{ padding: "14px 18px" }}>
          <SectionLabel>HOW TO TRAIN</SectionLabel>
          <ol style={{ margin: 0, paddingLeft: 18, fontFamily: mono, fontSize: 11, color: "#aaa", lineHeight: 1.9 }}>
            <li>Install deps: <Code>pip install gymnasium stable-baselines3 torch</Code></li>
            <li>Run the bridge once so candles are cached</li>
            <li>Train: <Code>python server/train_rl.py --coin BTC --interval 1h --steps 200000</Code></li>
            <li>Restart the bridge — the policy auto-loads and this panel goes live</li>
          </ol>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: mono, fontSize: 9, color: "#444", letterSpacing: "0.1em", marginBottom: 12 }}>
      {children}
    </div>
  );
}

function Stat({ label, value, big, color }: { label: string; value: string; big?: boolean; color?: string }) {
  return (
    <div>
      <div style={{ fontFamily: mono, fontSize: 9, color: "#444", marginBottom: 3 }}>{label.toUpperCase()}</div>
      <div style={{ fontFamily: sans, fontWeight: 700, fontSize: big ? 22 : 14, color: color ?? "#e8e8e8" }}>{value}</div>
    </div>
  );
}

function ProbBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
      <span style={{ fontFamily: mono, fontSize: 10, color: "#888", width: 44 }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: "#141414", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${Math.round(pct * 100)}%`, height: "100%", background: color, transition: "width 0.4s" }} />
      </div>
      <span style={{ fontFamily: mono, fontSize: 10, color: "#888", width: 36, textAlign: "right" }}>
        {(pct * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function FeatureGauge({ label, value }: { label: string; value: number }) {
  const v = Math.max(-1, Math.min(1, value));
  const pos = v >= 0;
  const widthPct = Math.abs(v) * 50;
  const leftPct = pos ? 50 : 50 - widthPct;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <span style={{ fontFamily: mono, fontSize: 10, color: "#999", width: 130, flexShrink: 0 }}>{label}</span>
      <div style={{ position: "relative", flex: 1, height: 8, background: "#141414", borderRadius: 3 }}>
        <div style={{ position: "absolute", left: "50%", top: -1, bottom: -1, width: 1, background: "#333" }} />
        <div style={{
          position: "absolute", top: 0, bottom: 0, left: `${leftPct}%`, width: `${widthPct}%`,
          background: pos ? GREEN : RED, borderRadius: 2, transition: "all 0.4s",
        }} />
      </div>
      <span style={{ fontFamily: mono, fontSize: 10, color: "#aaa", width: 46, textAlign: "right", flexShrink: 0 }}>
        {value >= 0 ? "+" : ""}{value.toFixed(2)}
      </span>
    </div>
  );
}

function Sparkline({ points, height = 70 }: { points: number[]; height?: number }) {
  if (points.length < 2) {
    return (
      <div style={{
        height, display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: mono, fontSize: 10, color: "#555", background: "#0a0a0a", borderRadius: 4,
      }}>
        collecting equity data…
      </div>
    );
  }
  const min = Math.min(...points, 0);
  const max = Math.max(...points, 0);
  const range = max - min || 1;
  const W = 100;
  const H = height;
  const step = W / (points.length - 1);
  const y = (v: number) => H - ((v - min) / range) * H;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(2)},${y(p).toFixed(2)}`).join(" ");
  const last = points[points.length - 1];
  const color = last >= 0 ? GREEN : RED;
  const zeroY = y(0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
         style={{ width: "100%", height, background: "#0a0a0a", borderRadius: 4 }}>
      <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="#2a2a2a" strokeWidth="0.5" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code style={{
      fontFamily: mono, fontSize: 10, color: BLUE,
      background: "#0a0a0a", border: "1px solid #1c1c1c",
      borderRadius: 3, padding: "1px 6px",
    }}>
      {children}
    </code>
  );
}

function ExecInput({ label, value, onChange, prefix, suffix, width = 72 }: {
  label: string; value: string; onChange: (v: string) => void;
  prefix?: string; suffix?: string; width?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ fontFamily: mono, fontSize: 8, color: "#444", letterSpacing: "0.08em" }}>{label.toUpperCase()}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        {prefix && <span style={{ fontFamily: mono, fontSize: 10, color: "#444" }}>{prefix}</span>}
        <input value={value} onChange={(e) => onChange(e.target.value)} style={{
          width, fontFamily: mono, fontSize: 11, background: "#0a0a0a", border: "1px solid #1c1c1c",
          borderRadius: 2, color: "#e8e8e8", padding: "3px 6px", outline: "none",
        }} />
        {suffix && <span style={{ fontFamily: mono, fontSize: 10, color: "#444" }}>{suffix}</span>}
      </div>
    </div>
  );
}
