// The desktop build: GNEZDO runs while its window is open. The window holds an event stream open
// (not slowed down when minimised, unlike timers), calls every 20 s, and says when it closes: 30 s
// after that GNEZDO stops (2 min after the last sign of it, when a browser crashes).
import { demoMode } from "./api";

let session: EventSource | null = null;

/** In the desktop build: opens the window's connection and answers the PC's user name; else null. */
export async function startDesktop(): Promise<string | null> {
  if (demoMode) return null;
  try {
    const h = (await (await fetch("/api/health", { headers: { Accept: "application/json" } })).json()) as { desktop?: boolean; user?: string | null };
    if (!h.desktop) return null;
    if (!session) {
      session = new EventSource("/api/desktop/session");
      // also a call every 20 s and a "closing" when the page goes for good: some browsers (Firefox)
      // drop the stream now and then, and GNEZDO must not stop while the page is open
      window.setInterval(() => { void fetch("/api/desktop/alive", { method: "POST", keepalive: true }).catch(() => {}); }, 20_000);
      window.addEventListener("pagehide", (e) => { if (!e.persisted) navigator.sendBeacon("/api/desktop/closing"); });
    }
    return h.user || "";
  } catch {
    return null;
  }
}
