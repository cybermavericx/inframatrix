/** Every entityType this app's change-log/activity timeline actually writes (CrudService's
 *  `auditType` constructor arg, plus TagsService's `parentType`-keyed entries — see resources.ts's
 *  `parentType` overrides on the web side for where each one comes from), mapped to the permission
 *  resource that should gate reading it. An entityType not listed here is refused rather than
 *  silently allowed — change history can reveal old field values a user was never granted read
 *  access to, so an unrecognised type should fail closed, not open. */
export const ENTITY_RESOURCE: Record<string, string> = {
  project: 'infra.projects',
  server: 'infra.servers',
  environment: 'infra.environments',
  git_provider: 'infra.git-providers',
  integration_type: 'infra.integration-types',
  account: 'infra.accounts',
  integration: 'infra.integrations',
  user: 'core.users',
  client: 'jobbag.clients',
  vendor: 'jobbag.vendors',
  vendor_service: 'jobbag.vendor-services',
  payment: 'jobbag.payments',
  job: 'jobbag.jobs',
};
