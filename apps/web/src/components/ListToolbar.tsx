import type { ReactNode } from 'react';
import { useState } from 'react';
import { CustomFilterModal } from './CustomFilterModal';
import { FilterPanel } from './FilterPanel';
import { ruleCount } from '../lib/serverFilter';
import { shortLabel, type ListView } from '../hooks/useListView';

// The reusable list control panel UI — search box · Filter & group (server-side: any field of the
// record or its related records, nested groups with counts — kept in the URL) · Quick filter (the
// older in-page rule builder, kept for page-computed columns such as publish state) · Group by a
// column · count + Clear. Driven entirely by a useListView() handle, so it looks and behaves the same on every
// screen that uses it.
export function ListToolbar({ view, placeholder, extra }: { view: ListView; placeholder: string; extra?: ReactNode }) {
  const [panel, setPanel] = useState(false);
  const sv = view.server;
  const sRules = ruleCount(sv.state?.f);
  const sGroups = sv.state?.g?.length ?? 0;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ maxWidth: 340 }}
          placeholder={placeholder}
          data-shortcut="/"
          title="Search (/)"
          value={view.search}
          onChange={(e) => view.setSearch(e.target.value)}
        />
        {sv.available && (
          <button className={'btn btn-sm ' + (sv.state ? 'btn-primary' : 'btn-ghost')} onClick={() => setPanel(true)} data-shortcut="f"
            title="Filter and group on any field, including related records and technology versions (F)">
            Filter &amp; group{sRules || sGroups ? ` (${[sRules && `${sRules} rule${sRules > 1 ? 's' : ''}`, sGroups && `${sGroups} group${sGroups > 1 ? 's' : ''}`].filter(Boolean).join(', ')})` : ''}
          </button>
        )}
        {view.filterFields.length > 0 && (
          <button className={'btn btn-sm ' + (view.customFilter ? 'btn-primary' : 'btn-ghost')} onClick={() => view.setShowCustom(true)}
            data-shortcut={sv.available ? undefined : 'f'}
            title="Filter the rows on this page by what they show (incl. computed columns)">
            {sv.available ? 'Quick filter' : 'Filter'}{view.customFilter ? ` (${view.customFilter.rules.length})` : ''}
          </button>
        )}
        {view.columns.length > 0 && (
          <select className="input btn-sm" style={{ width: 'auto', padding: '4px 8px' }} value={view.groupBy} disabled={sGroups > 0}
            onChange={(e) => view.setGroupBy(e.target.value)} title={sGroups ? 'Grouped by Filter & group' : 'Group by'}>
            <option value="">Group by…</option>
            {view.columns.map((c) => <option key={c} value={c}>{shortLabel(view.filterFields.find((f) => f.name === c)?.label ?? c)}</option>)}
          </select>
        )}
        {extra}
        {sv.loading && <span className="muted" style={{ fontSize: 12.5 }}>Searching…</span>}
        {sv.error && <span className="error-text" style={{ fontSize: 12.5 }}>{sv.error}</span>}
        {sv.capped && <span className="error-text" style={{ fontSize: 12.5 }}>Over 10,000 matches — narrow the filter.</span>}
        {view.active && (
          <>
            <span className="muted" style={{ fontSize: 12.5 }}>{view.visibleCount} of {view.total}</span>
            <button className="btn btn-ghost btn-sm" onClick={view.clearAll}>Clear</button>
          </>
        )}
      </div>

      {panel && view.resource && (
        <FilterPanel resource={view.resource} initial={sv.state} onApply={sv.set} onClose={() => setPanel(false)} />
      )}
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
