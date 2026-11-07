// The desktop build: GNEZDO runs while its window is open. The window holds an event stream open
// (not slowed down when minimised, unlike timers); 30 s after it closes for good GNEZDO stops.
import { demoMode } from "./api";

let session: EventSource | null = null;

/** In the desktop build: opens the window's connection and answers the PC's user name; else null. */
export async function startDesktop(): Promise<string | null> {
  if (demoMode) return null;
  try {
    const h = (await (await fetch("/api/health", { headers: { Accept: "application/json" } })).json()) as { desktop?: boolean; user?: string | null };
    if (!h.desktop) return null;
    session ??= new EventSource("/api/desktop/session");
    return h.user || "";
  } catch {
    return null;
  }
}
