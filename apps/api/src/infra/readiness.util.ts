import type { Project } from './entities/project.entity';
import type { Environment } from './entities/environment.entity';
import type { Integration } from './entities/integration.entity';

/**
 * Pure publish-readiness check from already-loaded data (no DB access) — the single source of
 * truth for the rules, shared by ProjectsService and the Dashboard. `intsByEnvId` maps an
 * environmentId to its integrations (each with `integrationType` loaded).
 */
export function computeProjectReasons(
  p: Project,
  envs: Environment[],
  intsByEnvId: Map<number, Integration[]>,
): string[] {
  const reasons: string[] = [];
  if (!p.pocUserId) reasons.push('A Point of Contact must be selected.');

  // AMC: an active AMC must declare its coverage period (from & to).
  if (p.amcStatus === 'active' && (!p.amcFrom || !p.amcTo)) {
    reasons.push('AMC is active — set both the AMC from and AMC to dates.');
  }
  if (p.amcFrom && p.amcTo && p.amcTo < p.amcFrom) {
    reasons.push('AMC to date must be on or after the AMC from date.');
  }

  if (envs.length === 0) reasons.push('At least one environment must exist.');

  for (const e of envs) {
    const lbl = e.type ?? 'environment';
    if (!e.type || !e.url || !e.serverId || !e.gitProviderId || !e.repoUrl || !e.repoBranch) {
      reasons.push(`Environment "${lbl}": fill type, URL, server, git provider, repo URL & branch.`);
    }
    if ((!e.cicdStatus || e.cicdStatus === 'disabled') && !e.cicdNotConfiguredReason) {
      reasons.push(`Environment "${lbl}": a CI/CD reason is required when CI/CD is Disabled.`);
    }
    // Checklist: whenever it is marked completed (on ANY env type), every detail is required.
    if (e.checklistCompleted) {
      const missing: string[] = [];
      if (!e.checklistAttachment) missing.push('document');
      if (!e.checklistSubmittedById) missing.push('submitted by');
      if (!e.checklistSubmittedDate) missing.push('submitted date');
      if (!e.checklistSubmittedVersion) missing.push('version');
      if (missing.length) {
        reasons.push(`Environment "${lbl}": go-live checklist is marked completed — provide ${missing.join(', ')}.`);
      }
    } else if (e.type === 'live') {
      // A live env that has NOT completed the checklist must explain why.
      if (!e.checklistNotCompletedReason) {
        reasons.push('Live environment: provide a reason the go-live checklist is not completed.');
      }
    }
    for (const it of intsByEnvId.get(e.id as number) ?? []) {
      const b = it.integrationType?.behavior;
      const nm = it.integrationType?.name;
      if (b === 'generic_value' && !it.value) {
        reasons.push(`Integration "${nm}": Identifier / Config ID is required.`);
      }
      if (b === 'key_value' && (!it.keyName || !it.value)) {
        reasons.push(`Integration "${nm}": both Key name and Value are required.`);
      }
    }
  }
  return reasons;
}

/** group integrations by environmentId */
export function groupIntegrations(ints: Integration[]): Map<number, Integration[]> {
  const map = new Map<number, Integration[]>();
  for (const it of ints) {
    const k = it.environmentId as number;
    const arr = map.get(k);
    if (arr) arr.push(it); else map.set(k, [it]);
  }
  return map;
}
