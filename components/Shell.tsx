"use client";

import { useEffect, useRef, useState } from "react";
import { useHLStream } from "@/hooks/useHLStream";
import { useTrading } from "@/hooks/useTrading";
import { useIsMobile } from "@/hooks/useIsMobile";
import Topbar from "@/components/Topbar";
import Sidebar, { type Page } from "@/components/Sidebar";
import MobileBottomNav from "@/components/MobileBottomNav";
import SignalToast from "@/components/SignalToast";
import OverviewPage from "@/components/pages/OverviewPage";
import ChartsPage from "@/components/pages/ChartsPage";
import BacktestPage from "@/components/pages/BacktestPage";
import DataHubPage from "@/components/pages/DataHubPage";
import JournalPage from "@/components/pages/JournalPage";
import StrategiesPage from "@/components/pages/StrategiesPage";
import WalletPage from "@/components/pages/WalletPage";
import LoadingScreen from "@/components/LoadingScreen";
import type { AISignal } from "@/lib/types";

export default function Shell() {
  const [page, setPage]             = useState<Page>("overview");
  const [unread, setUnread]         = useState(0);
  const [toastSignal, setToastSignal] = useState<AISignal | null>(null);
  const lastAlertId = useRef<number | null>(null);

  const hl      = useHLStream();
  const trading = useTrading();
  const isMobile = useIsMobile();

  // Show loading screen until connected + prices + minimum 2.5s for good UX
  const hasPrices = !!(hl.prices?.btc && hl.prices.btc > 0);
  const [minTimePassed, setMinTimePassed] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMinTimePassed(true), 2500); return () => clearTimeout(t); }, []);
  const loadingDone = hl.connected && hasPrices && minTimePassed;

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
      case "data-hub":  return <DataHubPage hl={hl} />;
      case "strategies":  return <StrategiesPage />;
      case "wallet":      return <WalletPage hl={hl} />;
      case "journal":     return <JournalPage />;
    }
  }

  function handleNavChange(p: Page) {
    setPage(p);
    if (p === "strategies") setUnread(0);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden", background: "#070707" }}>
      <LoadingScreen visible={!loadingDone} />
      <Topbar
        prices={hl.prices}
        connected={hl.connected}
        hlAccount={hl.hlAccount}
        unreadSignals={unread}
        onSignalBell={handleBell}
        isMobile={isMobile}
      />
      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>
        {/* Desktop sidebar — hidden on mobile */}
        <div className="desktop-sidebar">
          <Sidebar active={page} onChange={handleNavChange} />
        </div>
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          {renderPage()}
        </div>
      </div>

      {/* Mobile bottom nav */}
      <MobileBottomNav active={page} onChange={handleNavChange} unread={unread} />

      {/* Toast notification */}
      <SignalToast
        signal={toastSignal}
        onDismiss={() => setToastSignal(null)}
        onNavigate={() => { setPage("strategies"); setUnread(0); setToastSignal(null); }}
      />
    </div>
  );
}
