import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AUDIT_READS, TOOL_CATALOG, TOOLS_NOT_ON_MCP, catalogEntry } from './catalog'

const ROOT = join(import.meta.dir, '../..')
const TOOL_FILES = [
  'server/ai/tools/site/readTools.ts',
  'server/ai/tools/site/writeTools.ts',
  'server/ai/tools/content/readTools.ts',
  'server/ai/tools/content/writeTools.ts',
  'server/ai/mcp/tools/contextTool.ts',
  'server/ai/mcp/tools/documentTools.ts',
  'server/ai/mcp/tools/publishTool.ts',
  'server/ai/mcp/tools/styleTools.ts',
  'server/ai/mcp/tools/uploadMediaTool.ts',
]

describe('tool catalog', () => {
  it('matches the MCP tool names defined in the server and excludes the snapshot-only token tool', () => {
    const found = new Set<string>()
    for (const file of TOOL_FILES) {
      const text = readFileSync(join(ROOT, file), 'utf8')
      for (const match of text.matchAll(/name:\s+'([a-z][a-z0-9_]*)'/g)) {
        const name = match[1]
        if (name) found.add(name)
      }
    }
    for (const excluded of TOOLS_NOT_ON_MCP) found.delete(excluded)
    const catalog = new Set(TOOL_CATALOG.map((entry) => entry.name))
    const missing = [...found].filter((name) => !catalog.has(name))
    const extra = [...catalog].filter((name) => !found.has(name))
    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
    expect(catalog.has('site_list_tokens')).toBe(false)
    expect(new Set(TOOL_CATALOG.map((entry) => entry.name)).size).toBe(TOOL_CATALOG.length)
  })

  it('only audits headless reads', () => {
    for (const read of AUDIT_READS) {
      const entry = catalogEntry(read.name)
      expect(entry?.toolClass).toBe('read')
      expect(entry?.execution).toBe('server')
      expect(entry?.navigatesEditor).toBe(false)
    }
  })
})
