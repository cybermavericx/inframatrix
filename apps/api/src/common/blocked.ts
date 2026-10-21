import { ConflictException } from '@nestjs/common';

/** A single record that is preventing a delete (so the UI can link straight to it). */
export interface Blocker {
  resource: string; // permission/route resource, e.g. 'jobbag.vendor-services' → /jobbag/vendor-services
  id: number;
  label: string;    // human label shown next to the id
}

/**
 * Build the 409 thrown when a delete is blocked by still-referencing records. The body carries the
 * actual blockers (id + label + resource) so the web app can render each as a click-through link to
 * that exact record — like Odoo naming the record that holds the reference.
 */
export function blockedBy(what: string, blockers: Blocker[], hint?: string): ConflictException {
  const n = blockers.length;
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: `Cannot delete this ${what} — ${n} record${n > 1 ? 's' : ''} still reference${n > 1 ? '' : 's'} it.`,
    blockers: blockers.slice(0, 100), // cap the payload; the message keeps the true total
    blockersTotal: n,
    hint,
  });
}

/** Short, readable label for a payment row used in blocker lists. */
export function paymentLabel(p: { id: number; amount?: number | null; currency?: string | null; direction?: string | null; forWhat?: string | null }): string {
  if (p.forWhat && p.forWhat.trim()) return p.forWhat.trim();
  const money = [p.currency, p.amount].filter((x) => x != null && x !== '').join(' ');
  return `${money || 'Payment'}${p.direction ? ` (${p.direction})` : ''} #${p.id}`;
}
