import { safeStorage } from 'electron'
import { dataDir, readJson, writeJson } from './util'

type Vault = Record<string, string>

const file = (): string => dataDir('secrets.json')
let cache: Vault | null = null

function vault(): Vault {
  if (!cache) cache = readJson<Vault>(file(), {})
  return cache
}

export function setSecret(name: string, value: string): void {
  const v = vault()
  const trimmed = value.trim()
  if (!trimmed) delete v[name]
  else if (safeStorage.isEncryptionAvailable()) v[name] = `enc:${safeStorage.encryptString(trimmed).toString('base64')}`
  else throw new Error('Secure storage is not available on this system, so the key was not saved.')
  writeJson(file(), v)
}

export function getSecret(name: string): string | null {
  const raw = vault()[name]
  if (!raw) return null
  try {
    if (raw.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64'))
  } catch {
    return null
  }
  return null
}

export function hasSecret(name: string): boolean {
  return Boolean(vault()[name])
}

export function clearSecrets(): void {
  cache = {}
  writeJson(file(), cache)
}
