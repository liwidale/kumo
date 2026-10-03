import type { ModelInfo, ProviderInfo, Result } from '../../shared/types'
import { getSecret, hasSecret } from '../secrets'
import { settings } from '../settings'
import { which } from '../util'


export interface ProviderDef {
  id: string
  name: string
  kind: ProviderInfo['kind']
  local: boolean
  needsKey: boolean
  baseUrl: () => string
  defaultModel: string
  fallbackModels: string[]
  filter?: (id: string) => boolean
}

const NOISE = /(embed|tts|whisper|dall-e|audio|realtime|moderat|transcribe|image|sora|babbage|davinci|instruct|imagen|veo|aqa|live|search-preview|computer-use)/i

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'claude-cli',
    name: 'Claude Code',
    kind: 'claude-cli',
    local: true,
    needsKey: false,
    baseUrl: () => '',
    defaultModel: 'default',
    fallbackModels: ['default', 'sonnet', 'opus', 'haiku'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    local: false,
    needsKey: true,
    baseUrl: () => 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-5-5',
    fallbackModels: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai-compatible',
    local: false,
    needsKey: true,
    baseUrl: () => 'https://api.openai.com/v1',
    defaultModel: 'gpt-5-mini',
    fallbackModels: ['gpt-5', 'gpt-5-mini'],
    filter: (id) => !NOISE.test(id) && !/codex/i.test(id),
  },
  {
    id: 'google',
    name: 'Google AI',
    kind: 'openai-compatible',
    local: false,
    needsKey: true,
    baseUrl: () => 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    fallbackModels: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    filter: (id) => !NOISE.test(id),
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai-compatible',
    local: false,
    needsKey: true,
    baseUrl: () => 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-5.5',
    fallbackModels: ['anthropic/claude-sonnet-5.5'],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai-compatible',
    local: false,
    needsKey: true,
    baseUrl: () => 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    fallbackModels: ['mistral-large-latest', 'codestral-latest', 'mistral-small-latest'],
    filter: (id) => !NOISE.test(id) && !/moderation|ocr/i.test(id),
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai-compatible',
    local: false,
    needsKey: true,
    baseUrl: () => 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    fallbackModels: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai-compatible',
    local: false,
    needsKey: true,
    baseUrl: () => 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    fallbackModels: ['llama-3.3-70b-versatile', 'qwen/qwen3-32b'],
    filter: (id) => !NOISE.test(id) && !/guard|distil-whisper/i.test(id),
  },
  {
    id: 'xai',
    name: 'xAI',
    kind: 'openai-compatible',
    local: false,
    needsKey: true,
    baseUrl: () => 'https://api.x.ai/v1',
    defaultModel: 'grok-4',
    fallbackModels: ['grok-4', 'grok-code-fast-1'],
    filter: (id) => !NOISE.test(id),
  },
  {
    id: 'together',
    name: 'Together AI',
    kind: 'openai-compatible',
    local: false,
    needsKey: true,
    baseUrl: () => 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    fallbackModels: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
    filter: (id) => !NOISE.test(id) && !/flux|stable-diffusion|whisper|rerank/i.test(id),
  },
  {
    id: 'ollama',
    name: 'Ollama',
    kind: 'openai-compatible',
    local: true,
    needsKey: false,
    baseUrl: () => `${settings.get().chat.ollamaUrl.replace(/\/+$/, '')}/v1`,
    defaultModel: '',
    fallbackModels: [],
    filter: (id) => !/embed/i.test(id),
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    kind: 'openai-compatible',
    local: true,
    needsKey: false,
    baseUrl: () => `${settings.get().chat.lmstudioUrl.replace(/\/+$/, '')}/v1`,
    defaultModel: '',
    fallbackModels: [],
    filter: (id) => !/embed/i.test(id),
  },
  {
    id: 'custom',
    name: 'Custom',
    kind: 'openai-compatible',
    local: false,
    needsKey: false,
    baseUrl: () => settings.get().chat.customUrl.replace(/\/+$/, ''),
    defaultModel: '',
    fallbackModels: [],
  },
]

