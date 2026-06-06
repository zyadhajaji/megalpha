"use client";

import type { Page } from "@/components/Sidebar";

interface Props {
  active: Page;
  onChange: (page: Page) => void;
  unread?: number;
}

const NAV_ITEMS: { id: Page; label: string; icon: React.ReactNode }[] = [
  {
    id: "overview",
    label: "Home",
    icon: (
      <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.5" y="1.5" width="7" height="7" rx="1.5"/>
        <rect x="11.5" y="1.5" width="7" height="7" rx="1.5"/>
        <rect x="1.5" y="11.5" width="7" height="7" rx="1.5"/>
        <rect x="11.5" y="11.5" width="7" height="7" rx="1.5"/>
      </svg>
    ),
  },
  {
    id: "charts",
    label: "Chart",
    icon: (
      <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="2" x2="3" y2="18"/>
        <rect x="1.5" y="7" width="3" height="6" rx="0.5" fill="currentColor" stroke="none" opacity="0.9"/>
        <line x1="10" y1="2" x2="10" y2="18"/>
        <rect x="8.5" y="6" width="3" height="6" rx="0.5" fill="currentColor" stroke="none" opacity="0.9"/>
        <line x1="17" y1="4" x2="17" y2="16"/>
        <rect x="15.5" y="8" width="3" height="5" rx="0.5" fill="currentColor" stroke="none" opacity="0.9"/>
      </svg>
    ),
  },
  {
    id: "strategies",
    label: "Signals",
    icon: (
      <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L6 10.5h5l-3 7.5L18 9h-5z" fill="currentColor" stroke="none" opacity="0.8"/>
        <path d="M12 2L6 10.5h5l-3 7.5L18 9h-5z"/>
      </svg>
    ),
  },
  {
    id: "wallet",
    label: "Wallet",
    icon: (
      <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="16" height="11" rx="2"/>
        <path d="M6 6V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v2"/>
        <path d="M13 11.5h3v3h-3z" fill="currentColor" stroke="none" opacity="0.7"/>
        <line x1="2" y1="9.5" x2="18" y2="9.5"/>
      </svg>
    ),
  },
  {
    id: "backtest",
    label: "Test",
    icon: (
      <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="11" r="7"/>
        <polyline points="10,7 10,11 13,14"/>
        <path d="M4 5A9.5 9.5 0 0 1 10 3"/>
        <polyline points="2,3 4,5 6,3"/>
      </svg>
    ),
  },
];

export default function MobileBottomNav({ active, onChange, unread = 0 }: Props) {
  return (
    <nav
      className="mobile-bottom-nav"
      aria-label="Mobile navigation"
      style={{ alignItems: "stretch", justifyContent: "space-around" }}
    >
      {NAV_ITEMS.map(item => {
        const isActive = active === item.id;
        const showBadge = item.id === "strategies" && unread > 0;
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              background: "none",
              border: "none",
              cursor: "pointer",
              color: isActive ? "#4e8ecf" : "#444",
              padding: "8px 4px",
              position: "relative",
              minHeight: 44,
              transition: "color 0.15s",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {/* Active indicator bar */}
            {isActive && (
              <div style={{
                position: "absolute",
                top: 0, left: "50%",
                transform: "translateX(-50%)",
                width: 28, height: 2,
                borderRadius: "0 0 2px 2px",
                background: "#4e8ecf",
              }} />
            )}

            {/* Badge */}
            {showBadge && (
              <div style={{
                position: "absolute",
                top: 6, right: "calc(50% - 14px)",
                background: "#cf4e4e",
                borderRadius: "50%",
                width: 14, height: 14,
                fontSize: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-mono)",
                color: "#fff",
                fontWeight: 700,
                border: "1px solid #070707",
                zIndex: 1,
              }}>
                {unread > 9 ? "9+" : unread}
              </div>
            )}

            <div style={{ opacity: isActive ? 1 : 0.7 }}>{item.icon}</div>
            <span style={{
              fontSize: 9,
              fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
              fontWeight: isActive ? 600 : 400,
              letterSpacing: "0.04em",
            }}>
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
