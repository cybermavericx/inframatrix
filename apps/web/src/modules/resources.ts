import type { RelatedPanelDef } from '../components/RelatedPanel';
import { isValidYmd } from '../lib/dates';

export interface FieldDef {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'checkbox' | 'select' | 'datetime-local' | 'date' | 'email' | 'ref' | 'multiref' | 'file' | 'html' | 'field-defs';
  options?: string[];
  /** for type 'ref' / 'multiref': */
  refEndpoint?: string; // e.g. '/infra/servers'
  refLabel?: string;    // option label field, e.g. 'serverName'
  /** for type 'ref' (read-only display): the relation object's key on the row when it is NOT
   *  `name` minus 'Id' — e.g. field 'pocUserId' whose relation is loaded as 'poc'. */
  refRelKey?: string;
  /** for text inputs: autocomplete options (rendered as a <datalist>) */
  suggestions?: string[];
  /** only show this field when another field's value is one of these (e.g. renewableType only when isRenewable=Y) */
  showWhen?: { field: string; in: string[] };
  /** for type 'select': allow typing a value not in `options` (e.g. a new renewable type) */
  allowCustom?: boolean;
  /** Custom-filter field picker only: groups this field under a drill-in "relation" (Odoo-style),
   *  e.g. group:'Environments' / 'Integrations'. Ungrouped fields sit at the top level. */
  group?: string;
}

export interface RowAction {
  label: string;
  path: (row: Record<string, unknown>) => string; // POST endpoint
  visible?: (row: Record<string, unknown>) => boolean;
  confirm?: string;
}

export interface CrudConfig {
  module: 'infra' | 'jobbag';
  key: string;
  title: string;
  resource: string; // permission resource, e.g. 'infra.servers'
  endpoint: string; // API path, e.g. '/infra/servers'
  fields: FieldDef[];
  columns: string[]; // field names (dot-paths allowed, e.g. 'server.serverName') shown in the table
  badgeColumns?: string[]; // columns rendered as coloured badges
  actions?: RowAction[]; // extra per-row POST actions (e.g. publish/revert)
  /** Per-row links to a related, filtered list (e.g. a vendor → all its payments). Shown in the row
   *  actions and the detail view. `to(row)` returns an in-app route, e.g. '/jobbag/payments?vendorId=5'. */
  relatedLinks?: { label: string; to: (row: Record<string, unknown>) => string }[];
  /** When set, each row gets a "Remind" button that creates a reminder against that record. */
  reminderTarget?: 'payment' | 'service_billing';
  /** Polymorphic parent key for the generic "+ Add reminder/note" flow (e.g. 'client','vendor_service','job'). */
  parentType?: string;
  /** Panels shown in the detail view: related reminders/notes (with "+ Add") or any FK-filtered list. */
  relatedPanels?: RelatedPanelDef[];
  /** Extra Custom-Filter fields that reach into related records — grouped into drill-in "relations"
   *  via FieldDef.group (e.g. Payments → Vendor/Service/Client). A field whose value is an ARRAY
   *  (an aggregate over child records the list endpoint attaches) matches if ANY element matches. */
  filterRelations?: FieldDef[];
  /** Per-row "Resolve" button (opens the resolve-with-note modal). Used by the Reminders log. */
  resolvable?: boolean;
  /** Read-only resource: hide New/Edit (e.g. the Reminders log is created from records, not here). */
  readOnly?: boolean;
  dateRanges?: { from: string; to: string }[]; // validate "to" >= "from"
  /** When a field changes in the editor, compute derived field values from the current draft row
   *  (e.g. Payments: Period to / Due date from Period from + Repeats). Returns a partial patch that
   *  is merged into the draft. Should only fill targets that are currently empty (don't clobber
   *  manual edits). `changed` is the name of the field that just changed. */
  derive?: (changed: string, row: Record<string, unknown>) => Record<string, unknown>;
  /** Read-only nested list of related child records, shown expandable under each row
   *  (e.g. a vendor's services). Clicking a child navigates to its own tab, filtered to it. */
  childList?: {
    endpoint: string;   // child API path, e.g. '/jobbag/vendor-services'
    foreignKey: string; // child field linking back to this row's id, e.g. 'vendorId'
    label: string;      // child field used as the main label, e.g. 'serviceName'
    meta?: string[];    // a few extra child fields to show inline, e.g. ['status','expiryDate','cost']
    linkPath: string;   // route to open on click, e.g. '/jobbag/vendor-services' (gets ?id=<childId>)
    title: string;      // heading/label, e.g. 'Services'
  };
}

