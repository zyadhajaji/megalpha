"use client";

export type Page = "overview" | "charts" | "backtest" | "rl-agent" | "data-hub" | "strategies" | "journal";

interface NavItem {
  id: Page;
  label: string;
  symbol: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "overview",    label: "Overview",          symbol: "⊞" },
  { id: "charts",      label: "Charts",            symbol: "◫" },
  { id: "backtest",    label: "Backtest",           symbol: "◷" },
  { id: "rl-agent",    label: "RL Agent",           symbol: "◈" },
  { id: "data-hub",    label: "Data Hub",           symbol: "◉" },
  { id: "strategies",  label: "Signal Command",     symbol: "◆" },
];

const BOTTOM_ITEMS: NavItem[] = [
  { id: "journal", label: "Journal", symbol: "✦" },
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
      style={{
        width: 34,
        height: 34,
        borderRadius: 5,
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14,
        background: active ? "#101e30" : "transparent",
        color: active ? "#4e8ecf" : "#333",
        transition: "all 0.12s",
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = "#111";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {item.symbol}
    </button>
  );
}

export default function Sidebar({ active, onChange }: Props) {
  return (
    <div
      style={{
        width: 46,
        background: "#0c0c0c",
        borderRight: "1px solid #1a1a1a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "10px 0",
        gap: 2,
        flexShrink: 0,
      }}
    >
      {NAV_ITEMS.map((item) => (
        <NavBtn key={item.id} item={item} active={active === item.id} onClick={() => onChange(item.id)} />
      ))}
      <div style={{ flex: 1 }} />
      {BOTTOM_ITEMS.map((item) => (
        <NavBtn key={item.id} item={item} active={active === item.id} onClick={() => onChange(item.id)} />
      ))}
    </div>
  );
}