export const providerDef = (id: string): ProviderDef | undefined => PROVIDERS.find((p) => p.id === id)

async function reachable(url: string, ms = 700): Promise<boolean> {
  try {
    const ctl = AbortSignal.timeout(ms)
    const r = await fetch(url, { signal: ctl })
    return r.ok
  } catch {
    return false
  }
}

export async function listProviders(): Promise<ProviderInfo[]> {
  const c = settings.get().chat
  const [ollama, lmstudio] = await Promise.all([reachable(`${c.ollamaUrl.replace(/\/+$/, '')}/api/tags`), reachable(`${c.lmstudioUrl.replace(/\/+$/, '')}/v1/models`)])
  const cli = Boolean(which('claude'))
  return PROVIDERS.map((p) => {
    const key = hasSecret(`chat.${p.id}`)
    let available = false
    let detail = ''
    switch (p.id) {
      case 'claude-cli':
        available = cli
        detail = cli ? 'Uses your Claude Code sign-in' : 'Install Claude Code to use it here'
        break
      case 'ollama':
        available = ollama
        detail = ollama ? 'Running on this Mac' : 'Not running'
        if (process.platform === 'win32' && ollama) detail = 'Running on this PC'
        break
      case 'lmstudio':
        available = lmstudio
        detail = lmstudio ? 'Server running' : 'Not running'
        break
      case 'custom':
        available = Boolean(c.customUrl)
        detail = c.customUrl || 'Set a base URL in Settings'
        break
      default:
        available = key
        detail = key ? 'Key saved in your keychain' : 'Add an API key in Settings'
    }
    return {
      id: p.id,
      name: p.id === 'custom' ? c.customName || 'Custom' : p.name,
      kind: p.kind,
      local: p.local,
      needsKey: p.needsKey,
      hasKey: key,
      available,
      detail,
      baseUrl: p.baseUrl() || undefined,
    }
  })
}

export async function listModels(id: string): Promise<Result<ModelInfo[]>> {
  const p = providerDef(id)
  if (!p) return { ok: false, error: 'Unknown provider' }
  const fallback = (): Result<ModelInfo[]> => ({ ok: true, value: p.fallbackModels.map((m) => ({ id: m, name: prettyModel(m) })) })
  if (p.kind === 'claude-cli') return fallback()
  const key = getSecret(`chat.${p.id}`)
  if (p.needsKey && !key) return fallback()
  try {
    if (p.kind === 'anthropic') {
      const r = await fetch(`${p.baseUrl()}/models?limit=100`, { headers: { 'x-api-key': key || '', 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(6000) })
      if (!r.ok) return fallback()
      const j = (await r.json()) as { data?: { id: string; display_name?: string }[] }
      const list = (j.data || []).map((m) => ({ id: m.id, name: m.display_name || prettyModel(m.id) }))
      return list.length ? { ok: true, value: list } : fallback()
    }
    const headers: Record<string, string> = {}
    if (key) headers.Authorization = `Bearer ${key}`
    const r = await fetch(`${p.baseUrl()}/models`, { headers, signal: AbortSignal.timeout(6000) })
    if (!r.ok) return fallback()
    const j = (await r.json()) as { data?: { id: string; created?: number }[] }
    let list = (j.data || []).map((m) => ({ id: m.id.replace(/^models\//, ''), created: m.created || 0 }))
    if (p.filter) list = list.filter((m) => p.filter!(m.id))
    list.sort((a, b) => b.created - a.created)
    const out = list.slice(0, 60).map((m) => ({ id: m.id, name: prettyModel(m.id) }))
    return out.length ? { ok: true, value: out } : fallback()
  } catch {
    return fallback()
  }
}

export function prettyModel(id: string): string {
  if (id === 'default') return 'Default model'
  const short = id.replace(/^.*\//, '').replace(/-\d{8}$/, '')
  const m = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/.exec(short)
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`
  if (/^(opus|sonnet|haiku)$/.test(short)) return short[0].toUpperCase() + short.slice(1)
  return short
}
