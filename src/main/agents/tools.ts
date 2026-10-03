import type { ApprovalKind, DiffHunk, FileAction, Risk } from '../../shared/types'
import { basename, truncate } from '../util'


export interface ToolDescription {
  cwd?: string
  verb: string
  target?: string
  detail?: string
  kind: ApprovalKind
  title: string
  subject: string
  file?: { path: string; action: FileAction }
  diff?: DiffHunk[]
  content?: string
  url?: string
}

type Input = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v))

function host(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

function fileDesc(verb: string, title: string, p: string, action: FileAction, kind: ApprovalKind): ToolDescription {
  return { verb, target: basename(p), detail: p, kind, title, subject: p, file: { path: p, action } }
}

function claude(name: string, i: Input): ToolDescription | null {
  switch (name) {
    case 'Bash':
    case 'PowerShell': {
      const cmd = str(i.command)
      return {
        verb: 'Run',
        target: truncate(cmd, 80),
        detail: str(i.description) || cmd,
        kind: 'command',
        title: str(i.description) ? truncate(str(i.description), 70) : 'Run a command',
        subject: cmd,
      }
    }
    case 'Read':
      return fileDesc('Read', 'Read a file', str(i.file_path), 'read', 'read')
    case 'Edit': {
      const d = fileDesc('Edit', 'Edit a file', str(i.file_path), 'edit', 'edit')
      d.diff = [{ path: str(i.file_path), before: str(i.old_string), after: str(i.new_string) }]
      return d
    }
    case 'MultiEdit': {
      const d = fileDesc('Edit', 'Edit a file', str(i.file_path), 'edit', 'edit')
      const edits = Array.isArray(i.edits) ? (i.edits as Input[]) : []
      d.diff = edits.slice(0, 6).map((e) => ({ path: str(i.file_path), before: str(e.old_string), after: str(e.new_string) }))
      return d
    }
    case 'Write': {
      const d = fileDesc('Write', 'Create or overwrite a file', str(i.file_path), 'create', 'write')
      d.content = str(i.content)
      return d
    }
    case 'NotebookEdit':
      return fileDesc('Edit', 'Edit a notebook', str(i.notebook_path), 'edit', 'edit')
    case 'Grep':
      return { verb: 'Search', target: truncate(str(i.pattern), 60), kind: 'read', title: 'Search the code', subject: str(i.pattern) }
    case 'Glob':
      return { verb: 'Find', target: truncate(str(i.pattern), 60), kind: 'read', title: 'Find files', subject: str(i.pattern) }
    case 'LS':
      return { verb: 'List', target: basename(str(i.path)), kind: 'read', title: 'List a folder', subject: str(i.path) }
    case 'WebFetch': {
      const url = str(i.url)
      return { verb: 'Fetch', target: host(url), detail: url, kind: 'fetch', title: 'Open a web page', subject: url, url }
    }
    case 'WebSearch':
      return { verb: 'Search web', target: truncate(str(i.query), 60), kind: 'fetch', title: 'Search the web', subject: str(i.query) }
    case 'Task':
    case 'Agent':
      return {
        verb: 'Delegate',
        target: truncate(str(i.description) || str(i.subagent_type), 60),
        detail: str(i.prompt),
        kind: 'agent',
        title: 'Start a sub-agent',
        subject: str(i.description) || str(i.prompt),
      }
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return { verb: 'Plan', target: 'Update task list', kind: 'other', title: 'Update the plan', subject: 'Task list' }
    case 'AskUserQuestion':
      return { verb: 'Ask', target: 'Question for you', kind: 'other', title: 'Ask you a question', subject: '' }
    case 'ExitPlanMode':
      return { verb: 'Plan', target: 'Ready to implement', kind: 'other', title: 'Leave plan mode', subject: truncate(str(i.plan), 400) }
    case 'Skill':
      return { verb: 'Use skill', target: str(i.skill) || str(i.command), kind: 'other', title: 'Use a skill', subject: str(i.skill) }
    default:
      return null
  }
}

function antigravity(name: string, i: Input): ToolDescription | null {
  const p = str(i.AbsolutePath || i.TargetFile || i.file_path || i.path || i.FilePath)
  switch (name) {
    case 'run_command': {
      const cmd = str(i.CommandLine || i.command || i.Command)
      return { verb: 'Run', target: truncate(cmd, 80), detail: cmd, kind: 'command', title: 'Run a command', subject: cmd }
    }
    case 'view_file':
    case 'view_file_outline':
    case 'view_code_item':
      return fileDesc('Read', 'Read a file', p, 'read', 'read')
    case 'write_to_file': {
      const d = fileDesc('Write', 'Create or overwrite a file', p, 'create', 'write')
      d.content = str(i.CodeContent || i.content)
      return d
    }
    case 'replace_file_content':
    case 'multi_replace_file_content': {
      const d = fileDesc('Edit', 'Edit a file', p, 'edit', 'edit')
      const chunks = Array.isArray(i.ReplacementChunks) ? (i.ReplacementChunks as Input[]) : [i]
      d.diff = chunks
        .slice(0, 6)
        .map((c) => ({ path: p, before: str(c.TargetContent || c.old_string), after: str(c.ReplacementContent || c.new_string) }))
        .filter((h) => h.before || h.after)
      return d
    }
    case 'list_dir':
      return { verb: 'List', target: basename(str(i.DirectoryPath || p)), kind: 'read', title: 'List a folder', subject: str(i.DirectoryPath || p) }
    case 'find_by_name':
      return { verb: 'Find', target: truncate(str(i.Pattern || i.pattern), 60), kind: 'read', title: 'Find files', subject: str(i.Pattern) }
    case 'grep_search':
      return { verb: 'Search', target: truncate(str(i.Query || i.query), 60), kind: 'read', title: 'Search the code', subject: str(i.Query) }
    case 'search_web':
      return { verb: 'Search web', target: truncate(str(i.query || i.Query), 60), kind: 'fetch', title: 'Search the web', subject: str(i.query) }
    case 'read_url_content': {
      const url = str(i.Url || i.url)
      return { verb: 'Fetch', target: host(url), kind: 'fetch', title: 'Open a web page', subject: url, url }
    }
    case 'invoke_subagent':
      return { verb: 'Delegate', target: truncate(str(i.Task || i.prompt), 60), kind: 'agent', title: 'Start a sub-agent', subject: str(i.Task) }
    case 'ask_question':
      return { verb: 'Ask', target: 'Question for you', kind: 'other', title: 'Ask you a question', subject: str(i.Question) }
    case 'manage_task':
      return { verb: 'Plan', target: 'Update task list', kind: 'other', title: 'Update the plan', subject: 'Tasks' }
    default:
      return null
  }
}

function gemini(name: string, i: Input): ToolDescription | null {
  const p = str(i.file_path || i.absolute_path || i.path)
  switch (name) {
    case 'run_shell_command': {
      const cmd = str(i.command)
      return { verb: 'Run', target: truncate(cmd, 80), detail: str(i.description) || cmd, kind: 'command', title: str(i.description) ? truncate(str(i.description), 70) : 'Run a command', subject: cmd }
    }
    case 'read_file':
      return fileDesc('Read', 'Read a file', p, 'read', 'read')
    case 'read_many_files':
      return { verb: 'Read', target: 'several files', kind: 'read', title: 'Read several files', subject: truncate(JSON.stringify(i.paths || i), 200) }
    case 'write_file': {
      const d = fileDesc('Write', 'Create or overwrite a file', p, 'create', 'write')
      d.content = str(i.content)
      return d
    }
    case 'replace': {
      const d = fileDesc('Edit', 'Edit a file', p, 'edit', 'edit')
      d.diff = [{ path: p, before: str(i.old_string), after: str(i.new_string) }]
      return d
    }
    case 'list_directory':
      return { verb: 'List', target: basename(p), kind: 'read', title: 'List a folder', subject: p }
    case 'glob':
      return { verb: 'Find', target: truncate(str(i.pattern), 60), kind: 'read', title: 'Find files', subject: str(i.pattern) }
    case 'search_file_content':
    case 'grep':
      return { verb: 'Search', target: truncate(str(i.pattern), 60), kind: 'read', title: 'Search the code', subject: str(i.pattern) }
    case 'web_fetch': {
      const url = /https?:\/\/\S+/.exec(str(i.prompt) || str(i.url))?.[0] || str(i.url)
      return { verb: 'Fetch', target: url ? host(url) : 'web page', kind: 'fetch', title: 'Open a web page', subject: url || str(i.prompt), url }
    }
    case 'google_web_search':
      return { verb: 'Search web', target: truncate(str(i.query), 60), kind: 'fetch', title: 'Search the web', subject: str(i.query) }
    case 'save_memory':
      return { verb: 'Remember', target: truncate(str(i.fact), 60), kind: 'other', title: 'Save a memory', subject: str(i.fact) }
    case 'write_todos':
      return { verb: 'Plan', target: 'Update task list', kind: 'other', title: 'Update the plan', subject: 'Tasks' }
    default:
      return null
  }
}

function patchFiles(patch: string): string[] {
  return [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1].trim())
}

