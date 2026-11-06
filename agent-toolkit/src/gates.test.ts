import { describe, expect, it } from 'bun:test'
import { catalogEntry } from './catalog'
import { BOUNDARY_NOTICE } from './errors'
import { decideGate, type GateInput } from './gates'

function gate(overrides: Partial<GateInput> & Pick<GateInput, 'tool'>): GateDecisionShape {
  const entry = catalogEntry(overrides.tool)
  return decideGate({
    entry,
    allowDrafts: false,
    allowPublish: false,
    approvePublish: false,
    allowEditorNavigation: false,
    backupId: undefined,
    dryRun: false,
    confirmReviewed: false,
    hasMatchingReceipt: false,
    ...overrides,
  })
}

interface GateDecisionShape {
  effect: string
  reason?: string
  toolClass?: string
  writeReceipt?: boolean
}

describe('read-only defaults and write gates', () => {
  it('allows a headless read and refuses a draft tool', () => {
    expect(gate({ tool: 'get_context' }).effect).toBe('dispatch')
    const refused = gate({ tool: 'site_insert_html' })
    expect(refused.effect).toBe('refuse')
    expect(refused.reason).toContain(BOUNDARY_NOTICE)
    expect(refused.reason).toContain('read-only')
  })

  it('does not let publish flags authorize a draft or a library write', () => {
    for (const tool of ['site_insert_html', 'media_upload']) {
      const refused = gate({ tool, allowPublish: true, approvePublish: true, backupId: 'bak-1' })
      expect(refused.effect).toBe('refuse')
      expect(refused.reason).toContain('--allow-publish does not permit')
    }
  })

  it('requires a backup label and a prior receipt before a draft is sent', () => {
    expect(gate({
      tool: 'site_insert_html',
      allowDrafts: true,
    }).effect).toBe('refuse')
    expect(gate({
      tool: 'site_insert_html',
      allowDrafts: true,
      backupId: '../backups/db',
    }).reason).toContain('not a filesystem path')
    expect(gate({
      tool: 'site_insert_html',
      allowDrafts: true,
      backupId: 'bak-1',
      dryRun: true,
    })).toMatchObject({ effect: 'dry-run', writeReceipt: true })
    expect(gate({
      tool: 'site_insert_html',
      allowDrafts: true,
      backupId: 'bak-1',
      confirmReviewed: true,
      hasMatchingReceipt: false,
    }).effect).toBe('refuse')
    expect(gate({
      tool: 'site_insert_html',
      allowDrafts: true,
      backupId: 'bak-1',
      confirmReviewed: true,
      hasMatchingReceipt: true,
    })).toMatchObject({ effect: 'dispatch', toolClass: 'draft' })
  })

  it('keeps publishing off the draft path until both publish flags are set', () => {
    const draftOnly = gate({
      tool: 'site_publish',
      allowDrafts: true,
      backupId: 'bak-1',
      confirmReviewed: true,
      hasMatchingReceipt: true,
    })
    expect(draftOnly.effect).toBe('refuse')
    expect(draftOnly.reason).toContain('--allow-publish')
    expect(draftOnly.reason).toContain('--approve-publish')
    expect(draftOnly.reason).toContain(BOUNDARY_NOTICE)

    expect(gate({
      tool: 'content_set_document_status',
      allowDrafts: true,
      backupId: 'bak-1',
      confirmReviewed: true,
      hasMatchingReceipt: true,
    }).effect).toBe('refuse')

    expect(gate({
      tool: 'site_publish',
      allowPublish: true,
      backupId: 'bak-1',
      confirmReviewed: true,
      hasMatchingReceipt: true,
    }).effect).toBe('refuse')

    expect(gate({
      tool: 'site_publish',
      allowPublish: true,
      approvePublish: true,
      backupId: 'bak-1',
      dryRun: true,
      confirmReviewed: true,
    })).toMatchObject({ effect: 'dry-run', toolClass: 'publish', writeReceipt: true })

    expect(gate({
      tool: 'site_publish',
      allowPublish: true,
      approvePublish: true,
      backupId: 'bak-1',
      confirmReviewed: true,
      hasMatchingReceipt: true,
    })).toMatchObject({ effect: 'dispatch', toolClass: 'publish' })
  })

  it('refuses unknown tools and canvas navigation unless asked', () => {
    expect(gate({ tool: 'mutate_page_tree' }).effect).toBe('refuse')
    expect(gate({ tool: 'site_open_document' }).effect).toBe('refuse')
    expect(gate({ tool: 'site_open_document', allowEditorNavigation: true }).effect).toBe('dispatch')
  })
})
