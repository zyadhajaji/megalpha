"use client";

import { useEffect, useState } from "react";
import { BRIDGE_HTTP } from "@/lib/bridge";
import type { HLStreamData } from "@/hooks/useHLStream";

const mono = "var(--font-mono, 'IBM Plex Mono', monospace)";
const sans = "var(--font-sans, Inter, sans-serif)";

interface LiveSignal {
  asset: string;
  price: number;
  session: string;
  regime: string;
  bias: string;
  signal_a?: SignalSlot;
  signal_b?: SignalSlot;
  signal_c?: SignalSlot;
  signal_d?: SignalSlot;
}

interface SignalSlot {
  direction: string;
  confidence: number;
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  rr?: number | null;
  score?: number;
  priority?: string;
  conditions?: { label: string; points: number; possible: number }[];
}

const STRAT_META: Record<string, { label: string; color: string; bg: string }> = {
  A: { label: "A · Stop Hunt",    color: "#cfad4e", bg: "rgba(207,173,78,0.08)"  },
  B: { label: "B · Trend Follow", color: "#4ecf8a", bg: "rgba(78,207,138,0.08)" },
  C: { label: "C · Gold Sniper",  color: "#cf4e4e", bg: "rgba(207,78,78,0.08)"  },
  D: { label: "D · Unified",      color: "#4e8ecf", bg: "rgba(78,142,207,0.08)" },
};

const ASSETS = ["BTC", "ETH", "SOL"] as const;

