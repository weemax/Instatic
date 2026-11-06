import { AUDIT_READS, TOOL_CATALOG, catalogEntry } from './catalog'
import { endpointUrl, loadInstanceConfig, publicUrl } from './config'
import { BOUNDARY_NOTICE, ToolkitError } from './errors'
import { decideGate } from './gates'
import { buildMcpRequest, nextRpcId, postRpc, probePublic, type McpTransport, type RpcResult } from './protocol'
import { makeReceipt, receiptHash, type ReceiptIdentity, type ReceiptStore } from './receipts'
import { containsSecret, redact } from './redact'

export interface RunOptions {
  command: 'check' | 'discover' | 'list' | 'audit' | 'call'
  configText: string
  tool?: string
  args?: Record<string, unknown>
  allowDrafts: boolean
  allowPublish: boolean
  approvePublish: boolean
  allowEditorNavigation: boolean
  backupId?: string
  dryRun: boolean
  confirmReviewed: boolean
  token?: string
  transport: McpTransport
  receipts: ReceiptStore
  now: number
}

export async function run(options: RunOptions): Promise<unknown> {
  const config = loadInstanceConfig(options.configText)
  const secrets = options.token ? [options.token] : []
  if (options.args && JSON.stringify(options.args).length > 8_000_000) {
    throw new ToolkitError('Arguments exceed 8000000 characters. This client will not send them.')
  }
  if (options.args && containsSecret(options.args, secrets)) {
    throw new ToolkitError(
      'Refusing arguments that contain a token-like value. The arguments were not printed.',
    )
  }

  if (options.command === 'check') {
    return {
      ok: true,
      mode: 'read-only',
      endpoint: endpointUrl(config.origin),
      connectorLabel: config.connectorLabel,
      branchLabel: config.branchLabel ?? null,
      branchLabelTransmitted: false,
      publicUrl: publicUrl(config.origin, config.publicPath),
      tokenRead: false,
      note: 'branchLabel is an operator note. Headless reads and site_publish use the main draft. Browser tools follow whichever workspace is open. No request was sent.',
    }
  }

  if (options.command === 'audit' && (options.allowDrafts || options.allowPublish || options.approvePublish)) {
    throw new ToolkitError(
      `audit is read-only. Remove --allow-drafts, --allow-publish, and --approve-publish. ${BOUNDARY_NOTICE}`,
    )
  }

  if (options.command === 'audit' && options.dryRun) {
    return {
      ok: true,
      effect: 'dry-run',
      dispatched: false,
      endpoint: endpointUrl(config.origin),
      publicUrl: publicUrl(config.origin, config.publicPath),
      reads: AUDIT_READS,
      note: 'Audit would call server/discover, tools/list, the headless reads the server lists, and two unauthenticated GETs of publicUrl. Browser tools, drafts, media uploads, and publishing are not part of audit.',
    }
  }

  if (options.command === 'call') {
    return callTool(options, config.origin, secrets)
  }

  const token = requireToken(options.token)

  if (options.command === 'discover') {
    const rpc = await dispatch(options, token, 'server/discover')
    return { ok: true, endpoint: endpointUrl(config.origin), rpc: redactRpc(rpc, secrets) }
  }

  if (options.command === 'list') {
    const names = await listToolNames(options, token, secrets)
    const granted = new Set(names)
    return {
      ok: true,
      endpoint: endpointUrl(config.origin),
      tools: names.map((name) => annotate(name)),
      notInServerList: TOOL_CATALOG.filter((entry) => !granted.has(entry.name)).map((entry) => entry.name),
      note: 'notInServerList means this connection was not offered the tool. That is the server grant, not this client. Tools this client does not classify are omitted and cannot be called.',
    }
  }

  return audit(options, config.origin, config.publicPath, token, secrets)
}

async function callTool(
  options: RunOptions,
  origin: string,
  secrets: readonly string[],
): Promise<unknown> {
  if (!options.tool) throw new ToolkitError('call requires a tool name.')
  const entry = catalogEntry(options.tool)
  const args = options.args ?? {}
  const identity: ReceiptIdentity | undefined = entry && entry.toolClass !== 'read' && options.backupId
    ? {
        origin,
        tool: entry.name,
        args,
        toolClass: entry.toolClass,
        backupId: options.backupId,
        allowDrafts: options.allowDrafts,
        allowPublish: options.allowPublish,
        approvePublish: options.approvePublish,
      }
    : undefined
  const hash = identity ? receiptHash(identity) : undefined
  const decision = decideGate({
    entry,
    tool: options.tool,
    allowDrafts: options.allowDrafts,
    allowPublish: options.allowPublish,
    approvePublish: options.approvePublish,
    allowEditorNavigation: options.allowEditorNavigation,
    backupId: options.backupId,
    dryRun: options.dryRun,
    confirmReviewed: options.confirmReviewed,
    hasMatchingReceipt: hash ? await options.receipts.peek(hash, options.now) : false,
  })
  if (decision.effect === 'refuse') throw new ToolkitError(decision.reason)

  const editor = entry?.execution === 'browser'
    ? {
        required: true,
        workspace: entry.workspace,
        promise: 'This tool is relayed only when the connector owner has that workspace open. This client cannot open it, and a closed workspace is not a reason to write the database or the published HTML.',
      }
    : { required: false, workspace: 'none' as const }

  if (decision.effect === 'dry-run') {
    let receipt: string | undefined
    if (decision.writeReceipt && identity) {
      const record = makeReceipt(identity, options.now)
      await options.receipts.put(record)
      receipt = record.hash
    }
    return {
      ok: true,
      effect: 'dry-run',
      dispatched: false,
      tool: options.tool,
      toolClass: decision.toolClass,
      args,
      editor,
      receipt: receipt ?? null,
      note: decision.writeReceipt
        ? 'No request was sent. Repeat without --dry-run and with --confirm-reviewed to send this exact plan. A dry-run flag never sends, even together with --confirm-reviewed.'
        : 'No request was sent.',
    }
  }

  const token = requireToken(options.token)
  if (hash) {
    const taken = await options.receipts.take(hash, options.now)
    if (!taken) {
      throw new ToolkitError(
        'The matching dry-run receipt was already used or expired. Run --dry-run again and review the new plan before sending.',
      )
    }
  }
  const rpc = await dispatch(options, token, 'tools/call', options.tool, args)
  return {
    ok: rpc.error === undefined && rpc.result?.isError !== true,
    effect: 'dispatch',
    tool: options.tool,
    toolClass: decision.toolClass,
    editor,
    rpc: redactRpc(rpc, secrets),
  }
}