function codex(name: string, i: Input): ToolDescription | null {
  switch (name) {
    case 'shell':
    case 'local_shell':
    case 'exec_command':
    case 'container.exec': {
      const raw = i.command ?? i.cmd
      let cmd = Array.isArray(raw) ? raw.map(String).join(' ') : str(raw)
      cmd = cmd.replace(/^(bash|sh|zsh|pwsh|powershell)(\.exe)? (-lc|-c|-Command) /, '').replace(/^'(.*)'$/s, '$1')
      return { verb: 'Run', target: truncate(cmd, 80), detail: cmd, kind: 'command', title: str(i.justification) ? truncate(str(i.justification), 70) : 'Run a command', subject: cmd, cwd: str(i.workdir) } as ToolDescription
    }
    case 'apply_patch': {
      const patch = str(i.input || i.patch || i.command)
      const files = patchFiles(patch)
      const first = files[0] || ''
      return {
        verb: 'Edit',
        target: files.length > 1 ? `${basename(first)} +${files.length - 1}` : basename(first) || 'files',
        detail: files.join('\n'),
        kind: 'edit',
        title: files.length > 1 ? `Edit ${files.length} files` : 'Edit a file',
        subject: files.join(', ') || 'patch',
        file: first ? { path: first, action: /\*\*\* Add File:/.test(patch) ? 'create' : 'edit' } : undefined,
        content: patch,
      }
    }
    case 'update_plan':
      return { verb: 'Plan', target: 'Update task list', kind: 'other', title: 'Update the plan', subject: 'Plan' }
    case 'view_image':
      return fileDesc('View', 'Look at an image', str(i.path), 'read', 'read')
    case 'web_search':
      return { verb: 'Search web', target: truncate(str(i.query), 60), kind: 'fetch', title: 'Search the web', subject: str(i.query) }
    default:
      return null
  }
}

