// Single source of truth for the Python bridge URL.
// Set NEXT_PUBLIC_BRIDGE_URL in .env.local for cloud deployments.
export const BRIDGE_HTTP =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BRIDGE_URL)
    ? process.env.NEXT_PUBLIC_BRIDGE_URL.replace(/\/$/, "")
    : "http://localhost:8000";

export const BRIDGE_WS = BRIDGE_HTTP.replace(/^http/, "ws");
