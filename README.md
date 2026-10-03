# dsh-skillbox

A **skill console for DeepSeek Harness (dsh)**: see every skill DSH resolves, and **uninstall or restore** any of them from Settings — reversibly, without ever deleting a file.

> 中文说明见 [README.zh.md](README.zh.md)。

## What it does

- Adds one top-level page to **Settings → Skills** (`settings.section`).
- Lists every resolved skill with its source (`bundled` / `user-dsh` / `user-agents` / `project-dsh` / `project-agents` / `runtime` / `custom`), provider, invocation policy (model-invocable or user-only), `SKILL.md` path, and a same-name-conflict risk hint.
- Search across name / description / when-to-use, filter by source, and a stats line: total / uninstallable / plugin-provided / uninstalled.
- **Uninstall** moves a skill out of every scanned root into quarantine; **Restore** moves it back, per item or all at once. The "Uninstalled (restorable)" section keeps them visible so nothing is forgotten.

## How uninstall works

Nothing is deleted. Each source has its own quarantine location:

| Source | Quarantine location |
|---|---|
| `user-dsh` | `<root>/.system/<name>` — the filesystem provider declares that root with `skipSystem: true` and skips a top-level `.system` entry, so DSH stops seeing the skill while it stays on the same volume |
| `user-agents`, `project-dsh`, `project-agents`, `custom` | `<root>/../.skill-console-removed/<root name>/<name>` |
| a flat `<name>.md` skill | renamed to `<name>.md.removed` |

- **Plugin-provided skills cannot be uninstalled here**: `bundled` skills from dsh-office / dsh-feishu-config / dsh-windows-acl and `runtime` skills own no directory. Their button is disabled and the reason is shown.
- **Project-level skills require a confirmation** that displays the repository path before anything moves.
- Removal records live in this plugin's profile entry (`config.removedSkills`), and the page also scans the quarantine locations, so records survive a config reset.
- Uninstalling is global and needs no DSH restart; the provider's watchers invalidate discovery.
- Anything already admitted into a conversation stays there: uninstalling prevents future loads and reads, it does not retract history.

## Install

```bash
dsh plugin --profile <profile> add dsh-skillbox
```

Restart DSH (the Host half registers one exact data route at boot), then open **Settings → Skills**. Uninstall the plugin with `dsh plugin --profile <profile> remove dsh-skillbox`; skills you already uninstalled stay in quarantine and can be restored before or after removal.

## Development

Two plain-JS halves — no bundler:

- `lib/host.js` — reads the catalog (`ctx.skills.snapshot`), serves it over `/plugins/dsh-skillbox/skills` (GET read, POST `uninstall` / `restore`), performs the moves with `node:fs`, and persists the removal ledger through the config editor. It waits for the webserver with `ctx.inject(['webServer'], …)` so boot order never matters.
- `lib/client.js` — a `window.__ModuleLoader__` factory registering the Settings page. React comes from the browser module table; styles are component-local with a `dsc-` prefix.

```bash
dsh plugin --profile <profile> add link:/path/to/dsh-skillbox
```

## Compatibility

Built and verified against `@deepseek-ai/dsh` `0.2.0-rc.2`. Needs the `skills` service and the Web settings UI; declares no runtime dependencies (`@deepseek-ai/cordis` is an optional peer).

## License

MIT — see [LICENSE](LICENSE).
