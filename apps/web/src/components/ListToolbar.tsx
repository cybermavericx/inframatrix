import type { ReactNode } from 'react';
import { CustomFilterModal } from './CustomFilterModal';
import type { ListView } from '../hooks/useListView';

// The reusable list control panel UI — search box · Filter (rule builder over any field) · Group by ·
// count + Clear. Driven entirely by a useListView() handle, so it looks and behaves the same on every
// screen that uses it.
export function ListToolbar({ view, placeholder, extra }: { view: ListView; placeholder: string; extra?: ReactNode }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ maxWidth: 340 }}
          placeholder={placeholder}
          value={view.search}
          onChange={(e) => view.setSearch(e.target.value)}
        />
        {view.filterFields.length > 0 && (
          <button className={'btn btn-sm ' + (view.customFilter ? 'btn-primary' : 'btn-ghost')} onClick={() => view.setShowCustom(true)}>
            Filter{view.customFilter ? ` (${view.customFilter.rules.length})` : ''}
          </button>
        )}
        {view.columns.length > 0 && (
          <select className="input btn-sm" style={{ width: 'auto', padding: '4px 8px' }} value={view.groupBy}
            onChange={(e) => view.setGroupBy(e.target.value)} title="Group by">
            <option value="">Group by…</option>
            {view.columns.map((c) => <option key={c} value={c}>{c.replace(/\./g, ' ')}</option>)}
          </select>
        )}
        {extra}
        {view.active && (
          <>
            <span className="muted" style={{ fontSize: 12.5 }}>{view.visibleCount} of {view.total}</span>
            <button className="btn btn-ghost btn-sm" onClick={view.clearAll}>Clear</button>
          </>
        )}
      </div>

      {view.showCustom && (
        <CustomFilterModal
          fields={view.filterFields}
          valuesFor={view.valuesFor}
          isDate={view.isDate}
          initial={view.customFilter}
          onApply={view.setCustomFilter}
          onClose={() => view.setShowCustom(false)}
        />
      )}
    </>
  );
}
