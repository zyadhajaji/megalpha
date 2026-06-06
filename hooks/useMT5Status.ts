"use client";

import { useEffect, useState } from "react";
import { BRIDGE_HTTP } from "@/lib/bridge";

export interface MT5StatusData {
  connected:   boolean;
  balance:     number;
  equity:      number;
  profit:      number;
  free_margin: number;
  currency:    string;
  login:       number | string;
  server:      string;
}

const EMPTY: MT5StatusData = {
  connected: false, balance: 0, equity: 0, profit: 0,
  free_margin: 0, currency: "USD", login: 0, server: "",
};

export function useMT5Status(intervalMs = 5000): MT5StatusData {
  const [data, setData] = useState<MT5StatusData>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch(`${BRIDGE_HTTP}/mt5/status`);
        if (r.ok && !cancelled) setData(await r.json());
      } catch { /* server offline */ }
    }
    poll();
    const id = setInterval(poll, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [intervalMs]);

  return data;
}
