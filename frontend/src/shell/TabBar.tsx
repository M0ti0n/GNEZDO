import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Tab, TabKind } from "../state/tabs";
import { GnezdoIcon } from "../components/GnezdoIcon";
import {
  IconClose, IconLibrary, IconNewJob, IconProject, IconSettings, IconStock, IconTechnology,
} from "../components/Icons";

export type MenuId = "settings" | "technology" | "stock" | "projects";

const MENU: { id: MenuId; label: string; icon: ReactNode }[] = [
  { id: "settings", label: "Settings", icon: <IconSettings size={18} /> },
  { id: "technology", label: "Technology table", icon: <IconTechnology size={18} /> },
  { id: "stock", label: "Stock & remnants", icon: <IconStock size={18} /> },
  { id: "projects", label: "Projects", icon: <IconProject size={18} /> },
];

// Small badge in front of a tab title so job, import and project tabs are
// told apart at a glance.
const BADGE: Record<TabKind, ReactNode> = {
  job: <IconNewJob size={14} />,
  part: <IconLibrary size={14} />,
};

interface Props {
  tabs: Tab[];
  activeId: string | null;
  userName: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onMenu: (id: MenuId) => void;
}

export function TabBar({ tabs, activeId, userName, onActivate, onClose, onMenu }: Props) {
  return (
    <header className="tabbar">
      <AppMenu onMenu={onMenu} />
      <div className="tabs" role="tablist" aria-label="Open jobs and parts">
        {tabs.length === 0 && <span className="tabs-empty">Opened jobs appear here</span>}
        {tabs.map((t) => {
          const active = t.id === activeId;
          return (
            <div key={t.id} className={`tab tab-${t.kind}${active ? " is-active" : ""}`}>
              <button role="tab" aria-selected={active} className="tab-label" title={t.title}
                onClick={() => onActivate(t.id)}
                onAuxClick={(e) => e.button === 1 && onClose(t.id)}>
                <span className="tab-badge">{BADGE[t.kind]}</span>
                <span className="tab-title">{t.title}</span>
              </button>
              <button className="tab-close" aria-label={`Close ${t.title}`} onClick={() => onClose(t.id)}>
                <IconClose size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="user" title={`Signed in as ${userName}`}>{userName}</div>
    </header>
  );
}

function AppMenu({ onMenu }: { onMenu: (id: MenuId) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="appmenu" ref={ref}>
      <button className="brand" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <GnezdoIcon size={26} />
        <span className="brand-name">GNEZDO</span>
        <svg className="caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
      </button>
      {open && (
        <div className="menu" role="menu">
          {MENU.map((m) => (
            <button key={m.id} role="menuitem" className="menu-item" onClick={() => { setOpen(false); onMenu(m.id); }}>
              {m.icon}<span>{m.label}</span>
            </button>
          ))}
          <div className="menu-foot">GNEZDO 0.1, BO-DA d.o.o.</div>
        </div>
      )}
    </div>
  );
}
