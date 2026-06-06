"use client";

export type Page = "overview" | "charts" | "backtest" | "data-hub" | "strategies" | "wallet" | "journal";

interface NavItem {
  id: Page;
  label: string;
  icon: React.ReactNode;
}

// ── SVG Icons (16×16 viewBox, stroke-based, 1.4px, round caps) ──────────────

function IconOverview() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1" width="5.5" height="5.5" rx="1"/>
      <rect x="9.5" y="1" width="5.5" height="5.5" rx="1"/>
      <rect x="1" y="9.5" width="5.5" height="5.5" rx="1"/>
      <rect x="9.5" y="9.5" width="5.5" height="5.5" rx="1"/>
    </svg>
  );
}

function IconCharts() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="1.5" x2="3" y2="14.5"/>
      <rect x="1.5" y="5" width="3" height="5.5" rx="0.5" fill="currentColor" stroke="none" opacity="0.9"/>
      <line x1="8" y1="2" x2="8" y2="14"/>
      <rect x="6.5" y="4.5" width="3" height="5" rx="0.5" fill="currentColor" stroke="none" opacity="0.9"/>
      <line x1="13" y1="3" x2="13" y2="13"/>
      <rect x="11.5" y="6" width="3" height="4" rx="0.5" fill="currentColor" stroke="none" opacity="0.9"/>
    </svg>
  );
}

function IconBacktest() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8.5" cy="8.5" r="5.5"/>
      <polyline points="8.5,5.5 8.5,8.5 10.5,10.5"/>
      <path d="M3 4A7.5 7.5 0 0 1 8.5 2"/>
      <polyline points="1.5,2.5 3,4 4.5,2.5"/>
    </svg>
  );
}

function IconDataHub() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="8" cy="4" rx="5.5" ry="2"/>
      <path d="M2.5 4v3.5c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4"/>
      <path d="M2.5 7.5v4c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V7.5"/>
    </svg>
  );
}

function IconSignals() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 1.5L5 8.5h4l-2.5 6L14 7h-4z" fill="currentColor" stroke="none" opacity="0.8"/>
      <path d="M9.5 1.5L5 8.5h4l-2.5 6L14 7h-4z"/>
    </svg>
  );
}

function IconWallet() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4.5" width="12" height="8.5" rx="1.5"/>
      <path d="M5 4.5V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1.5"/>
      <path d="M10 9h3v3h-3z" fill="currentColor" stroke="none" opacity="0.7"/>
      <line x1="2" y1="7.5" x2="14" y2="7.5"/>
    </svg>
  );
}

function IconJournal() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 1.5h7l2.5 2.5V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z"/>
      <polyline points="11 1.5 11 4 13.5 4"/>
      <line x1="5.5" y1="7" x2="10.5" y2="7"/>
      <line x1="5.5" y1="10" x2="9" y2="10"/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const NAV_ITEMS: NavItem[] = [
  { id: "overview",   label: "Overview",       icon: <IconOverview/> },
  { id: "charts",     label: "Charts",         icon: <IconCharts/>   },
  { id: "backtest",   label: "Backtest",       icon: <IconBacktest/> },
  { id: "data-hub",   label: "Data Hub",       icon: <IconDataHub/>  },
  { id: "strategies", label: "Signal Command", icon: <IconSignals/>  },
];

const BOTTOM_ITEMS: NavItem[] = [
  { id: "wallet",  label: "Wallet",  icon: <IconWallet/>  },
  { id: "journal", label: "Journal", icon: <IconJournal/> },
];

interface Props {
  active: Page;
  onChange: (page: Page) => void;
}

function NavBtn({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      title={item.label}
      onClick={onClick}
      className={`nav-btn${active ? " active" : ""}`}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
    >
      {item.icon}
    </button>
  );
}

export default function Sidebar({ active, onChange }: Props) {
  return (
    <nav
      aria-label="Main navigation"
      style={{
        width: 46,
        background: "#0c0c0c",
        borderRight: "1px solid #161616",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "8px 0",
        gap: 2,
        flexShrink: 0,
      }}
    >
      {NAV_ITEMS.map((item) => (
        <NavBtn
          key={item.id}
          item={item}
          active={active === item.id}
          onClick={() => onChange(item.id)}
        />
      ))}
      <div style={{ flex: 1 }} />
      <div style={{ width: 22, height: 1, background: "#1a1a1a", margin: "4px 0" }} />
      {BOTTOM_ITEMS.map((item) => (
        <NavBtn
          key={item.id}
          item={item}
          active={active === item.id}
          onClick={() => onChange(item.id)}
        />
      ))}
    </nav>
  );
}
