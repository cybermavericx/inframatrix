import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Keyboard shortcuts (one document listener for the whole app). Page controls opt in with a
// data-shortcut="<key>" attribute; the first visible one is clicked (or focused, for inputs).
// Keys never fire while typing in a field or with Ctrl/Alt/Cmd held, so forms and browser
// shortcuts are unaffected. While a dialog is open only Esc and ? work.

/** "g then <key>" go-to targets; `module` hides the entry for users without that module. */
export type GotoTarget = { key: string; label: string; path: string; module?: string };
const GOTO: GotoTarget[] = [
  { key: 'd', label: 'Dashboard', path: '/' },
  { key: 'p', label: 'Projects', path: '/infra/projects', module: 'infra' },
  { key: 's', label: 'Servers', path: '/infra/servers', module: 'infra' },
  { key: 'j', label: 'JobBag', path: '/jobbag', module: 'jobbag' },
];

export const PAGE_KEYS: { keys: string; label: string }[] = [
  { keys: '/', label: 'Search this list' },
  { keys: 'f', label: 'Filter & group' },
  { keys: 'n', label: 'New record (where you can create)' },
  { keys: 'Esc', label: 'Close the open dialog (not while typing in a field)' },
  { keys: '?', label: 'Show these shortcuts' },
];

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

/** The topmost open dialog's backdrop (dialogs close on a click on their backdrop). */
function openDialog(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('.modal-backdrop');
  return all.length ? all[all.length - 1] : null;
}

function visible(el: HTMLElement): boolean {
  return el.offsetParent !== null && !(el as HTMLButtonElement).disabled;
}

export function useShortcuts(modules: string[]) {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const pendingG = useRef<number | null>(null);
  // read through a ref so the listener isn't re-attached on every render (modules is a new array each time)
  const modsRef = useRef(modules);
  useEffect(() => { modsRef.current = modules; });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const typing = isTyping(e.target);

      if (e.key === 'Escape') {
        if (typing) return; // never discard a half-typed form
        if (helpOpen) { setHelpOpen(false); return; }
        const d = openDialog();
        if (d) { e.preventDefault(); d.click(); }
        return;
      }
      if (typing) return;
      if (e.key === '?') { e.preventDefault(); setHelpOpen((o) => !o); return; }
      if (helpOpen || openDialog()) return;

      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const target = GOTO.find((g) => g.key === e.key.toLowerCase() && (!g.module || modsRef.current.includes(g.module)));
        if (target) { e.preventDefault(); navigate(target.path); }
        return;
      }
      if (e.key === 'g') { pendingG.current = window.setTimeout(() => { pendingG.current = null; }, 1200); return; }

      const el = [...document.querySelectorAll<HTMLElement>(`[data-shortcut="${CSS.escape(e.key.toLowerCase())}"]`)].find(visible);
      if (!el) return;
      e.preventDefault();
      if (isTyping(el)) el.focus(); else el.click();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [helpOpen, navigate]);

  return { helpOpen, closeHelp: () => setHelpOpen(false), goto: GOTO.filter((g) => !g.module || modules.includes(g.module)) };
}
