import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Tab, TabKind } from "../state/tabs";
import type { UndoState } from "../state/history";
import { demoMode } from "../api/api";
import { GnezdoIcon } from "../components/GnezdoIcon";
import { SideScroll } from "../components/SideScroll";
import { IconClose, IconLibrary, IconNewJob } from "../components/Icons";

// Small badge in front of a tab title so job, import and project tabs are
// told apart at a glance; "i" marks an imported drawing.
const BADGE: Record<TabKind, ReactNode> = {
  job: <IconNewJob size={14} />,
  part: <IconLibrary size={14} />,
  drawing: <span className="tab-i">i</span>,
};

interface Props {
  tabs: Tab[];
  activeId: string | null;
  userName: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** The GNEZDO button: Settings */
  onSettings: () => void;
  /** Undo / Redo of the open tab; greyed out when it has nothing to undo or redo. */
  undo: UndoState;
  /** SAVE / SAVE AS of the open job tab (missing: nothing to save). */
  save?: { onSave: () => void; onSaveAs: () => void } | null;
  /** Signed in (server build): the menu under the name; missing: just the name. */
  account?: { isAdmin: boolean; hasPassword: boolean; onPick: (id: "password" | "users" | "apikeys" | "signout") => void };
}

export function TabBar({ tabs, activeId, userName, onActivate, onClose, onSettings, undo, save, account }: Props) {
  return (
    <header className="tabbar">
      <div className="appmenu">
        <button className="brand" onClick={onSettings} title="Settings">
          <GnezdoIcon size={26} />
          <span className="brand-name">GNEZDO</span>
        </button>
      </div>
      <div className="save-btns" role="group" aria-label="Save the job">
        <button className="undo-btn" onClick={save?.onSave} disabled={!save} title={save ? "Save the job (Ctrl+S)" : "Open a job to save it"} aria-label="Save">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"><path d="M5 3h11l3 3v15H5z" /><path d="M8 3v5h7V3M8 21v-7h8v7" /></svg>
        </button>
        <button className="undo-btn" onClick={save?.onSaveAs} disabled={!save} title={save ? "Save as a new job, under another name" : "Open a job to save it"} aria-label="Save as">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"><path d="M14 21H5V3h11l3 3v4" /><path d="M8 3v5h7V3" /><path d="m14 21 1-3 5-5 2 2-5 5z" /></svg>
        </button>
      </div>
      <UndoRedo {...undo} />
      <SideScroll className="tabs" wrapClassName="tabs-wrap" role="tablist" label="Open jobs and parts" more="tabs" activeKey={activeId}>
        {tabs.length === 0 && <span className="tabs-empty">Opened jobs appear here</span>}
        {tabs.map((t) => {
          const active = t.id === activeId;
          return (
            <div key={t.id} className={`tab tab-${t.kind}${active ? " is-active" : ""}`}>
              <button role="tab" aria-selected={active} className="tab-label" title={t.title}
                onClick={() => onActivate(t.id)}
                onAuxClick={(e) => e.button === 1 && onClose(t.id)}>
                <span className="tab-badge">{t.drawingId?.startsWith("x3-") ? <span className="tab-i tab-3d">3D</span> : t.kind === "drawing" ? <span className="tab-i tab-3d tab-2d">2D</span> : BADGE[t.kind]}</span>
                <span className="tab-title">{t.title}</span>
              </button>
              <button className="tab-close" aria-label={`Close ${t.title}`} onClick={() => onClose(t.id)}>
                <IconClose size={13} />
              </button>
            </div>
          );
        })}
      </SideScroll>
      {demoMode && <div className="demo-badge" title="Demo: sample data. What you import and save stays in this browser tab only.">DEMO</div>}
      {account ? <UserMenu name={userName} account={account} /> : <div className="user" title={`Signed in as ${userName}`}>{userName}</div>}
    </header>
  );
}

const UndoArrow = ({ flip }: { flip?: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" style={flip ? { transform: "scaleX(-1)" } : undefined}>
    <path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);

/** Undo and Redo, right after the GNEZDO button, the same on every screen. */
function UndoRedo({ undoLabel, redoLabel, onUndo, onRedo }: UndoState) {
  return (
    <div className="undo-redo" role="group" aria-label="Undo and redo">
      <button className="undo-btn" onClick={onUndo} disabled={!undoLabel}
        title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : "Nothing to undo"} aria-label={undoLabel ? `Undo ${undoLabel}` : "Undo"}>
        <UndoArrow />
      </button>
      <button className="undo-btn" onClick={onRedo} disabled={!redoLabel}
        title={redoLabel ? `Redo ${redoLabel} (Ctrl+Y)` : "Nothing to redo"} aria-label={redoLabel ? `Redo ${redoLabel}` : "Redo"}>
        <UndoArrow flip />
      </button>
    </div>
  );
}

// The name in the top right (server build): change one's password, Users (admin), sign out.
function UserMenu({ name, account }: { name: string; account: NonNullable<Props["account"]> }) {
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
  const pick = (id: "password" | "users" | "apikeys" | "signout") => { setOpen(false); account.onPick(id); };
  return (
    <div className="user-wrap" ref={ref}>
      <button type="button" className="user user-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        title={`Signed in as ${name}${account.isAdmin ? " (admin)" : ""}`}>{name}</button>
      {open && (
        <div className="menu user-menu" role="menu">
          <button type="button" role="menuitem" className="menu-item" onClick={() => pick("password")}>{account.hasPassword ? "Change password" : "Set a password"}</button>
          {account.isAdmin && <button type="button" role="menuitem" className="menu-item" onClick={() => pick("users")}>Users</button>}
          {account.isAdmin && <button type="button" role="menuitem" className="menu-item" onClick={() => pick("apikeys")}>Status API keys</button>}
          <button type="button" role="menuitem" className="menu-item" onClick={() => pick("signout")}>Sign out</button>
        </div>
      )}
    </div>
  );
}
