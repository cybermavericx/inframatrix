import { PAGE_KEYS, type GotoTarget } from '../hooks/useShortcuts';

/** The "?" dialog: every keyboard shortcut, with the go-to keys this user's modules allow. */
export function ShortcutsHelp({ goto, onClose }: { goto: GotoTarget[]; onClose: () => void }) {
  const row = (keys: string, label: string) => (
    <tr key={keys}>
      <td style={{ whiteSpace: 'nowrap', paddingRight: 18 }}>{keys.split(' ').map((k) => <kbd key={k} className="kbd">{k}</kbd>)}</td>
      <td>{label}</td>
    </tr>
  );
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(480px, 100%)' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts">
        <div className="card-body">
          <h3 style={{ marginTop: 0 }}>Keyboard shortcuts</h3>
          <table><tbody>
            {PAGE_KEYS.map((k) => row(k.keys, k.label))}
            {goto.map((g) => row(`g ${g.key}`, `Go to ${g.label}`))}
          </tbody></table>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>Shortcuts don't fire while you type in a field.</p>
        </div>
      </div>
    </div>
  );
}
