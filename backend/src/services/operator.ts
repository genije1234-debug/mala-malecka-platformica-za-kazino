import { config } from "../config.ts";

/**
 * Klijent ka kladionickom (operator) wallet API-ju. Server-to-server, Bearer token.
 * Kladionica je izvor istine za novac; ovde se zove samo na ulazu/izlazu iz kazina.
 *
 *   GET  {base}/casino/balance?user_id=
 *   POST {base}/casino/withdraw-all  { user_id, idempotency_key }
 *   POST {base}/casino/deposit       { user_id, amount, idempotency_key, release_lock }
 */

export interface OperatorWalletResult {
  status: string;
  amount?: number;
  balance?: number;
  currency?: string;
  context?: string;
  [k: string]: unknown;
}

function assertConfigured(): void {
  if (!config.operatorBaseUrl || !config.operatorToken) {
    throw new Error("OPERATOR_NOT_CONFIGURED");
  }
}

async function call(path: string, init: RequestInit & { method: string }): Promise<OperatorWalletResult> {
  assertConfigured();
  const url = `${config.operatorBaseUrl.replace(/\/$/, "")}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.operatorTimeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${config.operatorToken}`,
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let body: any = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`OPERATOR_BAD_RESPONSE: ${res.status} ${text.slice(0, 200)}`);
    }
    if (!res.ok || body.status === "error") {
      const msg = Array.isArray(body.message) ? body.message.join("; ") : body.message ?? res.status;
      throw new Error(`OPERATOR_ERROR: ${msg}`);
    }
    return body as OperatorWalletResult;
  } finally {
    clearTimeout(timer);
  }
}

export function operatorBalance(operatorUserId: string): Promise<OperatorWalletResult> {
  return call(`/casino/balance?user_id=${encodeURIComponent(operatorUserId)}`, { method: "GET" });
}

export interface OperatorLaunchResult extends OperatorWalletResult {
  user_id?: number;
  username?: string;
}

/** Razmeni jednokratni SSO launch token za korisnika kladionice (validira se na njihovoj strani). */
export function operatorVerifyLaunch(token: string): Promise<OperatorLaunchResult> {
  return call(`/casino/launch/verify`, {
    method: "POST",
    body: JSON.stringify({ token }),
  }) as Promise<OperatorLaunchResult>;
}

/** Skida ceo balans korisnika u kladionici i zakljucava kontekst na 'kazino'. */
export function operatorWithdrawAll(operatorUserId: string, idempotencyKey: string): Promise<OperatorWalletResult> {
  return call(`/casino/withdraw-all`, {
    method: "POST",
    body: JSON.stringify({ user_id: operatorUserId, idempotency_key: idempotencyKey }),
  });
}

/** Vraca novac na kladionicki balans i (opciono) otkljucava kontekst na 'kladionica'. */
export function operatorDeposit(
  operatorUserId: string,
  amount: number,
  idempotencyKey: string,
  releaseLock = true,
): Promise<OperatorWalletResult> {
  return call(`/casino/deposit`, {
    method: "POST",
    body: JSON.stringify({
      user_id: operatorUserId,
      amount,
      idempotency_key: idempotencyKey,
      release_lock: releaseLock,
    }),
  });
}
