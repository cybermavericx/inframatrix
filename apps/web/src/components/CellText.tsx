import { Fragment, type ReactNode } from 'react';

/** Text in a list cell. It wraps between words at about 36 characters instead of widening its column.
 *  Plain-text values also get break points after . @ _ / (like spaces and hyphens), so a host name or
 *  e-mail wraps at its dots rather than mid-word. Only a value with no break point that still doesn't
 *  fit (e.g. "adminadmin…") is split anywhere, so it can't push the other columns under the pinned
 *  actions column. The column stays at least 10 characters wide. */
export function CellText({ children }: { children: ReactNode }) {
  return <span className="cell-text">{typeof children === 'string' ? withBreaks(children) : children}</span>;
}

function withBreaks(text: string): ReactNode {
  const parts = text.split(/(?<=[.@_/])/);
  if (parts.length === 1) return text;
  return parts.map((p, i) => <Fragment key={i}>{i > 0 && <wbr />}{p}</Fragment>);
}
