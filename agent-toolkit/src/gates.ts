import type { ToolCatalogEntry, ToolClass } from './catalog'
import { BOUNDARY_NOTICE } from './errors'

export const RECEIPT_TTL_MS = 12 * 60 * 60 * 1000
export const BACKUP_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/

export interface GateInput {
  entry: ToolCatalogEntry | undefined
  tool: string
  allowDrafts: boolean
  allowPublish: boolean
  approvePublish: boolean
  allowEditorNavigation: boolean
  backupId: string | undefined
  dryRun: boolean
  confirmReviewed: boolean
  hasMatchingReceipt: boolean
}

export type GateDecision =
  | {
      effect: 'dispatch' | 'dry-run'
      toolClass: ToolClass
      writeReceipt: boolean
    }
  | {
      effect: 'refuse'
      reason: string
    }

export function decideGate(input: GateInput): GateDecision {
  const { entry } = input
  if (!entry) {
    return {
      effect: 'refuse',
      reason: `Unknown tool "${input.tool}". This client fails closed until the tool is classified in agent-toolkit/src/catalog.ts. ${BOUNDARY_NOTICE}`,
    }
  }

  if (entry.toolClass === 'read') {
    if (entry.navigatesEditor && !input.allowEditorNavigation) {
      return {
        effect: 'refuse',
        reason: `${entry.name} moves the visible Site canvas. Pass --allow-editor-navigation when that is intended. Read and audit commands do not move the editor. ${BOUNDARY_NOTICE}`,
      }
    }
    return { effect: input.dryRun ? 'dry-run' : 'dispatch', toolClass: 'read', writeReceipt: false }
  }

  const publish = entry.toolClass === 'publish'
  if (publish) {
    if (!input.allowPublish || !input.approvePublish) {
      return {
        effect: 'refuse',
        reason: `${entry.name} changes visitor-visible state. Draft mode never includes publishing. Pass both --allow-publish and --approve-publish on a separate command from drafting. The server treats a successful call as the approval and will not ask again. ${BOUNDARY_NOTICE}`,
      }
    }
  } else if (!input.allowDrafts) {
    const libraryNote = entry.toolClass === 'library-write'
      ? 'media_upload stores the file immediately; skipping site_publish does not undo it. '
      : 'Draft tools edit the open workspace and do not publish. '
    return {
      effect: 'refuse',
      reason: `${entry.name} is refused in the default read-only mode. ${libraryNote}Pass --allow-drafts only after a backup and a dry-run. --allow-publish does not permit this call. ${BOUNDARY_NOTICE}`,
    }
  }

  if (!input.backupId) {
    return {
      effect: 'refuse',
      reason: 'Pass --backup-id with the label of a backup you already took (database plus uploads, or a site-bundle export). This client does not create backups and does not read backup files.',
    }
  }
  if (!BACKUP_ID_RE.test(input.backupId)) {
    return {
      effect: 'refuse',
      reason: 'backup id must be a short label of letters, numbers, dots, underscores, or hyphens. It is an acknowledgement, not a filesystem path.',
    }
  }

  if (input.dryRun) {
    return { effect: 'dry-run', toolClass: entry.toolClass, writeReceipt: true }
  }

  if (!input.confirmReviewed || !input.hasMatchingReceipt) {
    return {
      effect: 'refuse',
      reason: 'No matching dry-run receipt. Run the same call with --dry-run, read the plan, then repeat without --dry-run and with --confirm-reviewed. Flags, tool, arguments, origin, and backup id must match. The server will not perform this review for you.',
    }
  }

  return { effect: 'dispatch', toolClass: entry.toolClass, writeReceipt: false }
}
