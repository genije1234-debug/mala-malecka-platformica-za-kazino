const BASE = "/api/v1/casino";

let token: string | null = localStorage.getItem("token");

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem("token", t);
  else localStorage.removeItem("token");
}

export function getToken() {
  return token;
}

/** Zahtev sa timeout-om: bez ovoga zaglavljen zahtev "vrti" beskonacno. */
async function rawRequest<T>(method: string, path: string, body?: unknown, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e: any) {
    // mrezni prekid ili timeout -> jasna poruka umesto vecnog cekanja
    throw new Error(e?.name === "AbortError" ? "TIMEOUT" : "NETWORK");
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `HTTP_${res.status}`);
  return data as T;
}

/**
 * GET je bezbedan za ponavljanje -> do 2 automatska pokusaja na prekid veze.
 * POST se NE ponavlja automatski (spin/uplata ne sme da se dupla).
 */
/**
 * Prolazne greske koje sme da se ponove: prekid mreze, timeout i 5xx sa
 * tunela/proxy-ja (Cloudflare na zastoj vraca 502/504/52x-53x, ne prekid veze).
 */
function isTransient(msg: string): boolean {
  if (msg === "NETWORK" || msg === "TIMEOUT") return true;
  const m = /^HTTP_(\d{3})$/.exec(msg);
  return m ? Number(m[1]) >= 500 : false;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (method === "GET") {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await rawRequest<T>(method, path, body, 10000);
      } catch (e: any) {
        lastErr = e;
        if (!isTransient(e.message)) throw e;
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
    throw lastErr;
  }
  return rawRequest<T>(method, path, body);
}

function clientKey(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * POST sa BEZBEDNIM ponavljanjem za spin: salje clientKey, server duplikat
 * prepoznaje i vraca ISTI rezultat (nema duplog skidanja uloga). Krace cekanje
 * po pokusaju (8s) -> kratak zastoj veze ne zaledi igru na 15s.
 */
async function postIdem<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const full = { ...(body ?? {}), clientKey: clientKey() };
  let lastErr: unknown;
  // 5 pokusaja: tunel ume da "stuca" i po 10-15s; dedup na serveru garantuje
  // da ponovljen spin NIKAD ne skida ulog dvaput.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await rawRequest<T>("POST", path, full, 8000);
    } catch (e: any) {
      lastErr = e;
      if (!isTransient(e.message)) throw e;
      await new Promise((r) => setTimeout(r, Math.min(2500, 400 * (attempt + 1))));
    }
  }
  throw lastErr;
}

export const api = {
  get: <T>(p: string) => request<T>("GET", p),
  post: <T>(p: string, b?: unknown) => request<T>("POST", p, b),
  /** Samo za spin (/round/start): retry je bezbedan jer server dedupira clientKey. */
  postIdem,
};