const YN = ['Y', 'N'];

// ── Date helpers for derived fields (work on 'yyyy-mm-dd' strings, as <input type=date> uses) ──
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s: string, n: number) => {
  const [y, m, d] = s.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
};
const addMonths = (s: string, n: number) => {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(y, m - 1 + n, 1);            // first of the target month
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(d, last));                   // clamp (e.g. Jan 31 + 1mo → Feb 28)
  return ymd(t);
};
/** End-of-period date = period start + one cycle − 1 day (e.g. 01 Jan, MONTHLY → 31 Jan). */
const periodEnd = (from: string, freq: string, customMonths?: number | null): string | null => {
  if (!from) return null;
  const months: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };
  if (freq === 'WEEKLY') return addDays(from, 6);
  if (freq === 'CUSTOM') return customMonths ? addDays(addMonths(from, customMonths), -1) : null;
  if (months[freq]) return addDays(addMonths(from, months[freq]), -1);
  return null; // ONE_TIME / unknown → no period end
};

export const RESOURCES: CrudConfig[] = [
  // ---------------- INFRA ----------------
  {
    module: 'infra', key: 'projects', title: 'Projects',
    resource: 'infra.projects', endpoint: '/infra/projects',
    columns: ['name', 'status', 'poc.name', 'publishState', 'amcStatus'],
    badgeColumns: ['publishState', 'status'],
    dateRanges: [{ from: 'amcFrom', to: 'amcTo' }],
    actions: [
      { label: 'Publish', path: (r) => `/infra/projects/${r.id}/publish`, visible: (r) => !r.isPublished },
      { label: 'Revert to Draft', path: (r) => `/infra/projects/${r.id}/revert`, visible: (r) => !!r.isPublished, confirm: 'Revert this project to Draft?' },
    ],
    fields: [
      { name: 'name', label: 'Name' },
      { name: 'status', label: 'Status', type: 'select', options: ['active', 'on_hold', 'archived'] },
      { name: 'pocUserId', label: 'Point of Contact', type: 'ref', refEndpoint: '/users/lookup', refLabel: 'name' },
      { name: 'amcStatus', label: 'AMC status', type: 'select', options: ['active', 'inactive', 'internal'] },
      { name: 'amcFrom', label: 'AMC from', type: 'date' },
      { name: 'amcTo', label: 'AMC to', type: 'date' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    module: 'infra', key: 'servers', title: 'Servers',
    resource: 'infra.servers', endpoint: '/infra/servers',
    parentType: 'server',
    columns: ['serverName', 'provider', 'panel', 'status', 'capacity', 'publicIp', 'amc'],
    // Detail view: tags/flags (e.g. "To be dismantled" — inherited by every hosting on this server),
    // every environment (hosting) running on this server, and the change-log timeline.
    relatedPanels: [
      { title: 'Tags', kind: 'tags' },
      { title: 'Hosting on this server', kind: 'filter', endpoint: '/infra/environments', filterKey: 'serverId', exportResource: 'infra.environments',
        columns: [
          { name: 'project.name', label: 'project' }, { name: 'type', label: 'env' }, { name: 'url', label: 'url' },
        ],
        linkPath: '/infra/projects', linkIdField: 'projectId' },
      { title: 'Activity', kind: 'activity' },
    ],
    fields: [
      { name: 'serverName', label: 'Server name' },
      { name: 'subscriptionName', label: 'Subscription' },
      { name: 'location', label: 'Location' },
      { name: 'provider', label: 'Provider', type: 'select', options: ['Azure', 'AWS', 'Contabo', 'On-prem', 'Other'] },
      { name: 'panel', label: 'Panel', type: 'select', options: ['CloudPanel', 'Plesk', 'None'] },
      { name: 'osName', label: 'OS name' },
      { name: 'osVersion', label: 'OS version' },
      { name: 'status', label: 'Status', type: 'select', options: ['active', 'maintenance', 'decommissioned'] },
      { name: 'capacity', label: 'Hosting capacity', type: 'number' },
      { name: 'amc', label: 'AMC', type: 'checkbox' },
      { name: 'publicIp', label: 'Public IP' },
      { name: 'privateIp', label: 'Private IP' },
      { name: 'configuredDate', label: 'Configured date', type: 'date' },
    ],
  },
  {
    module: 'infra', key: 'git-providers', title: 'Git Providers',
    resource: 'infra.git-providers', endpoint: '/infra/git-providers',
    parentType: 'git_provider',
    relatedPanels: [{ title: 'Activity', kind: 'activity' }],
    columns: ['name', 'baseUrl'],
    fields: [
      { name: 'name', label: 'Name' },
      { name: 'baseUrl', label: 'Base URL' },
    ],
  },
  {
    module: 'infra', key: 'integration-types', title: 'Integration Types',
    resource: 'infra.integration-types', endpoint: '/infra/integration-types',
    parentType: 'integration_type',
    relatedPanels: [{ title: 'Activity', kind: 'activity' }],
    columns: ['name', 'behavior', 'isActive'],
    fields: [
      { name: 'name', label: 'Name' },
      { name: 'behavior', label: 'Behavior', type: 'select', options: ['generic_value', 'key_value', 'account_select_optional', 'custom_fields'] },
      { name: 'fields', label: 'Custom Fields', type: 'field-defs', showWhen: { field: 'behavior', in: ['custom_fields'] } },
      { name: 'isActive', label: 'Active', type: 'checkbox' },
    ],
  },
  {
    module: 'infra', key: 'accounts', title: 'Accounts',
    resource: 'infra.accounts', endpoint: '/infra/accounts',
    parentType: 'account',
    relatedPanels: [{ title: 'Activity', kind: 'activity' }],
    columns: ['accountName', 'integrationType.name'],
    fields: [
      { name: 'accountName', label: 'Account name' },
      { name: 'integrationTypeId', label: 'Integration type', type: 'ref', refEndpoint: '/infra/integration-types', refLabel: 'name' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    module: 'infra', key: 'tags', title: 'Tags',
    resource: 'infra.tags', endpoint: '/infra/tags',
    // The reusable flag catalogue. Tags are attached to records from each record's detail view;
    // this screen manages the master list (rename, recolour, retire).
    columns: ['name', 'color', 'description'],
    badgeColumns: ['color'],
    fields: [
      { name: 'name', label: 'Tag name' },
      { name: 'color', label: 'Color', type: 'select', options: ['gray', 'green', 'blue', 'amber', 'red'] },
      { name: 'description', label: 'Description', type: 'textarea' },
    ],
  },
  // (Environments & Integrations are managed nested inside the Project editor, not as
  //  standalone screens — avoids picking the wrong project. Invites live in the Users screen.)

  // ---------------- JOBBAG ----------------
  {
    module: 'jobbag', key: 'clients', title: 'Clients',
    resource: 'jobbag.clients', endpoint: '/jobbag/clients',
    parentType: 'client',
    columns: ['name', 'email', 'phone', 'status'],
    relatedLinks: [{ label: 'Billings', to: (r) => `/jobbag/payments?clientId=${r.id}` }],
    // Drill into the services billed to this client / its payments (aggregates from the list endpoint).
    filterRelations: [
      { name: 'serviceNames', label: 'Name', group: 'Services' },
      { name: 'paymentStatuses', label: 'Status', group: 'Payments' },
    ],
    // In the detail view: the services billed to this client (from payments) with each period's
    // payment status — click a row to open the underlying vendor-service. Plus reminders & notes.
    relatedPanels: [
      { title: 'Services & billing', kind: 'filter', endpoint: '/jobbag/payments', filterKey: 'clientId', exportResource: 'jobbag.payments',
        columns: [
          { name: 'vendorService.serviceName', label: 'service' }, { name: 'periodFrom', label: 'from' },
          { name: 'periodTo', label: 'to' }, { name: 'amount', label: 'amount' }, { name: 'status', label: 'payment' },
        ],
        badgeCols: ['status'], linkPath: '/jobbag/vendor-services', linkIdField: 'vendorServiceId' },
      { title: 'Reminders', kind: 'reminders' },
      { title: 'Activity', kind: 'activity' }, // change-log + notes in one Odoo-style timeline
    ],
    fields: [
      { name: 'name', label: 'Name' },
      { name: 'groupName', label: 'Group' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'phone', label: 'Phone' },
      { name: 'billingUnder', label: 'Billing under' },
      { name: 'billingAddress', label: 'Billing address', type: 'textarea' },
      { name: 'trn', label: 'TRN' },
      { name: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] },
    ],
  },
  {
    module: 'jobbag', key: 'vendors', title: 'Vendors',
    resource: 'jobbag.vendors', endpoint: '/jobbag/vendors',
    parentType: 'vendor',
    columns: ['vendorName', 'pocName', 'pocEmail', 'status'],
    relatedLinks: [{ label: 'Payments', to: (r) => `/jobbag/payments?vendorId=${r.id}` }],
    // Drill into the vendor's services / payments (aggregates from the list endpoint).
    filterRelations: [
      { name: 'serviceNames', label: 'Name', group: 'Services' },
      { name: 'serviceStatuses', label: 'Status', group: 'Services' },
      { name: 'serviceExpiries', label: 'Expiry date', type: 'date', group: 'Services' },
      { name: 'paymentStatuses', label: 'Status', group: 'Payments' },
      { name: 'paymentDirections', label: 'Direction', group: 'Payments' },
    ],
    childList: {
      endpoint: '/jobbag/vendor-services', foreignKey: 'vendorId', label: 'serviceName',
      meta: ['status', 'expiryDate', 'cost'], linkPath: '/jobbag/vendor-services', title: 'Services',
    },
    relatedPanels: [
      { title: 'Reminders', kind: 'reminders' },
      { title: 'Activity', kind: 'activity' }, // change-log + notes in one Odoo-style timeline
    ],
    fields: [
      { name: 'vendorName', label: 'Vendor name' },
      { name: 'pocName', label: 'PoC name' },
      { name: 'pocEmail', label: 'PoC email', type: 'email' },
      { name: 'pocPhone', label: 'PoC phone' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'paymentMethod', label: 'Payment method', type: 'select', options: ['CARD', 'CASH', 'CHEQUE', 'ONLINE'] },
      { name: 'billingUnder', label: 'Billing under' },
      { name: 'address', label: 'Address', type: 'textarea' },
      { name: 'trn', label: 'TRN' },
      { name: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] },
    ],
  },
  {
    module: 'jobbag', key: 'vendor-services', title: 'Vendor Services',
    resource: 'jobbag.vendor-services', endpoint: '/jobbag/vendor-services',
    parentType: 'vendor_service',
    columns: ['vendor.vendorName', 'serviceName', 'expiryDate', 'isRenewable', 'status'],
    badgeColumns: ['status', 'isRenewable'],
    relatedLinks: [{ label: 'Payments', to: (r) => `/jobbag/payments?vendorServiceId=${r.id}` }],
    dateRanges: [{ from: 'startDate', to: 'expiryDate' }],
    // Vendor (direct) + the service's payments / billed clients (aggregates from the list endpoint).
    filterRelations: [
      { name: 'vendor.vendorName', label: 'Name', group: 'Vendor' },
      { name: 'vendor.status', label: 'Status', group: 'Vendor' },
      { name: 'vendor.pocName', label: 'POC', group: 'Vendor' },
      { name: 'paymentStatuses', label: 'Status', group: 'Payments' },
      { name: 'paymentDirections', label: 'Direction', group: 'Payments' },
      { name: 'clientNames', label: 'Name', group: 'Clients' },
    ],
    // Purchase + billing history for this service (outgoing = what we pay the vendor, incoming = what
    // we bill a client), each clickable; plus the reminders & notes attached to the service.
    relatedPanels: [
      { title: 'Payments & client billing', kind: 'filter', endpoint: '/jobbag/payments', filterKey: 'vendorServiceId', exportResource: 'jobbag.payments',
        columns: [
          { name: 'direction', label: 'dir' }, { name: 'client.name', label: 'client' },
          { name: 'periodFrom', label: 'from' }, { name: 'periodTo', label: 'to' },
          { name: 'amount', label: 'amount' }, { name: 'status', label: 'status' },
        ],
        badgeCols: ['direction', 'status'], linkPath: '/jobbag/payments' },
      { title: 'Reminders', kind: 'reminders' },
      { title: 'Activity', kind: 'activity' }, // change-log + notes in one Odoo-style timeline
    ],
    fields: [
      { name: 'vendorId', label: 'Vendor', type: 'ref', refEndpoint: '/jobbag/vendors', refLabel: 'vendorName' },
      { name: 'serviceName', label: 'Service' },
      { name: 'cost', label: 'Cost', type: 'number' },
      { name: 'currency', label: 'Currency' },
      { name: 'quantity', label: 'Quantity', type: 'number' },
      { name: 'frequency', label: 'Frequency' },
      { name: 'paymentMethod', label: 'Payment method (how)', type: 'select', options: ['CARD', 'CASH', 'CHEQUE', 'ONLINE'] },
      { name: 'startDate', label: 'Start date', type: 'date' },
      { name: 'expiryDate', label: 'Expiry date', type: 'date' },
      { name: 'isRenewable', label: 'Renewable', type: 'select', options: YN },
      { name: 'renewableType', label: 'Renewable type', type: 'select', allowCustom: true,
        showWhen: { field: 'isRenewable', in: ['Y'] },
        options: ['MONTHLY', 'THREE_MONTHS', 'SIX_MONTHS', 'ONE_YEAR', 'TWO_YEARS', 'MORE_THAN_TWO_YEARS'] },
      { name: 'status', label: 'Status', type: 'select', options: ['CREATED', 'STARTED', 'EXPIRED', 'DROPPED'] },
    ],
  },
  {
    // Service Billing was removed — a client's billing is now an `incoming` Payment (the Payment record
    // is the single link between client, service and vendor). See the client/vendor-service detail panels.
    module: 'jobbag', key: 'payments', title: 'Payments',
    resource: 'jobbag.payments', endpoint: '/jobbag/payments',
    parentType: 'payment',
    columns: ['direction', 'vendor.vendorName', 'client.name', 'amount', 'dueDate', 'frequency', 'status'],
    badgeColumns: ['direction', 'status', 'frequency'],
    dateRanges: [{ from: 'periodFrom', to: 'periodTo' }],
    // Cross-entity filters: a payment links a Vendor, a Service and a Client — drill into each.
    filterRelations: [
      { name: 'vendor.vendorName', label: 'Name', group: 'Vendor' },
      { name: 'vendor.status', label: 'Status', group: 'Vendor' },
      { name: 'vendorService.serviceName', label: 'Name', group: 'Service' },
      { name: 'vendorService.expiryDate', label: 'Expiry date', type: 'date', group: 'Service' },
      { name: 'vendorService.status', label: 'Status', group: 'Service' },
      { name: 'client.name', label: 'Name', group: 'Client' },
      { name: 'client.status', label: 'Status', group: 'Client' },
    ],
    relatedPanels: [
      { title: 'Reminders', kind: 'reminders' },
      { title: 'Activity', kind: 'activity' }, // change-log + notes in one Odoo-style timeline
    ],
    // When Period from / Repeats / Every-N-months change, fill the end of the billing period and a
    // matching due date — but only when those fields are still empty (never clobber manual edits).
    derive: (changed, row) => {
      if (!['periodFrom', 'frequency', 'customMonths'].includes(changed)) return {};
      const from = (row.periodFrom as string) || '';
      if (from && !isValidYmd(from)) return {}; // ignore half-typed dates (no more 1902 artifacts)
      const end = periodEnd(from, String(row.frequency ?? ''), row.customMonths as number | null);
      const patch: Record<string, unknown> = {};
      if (end && !row.periodTo) patch.periodTo = end;
      const effectiveTo = (row.periodTo as string) || end;
      if (effectiveTo && !row.dueDate) patch.dueDate = effectiveTo; // due date defaults to period end
      return patch;
    },
    actions: [
      // mark this cycle paid; if recurring, the API auto-creates the next due payment
      { label: 'Mark paid', path: (r) => `/jobbag/payments/${r.id}/pay`, visible: (r) => r.status !== 'paid', confirm: 'Mark this payment as paid?\n(If it is recurring, the next cycle will be created automatically.)' },
      // pre-create EVERY cycle up to the contract-end date, each markable on its own (vs. pay-as-you-go).
      // Only on a fresh recurring payment that has an end date and isn't already part of a series.
      { label: 'Generate schedule', path: (r) => `/jobbag/payments/${r.id}/schedule`,
        visible: (r) => !!r.frequency && r.frequency !== 'ONE_TIME' && !!r.tenureEnd && !r.seriesId && !r.spawnedNext,
        confirm: 'Create every payment cycle from this one up to the contract-end date?\nEach period becomes its own row you can mark paid individually. (Use this instead of pay-as-you-go.)' },
    ],
    fields: [
      { name: 'direction', label: 'Direction', type: 'select', options: ['outgoing', 'incoming'] },
      { name: 'vendorServiceId', label: 'For service', type: 'ref', refEndpoint: '/jobbag/vendor-services', refLabel: 'serviceName' },
      { name: 'vendorId', label: 'Vendor (pay to)', type: 'ref', refEndpoint: '/jobbag/vendors', refLabel: 'vendorName' },
      { name: 'clientId', label: 'Client (paid by) — optional', type: 'ref', refEndpoint: '/jobbag/clients', refLabel: 'name' },
      { name: 'amount', label: 'Amount', type: 'number' },
      { name: 'currency', label: 'Currency' },
      { name: 'paymentMethod', label: 'Payment method (how)', type: 'select', options: ['CARD', 'CASH', 'CHEQUE', 'ONLINE'] },
      { name: 'forWhat', label: 'For what', type: 'textarea' },
      // ── Recurrence: a contract paid in cycles. Mark a cycle paid → next is auto-created. ──
      { name: 'frequency', label: 'Repeats', type: 'select', options: ['ONE_TIME', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'CUSTOM'] },
      { name: 'customMonths', label: 'Every N months', type: 'number', showWhen: { field: 'frequency', in: ['CUSTOM'] } },
      { name: 'tenureEnd', label: 'Contract ends — optional, blank = repeat forever', type: 'date', showWhen: { field: 'frequency', in: ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'CUSTOM'] } },
      { name: 'periodFrom', label: 'Period from', type: 'date' },
      { name: 'periodTo', label: 'Period to', type: 'date' },
      { name: 'dueDate', label: 'Due date', type: 'date' },
      { name: 'paidDate', label: 'Paid date', type: 'date' },
      { name: 'status', label: 'Status', type: 'select', options: ['due', 'paid', 'overdue', 'cancelled'] },
    ],
  },
  {
    module: 'jobbag', key: 'jobs', title: 'Jobs',
    resource: 'jobbag.jobs', endpoint: '/jobbag/jobs',
    parentType: 'job',
    columns: ['uniqueId', 'title', 'vendorService.vendor.vendorName', 'client.name', 'projectStatus'],
    filterRelations: [
      { name: 'vendorService.serviceName', label: 'Name', group: 'Service' },
      { name: 'vendorService.vendor.vendorName', label: 'Name', group: 'Vendor' },
      { name: 'client.name', label: 'Name', group: 'Client' },
    ],
    // A job is a task you track + get reminded about. Link a vendor-service (its vendor shows
    // automatically) and a client, write the action, then add reminders/notes from the detail view.
    relatedPanels: [
      { title: 'Reminders', kind: 'reminders' },
      { title: 'Activity', kind: 'activity' }, // change-log + notes in one Odoo-style timeline
    ],
    fields: [
      { name: 'title', label: 'Job name' },
      { name: 'vendorServiceId', label: 'Vendor service (vendor shown automatically)', type: 'ref', refEndpoint: '/jobbag/vendor-services', refLabel: 'serviceName' },
      { name: 'clientId', label: 'Client', type: 'ref', refEndpoint: '/jobbag/clients', refLabel: 'name' },
      { name: 'action', label: 'Job action / note', type: 'textarea' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'requestedBy', label: 'Requested by' },
      { name: 'requesterEmail', label: 'Requester email', type: 'email' },
      {
        name: 'projectStatus', label: 'Status', type: 'select',
        options: ['REQUEST_CREATED', 'QUOTE_CREATED', 'INVOICE_REQUESTED', 'INVOICE_CREATED', 'PAYMENT_RECEIVED', 'COMPLETED', 'DROPPED'],
      },
    ],
  },
  {
    // Central log of every reminder (created via the "+ Add reminder" button on any record). Filter by
    // status / type / month, search any field, and Resolve (with a note) right here.
    module: 'jobbag', key: 'reminders', title: 'Reminders',
    resource: 'jobbag.reminders', endpoint: '/jobbag/reminders',
    readOnly: true,
    resolvable: true,
    columns: ['title', 'parentType', 'scheduledDateTime', 'recurrence', 'status'],
    badgeColumns: ['parentType', 'status', 'recurrence'],
    fields: [
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'parentType', label: 'For', type: 'text' },
      { name: 'parentId', label: 'Record #', type: 'number' },
      { name: 'content', label: 'Message', type: 'textarea' },
      { name: 'emailTo', label: 'Extra emails', type: 'text' },
      { name: 'scheduledDateTime', label: 'Scheduled at', type: 'datetime-local' },
      { name: 'recurrence', label: 'Repeat', type: 'text' },
      { name: 'status', label: 'Status', type: 'text' },
      { name: 'resolvedNote', label: 'Resolution note', type: 'textarea' },
      { name: 'resolvedAt', label: 'Resolved at', type: 'text' },
    ],
  },
  {
    module: 'jobbag', key: 'reminder-groups', title: 'Reminder Groups',
    // Reuses the jobbag.reminders permission (no separate RBAC resource).
    resource: 'jobbag.reminders', endpoint: '/jobbag/reminder-groups',
    columns: ['name', 'description'],
    fields: [
      { name: 'name', label: 'Group name' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'memberUserIds', label: 'Members', type: 'multiref', refEndpoint: '/users/lookup', refLabel: 'name' },
    ],
  },
  {
    // Log of notes added against records (via the "+ Add note" button). Created from a record's detail
    // view; deletable here. Click a row to read the full note.
    module: 'jobbag', key: 'notes', title: 'Notes',
    resource: 'jobbag.notes', endpoint: '/jobbag/notes',
    readOnly: true,
    columns: ['parentType', 'parentId', 'body', 'authorName', 'createdAt'],
    badgeColumns: ['parentType'],
    fields: [
      { name: 'parentType', label: 'For', type: 'text' },
      { name: 'parentId', label: 'Record #', type: 'number' },
      { name: 'body', label: 'Note', type: 'textarea' },
      { name: 'authorName', label: 'By', type: 'text' },
      { name: 'createdAt', label: 'Added', type: 'text' },
    ],
  },
  {
    // Mail outbox: every email the system sent / stored. When no provider is configured, mails are
    // STORED here so nothing is lost — open a row to read the full rendered body.
    module: 'jobbag', key: 'outbox', title: 'Outbox',
    resource: 'jobbag.outbox', endpoint: '/jobbag/outbox',
    readOnly: true,
    columns: ['toAddr', 'subject', 'status', 'provider', 'sentAt'],
    badgeColumns: ['status', 'provider'],
    fields: [
      { name: 'toAddr', label: 'To', type: 'text' },
      { name: 'subject', label: 'Subject', type: 'text' },
      { name: 'status', label: 'Status', type: 'text' },
      { name: 'provider', label: 'Provider', type: 'text' },
      { name: 'relatedType', label: 'Related', type: 'text' },
      { name: 'error', label: 'Error', type: 'textarea' },
      { name: 'sentAt', label: 'Sent at', type: 'text' },
      { name: 'body', label: 'Body', type: 'html' },
    ],
  },
  {
    // rendered by NotificationsPage (read-only log), listed here so it shows in the sidebar
    module: 'jobbag', key: 'notifications', title: 'Notifications',
    resource: 'jobbag.notifications', endpoint: '/jobbag/notifications',
    columns: [], fields: [],
  },
];

export const resourcesForModule = (module: string) => RESOURCES.filter((r) => r.module === module);