function cursor(name: string, i: Input): ToolDescription | null {
  const p = str(i.file_path || i.target_file || i.path || i.relative_workspace_path)
  switch (name) {
    case 'Shell':
    case 'run_terminal_cmd':
    case 'run_terminal_command': {
      const cmd = str(i.command)
      return { verb: 'Run', target: truncate(cmd, 80), detail: cmd, kind: 'command', title: 'Run a command', subject: cmd }
    }
    case 'read_file':
    case 'Read':
      return fileDesc('Read', 'Read a file', p, 'read', 'read')
    case 'edit_file':
    case 'search_replace':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'write': {
      const d = fileDesc('Edit', 'Edit a file', p, 'edit', 'edit')
      if (i.old_string != null) d.diff = [{ path: p, before: str(i.old_string), after: str(i.new_string) }]
      else if (i.code_edit || i.contents) d.content = str(i.code_edit || i.contents)
      return d
    }
    case 'delete_file':
      return fileDesc('Delete', 'Delete a file', p, 'edit', 'write')
    case 'grep_search':
    case 'Grep':
    case 'codebase_search':
      return { verb: 'Search', target: truncate(str(i.query || i.pattern), 60), kind: 'read', title: 'Search the code', subject: str(i.query || i.pattern) }
    case 'file_search':
    case 'Glob':
      return { verb: 'Find', target: truncate(str(i.query || i.pattern || i.glob_pattern), 60), kind: 'read', title: 'Find files', subject: str(i.query || i.pattern) }
    case 'list_dir':
    case 'LS':
      return { verb: 'List', target: basename(p), kind: 'read', title: 'List a folder', subject: p }
    case 'web_search':
      return { verb: 'Search web', target: truncate(str(i.search_term || i.query), 60), kind: 'fetch', title: 'Search the web', subject: str(i.search_term || i.query) }
    case 'todo_write':
      return { verb: 'Plan', target: 'Update task list', kind: 'other', title: 'Update the plan', subject: 'Tasks' }
    default:
      return null
  }
}

