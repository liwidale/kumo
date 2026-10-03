<p align="center">
  <img src="resources/icons/icon.png" width="96" height="96" alt="Kumo">
</p>

<h1 align="center">Kumo</h1>

<p align="center">
  A small companion that lives at the top of your screen and keeps an eye on your coding agents,<br>
  so you can stop checking terminals and keep coding.
</p>

<p align="center">
  <a href="https://github.com/liwidale/kumo/releases/latest"><img src="https://img.shields.io/github/v/release/liwidale/kumo?label=download&color=4c9dff" alt="Download"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey" alt="macOS and Windows">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/liwidale/kumo?color=3ad37e" alt="MIT License"></a>
</p>

<p align="center">
  <img src=".github/assets/demo.gif" width="720" alt="Kumo showing all agent sessions, an approval request, files dropped in as context and an agent finishing its work">
</p>

Running Claude Code in one window, Antigravity in another and Codex somewhere else? Kumo puts all of them in one place. It shows what every agent is doing, lets you approve their requests from wherever you are, and tells you when one of them is done or needs you.

## Download

**[Get the latest version](https://github.com/liwidale/kumo/releases/latest)**

| | File | Works on |
| --- | --- | --- |
| macOS | `Kumo-<version>-mac.dmg` | macOS 12 or later, Apple silicon and Intel |
| Windows | `Kumo-Setup-<version>.exe` | Windows 10 and 11, 64-bit |

Kumo is free and open source.

## What you get

- **Every session at a glance.** Hover the island to see each agent's project, what it is doing right now, a live diff of the file it is editing, its plan and how full its context is.
- **Approve from anywhere.** When an agent wants to run a command or edit a file, the request appears on top of whatever you are doing. Allow it, deny it, allow it for the rest of the session or turn your answer into a rule.
- **Hand over context in one drop.** Drag files, folders, screenshots or a whole window onto Kumo, and they go to the agent you choose on its next turn.
- **Talk back.** Answer an agent's question, queue your next message for when it finishes, or stop it.
- **Review and undo.** See what changed with syntax highlighting and line numbers, and restore any single file.
- **Know your limits.** Your five-hour and weekly plan limits for Claude Code and Codex, plus cost and tokens per session.
- **Your day in review.** Sessions, finished tasks, changed files and every approval you made.
- **Chat about your work.** Ask questions about a session using Claude Code, Anthropic, OpenAI, Google, OpenRouter, Mistral, DeepSeek, Groq, xAI, Together, Ollama, LM Studio or any OpenAI-compatible service.
- **Stays out of the way.** On a MacBook Kumo sits around the notch; on other screens it floats at the top edge. When nothing is happening you only see the little character, and you can hide it in the tray entirely.

## Supported agents

| Agent | Sessions | Approvals | Context | Plan limits |
| --- | :---: | :---: | :---: | :---: |
| Claude Code (terminal and Claude Desktop) | ✓ | ✓ | ✓ | ✓ |
| Antigravity (desktop and CLI) | ✓ | ✓ | ✓ | |
| Codex | ✓ | ✓ | ✓ | ✓ |
| Gemini CLI | ✓ | optional | ✓ | |
| Cursor | ✓ | optional | | |

## Getting started

1. **Install Kumo.** Open the downloaded file and follow the usual steps.
2. **Open it the first time.** Kumo isn't signed by Apple or Microsoft yet, so your system asks once:
   - **macOS:** right-click Kumo in Applications and choose **Open**. If macOS still refuses, run `xattr -dr com.apple.quarantine /Applications/Kumo.app` in Terminal.
   - **Windows:** if SmartScreen appears, click **More info**, then **Run anyway**.
3. **Connect your agents.** Open **Settings → Agents** and click **Connect** next to the agents you use. Kumo shows exactly what it will add to the agent's settings, keeps a backup and leaves everything else untouched.
4. **Work as usual.** Start a session in your agent. Kumo picks it up straight away.

## Keyboard shortcuts

| Action | macOS | Windows |
| --- | --- | --- |
| Open or close Kumo | `⌘⌥K` | `Ctrl+Alt+K` |
| Allow the current request | `⌘⌥Y` | `Ctrl+Alt+Y` |
| Deny the current request | `⌘⌥N` | `Ctrl+Alt+N` |

You can change the main shortcut in **Settings → General**.

## Privacy

- Everything stays on your computer. There is no account, no telemetry and no cloud.
- Kumo only contacts the chat provider you pick, and only when you send a message.
- API keys are kept in the macOS Keychain or protected by Windows.
- You can erase chats, history and saved context at any time in **Settings → Privacy**.

## Questions

**Will Kumo slow my agents down?**
No. If Kumo is closed, paused or busy, your agents carry on exactly as they would without it.

**What happens if I don't answer a request?**
After the time you set in **Settings → Approvals** (about two minutes by default), the request goes back to the agent, which asks you in its own window as usual.

**How do I stop Kumo from showing up for a while?**
Choose **Pause** in the tray menu, or turn on **Pause notifications** in **Settings → General**. Kumo keeps watching quietly, and agents ask for permission in their own windows.

**How do I uninstall it?**
First open **Settings → Agents** and click **Disconnect** for each agent, so their settings go back to how they were. Then remove Kumo like any other app: drag it to the Trash on macOS, or use **Settings → Apps** on Windows.

## Building from source

You'll need Node.js 24 and Rust.

```bash
npm ci
npm start
```

## License

[MIT](LICENSE) © 2026 Liwidale
