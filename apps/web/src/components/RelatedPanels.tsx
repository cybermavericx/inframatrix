import { RelatedPanel, type RelatedPanelDef } from './RelatedPanel';
import { TagPanel } from './TagPanel';
import { ActivityPanel } from './ActivityPanel';
import { AttachmentPanel } from './AttachmentPanel';

/**
 * The generic "+ Add"-able related panels for a SAVED record: reminders / notes / FK-filtered
 * lists / tags / activity (from the resource's `relatedPanels` config), plus the Odoo-chatter
 * Attachments panel that shows on every record. Shared by the read-only View (RecordDetail) AND the
 * Edit form so both surfaces show the exact same panels. (Only render for an existing record — there
 * is no parentId to attach against while creating.)
 */
export function RelatedPanels({
  panels, parentType, parentId, parentLabel, canEdit,
}: {
  panels?: RelatedPanelDef[];
  parentType: string;
  parentId: number;
  parentLabel?: string;
  canEdit: boolean;
}) {
  if (!parentType || parentId == null) return null;
  return (
    <>
      {(panels ?? []).map((p) =>
        p.kind === 'tags' ? (
          <TagPanel key={p.title} parentType={parentType} parentId={parentId} canEdit={canEdit} />
        ) : p.kind === 'activity' ? (
          <ActivityPanel key={p.title} parentType={parentType} parentId={parentId} canEdit={canEdit} />
        ) : (
          <RelatedPanel key={p.title} panel={p} parentType={parentType} parentId={parentId} parentLabel={parentLabel} canEdit={canEdit} />
        ),
      )}
      <AttachmentPanel parentType={parentType} parentId={parentId} parentLabel={parentLabel} canEdit={canEdit} />
    </>
  );
}
