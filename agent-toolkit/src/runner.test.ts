import { describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BOUNDARY_NOTICE } from './errors'
import type { McpTransport, OutboundRequest } from './protocol'
import { fileReceiptStore, memoryReceiptStore, type ReceiptStore } from './receipts'
import { run, type RunOptions } from './runner'
import { parseArgs, runCli } from './cli'

const TOKEN = 'opaque-test-secret'
const CONFIG = JSON.stringify({
  origin: 'https://staging.example.com',
  connectorLabel: 'staging-read-only',
  branchLabel: 'main',
  publicPath: '/',
})

function transport(route: (request: OutboundRequest) => unknown, bodies?: Uint8Array[]): {
  transport: McpTransport
  posts: OutboundRequest[]
  gets: string[]
} {
  const posts: OutboundRequest[] = []
  const gets: string[] = []
  let getIndex = 0
  return {
    posts,
    gets,
    transport: {
      async post(request) {
        posts.push(request)
        return { status: 200, body: JSON.stringify(route(request)) }
      },
      async get(url) {
        gets.push(url)
        const body = bodies?.[getIndex] ?? new Uint8Array([1, 2, 3])
        getIndex += 1
        return { status: 200, body }
      },
    },
  }
}

function options(overrides: Partial<RunOptions> & Pick<RunOptions, 'command' | 'transport'>): RunOptions {
  return {
    configText: CONFIG,
    allowDrafts: false,
    allowPublish: false,
    approvePublish: false,
    allowEditorNavigation: false,
    dryRun: false,
    confirmReviewed: false,
    token: TOKEN,
    receipts: memoryReceiptStore(),
    now: 1_700_000_000_000,
    ...overrides,
  }
}

function rpcMethod(request: OutboundRequest): string {
  return (JSON.parse(request.body) as { method: string }).method
}

