import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { ProfileData } from "../App.tsx";

interface Notif {
  notification_id: string;
  title: string;
  body: string;
  read: number;
}
interface HistoryRow {
  round_id: string;
  game_id: string;
  bet_amount: number;
  final_win_amount: number;
  jackpot_amount: number;
  created_at: string;
}

export function Profile({
  profile,
  onUpdate,
  onLogout,
}: {
  profile: ProfileData;
  onUpdate: () => Promise<void>;
  onLogout: () => void;
}) {
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  async function load() {
    setNotifs(await api.get<Notif[]>("/player/notifications").catch(() => []));
    setHistory(await api.get<HistoryRow[]>("/history").catch(() => []));
  }
  useEffect(() => {
    load();
  }, []);

  async function markRead(id: string) {
    await api.post(`/player/notifications/${id}/read`);
    setNotifs((n) => n.filter((x) => x.notification_id !== id));
  }

  const unread = notifs.filter((n) => !n.read);

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{profile.username}</div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{profile.role}</div>
          </div>
          <button className="btn secondary" style={{ width: "auto", padding: "8px 14px" }} onClick={onLogout}>
            Odjava
          </button>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <span className="k">Balans</span>
          <span>
            {profile.balance.toFixed(2)} {profile.currency}
          </span>
        </div>
        <div className="row">
          <span className="k">Free bet kasica (1% betova)</span>
          <span style={{ color: "var(--accent)" }}>{profile.freebet_accrued.toFixed(2)}</span>
        </div>
        <div className="row">
          <span className="k">Dodeljeni free bet</span>
          <span style={{ color: "var(--accent-2)" }}>{profile.freebet_granted.toFixed(2)}</span>
        </div>
      </div>

      {unread.length > 0 && (
        <>
          <div className="section-title">Obaveštenja</div>
          {unread.map((n) => (
            <div key={n.notification_id} className="notif" onClick={() => markRead(n.notification_id)}>
              <h4>{n.title}</h4>
              <p>{n.body}</p>
            </div>
          ))}
        </>
      )}

      <div className="section-title">Istorija</div>
      <div className="card" style={{ padding: 8 }}>
        {history.length === 0 && <div style={{ color: "var(--muted)", padding: 8 }}>Još nema rundi.</div>}
        {history.slice(0, 20).map((h) => (
          <div className="row" key={h.round_id} style={{ padding: "8px 6px" }}>
            <span className="k">{h.game_id}</span>
            <span style={{ color: h.final_win_amount + h.jackpot_amount > 0 ? "var(--green)" : "var(--muted)" }}>
              {h.final_win_amount + h.jackpot_amount > 0
                ? `+${(h.final_win_amount + h.jackpot_amount).toFixed(2)}`
                : `−${h.bet_amount.toFixed(2)}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

