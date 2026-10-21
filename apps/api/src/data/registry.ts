import { Server } from '../infra/entities/server.entity';
import { Project } from '../infra/entities/project.entity';
import { GitProvider } from '../infra/entities/git-provider.entity';
import { IntegrationType } from '../infra/entities/integration-type.entity';
import { Account } from '../infra/entities/account.entity';
import { Environment } from '../infra/entities/environment.entity';
import { Integration } from '../infra/entities/integration.entity';
import { Invite } from '../infra/entities/invite.entity';
import { Client } from '../jobbag/entities/client.entity';
import { Vendor } from '../jobbag/entities/vendor.entity';
import { VendorService } from '../jobbag/entities/vendor-service.entity';
import { Job } from '../jobbag/entities/job.entity';
import { Payment } from '../jobbag/entities/payment.entity';
import { Reminder } from '../jobbag/entities/reminder.entity';
import { Note } from '../jobbag/entities/note.entity';
import { Outbox } from '../mail/entities/outbox.entity';
import { Tag } from '../tags/entities/tag.entity';
import { User } from '../users/entities/user.entity';

/** Maps a permission/resource key to its TypeORM entity (for generic Excel import/export). */
export const RESOURCE_ENTITIES: Record<string, new () => object> = {
  // Users: exports name/email/status (password is select:false → never exported); import matches by
  // unique email and UPDATES existing users. New users are skipped (password is required, not in sheet).
  'core.users': User,
  'infra.servers': Server,
  'infra.projects': Project,
  'infra.git-providers': GitProvider,
  'infra.integration-types': IntegrationType,
  'infra.accounts': Account,
  'infra.environments': Environment,
  'infra.integrations': Integration,
  'infra.invites': Invite,
  'jobbag.clients': Client,
  'jobbag.vendors': Vendor,
  'jobbag.vendor-services': VendorService,
  'jobbag.jobs': Job,
  'jobbag.payments': Payment,
  'jobbag.reminders': Reminder,
  'jobbag.notes': Note,
  'jobbag.outbox': Outbox,
  'infra.tags': Tag,
};

const YN = ['Y', 'N'];

/**
 * Allowed values for constrained (dropdown) columns — listed on the export "Reference"
 * sheet so importers use valid values. Mirrors the frontend select options.
 */
export const RESOURCE_ENUMS: Record<string, Record<string, string[]>> = {
  'core.users': { status: ['Y', 'N'] },
  'infra.servers': {
    provider: ['Azure', 'AWS', 'Contabo', 'On-prem', 'Other'],
    panel: ['CloudPanel', 'Plesk', 'None'],
    status: ['active', 'maintenance', 'decommissioned'],
  },
  'infra.integration-types': {
    behavior: ['generic_value', 'key_value', 'account_select_optional', 'custom_fields'],
  },
  'infra.environments': {
    type: ['staging', 'uat', 'live'],
    cicdStatus: ['auto', 'manual', 'disabled'],
  },
  'infra.projects': {
    status: ['active', 'on_hold', 'archived'],
    amcStatus: ['active', 'inactive', 'internal'],
  },
  'jobbag.clients': { status: ['active', 'inactive'] },
  'jobbag.vendors': {
    paymentMethod: ['CARD', 'CASH', 'CHEQUE', 'ONLINE'],
    status: ['active', 'inactive'],
  },
  'jobbag.vendor-services': {
    isRenewable: YN,
    renewableType: ['MONTHLY', 'SIX_MONTHS', 'ONE_YEAR', 'TWO_YEARS', 'MORE_THAN_TWO_YEARS'],
    status: ['CREATED', 'STARTED', 'EXPIRED', 'DROPPED'],
  },
  'jobbag.jobs': {
    projectStatus: ['REQUEST_CREATED', 'QUOTE_CREATED', 'INVOICE_REQUESTED', 'INVOICE_CREATED', 'PAYMENT_RECEIVED', 'COMPLETED', 'DROPPED'],
  },
  'jobbag.payments': {
    direction: ['outgoing', 'incoming'],
    paymentMethod: ['CARD', 'CASH', 'CHEQUE', 'ONLINE'],
    status: ['due', 'paid', 'overdue', 'cancelled'],
  },
  'jobbag.reminders': {
    parentType: ['payment', 'vendor_service', 'client', 'vendor', 'job'],
    recurrence: ['NONE', 'WEEKLY', 'MONTHLY', 'YEARLY'],
    status: ['WAITING', 'DUE', 'PENDING_RESOLVED', 'RESOLVED', 'CANCELLED'],
  },
  'jobbag.outbox': {
    status: ['QUEUED', 'SENT', 'FAILED', 'STORED'],
    provider: ['smtp', 'sendgrid'],
  },
};
