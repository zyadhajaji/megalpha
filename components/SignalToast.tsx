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

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="2" y1="2" x2="10" y2="10"/>
      <line x1="10" y1="2" x2="2" y2="10"/>
    </svg>
  );
}

interface PriceItemProps {
  label: string;
  value: string;
  color?: string;
}

function PriceItem({ label, value, color }: PriceItemProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontFamily: mono, fontSize: 7, color: "#555", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ fontFamily: sans, fontWeight: 600, fontSize: 11, color: color ?? "#e8e8e8", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </div>
  );
}

interface Props {
  signal: AISignal | null;
  onDismiss: () => void;
  onNavigate: () => void;
}

export default function SignalToast({ signal, onDismiss, onNavigate }: Props) {
  const [visible, setVisible]   = useState(false);
  const [leaving, setLeaving]   = useState(false);
  const timerRef                = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevIdRef               = useRef<number | null>(null);

  useEffect(() => {
    if (!signal) return;
    const id = signal.id ?? signal.created_at;
    if (id === prevIdRef.current) return;
    prevIdRef.current = id;
    if (signal.signal === "HOLD") return;

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(`CORTISOL · ${signal.signal} SIGNAL`, {
        body: `${signal.coin}/USDC ${signal.interval} · ${signal.confidence}% confidence\n${signal.reasoning?.slice(0, 100)}`,
        tag: `megalpha-signal-${id}`,
      });
    }

    setLeaving(false);
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => dismiss(), 10_000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal]);

  function dismiss() {
    setLeaving(true);
    setTimeout(() => { setVisible(false); setLeaving(false); onDismiss(); }, 280);
  }

  if (!visible || !signal) return null;

  const isLong   = signal.signal === "LONG";
  const color    = isLong ? GREEN : RED;
  const dimBg    = isLong ? "rgba(78,207,138,0.04)" : "rgba(207,78,78,0.04)";
  const borderC  = isLong ? "rgba(78,207,138,0.25)" : "rgba(207,78,78,0.25)";
  const summary: Partial<AISignalSummary> = signal.summary ?? {};

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      onClick={onNavigate}
      style={{
        position: "fixed",
        top: 48,
        right: 16,
        zIndex: 9999,
        width: 292,
        background: "#0d0d0d",
        border: `1px solid ${borderC}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 5,
        padding: "12px 14px",
        cursor: "pointer",
        opacity: leaving ? 0 : 1,
        transform: leaving ? "translateX(14px)" : "translateX(0)",
        transition: "opacity 0.28s cubic-bezier(0.4,0,1,1), transform 0.28s cubic-bezier(0.4,0,1,1)",
        boxShadow: `0 6px 32px rgba(0,0,0,0.7), 0 0 16px ${color}15`,
        animation: leaving ? undefined : "slide-right-in 0.28s cubic-bezier(0.16,1,0.3,1)",
      }}
    >
      {/* Close button */}
      <button
        onClick={e => { e.stopPropagation(); dismiss(); }}
        aria-label="Dismiss signal alert"
        style={{
          position: "absolute",
          top: 8,
          right: 9,
          background: "none",
          border: "none",
          color: "#444",
          cursor: "pointer",
          padding: 2,
          lineHeight: 1,
          borderRadius: 2,
          display: "flex",
          alignItems: "center",
          transition: "color 0.1s",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#888"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#444"; }}
      >
        <CloseIcon />
      </button>

      {/* Badge row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <div style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 6px ${color}bb`,
          animation: "pulse-dot 1.5s ease-in-out infinite",
          flexShrink: 0,
        }} />
        <span style={{
          fontFamily: mono,
          fontSize: 8,
          color: "#555",
          letterSpacing: "0.10em",
          fontWeight: 500,
        }}>
          AI SIGNAL ALERT
        </span>
        <div style={{ flex: 1 }} />
        <span style={{
          fontFamily: mono,
          fontSize: 8,
          color: "#444",
          letterSpacing: "0.04em",
        }}>
          {signal.interval}
        </span>
      </div>

      {/* Coin + direction */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontFamily: sans, fontWeight: 800, fontSize: 17, color: "#e8e8e8", letterSpacing: "-0.02em" }}>
          {signal.coin}
        </span>
        <span style={{ fontFamily: mono, fontSize: 9, color: "#444" }}>/USDC</span>

        {/* Direction chip */}
        <div style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "3px 8px",
          borderRadius: 3,
          background: dimBg,
          border: `1px solid ${borderC}`,
        }}>
          <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color }}>
            {isLong ? "↑" : "↓"}
          </span>
          <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color }}>
            {isLong ? "LONG" : "SHORT"}
          </span>
          <span style={{ fontFamily: mono, fontSize: 10, color: color, opacity: 0.7 }}>
            {signal.confidence}%
          </span>
        </div>
      </div>

      {/* Entry / SL / TP */}
      {summary.entry && summary.entry > 0 && (
        <div style={{
          display: "flex",
          gap: 14,
          marginBottom: 10,
          padding: "8px 10px",
          background: "rgba(255,255,255,0.02)",
          borderRadius: 3,
          border: "1px solid #181818",
        }}>
          <PriceItem label="Entry" value={fmtPx(summary.entry)} />
          {summary.stop_loss && summary.stop_loss > 0 && (
            <PriceItem label="SL" value={fmtPx(summary.stop_loss)} color={RED} />
          )}
          {summary.take_profit && summary.take_profit > 0 && (
            <PriceItem label="TP" value={fmtPx(summary.take_profit)} color={GREEN} />
          )}
          {summary.risk_reward && (
            <PriceItem label="R:R" value={summary.risk_reward} color="#cfad4e" />
          )}
        </div>
      )}

      {/* Reasoning snippet */}
      <p style={{
        fontFamily: mono,
        fontSize: 9,
        color: "#666",
        lineHeight: 1.65,
        margin: 0,
        marginBottom: 8,
      }}>
        {signal.reasoning?.slice(0, 120)}{(signal.reasoning?.length ?? 0) > 120 ? "…" : ""}
      </p>

      <div style={{
        fontFamily: mono,
        fontSize: 8,
        color: "#333",
        letterSpacing: "0.04em",
      }}>
        Click to view all signals →
      </div>
    </div>
  );
}
