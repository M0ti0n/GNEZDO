const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** "12 minutes ago", "3 hours ago", "yesterday 14:20", "21 Oct" */
export function when(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const min = Math.round((now - d.getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return rtf.format(-min, "minute");
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (d >= today) return rtf.format(-Math.round(min / 60), "hour");
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d >= yesterday) return `yesterday ${timeFmt.format(d)}`;
  return dayFmt.format(d);
}

export const fullDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export const mm = (t: number) => `${t.toLocaleString("en-GB")} mm`;
