import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { ToolkitError } from './errors'
import { containsSecret } from './redact'

const InstanceConfigSchema = Type.Object(
  {
    origin: Type.String({ minLength: 1, maxLength: 200 }),
    connectorLabel: Type.String({ minLength: 1, maxLength: 80 }),
    branchLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    publicPath: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
)

export type InstanceConfig = Static<typeof InstanceConfigSchema> & {
  origin: string
  publicPath: string
}

const SECRET_KEYS = new Set([
  'token',
  'accesstoken',
  'apikey',
  'secret',
  'password',
  'authorization',
  'bearer',
  'pat',
  'header',
  'headers',
])

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function loadInstanceConfig(text: string): InstanceConfig {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ToolkitError('Instance config is not JSON. The file body was not printed.')
  }
  assertNoSecretKeys(raw)
  if (containsSecret(raw)) {
    throw new ToolkitError(
      'Instance config contains a token-like value. Keep the bearer token in INSTATIC_MCP_TOKEN only. The value was not printed.',
    )
  }
  if (!Value.Check(InstanceConfigSchema, raw)) {
    throw new ToolkitError(
      'Instance config must be an object with origin and connectorLabel, and optional branchLabel and publicPath. Other keys are rejected.',
    )
  }

  const origin = normalizeOrigin(raw.origin)
  const connectorLabel = requirePlainLabel(raw.connectorLabel, 'connectorLabel')
  const branchLabel = raw.branchLabel === undefined
    ? undefined
    : requirePlainLabel(raw.branchLabel, 'branchLabel')
  const publicPath = normalizePublicPath(raw.publicPath ?? '/')

  return { origin, connectorLabel, ...(branchLabel ? { branchLabel } : {}), publicPath }
}

function assertNoSecretKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecretKeys(item)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEYS.has(key.toLowerCase())) {
      throw new ToolkitError(
        `Instance config must not contain "${key}". Set INSTATIC_MCP_TOKEN in the environment. The value was not printed.`,
      )
    }
    assertNoSecretKeys(child)
  }
}

function requirePlainLabel(value: string, field: string): string {
  if (value !== value.trim() || value.includes('://') || /\s/.test(value)) {
    throw new ToolkitError(`${field} must be a single token without spaces or a URL.`)
  }
  return value
}

export function normalizeOrigin(input: string): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new ToolkitError('origin must be an absolute URL.')
  }
  const loopback = LOOPBACK.has(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new ToolkitError('origin must be https, or http on localhost / 127.0.0.1 / ::1.')
  }
  if (url.username || url.password) {
    throw new ToolkitError('origin must not contain userinfo. The value was not printed.')
  }
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new ToolkitError('origin must be scheme and host only. Put the public page in publicPath.')
  }
  return url.origin
}

export function normalizePublicPath(input: string): string {
  if (!input.startsWith('/') || input.startsWith('//') || input.includes('://') || input.includes('..')) {
    throw new ToolkitError('publicPath must be a same-origin path starting with /.')
  }
  if (input.includes('?') || input.includes('#')) {
    throw new ToolkitError('publicPath must not contain a query or hash.')
  }
  return input
}

export function endpointUrl(origin: string): string {
  return `${origin}/_instatic/mcp`
}

export function publicUrl(origin: string, publicPath: string): string {
  return new URL(publicPath, `${origin}/`).toString()
}
