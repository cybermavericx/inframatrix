import { Fragment, type ReactNode } from 'react';
import type { ListView, Row } from '../hooks/useListView';

/** Group headers (nested up to 3 levels, each with its record count) + the rows of the innermost
 *  groups. Click a header to fold it — a folded group hides everything nested in it. */
export function GroupedRows({ view, colSpan, renderRow }: { view: ListView; colSpan: number; renderRow: (r: Row) => ReactNode }) {
  return (
    <>
      {(view.groups ?? []).map((g) => {
        const folded = view.collapsedGroups.has(g.key);
        return (
          <Fragment key={'grp-' + g.key}>
            <tr onClick={() => view.toggleGroup(g.key)} style={{ cursor: 'pointer', background: 'var(--bg-2)' }}>
              <td colSpan={colSpan} style={{ fontWeight: 600, padding: '7px 12px', paddingLeft: 12 + g.depth * 20 }}>
                {folded ? '▸' : '▾'} {g.label} <span className="muted" style={{ fontWeight: 400 }}>({g.count})</span>
              </td>
            </tr>
            {!folded && g.rows.map(renderRow)}
          </Fragment>
        );
      })}
    </>
  );
}
