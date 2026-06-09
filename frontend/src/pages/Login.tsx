import { useState } from "react";
import { api, setToken } from "../api.ts";

export function Login({ onAuth }: { onAuth: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("igrac1");
  const [password, setPassword] = useState("igrac123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const res = await api.post<{ token: string }>(path, { username, password });
      setToken(res.token);
      onAuth();
    } catch (e: any) {
      setError(translate(e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <h1>
        Lucky<span>Brain</span>
      </h1>
      <p className="sub">{mode === "login" ? "Prijavi se i zaigraj" : "Napravi nalog"}</p>

      <input className="input" placeholder="Korisničko ime" value={username} onChange={(e) => setUsername(e.target.value)} />
      <input
        className="input"
        type="password"
        placeholder="Lozinka"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      {error && <div className="error">{error}</div>}
      <button className="btn" onClick={submit} disabled={busy}>
        {busy ? "..." : mode === "login" ? "Prijava" : "Registracija"}
      </button>
      <div className="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "Nemaš nalog? Registruj se" : "Imaš nalog? Prijavi se"}
      </div>
      <p className="sub" style={{ marginTop: 24, fontSize: 12 }}>
        Demo: igrac1 / igrac123 &nbsp;•&nbsp; Admin: admin / admin123
      </p>
    </div>
  );
}

function translate(code: string): string {
  const map: Record<string, string> = {
    INVALID_CREDENTIALS: "Pogrešno ime ili lozinka",
    USERNAME_TAKEN: "Korisničko ime je zauzeto",
    ACCOUNT_BLOCKED: "Nalog je blokiran",
    MISSING_FIELDS: "Popuni sva polja",
  };
  return map[code] || code;
}
