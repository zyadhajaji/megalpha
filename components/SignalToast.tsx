"use client";

import { useEffect, useRef, useState } from "react";
import type { AISignal, AISignalSummary } from "@/lib/types";

const mono = "var(--font-mono, 'IBM Plex Mono', monospace)";
const sans = "var(--font-sans, Inter, sans-serif)";
const GREEN = "#4ecf8a", RED = "#cf4e4e";

function fmtPx(n: number) {
  if (!n || !isFinite(n)) return "";
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: n > 100 ? 1 : 4 });
}

interface Props {
  signal: AISignal | null;
  onDismiss: () => void;
  onNavigate: () => void;   // navigate to Signals page
}

export default function SignalToast({ signal, onDismiss, onNavigate }: Props) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!signal) return;
    // Only animate in when a NEW signal arrives (different id)
    const id = signal.id ?? signal.created_at;
    if (id === prevIdRef.current) return;
    prevIdRef.current = id;

    // Skip HOLD signals
    if (signal.signal === "HOLD") return;

    // Request browser notification permission + show OS notification
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(`MEGALPHA · ${signal.signal} SIGNAL`, {
        body: `${signal.coin}/USDC ${signal.interval} · ${signal.confidence}% confidence\n${signal.reasoning?.slice(0, 100)}`,
        tag: `megalpha-signal-${id}`,
      });
    }

    setLeaving(false);
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => dismiss(), 10_000);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [signal]);

  function dismiss() {
    setLeaving(true);
    setTimeout(() => { setVisible(false); setLeaving(false); onDismiss(); }, 300);
  }

  if (!visible || !signal) return null;

  const isLong  = signal.signal === "LONG";
  const color   = isLong ? GREEN : RED;
  const dimBg   = isLong ? "rgba(78,207,138,0.06)" : "rgba(207,78,78,0.06)";
  const border_ = isLong ? "rgba(78,207,138,0.3)"  : "rgba(207,78,78,0.3)";
  const summary: Partial<AISignalSummary> = signal.summary ?? {};

  return (
    <div
      onClick={onNavigate}
      style={{
        position: "fixed",
        top: 48,
        right: 16,
        zIndex: 9999,
        width: 280,
        background: "#0d0d0d",
        border: `1px solid ${border_}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 5,
        padding: "12px 14px",
        cursor: "pointer",
        opacity: leaving ? 0 : 1,
        transform: leaving ? "translateX(20px)" : "translateX(0)",
        transition: "opacity 0.3s, transform 0.3s",
        boxShadow: `0 4px 24px rgba(0,0,0,0.6), 0 0 12px ${color}22`,
      }}
    >
      {/* Close button */}
      <button
        onClick={e => { e.stopPropagation(); dismiss(); }}
        style={{
          position: "absolute", top: 6, right: 8,
          background: "none", border: "none", color: "#333",
          cursor: "pointer", fontSize: 12, lineHeight: 1,
        }}
      >×</button>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: color, boxShadow: `0 0 6px ${color}`,
          animation: "pulse-dot 1.5s infinite",
        }} />
        <span style={{ fontFamily: mono, fontSize: 8, color: "#444", letterSpacing: "0.08em" }}>
          AI SIGNAL ALERT
        </span>
      </div>

      {/* Coin + direction */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
        <span style={{ fontFamily: sans, fontWeight: 800, fontSize: 16, color: "#e8e8e8" }}>
          {signal.coin}
        </span>
        <span style={{ fontFamily: mono, fontSize: 8, color: "#444" }}>
          /USDC · {signal.interval}
        </span>
        <span style={{
          fontFamily: mono, fontSize: 11, fontWeight: 700, color,
          marginLeft: "auto",
        }}>
          {isLong ? "↑ LONG" : "↓ SHORT"} {signal.confidence}%
        </span>
      </div>

      {/* Entry / SL / TP */}
      {summary.entry ? (
        <div style={{ display: "flex", gap: 12, marginBottom: 6 }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: 7, color: "#2a2a2a" }}>ENTRY</div>
            <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 11, color: "#e8e8e8" }}>
              {fmtPx(summary.entry)}
            </div>
          </div>
          {summary.stop_loss ? (
            <div>
              <div style={{ fontFamily: mono, fontSize: 7, color: "#2a2a2a" }}>SL</div>
              <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 11, color: RED }}>
                {fmtPx(summary.stop_loss)}
              </div>
            </div>
          ) : null}
          {summary.take_profit ? (
            <div>
              <div style={{ fontFamily: mono, fontSize: 7, color: "#2a2a2a" }}>TP</div>
              <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 11, color: GREEN }}>
                {fmtPx(summary.take_profit)}
              </div>
            </div>
          ) : null}
          {summary.risk_reward ? (
            <div>
              <div style={{ fontFamily: mono, fontSize: 7, color: "#2a2a2a" }}>R:R</div>
              <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 11, color: "#cfad4e" }}>
                {summary.risk_reward}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Reasoning snippet */}
      <p style={{
        fontFamily: mono, fontSize: 8, color: "#555",
        lineHeight: 1.6, margin: 0,
      }}>
        {signal.reasoning?.slice(0, 120)}{signal.reasoning?.length > 120 ? "…" : ""}
      </p>

      <div style={{ fontFamily: mono, fontSize: 7, color: "#222", marginTop: 6 }}>
        Click to view all signals →
      </div>
    </div>
  );
}
