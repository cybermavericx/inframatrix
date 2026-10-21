import { BRAND } from '../branding';

/** App footer — shown at the bottom of the shell and on the auth screens. Text comes from branding.ts. */
export default function Footer({ fixed = false }: { fixed?: boolean }) {
  const year = new Date().getFullYear();
  return (
    <footer className={'appfoot' + (fixed ? ' appfoot-fixed' : '')}>
      <span className="foot-brand">{BRAND.product}</span>
      <span className="foot-sep">•</span>
      <span>{BRAND.tagline} </span>
      {BRAND.org.href ? (
        <a className="foot-org" href={BRAND.org.href} target="_blank" rel="noopener noreferrer">{BRAND.org.name}</a>
      ) : (
        <span className="foot-org">{BRAND.org.name}</span>
      )}
      {BRAND.links.map((l) => (
        <span key={l.href}>
          <span className="foot-sep">·</span>
          <a className="foot-link" href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
        </span>
      ))}
      <span className="foot-sep">·</span>
      <span>© {year}</span>
    </footer>
  );
}
