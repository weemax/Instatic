import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadInstanceConfig } from './config'
import { ToolkitError } from './errors'

const examplePath = join(import.meta.dir, '../examples/instance.example.json')

function config(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    origin: 'https://staging.example.com',
    connectorLabel: 'staging-read-only',
    ...overrides,
  })
}

describe('instance config', () => {
  it('accepts the committed example without a token', () => {
    const loaded = loadInstanceConfig(readFileSync(examplePath, 'utf8'))
    expect(loaded.origin).toBe('https://staging.example.com')
    expect(loaded.connectorLabel).toBe('staging-read-only')
    expect(loaded.publicPath).toBe('/')
    expect(JSON.stringify(loaded)).not.toContain('token')
    expect(JSON.stringify(loaded)).not.toContain('imcp_pat_')
  })

  it('accepts loopback http and rejects other insecure origins', () => {
    expect(loadInstanceConfig(config({ origin: 'http://127.0.0.1:3000' })).origin).toBe('http://127.0.0.1:3000')
    expect(loadInstanceConfig(config({ origin: 'http://localhost:3000' })).origin).toBe('http://localhost:3000')
    expect(() => loadInstanceConfig(config({ origin: 'http://staging.example.com' }))).toThrow(ToolkitError)
  })

  it('rejects paths, userinfo, and query on the origin', () => {
    expect(() => loadInstanceConfig(config({ origin: 'https://staging.example.com/admin' }))).toThrow(/scheme and host/)
    expect(() => loadInstanceConfig(config({ origin: 'https://staging.example.com?x=1' }))).toThrow(/scheme and host/)
    expect(() => loadInstanceConfig(config({ origin: 'https://user:secret@staging.example.com' }))).toThrow(/not printed/)
  })

  it('rejects a token field without echoing the value', () => {
    const secret = 'imcp_pat_example'
    try {
      loadInstanceConfig(config({ token: secret }))
      throw new Error('expected rejection')
    } catch (err) {
      expect(err).toBeInstanceOf(ToolkitError)
      expect((err as Error).message).toContain('token')
      expect((err as Error).message).not.toContain(secret)
    }
  })

  it('rejects a secret-like value in an allowed field without echoing it', () => {
    const secret = 'imcp_pat_example'
    try {
      loadInstanceConfig(config({ connectorLabel: secret }))
      throw new Error('expected rejection')
    } catch (err) {
      expect((err as Error).message).not.toContain(secret)
      expect((err as Error).message).toContain('not printed')
    }
  })

  it('rejects unknown keys and unsafe public paths', () => {
    expect(() => loadInstanceConfig(config({ note: 'hi' }))).toThrow(/optional branchLabel/)
    expect(() => loadInstanceConfig(config({ publicPath: 'https://elsewhere.example/a' }))).toThrow(/publicPath/)
    expect(() => loadInstanceConfig(config({ publicPath: '//elsewhere.example' }))).toThrow(/publicPath/)
    expect(() => loadInstanceConfig(config({ publicPath: '/../secret' }))).toThrow(/publicPath/)
  })

  it('does not echo malformed JSON', () => {
    const secret = 'imcp_pat_example'
    try {
      loadInstanceConfig(`{${secret}`)
      throw new Error('expected rejection')
    } catch (err) {
      expect((err as Error).message).not.toContain(secret)
    }
  })
})
