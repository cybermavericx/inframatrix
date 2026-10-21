/** App footer — shown at the bottom of the shell and on the auth screens. */
export default function Footer({ fixed = false }: { fixed?: boolean }) {
  const year = new Date().getFullYear();
  return (
    <footer className={'appfoot' + (fixed ? ' appfoot-fixed' : '')}>
      <span className="foot-brand">InfraMatrix</span>
      <span className="foot-sep">•</span>
      <span>Open-source Infrastructure Tracker by </span>
      <a className="foot-org" href="https://muhammednoufal.cybermavericx.com" target="_blank" rel="noopener noreferrer">
        Muhammed Noufal
      </a>
      <span className="foot-sep">·</span>
      <a className="foot-link" href="https://cybermavericx.com" target="_blank" rel="noopener noreferrer">cybermavericx.com</a>
      <span className="foot-sep">·</span>
      <a className="foot-link" href="https://github.com/cybermavericx/inframatrix" target="_blank" rel="noopener noreferrer">GitHub</a>
      <span className="foot-sep">·</span>
      <span>© {year}</span>
    </footer>
  );
}
