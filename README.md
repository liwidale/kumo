<p align="center">
  <img src="resources/icons/icon.png" width="96" height="96" alt="Kumo">
</p>

<h1 align="center">Kumo</h1>

<p align="center">
  A small companion that lives at the top of your screen and keeps an eye on your coding agents.<br>
  See what every session is doing, approve requests without switching windows, and hand over context in one drop.
</p>

<p align="center">
  <a href="https://github.com/liwidale/kumo/releases/latest"><img src="https://img.shields.io/github/v/release/liwidale/kumo?label=download&color=4c9dff" alt="Latest release"></a>
  <a href="https://github.com/liwidale/kumo/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/liwidale/kumo/release.yml?label=build" alt="Build"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey" alt="macOS and Windows">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/liwidale/kumo?color=3ad37e" alt="MIT License"></a>
</p>

<p align="center">
  <img src=".github/assets/demo.gif" width="880" alt="Kumo showing a live diff, an approval request and a finished task">
</p>

## What it does

- **Lives in the notch.** On a MacBook Kumo sits around the notch, on other displays it floats at the top edge. When nothing is running you only see the character.
- **Every session at a glance.** Hover the island to see what each agent is editing right now: a live diff, the plan, context usage and subagents.
- **Approvals from anywhere.** Permission requests pop up on top of whatever you are doing. Allow, deny, allow for the session or turn the answer into a rule. `Ctrl+Alt+Y` / `Ctrl+Alt+N` (`⌘⌥Y` / `⌘⌥N` on macOS) answer without touching the mouse.
- **Talk back.** Answer an agent's question, queue the next prompt for when its turn ends, or stop a session.
- **Context in one drop.** Drag files, folders, images or a window onto Kumo and they are handed to the next turn of the session you pick.
- **Review and revert.** Browse what changed with syntax highlighting and line numbers, and restore a single file with git.
- **Plan limits and cost.** Five-hour and weekly limits for Claude Code and Codex, plus cost and tokens per session.
- **A day in review.** Sessions, finished tasks, changed files and every approval decision, kept on your machine.
- **Chat.** Ask about a session with Claude Code, Anthropic, OpenAI, Google, OpenRouter, Mistral, DeepSeek, Groq, xAI, Together, Ollama, LM Studio or any OpenAI-compatible endpoint.
- **Tray only, if you prefer.** Hide the island completely and let it appear only when an agent needs your OK.

## Supported agents

| Agent | Sessions | Approvals | Context hand-off | Plan limits |
| --- | :---: | :---: | :---: | :---: |
| Claude Code (CLI and Desktop) | ✓ | ✓ | ✓ | ✓ |
| Antigravity (desktop and CLI) | ✓ | ✓ | ✓ | |
| Codex | ✓ | ✓ | ✓ | ✓ |
| Gemini CLI | ✓ | opt-in | ✓ | |
| Cursor | ✓ | opt-in | | |

## Install

Download the latest build from [Releases](https://github.com/liwidale/kumo/releases/latest):

- **macOS** (Apple silicon and Intel): `Kumo-<version>-mac.dmg`
- **Windows** (x64): `Kumo-Setup-<version>.exe`

Release builds are not signed yet, so the first launch needs one extra step:

- **macOS:** right-click Kumo in Applications and choose **Open**, or run `xattr -dr com.apple.quarantine /Applications/Kumo.app`.
- **Windows:** if SmartScreen appears, click **More info** and then **Run anyway**.

## Getting started

1. Launch Kumo. The character appears at the top of the screen.
2. Open **Settings → Agents** and press **Connect** next to the agents you use. Kumo shows the exact change it will make to the agent's config file, keeps a backup and never touches your other settings.
3. Start a session as usual. Kumo picks it up on the first event.

`Ctrl+Alt+K` (`⌘⌥K` on macOS) opens and closes the island from anywhere.

## How it works

Each agent runs a tiny relay (`kumo-hook`, written in Rust) on its hook events. The relay forwards the event to Kumo over `127.0.0.1` with a per-launch token and prints Kumo's answer back to the agent. If Kumo is closed or paused, the relay steps aside immediately and the agent behaves exactly as it would without Kumo. An unanswered approval goes back to the agent's own prompt after the timeout you set.

## Privacy

- Everything stays on your computer: no account, no telemetry, no cloud.
- Kumo only talks to the chat provider you choose, and only when you send a message.
- API keys are stored in the macOS Keychain or protected with Windows DPAPI.
- Chats, history and captured context live in Kumo's data folder and can be erased from Settings.

## Building from source

Requirements: Node.js 24, Rust (stable), and on macOS the Xcode command line tools.

```bash
npm ci
npm start
```

Package an installer:

```bash
npm run pack:mac   # universal DMG and ZIP
npm run pack:win   # NSIS installer
```

`npm run test:mac` runs an end-to-end check of the macOS app in a throwaway profile.

## Releases

Pushing a version tag builds both platforms on GitHub Actions and publishes a release with the installers attached:

```bash
git tag v1.0.1
git push origin v1.0.1
```

Signing and notarization turn on automatically when these repository secrets are set: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Without them the builds are unsigned.

## License

[MIT](LICENSE) © 2026 Liwidale
