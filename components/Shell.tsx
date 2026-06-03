"use client";

import { useEffect, useRef, useState } from "react";
import { useHLStream } from "@/hooks/useHLStream";
import { useTrading } from "@/hooks/useTrading";
import Topbar from "@/components/Topbar";
import Sidebar, { type Page } from "@/components/Sidebar";
import SignalToast from "@/components/SignalToast";
import OverviewPage from "@/components/pages/OverviewPage";
import ChartsPage from "@/components/pages/ChartsPage";
import BacktestPage from "@/components/pages/BacktestPage";
import RLAgentPage from "@/components/pages/RLAgentPage";
import DataHubPage from "@/components/pages/DataHubPage";
import JournalPage from "@/components/pages/JournalPage";
import StrategiesPage from "@/components/pages/StrategiesPage";
import type { AISignal } from "@/lib/types";

export default function Shell() {
  const [page, setPage]             = useState<Page>("overview");
  const [unread, setUnread]         = useState(0);
  const [toastSignal, setToastSignal] = useState<AISignal | null>(null);
  const lastAlertId = useRef<number | null>(null);

  const hl      = useHLStream();
  const trading = useTrading();

  // When a new signal_alert arrives via WS, increment unread + show toast
  useEffect(() => {
    const sig = hl.signalAlert;
    if (!sig || sig.signal === "HOLD") return;
    const id = sig.id ?? sig.created_at;
    if (id === lastAlertId.current) return;
    lastAlertId.current = id;

    // Request notification permission once
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }

    setToastSignal(sig);
    setUnread(n => n + 1);
  }, [hl.signalAlert]);

  function handleBell() {
    setPage("strategies");
    setUnread(0);
  }

  function renderPage() {
    switch (page) {
      case "overview":  return <OverviewPage hl={hl} trading={trading} />;
      case "charts":    return <ChartsPage hl={hl} />;
      case "backtest":  return <BacktestPage />;
      case "rl-agent":  return <RLAgentPage hl={hl} />;
      case "data-hub":  return <DataHubPage hl={hl} />;
      case "strategies":  return <StrategiesPage />;
      case "journal":     return <JournalPage />;
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "#070707" }}>
      <Topbar
        prices={hl.prices}
        connected={hl.connected}
        hlAccount={hl.hlAccount}
        unreadSignals={unread}
        onSignalBell={handleBell}
      />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar active={page} onChange={p => { setPage(p); if (p === "strategies") setUnread(0); }} />
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {renderPage()}
        </div>
      </div>

      {/* Toast notification */}
      <SignalToast
        signal={toastSignal}
        onDismiss={() => setToastSignal(null)}
        onNavigate={() => { setPage("strategies"); setUnread(0); setToastSignal(null); }}
      />
    </div>
  );
}