function StratBadge({ letter, sig }: { letter: string; sig: SignalSlot | null | undefined }) {
  const meta = STRAT_META[letter];
  if (!sig || sig.direction === "NEUTRAL") {
    return (
      <div style={{
        padding: "6px 8px",
        background: "#0a0a0a",
        border: "1px solid #1a1a1a",
        borderRadius: 3,
        flex: 1,
        minWidth: 0,
      }}>
        <div style={{ fontFamily: mono, fontSize: 8, color: "#333", marginBottom: 3 }}>{meta.label}</div>
        <div style={{ fontFamily: mono, fontSize: 9, color: "#333" }}>—</div>
      </div>
    );
  }

  const isLong = sig.direction === "LONG";
  const dirColor = isLong ? "#4ecf8a" : "#cf4e4e";
  const conf = Math.min(100, Math.max(0, sig.confidence ?? 0));

  return (
    <div style={{
      padding: "6px 8px",
      background: meta.bg,
      border: `1px solid ${meta.color}28`,
      borderLeft: `2px solid ${meta.color}`,
      borderRadius: 3,
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{ fontFamily: mono, fontSize: 8, color: meta.color, marginBottom: 4, fontWeight: 600 }}>
        {meta.label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
        <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color: dirColor }}>
          {isLong ? "↑" : "↓"} {sig.direction}
        </span>
        <span style={{ fontFamily: mono, fontSize: 9, color: meta.color }}>
          {conf}%
        </span>
      </div>
      {/* Confidence bar */}
      <div style={{ height: 2, background: "#1a1a1a", borderRadius: 1, overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: `${conf}%`,
          background: conf >= 75 ? "#4ecf8a" : conf >= 55 ? "#cfad4e" : "#666",
          borderRadius: 1,
          transition: "width 0.4s ease-out",
        }}/>
      </div>
      {sig.entry != null && sig.entry > 0 && (
        <div style={{ fontFamily: mono, fontSize: 8, color: "#666", marginTop: 3 }}>
          E ${sig.entry.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          {sig.rr != null && ` · R${sig.rr.toFixed(1)}`}
        </div>
      )}
    </div>
  );
}

export default function SignalSummaryPanel({ hl }: { hl: HLStreamData }) {
  const [signals, setSignals] = useState<Record<string, LiveSignal | null>>({ BTC: null, ETH: null, SOL: null });
  const [activeAsset, setActiveAsset] = useState<typeof ASSETS[number]>("BTC");
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<number | null>(null);

  async function fetchSignals(asset: string) {
    setLoading(true);
    try {
      const r = await fetch(`${BRIDGE_HTTP}/signals/live?asset=${asset}`);
      if (r.ok) {
        const data = await r.json();
        const row = Array.isArray(data) ? data[0] : data;
        setSignals(prev => ({ ...prev, [asset]: row ?? null }));
        setLastFetched(Date.now());
      }
    } catch { /* bridge offline */ }
    finally { setLoading(false); }
  }

  useEffect(() => {
    fetchSignals(activeAsset);
    const id = setInterval(() => fetchSignals(activeAsset), 60_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAsset]);

  const sig = signals[activeAsset];
  const autoExec = (hl as unknown as { autoExec?: { mode: string } }).autoExec;

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "7px 12px",
        borderBottom: "1px solid #141414",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexShrink: 0,
      }}>
        <span style={{ fontFamily: mono, fontSize: 9, color: "#555", letterSpacing: "0.10em", textTransform: "uppercase", fontWeight: 500 }}>
          Signal Command
        </span>

        {/* Asset tabs */}
        <div style={{ display: "flex", gap: 2 }}>
          {ASSETS.map(a => (
            <button
              key={a}
              onClick={() => setActiveAsset(a)}
              style={{
                fontFamily: sans,
                fontWeight: activeAsset === a ? 700 : 400,
                fontSize: 11,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: activeAsset === a ? "#e8e8e8" : "#444",
                padding: "1px 5px",
                transition: "color 0.1s",
              }}
            >
              {a}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Session + regime */}
        {sig && (
          <>
            {sig.session && (
              <span style={{
                fontFamily: mono,
                fontSize: 8,
                color: sig.session.includes("PRIMARY") || sig.session.includes("LONDON") ? "#4ecf8a" : "#555",
                letterSpacing: "0.06em",
              }}>
                {sig.session.replace("_", " ")}
              </span>
            )}
            {sig.regime && (
              <span style={{
                fontFamily: mono,
                fontSize: 8,
                color: sig.regime === "TRENDING" ? "#4ecf8a" : sig.regime === "RANGING" ? "#cfad4e" : "#555",
                padding: "1px 5px",
                border: `1px solid ${sig.regime === "TRENDING" ? "rgba(78,207,138,0.2)" : sig.regime === "RANGING" ? "rgba(207,173,78,0.2)" : "#1c1c1c"}`,
                borderRadius: 2,
              }}>
                {sig.regime}
              </span>
            )}
          </>
        )}

        {loading && <span style={{ fontFamily: mono, fontSize: 8, color: "#333" }}>…</span>}

        <button
          onClick={() => fetchSignals(activeAsset)}
          disabled={loading}
          title="Refresh signals"
          style={{
            fontFamily: mono, fontSize: 8,
            background: "none",
            border: "1px solid #1c1c1c",
            borderRadius: 2, color: "#444",
            cursor: loading ? "not-allowed" : "pointer",
            padding: "2px 7px",
            transition: "color 0.1s",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#888"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#444"; }}
        >
          ↻
        </button>
      </div>

      {/* Signal cards */}
      <div style={{ flex: 1, padding: "8px 10px", overflow: "hidden", display: "flex", flexDirection: "column", gap: 6 }}>
        {/* Consensus bias */}
        {sig?.bias && sig.bias !== "NEUTRAL" && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 8px",
            background: sig.bias === "BULLISH" ? "rgba(78,207,138,0.05)" : "rgba(207,78,78,0.05)",
            border: `1px solid ${sig.bias === "BULLISH" ? "rgba(78,207,138,0.12)" : "rgba(207,78,78,0.12)"}`,
            borderRadius: 3,
            flexShrink: 0,
          }}>
            <span style={{
              fontFamily: mono, fontSize: 9, fontWeight: 700,
              color: sig.bias === "BULLISH" ? "#4ecf8a" : "#cf4e4e",
            }}>
              {sig.bias === "BULLISH" ? "↑" : "↓"} {sig.bias}
            </span>
            <span style={{ fontFamily: mono, fontSize: 8, color: "#555" }}>consensus</span>
            {sig.price > 0 && (
              <span style={{ fontFamily: sans, fontWeight: 600, fontSize: 11, color: "#e8e8e8", marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
                ${sig.price.toLocaleString("en-US", { maximumFractionDigits: sig.price > 1000 ? 0 : 2 })}
              </span>
            )}
          </div>
        )}

        {/* Strategy grid */}
        <div style={{ display: "flex", gap: 5, flex: 1, alignItems: "stretch" }}>
          <StratBadge letter="A" sig={sig?.signal_a} />
          <StratBadge letter="B" sig={sig?.signal_b} />
          <StratBadge letter="C" sig={sig?.signal_c} />
          <StratBadge letter="D" sig={sig?.signal_d} />
        </div>

        {/* No signals state */}
        {!sig && !loading && (
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            fontFamily: mono,
            fontSize: 9,
            color: "#333",
            letterSpacing: "0.08em",
          }}>
            server offline — strategies not loaded
          </div>
        )}

        {/* Auto-exec status */}
        {autoExec && autoExec.mode !== "stopped" && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 8px",
            background: autoExec.mode === "live" ? "rgba(207,78,78,0.06)" : "rgba(78,142,207,0.06)",
            border: `1px solid ${autoExec.mode === "live" ? "rgba(207,78,78,0.15)" : "rgba(78,142,207,0.15)"}`,
            borderRadius: 3,
            flexShrink: 0,
          }}>
            <div style={{
              width: 5, height: 5, borderRadius: "50%",
              background: autoExec.mode === "live" ? "#cf4e4e" : "#4e8ecf",
              boxShadow: `0 0 5px ${autoExec.mode === "live" ? "#cf4e4e" : "#4e8ecf"}`,
              animation: "pulse-dot 1.5s ease-in-out infinite",
            }}/>
            <span style={{ fontFamily: mono, fontSize: 8, fontWeight: 700, color: autoExec.mode === "live" ? "#cf4e4e" : "#4e8ecf", letterSpacing: "0.06em" }}>
              AUTO-EXEC {autoExec.mode.toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      {lastFetched && (
        <div style={{
          padding: "4px 12px",
          borderTop: "1px solid #0e0e0e",
          fontFamily: mono,
          fontSize: 8,
          color: "#333",
          flexShrink: 0,
        }}>
          updated {Math.round((Date.now() - lastFetched) / 1000)}s ago · 60s refresh
        </div>
      )}
    </div>
  );
}
