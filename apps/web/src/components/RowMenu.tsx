import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';

export type RowMenuItem = { label: string; danger?: boolean; onSelect: () => void };

// "⋯" overflow menu for a list row. Opens on click (Enter/Space on the button), focuses the first
// item; ↑/↓/Home/End move, Enter picks, Esc or Tab or a click outside closes, and focus goes back
// to the button. The menu is position: fixed so the table card's overflow doesn't clip it; it
// closes on scroll/resize instead of following the row.
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  const close = (refocus: boolean) => { setPos(null); if (refocus) trigger.current?.focus(); };
  const toggle = () => {
    if (open) { close(true); return; }
    const r = trigger.current!.getBoundingClientRect();
    const right = window.innerWidth - r.right;
    // open upwards when there isn't room below for the items
    setPos(r.bottom + 8 + items.length * 40 > window.innerHeight
      ? { position: 'fixed', right, bottom: window.innerHeight - r.top + 4 }
      : { position: 'fixed', right, top: r.bottom + 4 });
  };

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) setPos(null);
    };
    const onMove = () => setPos(null);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const btns = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => { e.preventDefault(); btns[(n + btns.length) % btns.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(btns.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close(false);
  };

  return (
    <>
      <button ref={trigger} type="button" className="btn btn-ghost btn-sm row-menu-trigger" aria-label={label}
        aria-haspopup="menu" aria-expanded={open} onClick={toggle}>⋯</button>
      {open && (
        <div ref={menu} role="menu" aria-label={label} className="row-menu" style={pos} onKeyDown={onMenuKey}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" tabIndex={-1}
              className={'row-menu-item' + (it.danger ? ' danger' : '')}
              onClick={() => { close(true); it.onSelect(); }}>{it.label}</button>
          ))}
        </div>
      )}
    </>
  );
}
