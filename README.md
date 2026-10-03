# dsh-skillbox

A **skill console for DeepSeek Harness (dsh)**: see every skill DSH resolves, **discover and install** skills from [skills.sh](https://skills.sh), **upgrade** them safely, and **uninstall or restore** any of them from Settings — reversibly, without ever deleting a file and without ever rewriting a skill's own `SKILL.md`.

> 中文说明见 [README.zh.md](README.zh.md)。

## What it does

Four tabs inside one top-level **Settings → Skills** page (`settings.section`):

| Tab | What it gives you |
|---|---|
| **Installed** | Every resolved skill with its source (`bundled` / `user-dsh` / `user-agents` / `project-dsh` / `project-agents` / `runtime` / `custom`), invocation policy, `SKILL.md` path, same-name-conflict hint — plus **where it came from**, when it was installed/updated, whether it was **edited locally**, and whether **upstream has moved on**. Grouped by origin repository. |
| **Discover** | Search skills.sh (installs, owner filter), preview a skill's `SKILL.md` with its Snyk / Socket verdicts, and install it into the DSH root in one click. Low-trust sources need an explicit confirmation. |
| **Quarantine** | Everything this console moved out of discovery, with the reason (uninstalled by hand / pre-upgrade backup) and one-click restore, per item or all at once. |
| **Health** | **Skill health**: scans the global roots for skills DSH silently refuses to load and says why, with a suggestion for each — plus an environment self-check (is the `skills` CLI present, which version, does it still carry the `dsh` agent patch, where the lock and state files live). |

Plus: search across name / description / when-to-use, filter by source, filter to locally-edited skills, a stats line (total / uninstallable / plugin-provided / edited / upgradable / quarantined), and an **upgrade preview** that lists what would upgrade and what would be skipped before anything moves.

## How it stays safe

- **Nothing is ever deleted.** Uninstalling and upgrading both *move* directories; a skill's previous version is parked in quarantine, never removed.
- **No `SKILL.md` is ever edited.** The console installs, moves, upgrades and reports. It does not rewrite a skill's own files.
- **Installs only ever target the DSH root** (`skills add … -a dsh --copy`), never another agent's directory.
- **An upgrade either lands or rolls back.** The current version goes to quarantine first; if the install fails, it is moved back.
- **Local edits are protected.** A skill whose files no longer match the baseline recorded at install time is skipped, unless you explicitly tick *force overwrite*.

## Skill health, and the one thing that acts on its own

DSH silently ignores a `SKILL.md` it cannot accept: no error, no listing, no trace. The Health tab reads the global roots itself (`user-dsh`, `user-agents`, including flat `<name>.md` skills) and reports every file DSH will not load — missing frontmatter, missing `name`/`description`, a non-kebab-case `name`, a retired invocation key (`modelInvocable` / `userInvocable` / `disableModelInvocation`), unparsable frontmatter — each with the reason and a suggestion. The CLI's own listing cannot do this: measured, it reports a missing description but lists a skill with a legacy key as if it were fine.

**Auto-quarantine** is the only thing this plugin does without being asked, and it is off by default. Turning it on requires one **rehearsal** first: the tab lists exactly what would move and touches nothing. After that, entering the page moves those files into the same reversible quarantine a manual uninstall uses, and reports what it moved. A skill you restore while the automation is on is not moved again during that run; toggling the automation or restarting DSH resets that. Findings are never rewritten and never deleted — only moved, and always restorable from the Quarantine tab.

Both the scan and the automation are limited to the global roots: project-level skills are never scanned and never moved.

The page itself is built from DSH's shared client controls (`@deepseek-ai/dsh-client-ui-primitives`) — the same primitives the plugin manager page uses — and degrades to plain elements if a client cannot see that module.

## Requirements

The console drives the official **`skills` CLI** (npm package `skills`, the package manager of the skills.sh ecosystem) for anything that writes:

```bash
npm i -g skills
```

The CLI needs a local `dsh` agent entry so that `-a dsh` installs into the DSH skill root. Upstream does not ship one yet; the companion **`find-skills`** skill carries an idempotent patch script:

```powershell
pwsh -NoProfile -File "<dsh-home>\skills\find-skills\scripts\patch-skills-cli-dsh.ps1" [-Check|-Revert]
```

Without the CLI (or without the patch) the Discover tab is disabled and the Health tab explains what is wrong. Everything else — listing, quarantine, restore — keeps working.

## How uninstall works

Nothing is deleted. Each source has its own quarantine location:

| Source | Quarantine location |
|---|---|
| `user-dsh` | `<root>/.system/<name>` — the filesystem provider declares that root with `skipSystem: true` and skips a top-level `.system` entry, so DSH stops seeing the skill while it stays on the same volume |
| `user-agents`, `project-dsh`, `project-agents`, `custom` | `<root>/../.skill-console-removed/<root name>/<name>` |
| a flat `<name>.md` skill | renamed to `<name>.md.removed` |

- **Plugin-provided skills cannot be uninstalled here**: `bundled` skills from dsh-office / dsh-feishu-config / dsh-windows-acl and `runtime` skills own no directory. Their button is disabled and the reason is shown.
- **Project-level skills require a confirmation** that displays the repository path before anything moves.
- Quarantine records live in `<profile>/dsh-skillbox-state.json` (see below) and the page also scans the quarantine locations, so records survive a config reset.
- Uninstalling is global and needs no DSH restart; the provider's watchers invalidate discovery.
- Anything already admitted into a conversation stays there: uninstalling prevents future loads and reads, it does not retract history.

## State

Install baselines (the content hash recorded when this plugin last wrote a skill), the quarantine ledger and the auto-quarantine switch (0.4.0) live in:

```
<profile>/dsh-skillbox-state.json
```

It sits next to the profile's own `cordis.patch.yml` — resolved from the running Harness (`configEditor.documentPath`), so it travels with profile backups — and **not** in this plugin's config entry. Config writes re-apply the plugin and would tear down the live route mid-request; v0.2.x learned that the hard way. A v0.2.x `removedSkills` entry is migrated on first read and never written again.

## Install

```bash
dsh plugin --profile <profile> add dsh-skillbox
```

Restart DSH (the Host half registers one exact data route at boot), then open **Settings → Skills**. Uninstall the plugin with `dsh plugin --profile <profile> remove dsh-skillbox`; skills you already uninstalled stay in quarantine and can be restored before or after removal.

### From this repository

The same package straight from source — the form this plugin is developed and verified with:

```bash
git clone https://github.com/BB0027/dsh-skillbox.git
dsh plugin --profile <profile> add link:/absolute/path/to/dsh-skillbox
```

Every release also carries a prebuilt `dsh-skillbox-<version>.tgz`; unpack it and use the same `link:` form. Restart DSH afterwards.

## Development

Plain-JS halves — no bundler, no runtime dependencies:

| File | Role |
|---|---|
| `lib/host.js` | Route `/plugins/dsh-skillbox/skills` (GET read, POST actions), catalog assembly, wiring. Waits for the webserver with `ctx.inject(['webServer'], …)` so boot order never matters. |
| `lib/cli.js` | `skills` CLI adapter: detection (PATH, `SKILLS_CLI`, npm shims), spawn with a Windows `.cmd` wrapper, JSON extraction, retry, one writer at a time, `--full-depth` always. |
| `lib/upstream.js` | skills.sh search, `skillId` → repository directory resolution, `SKILL.md` preview, Snyk/Socket verdicts, upstream git tree SHA. |
| `lib/registry.js` | Merges the DSH catalog + CLI lock + our baselines + upstream into the enriched inventory. |
| `lib/flows.js` | The mutating flows: quarantine, restore, install, upgrade preview / one / all, with rollback. |
| `lib/hash.js` | Folder content hash, byte-compatible with the CLI's own `computeSkillFolderHash`. |
| `lib/state.js` | Profile-directory resolution and the atomic state document. |
| `lib/paths.js` | Quarantine location arithmetic, shared by the Host and the flows. |
| `lib/client.js` | `window.__ModuleLoader__` factory registering the Settings page. React comes from the browser module table; styles are component-local with a `dsc-` prefix. |

```bash
dsh plugin --profile <profile> add link:/path/to/dsh-skillbox
```

## Compatibility

Built and verified against `@deepseek-ai/dsh` `0.2.0-rc.2` with `skills` CLI `1.7.0`. Needs the `skills` service and the Web settings UI; declares no runtime dependencies (`@deepseek-ai/cordis` is an optional peer).

## License

MIT — see [LICENSE](LICENSE).
