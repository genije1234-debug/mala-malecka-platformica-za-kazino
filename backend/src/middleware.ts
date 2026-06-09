import type { Request, Response, NextFunction } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { verifyToken, type SessionToken } from "./services/session.ts";

export interface AuthedRequest extends Request {
  auth?: SessionToken;
}

/** Brute-force zaštita za login/registraciju: po IP-u, strogo. */
export const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "TOO_MANY_REQUESTS" },
});

/**
 * Spam-guard za start poteza: ključ je IGRAČ (iz tokena), limit visoko iznad
 * legitimne brzine (60 spinova/min) pa ne smeta brzoj igri, ali zaustavlja
 * skriptovani napad. Mora ići POSLE authMiddleware (treba req.auth).
 */
export const playLimiter = rateLimit({
  windowMs: 60_000,
  max: 600, // ~10/s po igraču
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => (req as AuthedRequest).auth?.player_id ?? ipKeyGenerator(req.ip ?? "anon"),
  message: { error: "TOO_MANY_REQUESTS" },
});

export function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "NO_TOKEN" });
    return;
  }
  try {
    req.auth = verifyToken(header.slice(7));
    next();
  } catch (e: any) {
    res.status(401).json({ error: e.message ?? "INVALID_TOKEN" });
  }
}

export function adminMiddleware(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.auth?.role !== "ADMIN") {
    res.status(403).json({ error: "FORBIDDEN" });
    return;
  }
  next();
}
