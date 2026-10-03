import anthropic from '../assets/logos/anthropic.svg?raw'
import antigravity from '../assets/logos/antigravity.svg?raw'
import claudeCode from '../assets/logos/claudecode.svg?raw'
import codex from '../assets/logos/codex.svg?raw'
import cursor from '../assets/logos/cursor.svg?raw'
import deepseek from '../assets/logos/deepseek.svg?raw'
import gemini from '../assets/logos/gemini.svg?raw'
import geminiCli from '../assets/logos/geminicli.svg?raw'
import groq from '../assets/logos/groq.svg?raw'
import lmstudio from '../assets/logos/lmstudio.svg?raw'
import mistral from '../assets/logos/mistral.svg?raw'
import ollama from '../assets/logos/ollama.svg?raw'
import openai from '../assets/logos/openai.svg?raw'
import openrouter from '../assets/logos/openrouter.svg?raw'
import together from '../assets/logos/together.svg?raw'
import xai from '../assets/logos/xai.svg?raw'


const strip = (svg: string): string => svg.replace(/<title>[^<]*<\/title>/, '').replace(/\s(width|height)="1em"/g, '')

const AGENTS: Record<string, string> = {
  'claude-code': strip(claudeCode),
  antigravity: strip(antigravity),
  codex: strip(codex),
  gemini: strip(geminiCli),
  cursor: strip(cursor),
}

const PROVIDERS: Record<string, string> = {
  'claude-cli': strip(claudeCode),
  anthropic: strip(anthropic),
  openai: strip(openai),
  google: strip(gemini),
  openrouter: strip(openrouter),
  mistral: strip(mistral),
  deepseek: strip(deepseek),
  groq: strip(groq),
  xai: strip(xai),
  together: strip(together),
  ollama: strip(ollama),
  lmstudio: strip(lmstudio),
}

export const hasAgentLogo = (id: string): boolean => id in AGENTS

export function AgentLogo({ agent, size = 14 }: { agent: string; size?: number }) {
  const svg = AGENTS[agent]
  if (!svg) return null
  return <span className="logo" style={{ width: size, height: size }} aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />
}

export function ProviderLogo({ provider, size = 14 }: { provider: string; size?: number }) {
  const svg = PROVIDERS[provider]
  if (!svg) return null
  return <span className="logo" style={{ width: size, height: size }} aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />
}
