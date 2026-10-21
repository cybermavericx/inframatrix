import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

/** A transient toast. `kind` drives the colour; `id` is used to dismiss it. */
type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: ToastKind; message: string }

interface ToastApi {
  /** Green confirmation, e.g. notify('Saved'). */
  notify: (message: string) => void;
  /** Red error toast (stays a little longer). */
  error: (message: string) => void;
  /** Neutral info toast. */
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Reusable toast/notification system. Wrap the app once (see main.tsx) and call `useToast()`
 *  anywhere to show "Saved" confirmations or errors instead of silent saves / blocking alert(). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = ++seq.current;
    setToasts((list) => [...list, { id, kind, message }]);
    // errors linger longer so they can be read; success/info auto-dismiss quickly
    window.setTimeout(() => remove(id), kind === 'error' ? 6000 : 3000);
  }, [remove]);

  // push is stable (useCallback), so the api object is built once and never changes identity.
  const api = useMemo<ToastApi>(() => ({
    notify: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => remove(t.id)}>
            <span className="toast-icon">{t.kind === 'success' ? '✓' : t.kind === 'error' ? '!' : 'i'}</span>
            <span className="toast-msg">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Access the toast api. Falls back to a no-op-ish console logger if used outside the provider
 *  (so a stray call never crashes a screen). */
// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx) return ctx;
  return {
    notify: (m) => console.log('[toast]', m),
    error: (m) => console.error('[toast]', m),
    info: (m) => console.log('[toast]', m),
  };
}
