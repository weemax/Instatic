import { createHash } from 'node:crypto'
import { endpointUrl } from './config'
import { ToolkitError } from './errors'
import { redact } from './redact'

export const MCP_PROTOCOL_VERSION = '2026-07-28'
const MAX_PROBE_BYTES = 20 * 1024 * 1024

export interface OutboundRequest {
  url: string
  headers: Record<string, string>
  body: string
}

export interface InboundResponse {
  status: number
  body: string
}

export interface PublicProbe {
  ok: boolean
  url: string
  status?: number
  byteLength?: number
  sha256?: string
  error?: string
}

export interface McpTransport {
  post(request: OutboundRequest): Promise<InboundResponse>
  get(url: string): Promise<{ status: number; body: Uint8Array }>
}

export interface RpcResult {
  result?: Record<string, unknown>
  error?: { code?: number; message?: string }
}

export function buildMcpRequest(input: {
  origin: string
  method: 'server/discover' | 'tools/list' | 'tools/call'
  token: string
  id: string
  toolName?: string
  args?: unknown
}): OutboundRequest {
  const params: Record<string, unknown> = {
    _meta: {
      'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
      'io.modelcontextprotocol/clientInfo': { name: 'instatic-agent-toolkit', version: '1' },
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  }
  if (input.method === 'tools/call') {
    params.name = input.toolName
    params.arguments = input.args ?? {}
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${input.token}`,
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    'Mcp-Method': input.method,
  }
  if (input.method === 'tools/call' && input.toolName) headers['Mcp-Name'] = input.toolName
  return {
    url: endpointUrl(input.origin),
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: input.id, method: input.method, params }),
  }
}

export function parseRpc(body: string): RpcResult {
  const trimmed = body.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return asRpc(JSON.parse(trimmed))
  }
  const data = trimmed
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6))
  const last = data.at(-1)
  if (!last) throw new ToolkitError('MCP response was neither JSON nor an SSE data event.')
  return asRpc(JSON.parse(last))
}

function asRpc(value: unknown): RpcResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolkitError('MCP response was not a JSON-RPC object.')
  }
  return value as RpcResult
}

export async function postRpc(
  transport: McpTransport,
  request: OutboundRequest,
  secrets: readonly string[],
): Promise<RpcResult> {
  let response: InboundResponse
  try {
    response = await transport.post(request)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'transport failed'
    throw new ToolkitError(`MCP request failed before a response: ${redact(message, secrets)}`, 2)
  }
  if (response.status < 200 || response.status >= 300) {
    const snippet = redact(response.body, secrets).slice(0, 500)
    throw new ToolkitError(`MCP HTTP ${response.status}. ${snippet}`, 2)
  }
  try {
    return parseRpc(response.body)
  } catch (err) {
    if (err instanceof ToolkitError) throw err
    throw new ToolkitError('MCP response could not be parsed. The body was not printed.', 2)
  }
}

export async function probePublic(transport: McpTransport, url: string): Promise<PublicProbe> {
  try {
    const response = await transport.get(url)
    if (response.body.byteLength > MAX_PROBE_BYTES) {
      return { ok: false, url, status: response.status, error: 'Public response exceeds 20 MiB; it was not hashed.' }
    }
    return {
      ok: response.status >= 200 && response.status < 300,
      url,
      status: response.status,
      byteLength: response.body.byteLength,
      sha256: createHash('sha256').update(response.body).digest('hex'),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'public probe failed'
    return { ok: false, url, error: redact(message) }
  }
}

let nextId = 1
export function nextRpcId(): string {
  nextId += 1
  return `toolkit-${nextId}`
}