describe('runner dispatch and gates', () => {
  it('checks config without a token or a request', async () => {
    const mock = transport(() => ({}))
    const output = await run(options({ command: 'check', transport: mock.transport, token: undefined }))
    expect(output).toMatchObject({
      ok: true,
      mode: 'read-only',
      endpoint: 'https://staging.example.com/_instatic/mcp',
      branchLabelTransmitted: false,
      tokenRead: false,
    })
    expect(mock.posts).toHaveLength(0)
    expect(mock.gets).toHaveLength(0)
  })

  it('dispatches a read and refuses a draft without touching the transport', async () => {
    const mock = transport(() => ({ result: { content: [{ type: 'text', text: 'ok' }] } }))
    const read = await run(options({ command: 'call', tool: 'get_context', transport: mock.transport }))
    expect(read).toMatchObject({ ok: true, effect: 'dispatch', tool: 'get_context' })
    expect(mock.posts).toHaveLength(1)
    expect(mock.posts[0]?.headers.Origin).toBeUndefined()
    expect(mock.posts[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(JSON.stringify(read)).not.toContain(TOKEN)

    const before = mock.posts.length
    await expect(run(options({
      command: 'call',
      tool: 'site_insert_html',
      args: { html: '<p>x</p>' },
      transport: mock.transport,
    }))).rejects.toThrow(/read-only/)
    expect(mock.posts).toHaveLength(before)
  })

  it('sends a draft only after a dry-run receipt, and only once', async () => {
    const mock = transport(() => ({ result: { content: [{ type: 'text', text: 'saved' }] } }))
    const receipts = memoryReceiptStore()
    const shared = {
      command: 'call' as const,
      tool: 'site_insert_html',
      args: { html: '<section id="mark">Hi</section>' },
      allowDrafts: true,
      backupId: 'bak-2026-11-06',
      transport: mock.transport,
      receipts,
    }
    const preview = await run(options({ ...shared, dryRun: true, confirmReviewed: true }))
    expect(preview).toMatchObject({ dispatched: false, effect: 'dry-run' })
    expect(mock.posts).toHaveLength(0)

    const sent = await run(options({ ...shared, confirmReviewed: true }))
    expect(sent).toMatchObject({ effect: 'dispatch', toolClass: 'draft' })
    expect(mock.posts).toHaveLength(1)
    const call = JSON.parse(mock.posts[0]?.body ?? '{}') as { params: { name: string } }
    expect(call.params.name).toBe('site_insert_html')

    await expect(run(options({ ...shared, confirmReviewed: true }))).rejects.toThrow(/dry-run/)
    expect(mock.posts).toHaveLength(1)
  })

  it('matches a receipt when argument key order changes', async () => {
    const mock = transport(() => ({ result: { ok: true } }))
    const receipts = memoryReceiptStore()
    await run(options({
      command: 'call',
      tool: 'site_update_node_props',
      args: { b: 1, a: 2 },
      allowDrafts: true,
      backupId: 'bak-1',
      dryRun: true,
      transport: mock.transport,
      receipts,
    }))
    await run(options({
      command: 'call',
      tool: 'site_update_node_props',
      args: { a: 2, b: 1 },
      allowDrafts: true,
      backupId: 'bak-1',
      confirmReviewed: true,
      transport: mock.transport,
      receipts,
    }))
    expect(mock.posts).toHaveLength(1)
  })

  it('refuses publishing before a token is read and without sending', async () => {
    const mock = transport(() => ({ result: {} }))
    await expect(run(options({
      command: 'call',
      tool: 'site_publish',
      allowDrafts: true,
      backupId: 'bak-1',
      confirmReviewed: true,
      token: undefined,
      transport: mock.transport,
    }))).rejects.toThrow(/--approve-publish/)
    expect(mock.posts).toHaveLength(0)
  })

  it('does not publish from draft flags, and publish flags do not draft', async () => {
    const mock = transport(() => ({ result: { publishedPages: 1 } }))
    const receipts = memoryReceiptStore()
    await expect(run(options({
      command: 'call',
      tool: 'site_publish',
      allowDrafts: true,
      backupId: 'bak-1',
      confirmReviewed: true,
      transport: mock.transport,
      receipts,
    }))).rejects.toThrow(/--approve-publish/)
    await expect(run(options({
      command: 'call',
      tool: 'content_set_document_status',
      args: { documentId: 'doc-1', status: 'draft' },
      allowDrafts: true,
      backupId: 'bak-1',
      confirmReviewed: true,
      transport: mock.transport,
      receipts,
    }))).rejects.toThrow(BOUNDARY_NOTICE)
    await expect(run(options({
      command: 'call',
      tool: 'site_insert_html',
      allowPublish: true,
      approvePublish: true,
      backupId: 'bak-1',
      confirmReviewed: true,
      transport: mock.transport,
      receipts,
    }))).rejects.toThrow(/does not permit/)
    expect(mock.posts).toHaveLength(0)

    await run(options({
      command: 'call',
      tool: 'site_publish',
      allowPublish: true,
      approvePublish: true,
      backupId: 'bak-1',
      dryRun: true,
      transport: mock.transport,
      receipts,
    }))
    const published = await run(options({
      command: 'call',
      tool: 'site_publish',
      allowPublish: true,
      approvePublish: true,
      backupId: 'bak-1',
      confirmReviewed: true,
      transport: mock.transport,
      receipts,
    }))
    expect(published).toMatchObject({ effect: 'dispatch', toolClass: 'publish' })
    expect(mock.posts).toHaveLength(1)
    expect(JSON.stringify(published)).not.toContain(TOKEN)
  })

  it('refuses arguments that contain the token and does not send them', async () => {
    const mock = transport(() => ({ result: {} }))
    await expect(run(options({
      command: 'call',
      tool: 'get_context',
      args: { entryId: TOKEN },
      transport: mock.transport,
    }))).rejects.toThrow(/not printed/)
    expect(mock.posts).toHaveLength(0)
  })

  it('redacts a token echoed in a tool result', async () => {
    const leaked = 'imcp_pat_example'
    const mock = transport(() => ({ result: { content: [{ type: 'text', text: leaked }] } }))
    const output = await run(options({
      command: 'call',
      tool: 'get_context',
      token: leaked,
      transport: mock.transport,
    }))
    expect(JSON.stringify(output)).not.toContain(leaked)
    expect(JSON.stringify(output)).not.toContain('imcp_pat_')
  })

  it('audits only listed headless reads and compares the public URL', async () => {
    const mock = transport((request) => {
      const method = rpcMethod(request)
      if (method === 'server/discover') return { result: { supportedVersions: ['2026-07-28'] } }
      if (method === 'tools/list') {
        return {
          result: {
            tools: [
              { name: 'get_context' },
              { name: 'site_list_documents' },
              { name: 'site_insert_html' },
              { name: 'site_publish' },
              { name: 'site_read_document' },
              { name: 'unclassified_tool' },
            ],
          },
        }
      }
      const name = (JSON.parse(request.body) as { params: { name: string } }).params.name
      return { result: { content: [{ type: 'text', text: name }] } }
    }, [new Uint8Array([1]), new Uint8Array([2])])
    const preview = await run(options({ command: 'audit', dryRun: true, transport: mock.transport, token: undefined }))
    expect(preview).toMatchObject({ dispatched: false })
    expect(mock.posts).toHaveLength(0)

    const output = await run(options({ command: 'audit', transport: mock.transport })) as {
      reads: Array<{ name: string; called: boolean }>
      notCalled: { writeTools: string[]; browserTools: string[] }
      publicUnchanged: boolean
    }
    const called = output.reads.filter((read) => read.called).map((read) => read.name)
    expect(called).toEqual(['get_context', 'site_list_documents'])
    expect(output.notCalled.writeTools).toEqual(['site_insert_html', 'site_publish'])
    expect(output.notCalled.browserTools).toEqual(['site_insert_html', 'site_read_document'])
    expect(output.publicUnchanged).toBe(false)
    expect(mock.gets).toEqual([
      'https://staging.example.com/',
      'https://staging.example.com/',
    ])
    const calledNames = mock.posts
      .filter((post) => rpcMethod(post) === 'tools/call')
      .map((post) => (JSON.parse(post.body) as { params: { name: string } }).params.name)
    expect(calledNames).toEqual(['get_context', 'site_list_documents'])
  })

  it('stores a review receipt without the bearer token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'instatic-agent-toolkit-'))
    try {
      const receipts: ReceiptStore = fileReceiptStore(dir)
      const mock = transport(() => ({ result: {} }))
      const preview = await run(options({
        command: 'call',
        tool: 'media_upload',
        args: { filename: 'a.png', data: 'aaaa' },
        allowDrafts: true,
        backupId: 'bak-1',
        dryRun: true,
        transport: mock.transport,
        receipts,
      })) as { receipt: string }
      const file = await readFile(join(dir, `${preview.receipt}.json`), 'utf8')
      expect(file).not.toContain(TOKEN)
      expect(file).toContain('media_upload')
      expect(mock.posts).toHaveLength(0)
      await run(options({
        command: 'call',
        tool: 'media_upload',
        args: { filename: 'a.png', data: 'aaaa' },
        allowDrafts: true,
        backupId: 'bak-1',
        confirmReviewed: true,
        transport: mock.transport,
        receipts,
      }))
      expect(mock.posts).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('cli parsing', () => {
  it('refuses a token flag without echoing it', () => {
    const secret = 'imcp_pat_example'
    expect(() => parseArgs([`--token=${secret}`])).toThrow(/command line/)
    try {
      parseArgs([`--token=${secret}`])
    } catch (err) {
      expect((err as Error).message).not.toContain(secret)
    }
  })

  it('runs check against the example config', async () => {
    const result = await runCli([
      'check',
      '--config',
      join(import.meta.dir, '../examples/instance.example.json'),
    ], {})
    expect(result.exitCode).toBe(0)
    expect(result.text).toContain('"mode": "read-only"')
    expect(result.text).not.toContain('imcp_pat_')
  })
})
