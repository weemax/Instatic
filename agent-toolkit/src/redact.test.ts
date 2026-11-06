import { describe, expect, it } from 'bun:test'
import { containsSecret, redact } from './redact'

describe('redaction', () => {
  it('removes personal-token prefixes and bearer values', () => {
    const secret = 'imcp_pat_example'
    const text = `failed Authorization: Bearer ${secret} and also ${secret}`
    const cleaned = redact(text)
    expect(cleaned).not.toContain(secret)
    expect(cleaned).not.toContain('imcp_pat_')
    expect(cleaned).toContain('Bearer [redacted]')
  })

  it('removes an opaque extra secret and ignores short strings', () => {
    const opaque = 'opaque-test-secret'
    const cleaned = redact(`see ${opaque} and ok`, [opaque, 'ok'])
    expect(cleaned).not.toContain(opaque)
    expect(cleaned).toContain('ok')
  })

  it('detects token-like values without returning them', () => {
    expect(containsSecret({ html: '<p>hello</p>' })).toBe(false)
    expect(containsSecret({ note: 'Bearer abcdefgh' })).toBe(true)
    expect(containsSecret({ note: 'plain' }, ['opaque-test-secret'])).toBe(false)
    expect(containsSecret('prefix opaque-test-secret suffix', ['opaque-test-secret'])).toBe(true)
  })
})
