import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { ToolClass } from './catalog'
import { RECEIPT_TTL_MS } from './gates'

export interface ReceiptIdentity {
  origin: string
  tool: string
  args: unknown
  toolClass: ToolClass
  backupId: string
  allowDrafts: boolean
  allowPublish: boolean
  approvePublish: boolean
}

export interface ReceiptRecord extends ReceiptIdentity {
  hash: string
  createdAt: number
  expiresAt: number
}

export interface ReceiptStore {
  put(record: ReceiptRecord): Promise<void>
  peek(hash: string, now: number): Promise<boolean>
  /** Returns true once for an unexpired receipt, then deletes it. */
  take(hash: string, now: number): Promise<boolean>
}

export function receiptHash(identity: ReceiptIdentity): string {
  return createHash('sha256').update(canonicalJson(identity)).digest('hex')
}

export function makeReceipt(identity: ReceiptIdentity, now: number): ReceiptRecord {
  return {
    ...identity,
    hash: receiptHash(identity),
    createdAt: now,
    expiresAt: now + RECEIPT_TTL_MS,
  }
}

export function memoryReceiptStore(): ReceiptStore {
  const records = new Map<string, ReceiptRecord>()
  return {
    async put(record) {
      records.set(record.hash, record)
    },
    async peek(hash, now) {
      const record = records.get(hash)
      return record !== undefined && record.expiresAt > now
    },
    async take(hash, now) {
      const record = records.get(hash)
      records.delete(hash)
      return record !== undefined && record.expiresAt > now
    },
  }
}

export function fileReceiptStore(dir: string): ReceiptStore {
  return {
    async put(record) {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, `${record.hash}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    },
    async peek(hash, now) {
      const record = await readRecord(dir, hash)
      return record !== undefined && record.expiresAt > now
    },
    async take(hash, now) {
      const record = await readRecord(dir, hash)
      if (!record) return false
      await unlink(join(dir, `${hash}.json`))
      return record.expiresAt > now
    },
  }
}

async function readRecord(dir: string, hash: string): Promise<{ expiresAt: number } | undefined> {
  try {
    const raw = await readFile(join(dir, `${hash}.json`), 'utf8')
    const parsed = JSON.parse(raw) as { expiresAt?: unknown }
    if (typeof parsed.expiresAt !== 'number') return undefined
    return { expiresAt: parsed.expiresAt }
  } catch {
    return undefined
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}
