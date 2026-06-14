import { useCallback, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api.ts";
import { useJackpots } from "./ws.ts";
import { useWakeLock } from "./useWakeLock.ts";
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

// Sajt kladionice (za povratak iz kazina). Override-uje se sa VITE_OPERATOR_SITE_URL pri buildu.
const OPERATOR_SITE = (import.meta.env.VITE_OPERATOR_SITE_URL as string) || "http://169.40.15.27";

/** Posle poteza: ili lokalni patch balansa (bez /auth/me), ili pun refresh ako je prazno. */
export type OnUpdate = (patch?: { balance?: number; freebet_balance?: number }) => Promise<void>;

export function App() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("lobby");
  const [gameId, setGameId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [payout, setPayout] = useState<{ amount: number; currency: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const jackpots = useJackpots();

  // Drži ekran telefona budnim dok je igrač ulogovan (sprečava screen saver/zatamnjenje).
  useWakeLock(!!profile);

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
      // SSO ulaz sa kladionice: ?token=... -> razmeni za kazino sesiju (bez prijave) i ocisti URL.
      try {
        const params = new URLSearchParams(window.location.search);
        const launch = params.get("token");
        if (launch) {
          const r = await api.post<{ token: string }>("/auth/launch", { token: launch });
          setToken(r.token);
          window.history.replaceState({}, "", window.location.pathname);
          await refreshProfile();
          setLoading(false);
          return;
        }
      } catch {
        /* nevalidan/istekao launch token -> padni na normalnu prijavu */
        window.history.replaceState({}, "", window.location.pathname);
      }
      if (getToken()) await refreshProfile();
      setLoading(false);
    })();
  }, [refreshProfile]);

  // Payout sweep: dok je igrac u kazinu, periodicno proveri da li je stigla isplata tiketa
  // sa kladionice (najcesce jeftino citanje balansa; povlacenje samo kad stvarno ima para).
  // Ako jeste -> prikazi pop-up i osvezi balans.
  useEffect(() => {
    if (!profile) return;
    let stopped = false;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const r = await api.post<{ swept: number; currency: string; balance: number }>("/wallet/sweep");
        if (!stopped && r.swept > 0) {
          setPayout({ amount: r.swept, currency: r.currency });
          await refreshProfile();
        }
      } catch {
        /* sweep je best-effort; tiho ignorisi prolazne greske */
      }
    };
    poll(); // odmah po ulasku: pokupi isplatu stiglu dok korisnik nije bio na sajtu
    const id = setInterval(poll, 30000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [profile?.player_id, refreshProfile]);

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

  // Izlaz nazad na kladionicu: vrati ceo balans (transfer-out) pa otvori sajt kladionice.
  // Otkljucava 'kazino' kontekst -> korisnik ponovo moze da se kladi.
  const leaveToSportsbook = async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      const r = await api.post<{ amount: number; currency: string }>("/wallet/transfer-out");
      if (r.amount > 0) showToast(`Vraćeno ${r.amount.toFixed(2)} ${r.currency} na kladionicu.`);
    } catch {
      /* i ako padne, vodimo korisnika nazad; novac ostaje siguran u kazinu */
    } finally {
      window.location.href = OPERATOR_SITE;
    }
  };

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          Lucky<span>Brain</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="balance-pill">
            <span>
              {profile.balance.toFixed(2)} {profile.currency}
            </span>
            {profile.freebet_balance > 0 && <span className="fb">+{profile.freebet_balance.toFixed(2)} FB</span>}
          </div>
          <button
            onClick={leaveToSportsbook}
            disabled={leaving}
            title="Vrati novac i nazad na kladionicu"
            style={{
              background: "#1f2540", color: "#cdd3f5", border: "1px solid #2a2f4a",
              borderRadius: 10, padding: "8px 12px", fontSize: 13, fontWeight: 700,
              cursor: leaving ? "default" : "pointer", whiteSpace: "nowrap", opacity: leaving ? 0.6 : 1,
            }}
          >
            {leaving ? "..." : "↩ Kladionica"}
          </button>
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

      {payout && (
        <div
          onClick={() => setPayout(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#15182b", color: "#fff", borderRadius: 16, padding: "28px 24px",
              width: "min(86vw, 340px)", textAlign: "center",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)", border: "1px solid #2a2f4a",
            }}
          >
            <div style={{ fontSize: 44, lineHeight: 1 }}>🎉</div>
            <h3 style={{ margin: "12px 0 4px" }}>Isplata sa kladionice</h3>
            <p style={{ margin: "0 0 10px", color: "#9aa0c0" }}>Stigla je isplata tiketa.</p>
            <div style={{ fontSize: 30, fontWeight: 800, color: "#4ade80" }}>
              +{payout.amount.toFixed(2)} {payout.currency}
            </div>
            <p style={{ margin: "8px 0 18px", color: "#9aa0c0", fontSize: 13 }}>
              Dodato na vaš kazino balans.
            </p>
            <button
              onClick={() => setPayout(null)}
              style={{
                background: "#5b6cff", color: "#fff", border: "none", borderRadius: 10,
                padding: "10px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer",
              }}
            >
              U redu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