const TABLES: Record<string, (name: string, i: Input) => ToolDescription | null> = { antigravity, gemini, codex, cursor }

export function describeTool(agent: string, name: string, input: unknown): ToolDescription {
  const i = (input && typeof input === 'object' ? input : {}) as Input
  const own = TABLES[agent]
  const known = (own && own(name, i)) ?? claude(name, i) ?? codex(name, i) ?? gemini(name, i) ?? antigravity(name, i) ?? cursor(name, i)
  if (known) return known
  if (name.startsWith('mcp__')) {
    const [, server, tool] = name.split('__')
    const pretty = (tool || '').replace(/[_-]+/g, ' ')
    return { verb: pretty || 'Use tool', target: server, kind: 'mcp', title: `Use ${server} · ${pretty}`, subject: truncate(JSON.stringify(i), 300) }
  }
  if (name.startsWith('browser_')) {
    return { verb: 'Browse', target: name.slice(8).replace(/_/g, ' '), kind: 'fetch', title: 'Control the browser', subject: truncate(JSON.stringify(i), 300) }
  }
  const pretty = name.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  return { verb: pretty || 'Tool', kind: 'other', title: `Use ${pretty || 'a tool'}`, subject: truncate(JSON.stringify(i), 300) }
}


const HIGH: [RegExp, string][] = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i, 'Deletes files recursively'],
  [/\bRemove-Item\b.*-Recurse/i, 'Deletes files recursively'],
  [/\b(rd|rmdir)\s+\/s\b/i, 'Deletes a folder tree'],
  [/\bgit\s+push\b.*(--force|-f\b)/i, 'Force-pushes and can overwrite history'],
  [/\bgit\s+reset\s+--hard\b/i, 'Discards uncommitted work'],
  [/\bgit\s+clean\s+-[a-z]*f/i, 'Deletes untracked files'],
  [/(curl|wget|iwr|Invoke-WebRequest)[^|]*\|\s*(sh|bash|zsh|iex|Invoke-Expression|python)/i, 'Runs a script straight from the internet'],
  [/\b(mkfs|diskpart|format\s+[a-z]:)/i, 'Formats a disk'],
  [/\bdd\s+if=/i, 'Writes raw data to a device'],
  [/\b(drop\s+(table|database)|truncate\s+table)\b/i, 'Destroys database data'],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, 'Fork bomb'],
]

const ELEVATED: [RegExp, string][] = [
  [/\bsudo\b|\brunas\b|Start-Process.*-Verb\s+RunAs/i, 'Runs with administrator rights'],
  [/\bgit\s+push\b/i, 'Publishes to a remote'],
  [/\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b/i, 'Publishes a package'],
  [/\bchmod\s+(-R\s+)?777\b/i, 'Opens permissions to everyone'],
  [/\b(rm|del|erase|Remove-Item)\b/i, 'Deletes files'],
  [/\b(kubectl|terraform)\s+(apply|delete|destroy)\b/i, 'Changes live infrastructure'],
  [/\b(shutdown|reboot|Stop-Computer|Restart-Computer)\b/i, 'Restarts the machine'],
  [/\bnpx\s+-y\b|\bpip\s+install\b|\bnpm\s+(i|install)\s+-g\b/i, 'Installs software'],
  [/\bcurl\b.*\s-X\s*(POST|PUT|DELETE)/i, 'Sends data to a server'],
]

const SENSITIVE_PATH = /(\.env(\.|$)|id_rsa|id_ed25519|\.ssh[\\/]|\.aws[\\/]|credentials|\.npmrc|\.pypirc|secrets?\.(json|ya?ml)|\.git[\\/]config)/i

export function assessRisk(desc: ToolDescription): { risk: Risk; reason?: string } {
  if (desc.kind === 'command') {
    for (const [re, reason] of HIGH) if (re.test(desc.subject)) return { risk: 'high', reason }
    for (const [re, reason] of ELEVATED) if (re.test(desc.subject)) return { risk: 'elevated', reason }
    return { risk: 'normal' }
  }
  if (desc.file && SENSITIVE_PATH.test(desc.file.path)) return { risk: 'elevated', reason: 'Touches credentials or secrets' }
  if (desc.kind === 'write' || desc.kind === 'edit') {
    if (/[\\/](etc|Windows|System32|usr)[\\/]/i.test(desc.subject)) return { risk: 'high', reason: 'Writes outside the project, into system files' }
  }
  return { risk: 'normal' }
}

