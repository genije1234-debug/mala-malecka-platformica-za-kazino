import { useEffect, useState } from "react";
import type { JackpotState } from "@casino/shared";

export function useJackpots(): JackpotState[] {
  const [jackpots, setJackpots] = useState<JackpotState[]>([]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;

    function connect() {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "jackpots") setJackpots(msg.data);
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        retry = setTimeout(connect, 2000);
      };
    }
    connect();
    return () => {
      clearTimeout(retry);
      ws?.close();
    };
  }, []);

  return jackpots;
}
