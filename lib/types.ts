// lib/types.ts
// Single source of truth for types shared across hooks and components.

export interface Candle {
  time: number;   // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface HLPosition {
  coin: string;
  size: number;           // positive = long, negative = short
  entry_px: number;
  unrealized_pnl: number;
  liq_px: string | null;
  leverage_type: string;
  leverage_value: number;
  is_long: boolean;
}

export interface HLAccount {
  address: string;
  account_value: number;
  total_margin_used: number;
  withdrawable: number;
  positions: HLPosition[];
}

export interface Trade {
  id: string;
  coin: string;
  direction: "LONG" | "SHORT";
  entry_px: number;
  exit_px: number | null;
  size_usd: number;
  leverage: number;
  pnl: number | null;
  reason: string;         // agent reasoning snippet
  open_time: number;      // unix ms
  close_time: number | null;
}

export interface RLAgentState {
  status: "scanning" | "in_trade" | "training" | "offline";
  confidence: number;             // 0–1
  action_probs: [number, number, number]; // [long%, hold%, short%] sum = 1
  episode: number;
  session: string;                // "London" | "NY" | "Asia" | "Off-hours"
  last_action: string | null;     // "BTC LONG" etc.
  last_pnl: number | null;
}