async function audit(
  options: RunOptions,
  origin: string,
  path: string,
  token: string,
  secrets: readonly string[],
): Promise<unknown> {
  const url = publicUrl(origin, path)
  const publicProbeBefore = await probePublic(options.transport, url)
  const discover = redactRpc(await dispatch(options, token, 'server/discover'), secrets)
  const names = await listToolNames(options, token, secrets)
  const granted = new Set(names)
  const reads = []
  for (const planned of AUDIT_READS) {
    if (!granted.has(planned.name)) {
      reads.push({ name: planned.name, called: false, reason: 'not offered by the server for this connection' })
      continue
    }
    const rpc = redactRpc(await dispatch(options, token, 'tools/call', planned.name, planned.args), secrets)
    reads.push({ name: planned.name, called: true, args: planned.args, rpc })
  }
  const publicProbeAfter = await probePublic(options.transport, url)
  const browserTools = names.filter((name) => catalogEntry(name)?.execution === 'browser')
  const writeTools = names.filter((name) => {
    const toolClass = catalogEntry(name)?.toolClass
    return toolClass === 'draft' || toolClass === 'library-write' || toolClass === 'publish'
  })
  return {
    ok: true,
    effect: 'audit',
    dispatchedWrites: false,
    endpoint: endpointUrl(origin),
    discover,
    reads,
    notCalled: {
      browserTools,
      writeTools,
      reason: 'Audit never calls editor tools, drafts, media uploads, or publishing. Browser tools need the matching workspace open; this client cannot open it.',
    },
    publicProbeBefore,
    publicProbeAfter,
    publicUnchanged: publicProbeBefore.sha256 !== undefined
      && publicProbeBefore.sha256 === publicProbeAfter.sha256
      && publicProbeBefore.status === publicProbeAfter.status,
    note: 'A write-capable token can still publish through another client. This audit does not remove server permissions.',
  }
}

async function listToolNames(
  options: RunOptions,
  token: string,
  secrets: readonly string[],
): Promise<string[]> {
  const rpc = redactRpc(await dispatch(options, token, 'tools/list'), secrets)
  const tools = rpc.result?.tools
  if (!Array.isArray(tools)) throw new ToolkitError('tools/list did not return a tools array.')
  const names: string[] = []
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) continue
    const name = (tool as { name?: unknown }).name
    if (typeof name === 'string') names.push(name)
  }
  return names
}

async function dispatch(
  options: RunOptions,
  token: string,
  method: 'server/discover' | 'tools/list' | 'tools/call',
  toolName?: string,
  args?: unknown,
): Promise<RpcResult> {
  const config = loadInstanceConfig(options.configText)
  const request = buildMcpRequest({
    origin: config.origin,
    method,
    token,
    id: nextRpcId(),
    toolName,
    args,
  })
  return postRpc(options.transport, request, [token])
}

function requireToken(token: string | undefined): string {
  if (!token || !token.trim()) {
    throw new ToolkitError(
      'Set INSTATIC_MCP_TOKEN in the environment. Do not put it in the config file, the command line, or the prompt.',
    )
  }
  return token.trim()
}

function annotate(name: string): Record<string, unknown> {
  const entry = catalogEntry(name)
  if (!entry) {
    return {
      name,
      classified: false,
      callable: false,
      summary: 'The server offered a tool this client does not classify. It will not be called.',
    }
  }
  return {
    name,
    classified: true,
    callable: true,
    toolClass: entry.toolClass,
    execution: entry.execution,
    workspace: entry.workspace,
    navigatesEditor: entry.navigatesEditor,
    summary: entry.summary,
  }
}

function redactRpc(rpc: RpcResult, secrets: readonly string[]): RpcResult {
  const redacted = redact(JSON.stringify(rpc), secrets)
  try {
    return JSON.parse(redacted) as RpcResult
  } catch {
    throw new ToolkitError('MCP result could not be redacted safely. It was not printed.')
  }
}
