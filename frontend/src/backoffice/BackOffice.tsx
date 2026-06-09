import { useCallback, useEffect, useState } from "react";
import { api, getToken, setToken } from "../api.ts";
import "./backoffice.css";

type Section = "overview" | "players" | "games" | "jackpots" | "transactions" | "audit";

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "overview", label: "Pregled", icon: "📊" },
  { id: "players", label: "Igrači", icon: "👥" },
  { id: "games", label: "Igre", icon: "🎮" },
  { id: "jackpots", label: "Jackpotovi", icon: "💰" },
  { id: "transactions", label: "Transakcije", icon: "🧾" },
  { id: "audit", label: "Audit & Review", icon: "🛡️" },
];

export function BackOffice() {
  const [me, setMe] = useState<{ username: string; role: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>("overview");

  const check = useCallback(async () => {
    try {
      const p = await api.get<{ username: string; role: string }>("/auth/me");
      setMe(p.role === "ADMIN" ? p : null);
    } catch {
      setMe(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (getToken()) check();
    else setLoading(false);
  }, [check]);

  if (loading) return <div className="bo-root" />;
  if (!me) return <AdminLogin onAuth={check} />;

  return (
    <div className="bo-root">
      <aside className="bo-side">
        <div className="bo-logo">
          Lucky<span>Brain</span>
          <small>Back Office</small>
        </div>
        <nav>
          {SECTIONS.map((s) => (
            <button key={s.id} className={`bo-nav ${section === s.id ? "on" : ""}`} onClick={() => setSection(s.id)}>
              <span>{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>
        <div className="bo-side-foot">
          <div className="bo-user">{me.username}</div>
          <button
            className="bo-btn ghost"
            onClick={() => {
              setToken(null);
              setMe(null);
            }}
          >
            Odjava
          </button>
          <a className="bo-link" href="/">
            → Igrački frontend
          </a>
        </div>
      </aside>

      <main className="bo-main">
        <header className="bo-top">
          <h1>{SECTIONS.find((s) => s.id === section)?.label}</h1>
          <div className="bo-top-actions">
            <RestartButton />
            <div className="bo-live">
              <i /> uživo
            </div>
          </div>
        </header>
        <div className="bo-content">
          {section === "overview" && <Overview />}
          {section === "players" && <Players />}
          {section === "games" && <Games />}
          {section === "jackpots" && <Jackpots />}
          {section === "transactions" && <Transactions />}
          {section === "audit" && <AuditReview />}
        </div>
      </main>
    </div>
  );
}

function RestartButton() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function reset() {
    if (!window.confirm("Resetovati stanje OD NULE?\n\nBriše se sva istorija igranja, jackpotovi i balansi se vraćaju na početak. Igre i nalozi ostaju.")) return;
    setBusy(true);
    try {
      await api.post("/admin/reset", {});
      setDone(true);
      setTimeout(() => window.location.reload(), 700);
    } catch {
      setBusy(false);
      window.alert("Reset nije uspeo.");
    }
  }

  return (
    <button className="bo-btn danger" onClick={reset} disabled={busy}>
      {busy ? (done ? "✓ Resetovano" : "Resetujem...") : "⟳ Restart (od nule)"}
    </button>
  );
}

// ============================ LOGIN ============================

function AdminLogin({ onAuth }: { onAuth: () => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api.post<{ token: string; role: string }>("/auth/login", { username, password });
      if (r.role !== "ADMIN") {
        setError("Ovaj nalog nema admin pristup.");
        setBusy(false);
        return;
      }
      setToken(r.token);
      onAuth();
    } catch (err: any) {
      setError("Pogrešno korisničko ime ili lozinka.");
      setBusy(false);
    }
  }

  return (
    <div className="bo-login">
      <form className="bo-login-card" onSubmit={submit}>
        <div className="bo-logo center">
          Lucky<span>Brain</span>
          <small>Back Office</small>
        </div>
        <input className="bo-input" placeholder="Korisničko ime" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input className="bo-input" type="password" placeholder="Lozinka" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="bo-error">{error}</div>}
        <button className="bo-btn primary" disabled={busy}>
          {busy ? "..." : "Prijava"}
        </button>
      </form>
    </div>
  );
}

// ============================ OVERVIEW ============================

function Overview() {
  const [total, setTotal] = useState<any>(null);
  const [games, setGames] = useState<any[]>([]);
  const [jackpots, setJackpots] = useState<any[]>([]);
  const [rounds, setRounds] = useState<any[]>([]);

  const load = useCallback(async () => {
    const [t, g, j, r] = await Promise.all([
      api.get<any>("/reports/total"),
      api.get<any[]>("/reports/per-game"),
      api.get<any[]>("/admin/jackpots"),
      api.get<any[]>("/admin/rounds"),
    ]);
    setTotal(t);
    setGames(g);
    setJackpots(j);
    setRounds(r);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  if (!total) return <div className="bo-card">Učitavanje...</div>;

  const topGames = [...games].sort((a, b) => b.rounds - a.rounds).slice(0, 8);

  return (
    <>
      <div className="bo-kpis">
        <Kpi label="Rundi" value={total.total_rounds} />
        <Kpi label="Uplata" value={`${fmt(total.total_bet)} €`} />
        <Kpi label="Isplata" value={`${fmt(total.total_win)} €`} />
        <Kpi label="Jackpot isplate" value={`${fmt(total.total_jackpot_payout)} €`} />
        <Kpi label="GGR" value={`${fmt(total.ggr)} €`} accent={total.ggr >= 0 ? "green" : "red"} />
        <Kpi label="RTP (ukupno)" value={`${(total.total_rtp * 100).toFixed(1)}%`} />
        {total.house_rtp != null && (
          <Kpi
            label={`House RTP (plafon ${(total.house_target_rtp * 100).toFixed(0)}%)`}
            value={`${(total.house_rtp * 100).toFixed(2)}%`}
            accent={total.house_rtp <= total.house_target_rtp ? "green" : "red"}
          />
        )}
        {total.house_gas_active != null && (
          <Kpi
            label={`Gas (pali <${(total.house_gas_trigger * 100).toFixed(0)}% · gasi ≥${(total.house_gas_recover * 100).toFixed(1)}%)`}
            value={total.house_gas_active ? "ON ▲" : "OFF"}
            accent={total.house_gas_active ? "green" : undefined}
          />
        )}
      </div>

      <div className="bo-grid-2">
        <div className="bo-card">
          <h3>Jackpotovi uživo</h3>
          <div className="bo-jp-grid">
            {jackpots.map((j) => {
              const span = Math.max(j.upper_bound - j.lower_bound, 0.0001);
              const fill = Math.max(0, Math.min(1, (j.current_amount - j.lower_bound) / span));
              const active = j.current_amount >= j.lower_bound;
              return (
                <div key={j.jackpot_id} className={`bo-jp ${active ? "active" : "idle"}`} style={{ ["--c" as any]: j.color }}>
                  <div className="bo-jp-name">{j.name}</div>
                  <div className="bo-jp-amt">{fmt(j.current_amount)} €</div>
                  <div className="bo-jp-bar">
                    <i style={{ width: `${fill * 100}%` }} />
                  </div>
                  <div className="bo-jp-tier">{j.tier}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bo-card">
          <h3>Top igre po prometu</h3>
          <table className="bo-table">
            <thead>
              <tr>
                <th>Igra</th>
                <th>Rundi</th>
                <th>Uplata</th>
                <th>RTP</th>
                <th>GGR</th>
              </tr>
            </thead>
            <tbody>
              {topGames.map((g) => (
                <tr key={g.game_id}>
                  <td>{g.name}</td>
                  <td>{g.rounds}</td>
                  <td>{fmt(g.total_bet)} €</td>
                  <td>{g.rtp != null ? `${(g.rtp * 100).toFixed(0)}%` : "—"}</td>
                  <td className={g.ggr >= 0 ? "pos" : "neg"}>{fmt(g.ggr)} €</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bo-card">
        <h3>Poslednje runde</h3>
        <table className="bo-table">
          <thead>
            <tr>
              <th>Vreme</th>
              <th>Igra</th>
              <th>Igrač</th>
              <th>Mod</th>
              <th>Ulog</th>
              <th>Dobitak</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rounds.slice(0, 20).map((r) => (
              <tr key={r.round_id}>
                <td>{time(r.created_at)}</td>
                <td>{r.game_id}</td>
                <td className="mono">{short(r.player_id)}</td>
                <td>{r.mode}</td>
                <td>{fmt(r.bet_amount)} €</td>
                <td className={r.final_win_amount > 0 ? "pos" : ""}>{fmt(r.final_win_amount)} €</td>
                <td>
                  <StatusTag status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Kpi({ label, value, accent }: { label: string; value: any; accent?: "green" | "red" }) {
  return (
    <div className="bo-kpi">
      <div className="bo-kpi-val" style={{ color: accent === "green" ? "var(--bo-green)" : accent === "red" ? "var(--bo-red)" : undefined }}>
        {value}
      </div>
      <div className="bo-kpi-lab">{label}</div>
    </div>
  );
}

// ============================ PLAYERS ============================

function Players() {
  const [rows, setRows] = useState<any[]>([]);
  const [detail, setDetail] = useState<any | null>(null);

  const load = useCallback(async () => setRows(await api.get<any[]>("/admin/players")), []);
  useEffect(() => {
    load();
  }, [load]);

  async function setRtp(id: string, value: string) {
    await api.post(`/admin/players/${id}/rtp`, { rtp: value === "" ? null : Number(value) });
    await load();
  }

  async function credit(id: string, username: string) {
    const v = window.prompt(`Dopuna balansa za ${username} (EUR):`, "1000");
    if (v == null) return;
    const amount = Number(v.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      window.alert("Neispravan iznos.");
      return;
    }
    try {
      await api.post(`/admin/players/${id}/credit`, { amount });
      await load();
    } catch {
      window.alert("Uplata nije uspela.");
    }
  }

  async function openDetail(id: string) {
    setDetail(await api.get<any>(`/admin/players/${id}`));
  }

  return (
    <div className="bo-card">
      <h3>Igrači ({rows.length})</h3>
      <table className="bo-table">
        <thead>
          <tr>
            <th>Igrač</th>
            <th>Balans</th>
            <th>Promet</th>
            <th>Rundi</th>
            <th>Efektivni RTP</th>
            <th>Ručni RTP</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.player_id}>
              <td>{p.username}</td>
              <td>{fmt(p.balance)} €</td>
              <td>{fmt(p.total_wagered)} €</td>
              <td>{p.lifetime_rounds}</td>
              <td className={rtpColor(p.effective_rtp)}>{(p.effective_rtp * 100).toFixed(1)}%</td>
              <td>
                <input
                  className="bo-mini"
                  defaultValue={p.manual_rtp ?? ""}
                  placeholder="auto"
                  onBlur={(e) => setRtp(p.player_id, e.target.value)}
                />
              </td>
              <td style={{ display: "flex", gap: 6 }}>
                <button className="bo-btn primary sm" onClick={() => credit(p.player_id, p.username)}>
                  Dopuni
                </button>
                <button className="bo-btn ghost sm" onClick={() => openDetail(p.player_id)}>
                  Detalji
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail && <PlayerDrawer data={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function PlayerDrawer({ data, onClose }: { data: any; onClose: () => void }) {
  const b = data.brain ?? {};
  const beh = data.behavior ?? {};
  const eff = b.total_wagered > 0 ? b.total_returned / b.total_wagered : b.target_rtp;
  return (
    <div className="bo-drawer-wrap" onClick={onClose}>
      <div className="bo-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="bo-drawer-head">
          <h2>{data.player.username}</h2>
          <button className="bo-btn ghost sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="bo-kpis sm">
          <Kpi label="Balans" value={`${fmt(data.balance)} €`} />
          <Kpi label="Meta RTP" value={`${(b.target_rtp * 100).toFixed(0)}%`} />
          <Kpi label="Efektivni RTP" value={`${(eff * 100).toFixed(1)}%`} />
          <Kpi label="Free bet" value={`${fmt((data.freebet?.balance ?? 0) + (data.freebet?.granted_balance ?? 0))} €`} />
        </div>
        {data.curve && (
          <div className="bo-card" style={{ marginBottom: 14 }}>
            <h4 style={{ marginTop: 0 }}>Kriva sesije (vođenje RTP-a)</h4>
            <CurveChart curve={data.curve} effective={eff} />
            <p style={{ fontSize: 11, color: "var(--bo-muted)", margin: "6px 0 0" }}>
              Žuto = planirana bazna kriva dobitaka. Zelena tačka = gde je igrač sad (efektivni RTP × napredak sesije).
            </p>
          </div>
        )}
        <div className="bo-grid-2">
          <div>
            <h4>Ponašanje</h4>
            <KV k="Ukupno rundi" v={beh.total_rounds ?? 0} />
            <KV k="Prosečan ulog" v={`${fmt(beh.avg_bet ?? 0)} €`} />
            <KV k="Trend uloga" v={beh.bet_trend ?? "—"} />
            <KV k="Tilt skor" v={(beh.tilt_score ?? 0).toFixed(2)} />
            <KV k="Omiljena igra" v={beh.favorite_game ?? "—"} />
            <KV k="Churn rizik" v={(beh.churn_risk ?? 0).toFixed(2)} />
          </div>
          <div>
            <h4>Poslednje runde</h4>
            <table className="bo-table sm">
              <tbody>
                {(data.recent_rounds ?? []).slice(0, 12).map((r: any) => (
                  <tr key={r.round_id}>
                    <td>{r.game_id}</td>
                    <td>{fmt(r.bet_amount)}</td>
                    <td className={r.final_win_amount > 0 ? "pos" : ""}>{fmt(r.final_win_amount)}</td>
                    <td>
                      <StatusTag status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================ GAMES ============================

function Games() {
  const [rows, setRows] = useState<any[]>([]);
  const load = useCallback(async () => setRows(await api.get<any[]>("/admin/games")), []);
  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(id: string, status: string) {
    await api.post(`/admin/games/${id}/status`, { status });
    await load();
  }

  return (
    <div className="bo-card">
      <h3>Igre ({rows.length})</h3>
      <table className="bo-table">
        <thead>
          <tr>
            <th>Naziv</th>
            <th>Tip</th>
            <th>Inspiracija</th>
            <th>RTP meta</th>
            <th>Volatilnost</th>
            <th>Jackpot</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.game_id}>
              <td>{g.name}</td>
              <td>{g.game_type}</td>
              <td className="muted">{g.provider_style}</td>
              <td>{(g.rtp_target * 100).toFixed(0)}%</td>
              <td>{g.volatility}</td>
              <td>{g.jackpot_eligible ? "✓" : "—"}</td>
              <td>
                <select className="bo-select" value={g.status} onChange={(e) => setStatus(g.game_id, e.target.value)}>
                  {["ACTIVE", "INACTIVE", "MAINTENANCE", "RETIRED"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================ JACKPOTS ============================

function Jackpots() {
  const [rows, setRows] = useState<any[]>([]);
  const load = useCallback(async () => setRows(await api.get<any[]>("/admin/jackpots")), []);
  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  async function save(j: any, patch: any) {
    await api.post(`/admin/jackpots/${j.jackpot_id}`, { ...j, ...patch });
    await load();
  }

  return (
    <div className="bo-card">
      <h3>Jackpotovi ({rows.length})</h3>
      <table className="bo-table">
        <thead>
          <tr>
            <th>Naziv</th>
            <th>Tier</th>
            <th>Trenutno</th>
            <th>Donja</th>
            <th>Gornja</th>
            <th>Težina</th>
            <th>Efekat</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((j) => (
            <tr key={j.jackpot_id}>
              <td>
                <span className="bo-dot" style={{ background: j.color }} /> {j.name}
              </td>
              <td>{j.tier}</td>
              <td className="pos">{fmt(j.current_amount)} €</td>
              <td>
                <input className="bo-mini" defaultValue={j.lower_bound} onBlur={(e) => save(j, { lower_bound: Number(e.target.value) })} />
              </td>
              <td>
                <input className="bo-mini" defaultValue={j.upper_bound} onBlur={(e) => save(j, { upper_bound: Number(e.target.value) })} />
              </td>
              <td>
                <input className="bo-mini" defaultValue={j.base_weight} onBlur={(e) => save(j, { base_weight: Number(e.target.value) })} />
              </td>
              <td className="muted">{j.effect}</td>
              <td>
                <select className="bo-select" value={j.status} onChange={(e) => save(j, { status: e.target.value })}>
                  {["ACTIVE", "INACTIVE"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================ TRANSACTIONS ============================

function Transactions() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    api.get<any[]>("/admin/transactions").then(setRows);
  }, []);

  return (
    <div className="bo-card">
      <h3>Transakcije ({rows.length})</h3>
      <table className="bo-table">
        <thead>
          <tr>
            <th>Vreme</th>
            <th>Tip</th>
            <th>Igrač</th>
            <th>Runda</th>
            <th>Iznos</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.transaction_id}>
              <td>{time(t.created_at)}</td>
              <td>{t.tx_type}</td>
              <td className="mono">{short(t.player_id)}</td>
              <td className="mono">{t.round_id ? short(t.round_id) : "—"}</td>
              <td className={t.amount >= 0 ? "pos" : "neg"}>
                {t.amount >= 0 ? "+" : ""}
                {fmt(t.amount)} {t.currency}
              </td>
              <td>
                <StatusTag status={t.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================ AUDIT & REVIEW ============================

function AuditReview() {
  const [audit, setAudit] = useState<any[]>([]);
  const [review, setReview] = useState<any[]>([]);
  useEffect(() => {
    api.get<any[]>("/admin/audit").then(setAudit);
    api.get<any[]>("/admin/manual-review").then(setReview);
  }, []);

  return (
    <div className="bo-grid-2">
      <div className="bo-card">
        <h3>Manual review ({review.length})</h3>
        {review.length === 0 ? (
          <p className="muted">Nema stavki za pregled. 👍</p>
        ) : (
          <table className="bo-table">
            <thead>
              <tr>
                <th>Vreme</th>
                <th>Runda</th>
                <th>Razlog</th>
                <th>Ozbiljnost</th>
              </tr>
            </thead>
            <tbody>
              {review.map((r) => (
                <tr key={r.review_id}>
                  <td>{time(r.created_at)}</td>
                  <td className="mono">{short(r.round_id)}</td>
                  <td>{r.reason}</td>
                  <td>
                    <span className={`bo-tag sev-${(r.severity ?? "").toLowerCase()}`}>{r.severity}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="bo-card">
        <h3>Audit log</h3>
        <table className="bo-table">
          <thead>
            <tr>
              <th>Vreme</th>
              <th>Akcija</th>
              <th>Entitet</th>
            </tr>
          </thead>
          <tbody>
            {audit.slice(0, 40).map((a) => (
              <tr key={a.audit_id ?? a.id ?? `${a.created_at}-${a.action}`}>
                <td>{time(a.created_at)}</td>
                <td>{a.action}</td>
                <td className="muted">
                  {a.entity_type}/{a.entity_id ? short(a.entity_id) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================ helpers ============================

function CurveChart({ curve, effective }: { curve: any; effective: number }) {
  const params = boSafeParse(curve.curve_json);
  const W = 520;
  const H = 150;
  const pad = 10;
  const lo = 0.7;
  const hi = 1.25;
  const yOf = (rtp: number) => pad + (1 - (rtp - lo) / (hi - lo)) * (H - 2 * pad);
  const xOf = (p: number) => pad + p * (W - 2 * pad);

  // Opcija A: engine vodi BAZNE dobitke ka (ukupna meta − 3% za jackpot/free-bet),
  // a efektivni RTP je takođe iz dobitaka, pa kriva i tačka stoje na istoj osnovi.
  const baseTarget = (curve.target_rtp ?? 0.95) - 0.03;

  const pts: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const prog = i / 60;
    pts.push(`${xOf(prog).toFixed(1)},${yOf(boCurveTarget(baseTarget, params, prog)).toFixed(1)}`);
  }
  const curProg = Math.min(1, curve.expected_session_volume > 0 ? curve.session_wagered / curve.expected_session_volume : 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 150, display: "block" }}>
      <line x1={pad} y1={yOf(baseTarget)} x2={W - pad} y2={yOf(baseTarget)} stroke="#ffffff22" strokeDasharray="4 4" />
      <polyline points={pts.join(" ")} fill="none" stroke="#f5b400" strokeWidth="2" />
      <circle cx={xOf(curProg)} cy={yOf(effective)} r="5" fill="#34d399" stroke="#0a0a14" strokeWidth="2" />
      <text x={pad} y={H - 3} fill="#9a9ab5" fontSize="10">{(lo * 100).toFixed(0)}%</text>
      <text x={pad} y={13} fill="#9a9ab5" fontSize="10">{(hi * 100).toFixed(0)}%</text>
    </svg>
  );
}

function boCurveTarget(target: number, p: any, x: number): number {
  const startBoost = p?.startBoost ?? 0.08;
  const amplitude = p?.amplitude ?? 0.05;
  const freq = p?.freq ?? 1.5;
  const phase = p?.phase ?? 0;
  const decay = p?.decay ?? 2;
  return target + startBoost * Math.exp(-3 * x) + amplitude * Math.sin(2 * Math.PI * freq * x + phase) * Math.exp(-decay * x);
}

function boSafeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function StatusTag({ status }: { status: string }) {
  const ok = status === "CLOSED" || status === "SUCCESS" || status === "WIN_CREDITED";
  const bad = status === "FAILED" || status === "MANUAL_REVIEW" || status === "DEBIT_UNKNOWN";
  return <span className={`bo-tag ${ok ? "ok" : bad ? "bad" : "mid"}`}>{status}</span>;
}

function KV({ k, v }: { k: string; v: any }) {
  return (
    <div className="bo-kv">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

function fmt(n: number): string {
  return (Number(n) || 0).toFixed(2);
}
function short(id: string): string {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}
function time(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("sr-RS", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function rtpColor(rtp: number): string {
  if (rtp < 0.85) return "neg";
  if (rtp > 1.05) return "pos";
  return "";
}
