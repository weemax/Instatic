import { describe, expect, it } from 'bun:test'
import { buildMcpRequest, parseRpc, postRpc, type McpTransport } from './protocol'

describe('MCP dispatch', () => {
  it('builds a stateless 2026-07-28 tools/call without an Origin header', () => {
    const request = buildMcpRequest({
      origin: 'https://staging.example.com',
      method: 'tools/call',
      token: 'opaque-test-secret',
      id: 'toolkit-1',
      toolName: 'get_context',
      args: {},
    })
    expect(request.url).toBe('https://staging.example.com/_instatic/mcp')
    expect(request.headers.Origin).toBeUndefined()
    expect(request.headers['MCP-Protocol-Version']).toBe('2026-07-28')
    expect(request.headers['Mcp-Method']).toBe('tools/call')
    expect(request.headers['Mcp-Name']).toBe('get_context')
    expect(request.headers.Authorization).toBe('Bearer opaque-test-secret')
    const body = JSON.parse(request.body) as {
      method: string
      params: { name: string; _meta: Record<string, unknown> }
    }
    expect(body.method).toBe('tools/call')
    expect(body.params.name).toBe('get_context')
    expect(body.params._meta['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28')
  })

  it('parses a JSON body and an SSE data line', () => {
    expect(parseRpc('{"jsonrpc":"2.0","result":{"tools":[]}}').result).toEqual({ tools: [] })
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","result":{"ok":true}}\n\n'
    expect(parseRpc(sse).result).toEqual({ ok: true })
  })

  it('redacts a token echoed by a transport failure', async () => {
    const token = 'imcp_pat_example'
    const transport: McpTransport = {
      async post() {
        throw new Error(`connect failed for Bearer ${token}`)
      },
      async get() {
        return { status: 200, body: new Uint8Array() }
      },
    }
    const request = buildMcpRequest({
      origin: 'https://staging.example.com',
      method: 'server/discover',
      token,
      id: 'toolkit-2',
    })
    await expect(postRpc(transport, request, [token])).rejects.toThrow(/not|MCP request failed/)
    await postRpc(transport, request, [token]).catch((err: Error) => {
      expect(err.message).not.toContain(token)
      expect(err.message).not.toContain('imcp_pat_')
    })
  })
})
