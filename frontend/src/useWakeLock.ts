import { useEffect } from "react";

/**
 * Drži ekran telefona budnim (Screen Wake Lock API) dok je `active === true`.
 * Lock se automatski otpušta kad se tab sakrije / telefon zaključa, pa ga
 * ponovo uzimamo na `visibilitychange`. Radi samo u secure context (HTTPS/localhost)
 * i na browserima koji podržavaju API; inače tiho ne radi ništa (bez pada).
 */
export function useWakeLock(active = true): void {
  useEffect(() => {
    if (!active) return;
    if (!("wakeLock" in navigator)) return;

    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        // npr. baterija preniska ili sistem odbio – ignoriši
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible" && !cancelled) void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
