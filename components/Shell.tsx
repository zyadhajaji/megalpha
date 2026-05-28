"use client";

import { useState } from "react";
import { useHLStream } from "@/hooks/useHLStream";
import { useTrading } from "@/hooks/useTrading";
import Topbar from "@/components/Topbar";
import Sidebar, { type Page } from "@/components/Sidebar";
import OverviewPage from "@/components/pages/OverviewPage";
import ChartsPage from "@/components/pages/ChartsPage";
import BacktestPage from "@/components/pages/BacktestPage";
import RLAgentPage from "@/components/pages/RLAgentPage";
import DataHubPage from "@/components/pages/DataHubPage";
import JournalPage from "@/components/pages/JournalPage";

export default function Shell() {
  const [page, setPage] = useState<Page>("overview");
  const hl = useHLStream();
  const trading = useTrading();

  function renderPage() {
    switch (page) {
      case "overview":  return <OverviewPage hl={hl} trading={trading} />;
      case "charts":    return <ChartsPage hl={hl} />;
      case "backtest":  return <BacktestPage />;
      case "rl-agent":  return <RLAgentPage hl={hl} />;
      case "data-hub":  return <DataHubPage />;
      case "journal":   return <JournalPage />;
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "#070707" }}>
      <Topbar prices={hl.prices} connected={hl.connected} hlAccount={hl.hlAccount} />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar active={page} onChange={setPage} />
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {renderPage()}
        </div>
      </div>
    </div>
  );
}
