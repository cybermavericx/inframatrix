/**
 * Wrap arbitrary body HTML in a clean, email-client-safe InfraMatrix shell. Uses only inline styles
 * and a table layout (no external CSS) so it renders consistently across mail clients.
 */
export function brandwrap(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2933;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e7eb;">
            <tr>
              <td style="background:#1f3a5f;padding:18px 28px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.3px;">InfraMatrix</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 28px 8px 28px;">
                <h2 style="margin:0 0 16px 0;font-size:20px;line-height:1.3;color:#1f3a5f;">${title}</h2>
                <div style="font-size:14px;line-height:1.6;color:#1f2933;">${bodyHtml}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 28px 28px;">
                <hr style="border:none;border-top:1px solid #e4e7eb;margin:0 0 12px 0;" />
                <span style="font-size:12px;color:#9aa5b1;">Open-source Infrastructure Tracker by <a href="https://muhammednoufal.cybermavericx.com" style="color:#9aa5b1;">Muhammed Noufal</a> · <a href="https://cybermavericx.com" style="color:#9aa5b1;">cybermavericx.com</a></span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
