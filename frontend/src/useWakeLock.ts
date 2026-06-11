import { useEffect } from "react";

/**
 * Drži ekran telefona budnim dok je `active === true`.
 * 1) Screen Wake Lock API (Android Chrome, noviji Safari) — uzima se odmah,
 *    ponovo na visibilitychange I na svaki tap (gest), jer neki browseri odbiju
 *    zahtev bez gesta.
 * 2) Fallback za starije iOS Safari (bez wakeLock API-ja): nevidljiv mali
 *    muted video u petlji (/wake.mp4) — dok se "reprodukuje", iOS ne gasi ekran.
 *    Pokreće se na prvi tap (iOS traži gest za play()).
 */
export function useWakeLock(active = true): void {
  useEffect(() => {
    if (!active) return;

    const hasApi = "wakeLock" in navigator;
    let lock: WakeLockSentinel | null = null;
    let video: HTMLVideoElement | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || !hasApi) return;
      try {
        if (lock && !lock.released) return;
        lock = await navigator.wakeLock.request("screen");
      } catch {
        // sistem odbio (npr. baterija) – pokusacemo opet na sledeci gest
      }
    };

    const startVideo = () => {
      if (cancelled || video) return;
      const v = document.createElement("video");
      v.src = "/wake.mp4";
      v.muted = true;
      v.loop = true;
      v.setAttribute("playsinline", "");
      v.setAttribute("muted", "");
      v.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;";
      document.body.appendChild(v);
      v.play()
        .then(() => {
          video = v;
        })
        .catch(() => {
          v.remove(); // gest jos nije registrovan -> probamo na sledeci tap
        });
    };

    const onGesture = () => {
      if (hasApi) void acquire();
      else startVideo();
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible" || cancelled) return;
      if (hasApi) void acquire();
      else video?.play().catch(() => {});
    };

    if (hasApi) void acquire();
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("pointerdown", onGesture, { passive: true });
    document.addEventListener("touchend", onGesture, { passive: true });

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("pointerdown", onGesture);
      document.removeEventListener("touchend", onGesture);
      lock?.release().catch(() => {});
      if (video) {
        video.pause();
        video.remove();
        video = null;
      }
    };
  }, [active]);
}
