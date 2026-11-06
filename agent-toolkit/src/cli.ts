#!/usr/bin/env bun
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ToolkitError } from './errors'
import type { McpTransport } from './protocol'
import { fileReceiptStore } from './receipts'
import { redact } from './redact'
import { run, type RunOptions } from './runner'

interface ParsedCli {
  help: boolean
  command?: RunOptions['command']
  configPath?: string
  tool?: string
  argsText?: string
  allowDrafts: boolean
  allowPublish: boolean
  approvePublish: boolean
  allowEditorNavigation: boolean
  backupId?: string
  dryRun: boolean
  confirmReviewed: boolean
}

const COMMANDS = new Set(['check', 'discover', 'list', 'audit', 'call'])
const BOOLEAN_FLAGS = new Set([
  '--allow-drafts',
  '--allow-publish',
  '--approve-publish',
  '--allow-editor-navigation',
  '--dry-run',
  '--confirm-reviewed',
])
const VALUE_FLAGS = new Set(['--config', '--args', '--backup-id'])

export function parseArgs(argv: readonly string[]): ParsedCli {
  const parsed: ParsedCli = {
    help: false,
    allowDrafts: false,
    allowPublish: false,
    approvePublish: false,
    allowEditorNavigation: false,
    dryRun: false,
    confirmReviewed: false,
  }
  const positionals: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    if (isSecretFlag(arg)) {
      throw new ToolkitError(
        'Refusing a secret on the command line. Set INSTATIC_MCP_TOKEN in the environment. The argument was not printed.',
      )
    }
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      parsed.help = true
      continue
    }
    if (BOOLEAN_FLAGS.has(arg)) {
      if (arg === '--allow-drafts') parsed.allowDrafts = true
      if (arg === '--allow-publish') parsed.allowPublish = true
      if (arg === '--approve-publish') parsed.approvePublish = true
      if (arg === '--allow-editor-navigation') parsed.allowEditorNavigation = true
      if (arg === '--dry-run') parsed.dryRun = true
      if (arg === '--confirm-reviewed') parsed.confirmReviewed = true
      continue
    }
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new ToolkitError(`${arg} requires a value.`)
      i += 1
      if (arg === '--config') parsed.configPath = value
      if (arg === '--args') parsed.argsText = value
      if (arg === '--backup-id') parsed.backupId = value
      continue
    }
    if (arg.startsWith('--')) throw new ToolkitError(`Unknown flag ${arg}.`)
    positionals.push(arg)
  }

  const command = positionals[0]
  if (!parsed.help) {
    if (!command || !COMMANDS.has(command)) {
      throw new ToolkitError('Command must be check, discover, list, audit, or call.')
    }
    parsed.command = command as RunOptions['command']
    if (command === 'call') {
      if (!positionals[1]) throw new ToolkitError('call requires a tool name.')
      parsed.tool = positionals[1]
    } else if (positionals.length > 1) {
      throw new ToolkitError(`${command} does not take a positional argument.`)
    }
    if (!parsed.configPath) throw new ToolkitError('--config is required.')
    if (parsed.argsText !== undefined && command !== 'call') {
      throw new ToolkitError('--args is only valid with call.')
    }
  }
  return parsed
}

function isSecretFlag(arg: string): boolean {
  const name = arg.split('=', 1)[0] ?? arg
  return name === '--token'
    || name === '--authorization'
    || name === '--bearer'
    || name === '--pat'
    || name === '--header'
}

export function helpText(): string {
  return [
    'Instatic agent toolkit — client for an existing /_instatic/mcp endpoint.',
    '',
    'bun agent-toolkit/src/cli.ts <check|discover|list|audit|call> --config <file> [flags]',
    '',
    'Defaults to read-only. The bearer token is read from INSTATIC_MCP_TOKEN.',
    'Do not pass the token as a flag, and do not store it in the config file.',
    '',
    'Draft writes also need --allow-drafts, --backup-id, a prior --dry-run, then --confirm-reviewed.',
    'Publishing additionally needs both --allow-publish and --approve-publish. Draft flags do not publish.',
    'site_open_document also needs --allow-editor-navigation.',
    '',
    'Client flags are a workflow guard for this process. They are not server authorization.',
  ].join('\n')
}

export function fetchTransport(): McpTransport {
  return {
    async post(request) {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
      })
      return { status: response.status, body: await response.text() }
    },
    async get(url) {
      const response = await fetch(url, { method: 'GET' })
      const bytes = new Uint8Array(await response.arrayBuffer())
      return { status: response.status, body: bytes }
    },
  }
}

export async function runCli(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
  transport: McpTransport = fetchTransport(),
  now = Date.now(),
): Promise<{ exitCode: number; text: string }> {
  try {
    const parsed = parseArgs(argv)
    if (parsed.help || !parsed.command || !parsed.configPath) {
      return { exitCode: 0, text: `${helpText()}\n` }
    }
    const configText = await readFile(parsed.configPath, 'utf8')
    let args: Record<string, unknown> | undefined
    if (parsed.argsText !== undefined) {
      let parsedArgs: unknown
      try {
        parsedArgs = JSON.parse(parsed.argsText)
      } catch {
        throw new ToolkitError('--args is not JSON. The value was not printed.')
      }
      if (!parsedArgs || typeof parsedArgs !== 'object' || Array.isArray(parsedArgs)) {
        throw new ToolkitError('--args must be a JSON object.')
      }
      args = parsedArgs as Record<string, unknown>
    }
    const output = await run({
      command: parsed.command,
      configText,
      tool: parsed.tool,
      args,
      allowDrafts: parsed.allowDrafts,
      allowPublish: parsed.allowPublish,
      approvePublish: parsed.approvePublish,
      allowEditorNavigation: parsed.allowEditorNavigation,
      backupId: parsed.backupId,
      dryRun: parsed.dryRun,
      confirmReviewed: parsed.confirmReviewed,
      token: env.INSTATIC_MCP_TOKEN,
      transport,
      receipts: fileReceiptStore(join(dirname(parsed.configPath), '.local', 'receipts')),
      now,
    })
    const token = env.INSTATIC_MCP_TOKEN
    return { exitCode: 0, text: `${redact(JSON.stringify(output, null, 2), token ? [token] : [])}\n` }
  } catch (err) {
    const token = env.INSTATIC_MCP_TOKEN
    const message = err instanceof Error ? err.message : 'Unknown toolkit error'
    const exitCode = err instanceof ToolkitError ? err.exitCode : 1
    const body = { ok: false, error: redact(message, token ? [token] : []) }
    return { exitCode, text: `${JSON.stringify(body, null, 2)}\n` }
  }
}

if (import.meta.main) {
  const result = await runCli(process.argv.slice(2))
  const stream = result.exitCode === 0 ? process.stdout : process.stderr
  stream.write(result.text)
  process.exit(result.exitCode)
}
