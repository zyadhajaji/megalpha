"use client";

import { useEffect, useState } from "react";

const mono = "var(--font-mono, 'IBM Plex Mono', monospace)";
const sans = "var(--font-sans, Inter, sans-serif)";

const STEPS = [
  "Connecting...",
  "Loading market data...",
  "Syncing candles...",
  "Ready",
];

interface Props {
  visible: boolean;
}

export default function LoadingScreen({ visible }: Props) {
  const [removed,  setRemoved]  = useState(false);
  const [opacity,  setOpacity]  = useState(1);
  const [stepIdx,  setStepIdx]  = useState(0);
  const [progress, setProgress] = useState(0);
  const [imgFailed, setImgFailed] = useState(false);

  // Step + progress animation
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    STEPS.forEach((_, i) => timers.push(setTimeout(() => setStepIdx(i), i * 380)));
    const bar = setInterval(() => setProgress(p => p >= 92 ? p : Math.min(92, p + Math.random() * 10 + 3)), 200);
    return () => { timers.forEach(clearTimeout); clearInterval(bar); };
  }, []);

  // Fade out when done
  useEffect(() => {
    if (!visible) {
      setProgress(100);
      setStepIdx(STEPS.length - 1);
      setTimeout(() => setOpacity(0), 300);
      setTimeout(() => setRemoved(true), 1000);
    }
  }, [visible]);

  if (removed) return null;

  return (
    <div style={{
      position:       "fixed",
      inset:          0,
      zIndex:         9999,
      background:     "#070707",
      display:        "flex",
      flexDirection:  "column",
      alignItems:     "center",
      justifyContent: "center",
      opacity,
      transition:     "opacity 0.7s ease",
      pointerEvents:  opacity === 0 ? "none" : "all",
    }}>

      {/* ── Logo ── */}
      <div style={{ marginBottom: 32 }}>
        {!imgFailed ? (
          <img
            src="/cortisol-logo.png"
            alt="CORTISOL"
            onError={() => setImgFailed(true)}
            style={{
              width:     "clamp(280px, 70vw, 500px)",
              height:    "auto",
              display:   "block",
              mixBlendMode: "screen",  // makes white bg transparent on dark
            }}
          />
        ) : (
          <div style={{
            fontFamily:    sans,
            fontWeight:    900,
            fontSize:      "clamp(56px, 14vw, 100px)",
            letterSpacing: "-0.03em",
            color:         "#e8e8e8",
            userSelect:    "none",
          }}>
            COR<span style={{ color: "#4e8ecf" }}>TISOL</span>
          </div>
        )}
      </div>

      {/* ── Progress bar ── */}
      <div style={{ width: "clamp(240px, 50vw, 340px)" }}>
        <div style={{
          height:       2,
          background:   "#161616",
          borderRadius: 2,
          overflow:     "hidden",
          marginBottom: 12,
        }}>
          <div style={{
            height:     "100%",
            width:      `${progress}%`,
            background: "#4e8ecf",
            borderRadius: 2,
            transition: "width 0.2s ease",
          }} />
        </div>

        {/* Status */}
        <div style={{
          fontFamily:    mono,
          fontSize:      10,
          color:         "#444",
          letterSpacing: "0.06em",
          textAlign:     "center",
        }}>
          {STEPS[stepIdx]}
        </div>
      </div>
    </div>
  );
}
