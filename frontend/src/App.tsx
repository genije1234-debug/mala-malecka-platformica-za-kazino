import { useCallback, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api.ts";
import { useJackpots } from "./ws.ts";
import { JackpotRail } from "./components/JackpotRail.tsx";
import { Login } from "./pages/Login.tsx";
import { Lobby } from "./pages/Lobby.tsx";
import { GameScreen } from "./pages/Game.tsx";
import { Profile } from "./pages/Profile.tsx";

export interface ProfileData {
  player_id: string;
  username: string;
  role: string;
  balance: number;
  currency: string;
  freebet_balance: number;
  freebet_accrued: number;
  freebet_granted: number;
  effective_rtp: number;
  target_rtp: number;
  total_wagered: number;
  total_returned: number;
}

export type View = "lobby" | "game" | "profile";

/** Posle poteza: ili lokalni patch balansa (bez /auth/me), ili pun refresh ako je prazno. */
export type OnUpdate = (patch?: { balance?: number; freebet_balance?: number }) => Promise<void>;

export function App() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("lobby");
  const [gameId, setGameId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const jackpots = useJackpots();

  const refreshProfile = useCallback(async () => {
    try {
      const p = await api.get<ProfileData>("/auth/me");
      setProfile(p);
    } catch {
      setProfile(null);
      setToken(null);
    }
  }, []);

  // Posle poteza igre šaljemo balans iz ODGOVORA poteza (bez dodatnog /auth/me).
  // Ako patch nije prosleđen (npr. iz profila), radimo pun refresh.
  const onUpdate = useCallback(
    async (patch?: { balance?: number; freebet_balance?: number }) => {
      if (patch) {
        setProfile((prev) => (prev ? { ...prev, ...patch } : prev));
        return;
      }
      await refreshProfile();
    },
    [refreshProfile],
  );

  useEffect(() => {
    (async () => {
      if (getToken()) await refreshProfile();
      setLoading(false);
    })();
  }, [refreshProfile]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  if (loading) return <div className="app" />;

  if (!profile) {
    return (
      <div className="app">
        <Login
          onAuth={async () => {
            await refreshProfile();
            setView("lobby");
          }}
        />
      </div>
    );
  }

  const openGame = (id: string) => {
    setGameId(id);
    setView("game");
  };

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          Lucky<span>Brain</span>
        </div>
        <div className="balance-pill">
          <span>
            {profile.balance.toFixed(2)} {profile.currency}
          </span>
          {profile.freebet_balance > 0 && <span className="fb">+{profile.freebet_balance.toFixed(2)} FB</span>}
        </div>
      </div>

      <div className="content">
        {view !== "game" && <JackpotRail jackpots={jackpots} />}

        {view === "lobby" && <Lobby onOpenGame={openGame} />}
        {view === "game" && gameId && (
          <GameScreen
            gameId={gameId}
            profile={profile}
            jackpots={jackpots}
            onBack={() => setView("lobby")}
            onUpdate={onUpdate}
            showToast={showToast}
          />
        )}
        {view === "profile" && <Profile profile={profile} onUpdate={onUpdate} onLogout={() => { setToken(null); setProfile(null); }} />}
      </div>

      <nav className="bottom-nav">
        <button className={`nav-item ${view === "lobby" ? "on" : ""}`} onClick={() => setView("lobby")}>
          <span className="ico">🎰</span>Lobi
        </button>
        <button className={`nav-item ${view === "game" ? "on" : ""}`} onClick={() => gameId && setView("game")}>
          <span className="ico">🎮</span>Igra
        </button>
        <button className={`nav-item ${view === "profile" ? "on" : ""}`} onClick={() => setView("profile")}>
          <span className="ico">👤</span>Profil
        </button>
        {profile.role === "ADMIN" && (
          <a className="nav-item" href="/admin">
            <span className="ico">🛠️</span>Back office
          </a>
        )}
      </nav>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
