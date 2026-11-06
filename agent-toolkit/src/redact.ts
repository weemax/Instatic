const PAT_RE = /imcp_pat_[A-Za-z0-9_-]+/g
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi

/**
 * Remove bearer material from text that might be printed.
 * `extraSecrets` covers opaque OAuth tokens that do not use the personal-token prefix.
 * Values shorter than 8 characters are ignored so ordinary words are not blanked.
 */
export function redact(text: string, extraSecrets: readonly string[] = []): string {
  let out = text.replace(BEARER_RE, 'Bearer [redacted]').replace(PAT_RE, '[redacted-token]')
  for (const secret of extraSecrets) {
    if (secret.length < 8) continue
    out = out.split(secret).join('[redacted]')
  }
  return out
}

export function containsSecret(value: unknown, extraSecrets: readonly string[] = []): boolean {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
  if (/imcp_pat_/i.test(text)) return true
  if (/bearer\s+\S+/i.test(text)) return true
  return extraSecrets.some((secret) => secret.length >= 8 && text.includes(secret))
}
