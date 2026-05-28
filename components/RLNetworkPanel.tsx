"use client";

import type { RLAgentState } from "@/lib/types";

interface Props {
  rlAgent: RLAgentState | null;
}

const STATUS_COLOR: Record<string, string> = {
  scanning:  "#cfad4e",
  in_trade:  "#4ecf8a",
  training:  "#4e8ecf",
  offline:   "#333",
};

export default function RLNetworkPanel({ rlAgent }: Props) {
  const status   = rlAgent?.status ?? "offline";
  const probs    = rlAgent?.action_probs ?? [0.72, 0.21, 0.07];
  const episode  = rlAgent?.episode ?? 0;
  const session  = rlAgent?.session ?? "—";
  const color    = STATUS_COLOR[status] ?? "#333";
  const labelTxt = status.replace("_", " ").toUpperCase();

  const longPct  = Math.round(probs[0] * 100);
  const holdPct  = Math.round(probs[1] * 100);
  const shortPct = Math.round(probs[2] * 100);

  // Bar widths (max 42px matches the SVG)
  const longBar  = Math.round(probs[0] * 42);
  const holdBar  = Math.round(probs[1] * 42);
  const shortBar = Math.round(probs[2] * 42);

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{
          padding: "7px 12px",
          borderBottom: "1px solid #141414",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 9, color: "#333", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          RL Agent
        </span>
        <span style={{ fontSize: 9, color: "#1c1c1c" }}>·</span>
        <span style={{ fontSize: 9, color: "#333", letterSpacing: "0.1em" }}>Neural Network · PPO</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color }}>● {labelTxt}</span>
        <span style={{ fontSize: 9, color: "#2a2a2a", marginLeft: 10 }}>
          {episode > 0 ? `ep.${episode.toLocaleString()} · ` : ""}128 neurons
        </span>
        {session !== "—" && (
          <span style={{ fontSize: 9, color: "#2a2a2a" }}>· {session}</span>
        )}
      </div>

      {/* SVG neural network */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <svg
          viewBox="0 0 560 115"
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          <defs>
            <radialGradient id="rg-g" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#4ecf8a"/>
              <stop offset="100%" stopColor="#1d4a34" stopOpacity=".4"/>
            </radialGradient>
            <radialGradient id="rg-b" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#4e8ecf"/>
              <stop offset="100%" stopColor="#1d304a" stopOpacity=".4"/>
            </radialGradient>
            <radialGradient id="rg-r" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#cf4e4e"/>
              <stop offset="100%" stopColor="#4a1d1d" stopOpacity=".4"/>
            </radialGradient>
            <radialGradient id="rg-d" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#444"/>
              <stop offset="100%" stopColor="#111" stopOpacity=".4"/>
            </radialGradient>
            <filter id="nn-glow-s"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <filter id="nn-glow-m"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <filter id="nn-glow-l"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>

          {/* Layer labels */}
          {[["48","INPUTS"],["140","HIDDEN 1"],["228","HIDDEN 2"],["316","HIDDEN 3"],["400","HIDDEN 4"],["490","ACTION"]].map(([x, label]) => (
            <text key={label} x={x} y="7" fill="#1e1e1e" fontSize="6" fontFamily="IBM Plex Mono" textAnchor="middle">{label}</text>
          ))}

          {/* Background connections — inputs→h1 */}
          <g opacity=".09" stroke="#4e8ecf" strokeWidth=".5">
            {[[12,13],[12,26],[12,54],[27,13],[27,40],[27,68],[42,26],[42,40],[42,54],[57,40],[57,54],[57,68],[57,82],[72,54],[72,68],[72,82],[87,68],[87,82],[87,96],[102,82],[102,96],[102,110]].map(([iy,hy],i) => (
              <line key={i} x1="48" y1={iy} x2="140" y2={hy}/>
            ))}
          </g>
          {/* h1→h2 */}
          <g opacity=".08" stroke="#4e8ecf" strokeWidth=".5">
            {[[13,13],[13,40],[26,13],[26,40],[26,67],[40,26],[40,53],[54,40],[54,53],[54,67],[68,53],[68,67],[68,80],[82,67],[82,80],[82,94],[96,80],[96,94],[96,108],[110,94],[110,108]].map(([h1y,h2y],i) => (
              <line key={i} x1="140" y1={h1y} x2="228" y2={h2y}/>
            ))}
          </g>
          {/* h2→h3 */}
          <g opacity=".09" stroke="#4ecf8a" strokeWidth=".5">
            {[[13,18],[13,40],[26,18],[26,40],[40,18],[40,40],[40,62],[53,40],[53,62],[67,62],[67,84],[80,62],[80,84],[94,84],[94,106],[108,84],[108,106]].map(([h2y,h3y],i) => (
              <line key={i} x1="228" y1={h2y} x2="316" y2={h3y}/>
            ))}
          </g>
          {/* h3→h4 */}
          <g opacity=".1" stroke="#4ecf8a" strokeWidth=".6">
            {[[18,24],[18,52],[40,24],[40,52],[62,52],[62,80],[84,52],[84,80],[84,96],[106,80],[106,96]].map(([h3y,h4y],i) => (
              <line key={i} x1="316" y1={h3y} x2="400" y2={h4y}/>
            ))}
          </g>
          {/* h4→output */}
          <g opacity=".12" stroke="#4ecf8a" strokeWidth=".7">
            {[[24,34],[24,66],[52,34],[52,66],[80,66],[80,92],[96,66],[96,92]].map(([h4y,oy],i) => (
              <line key={i} x1="400" y1={h4y} x2="490" y2={oy}/>
            ))}
          </g>

          {/* Animated flow paths — main (green) */}
          <line className="nn-flow"    x1="48" y1="12"  x2="140" y2="13"  stroke="#4ecf8a" strokeWidth="1.2"/>
          <line className="nn-flow d1" x1="140" y1="13" x2="228" y2="13"  stroke="#4ecf8a" strokeWidth="1.2"/>
          <line className="nn-flow d2" x1="228" y1="13" x2="316" y2="18"  stroke="#4ecf8a" strokeWidth="1.4"/>
          <line className="nn-flow d3" x1="316" y1="18" x2="400" y2="24"  stroke="#4ecf8a" strokeWidth="1.4"/>
          <line className="nn-flow d4" x1="400" y1="24" x2="490" y2="34"  stroke="#4ecf8a" strokeWidth="1.6"/>
          {/* Secondary path (blue) */}
          <line className="nn-flow d2" x1="48" y1="27"  x2="140" y2="26"  stroke="#4e8ecf" strokeWidth=".9" opacity=".5"/>
          <line className="nn-flow d3" x1="140" y1="26" x2="228" y2="40"  stroke="#4e8ecf" strokeWidth=".9" opacity=".5"/>
          <line className="nn-flow d4" x1="228" y1="40" x2="316" y2="40"  stroke="#4ecf8a" strokeWidth="1"  opacity=".6"/>
          <line className="nn-flow d5" x1="316" y1="40" x2="400" y2="52"  stroke="#4ecf8a" strokeWidth="1"  opacity=".6"/>
          {/* Weak short path */}
          <line className="nn-flow d4" x1="316" y1="106" x2="400" y2="96" stroke="#cf4e4e" strokeWidth=".7" opacity=".25"/>
          <line className="nn-flow d5" x1="400" y1="96"  x2="490" y2="92" stroke="#cf4e4e" strokeWidth=".7" opacity=".2"/>

          {/* Input nodes */}
          <g filter="url(#nn-glow-s)">
            <circle className="nn-active"                    cx="48" cy="12"  r="5.5" fill="url(#rg-b)" stroke="#4e8ecf" strokeWidth=".8"/>
            <circle className="nn-active" style={{animationDelay:".3s"}} cx="48" cy="27" r="5"   fill="url(#rg-b)" stroke="#4e8ecf" strokeWidth=".6"/>
            <circle cx="48" cy="42"  r="4"   fill="url(#rg-d)" stroke="#222" strokeWidth=".5"/>
            <circle className="nn-glow"                      cx="48" cy="57"  r="5"   fill="url(#rg-b)" stroke="#4e8ecf" strokeWidth=".6"/>
            <circle cx="48" cy="72"  r="3.5" fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
            <circle cx="48" cy="87"  r="3.5" fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
            <circle cx="48" cy="102" r="3"   fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
          </g>
          {/* Input labels */}
          {[["4","12","Close"],["4","27","Volume"],["4","42","High"],["4","57","Volatility"],["4","72","OB ratio"],["4","87","Spread"],["4","102","Momentum"]].map(([x,y,lbl]) => (
            <text key={lbl} x={x} y={Number(y)+3} fill="#1e1e1e" fontSize="6" fontFamily="IBM Plex Mono">{lbl}</text>
          ))}

          {/* H1 nodes (8) */}
          <g filter="url(#nn-glow-s)">
            <circle className="nn-active" style={{animationDelay:".4s"}} cx="140" cy="13"  r="6"   fill="url(#rg-g)" stroke="#4ecf8a" strokeWidth=".8"/>
            <circle className="nn-active" style={{animationDelay:".7s"}} cx="140" cy="26"  r="5.5" fill="url(#rg-g)" stroke="#4ecf8a" strokeWidth=".7"/>
            <circle className="nn-glow"   style={{animationDelay:".2s"}} cx="140" cy="40"  r="5"   fill="url(#rg-g)" stroke="#3aaa72" strokeWidth=".6"/>
            <circle className="nn-glow"   style={{animationDelay:".9s"}} cx="140" cy="54"  r="4.5" fill="url(#rg-g)" stroke="#3aaa72" strokeWidth=".5"/>
            <circle cx="140" cy="68"  r="4"   fill="url(#rg-d)" stroke="#222" strokeWidth=".5"/>
            <circle cx="140" cy="82"  r="3.5" fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
            <circle cx="140" cy="96"  r="3"   fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
            <circle cx="140" cy="110" r="3"   fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
          </g>

          {/* H2 nodes (8) */}
          <g filter="url(#nn-glow-s)">
            <circle className="nn-active" style={{animationDelay:".8s"}} cx="228" cy="13"  r="6"   fill="url(#rg-g)" stroke="#4ecf8a" strokeWidth=".8"/>
            <circle cx="228" cy="26"  r="4"   fill="url(#rg-d)" stroke="#222" strokeWidth=".5"/>
            <circle className="nn-glow"   style={{animationDelay:".5s"}} cx="228" cy="40"  r="5"   fill="url(#rg-g)" stroke="#3aaa72" strokeWidth=".6"/>
            <circle className="nn-glow"   style={{animationDelay:"1.1s"}} cx="228" cy="53" r="4.5" fill="url(#rg-g)" stroke="#3aaa72" strokeWidth=".5"/>
            <circle cx="228" cy="67"  r="4"   fill="url(#rg-d)" stroke="#222" strokeWidth=".5"/>
            <circle cx="228" cy="80"  r="3.5" fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
            <circle cx="228" cy="94"  r="3"   fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
            <circle cx="228" cy="108" r="3"   fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
          </g>

          {/* H3 nodes (6) */}
          <g filter="url(#nn-glow-m)">
            <circle className="nn-active" style={{animationDelay:"1.2s"}} cx="316" cy="18"  r="6.5" fill="url(#rg-g)" stroke="#4ecf8a" strokeWidth="1"/>
            <circle className="nn-glow"   style={{animationDelay:".6s"}} cx="316" cy="40"   r="5.5" fill="url(#rg-g)" stroke="#3aaa72" strokeWidth=".7"/>
            <circle cx="316" cy="62"  r="4.5" fill="url(#rg-d)" stroke="#222" strokeWidth=".5"/>
            <circle cx="316" cy="84"  r="4"   fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
            <circle cx="316" cy="106" r="3.5" fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
          </g>

          {/* H4 nodes (4) */}
          <g filter="url(#nn-glow-m)">
            <circle className="nn-active" style={{animationDelay:"1.6s"}} cx="400" cy="24" r="7"   fill="url(#rg-g)" stroke="#4ecf8a" strokeWidth="1"/>
            <circle className="nn-glow"   style={{animationDelay:"1s"}}   cx="400" cy="52" r="5.5" fill="url(#rg-g)" stroke="#3aaa72" strokeWidth=".7"/>
            <circle cx="400" cy="80" r="4"   fill="url(#rg-d)" stroke="#222" strokeWidth=".5"/>
            <circle cx="400" cy="96" r="3.5" fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
          </g>

          {/* Output nodes */}
          <g filter="url(#nn-glow-l)">
            <circle className="nn-output" cx="490" cy="34" r="8" fill="url(#rg-g)" stroke="#4ecf8a" strokeWidth="1.2"/>
            <circle cx="490" cy="66" r="5" fill="url(#rg-d)" stroke="#222" strokeWidth=".5"/>
            <circle cx="490" cy="92" r="4" fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
          </g>

          {/* Output labels + probability bars */}
          <text x="503" y="31" fill="#4ecf8a" fontSize="7" fontFamily="IBM Plex Mono" fontWeight="500">LONG</text>
          <rect x="503" y="33" width="42" height="3" rx="1" fill="#1d4a34"/>
          <rect x="503" y="33" width={longBar} height="3" rx="1" fill="#4ecf8a" opacity=".8"/>
          <text x="548" y="38" fill="#4ecf8a" fontSize="6.5" fontFamily="IBM Plex Mono" textAnchor="end">{longPct}%</text>

          <text x="503" y="61" fill="#2a2a2a" fontSize="7" fontFamily="IBM Plex Mono">HOLD</text>
          <rect x="503" y="63" width="42" height="3" rx="1" fill="#1a1a1a"/>
          <rect x="503" y="63" width={holdBar} height="3" rx="1" fill="#333" opacity=".7"/>
          <text x="548" y="68" fill="#2a2a2a" fontSize="6.5" fontFamily="IBM Plex Mono" textAnchor="end">{holdPct}%</text>

          <text x="503" y="87" fill="#1e1e1e" fontSize="7" fontFamily="IBM Plex Mono">SHORT</text>
          <rect x="503" y="89" width="42" height="3" rx="1" fill="#1a1a1a"/>
          <rect x="503" y="89" width={shortBar} height="3" rx="1" fill="#2a1d1d" opacity=".7"/>
          <text x="548" y="94" fill="#1e1e1e" fontSize="6.5" fontFamily="IBM Plex Mono" textAnchor="end">{shortPct}%</text>
        </svg>
      </div>
    </div>
  );
}
