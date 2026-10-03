# Changelog

All notable changes to `dsh-skillbox` are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-10-03

First release. Batch 1 scope: browse + enable/disable, verified against `@deepseek-ai/dsh` `0.2.0-rc.2`.

### Added

- A top-level **Settings → Skills** page (`settings.section`), contributed by the Client half, with:
  - the full resolved skill catalog across every root, with source, provider, invocation policy, `SKILL.md` path, and visibility per workspace;
  - full-text search over name / description / when-to-use, and filtering by source;
  - Enabled / Disabled grouping with counts, one switch per row, Restore all, and JSON list export/import;
  - a same-name-conflict **risk hint** (risk only: `ctx.skills.list` returns winners alone, and the service exposes no provider enumeration, so shadowed candidates are not listed);
  - click-to-copy on the skill path;
  - Chinese and English copy following the DSH locale.
- A Host half serving the catalog over one exact route, `/plugins/dsh-skillbox/skills` (GET read, POST mutate; cross-origin POSTs refused; request bodies capped).
- A global disable policy enforced at both boundaries a skill can cross:
  - `ctx.tools.guard(...)` denies loading a disabled skill through the `skill` tool;
  - an `agent/pre-step` waterfall listener registered with `{ prepend: true }` removes disabled entries from the injected `<available_skills>` catalog and drops `<skill_content>` injections for user-invoked disabled skills.
- Policy persistence into this plugin's own profile entry (`config.disabledSkills`) through the config editor, so it lives in `cordis.patch.yml` and survives restarts.

### Notes

- The policy is a read-boundary filter: no skill file is ever moved, renamed, or edited.
- Disabling is global; per-workspace overrides are out of scope for this release.
- Editing, creating, deleting, and importing skills from GitHub are out of scope for this release.

## [0.2.0] — 2026-10-03

Direction change: skill management is now **uninstall**, not a read-boundary disable policy. Nothing is ever deleted — a skill leaves discovery by moving into a quarantine location.

### Changed

- Replaced the v0.1.0 disable policy: removed the `ctx.tools.guard` enforcement, the prepended `agent/pre-step` catalog rewriter, and the `disabledSkills` config key.
- The page's per-row control is now **Uninstall / Restore** instead of a switch, and the "disabled" group became "Uninstalled (restorable)".

### Added

- Uninstall moves a skill out of every scanned root, per source:
  - `user-dsh` → `<root>/.system/<name>`, a location `@deepseek-ai/dsh-skill-filesystem` skips natively through its `skipSystem` root flag;
  - `user-agents`, `project-dsh`, `project-agents`, `custom` → `<root>/../.skill-console-removed/<root name>/<name>`;
  - a flat `<name>.md` skill → renamed to `<name>.md.removed`.
- Restore in one click, per item or for all; the removal record lives in this plugin's profile entry (`removedSkills`), and the page also scans the quarantine locations so records survive a config reset.
- Project-level skills require an explicit confirmation that shows the repository path before anything is moved.
- Plugin-provided skills (`bundled` from dsh-office / dsh-feishu-config / …, and `runtime`) are listed as not uninstallable, with the reason on the disabled button.
- Stats line: total / uninstallable / plugin-provided / uninstalled.

### Notes

- Applying this version to a running DSH requires one restart of the Host process.
- Anything already admitted into a conversation stays in that conversation: uninstalling prevents future loads, it does not retract history.

## [0.2.1] — 2026-10-04

### Fixed

- The published package description still described v0.1.0's enable/disable policy. It now describes the uninstall/restore behaviour that actually ships, so the npm page matches the README.

### Notes

- No functional change. This release exists to correct published metadata.

## [0.2.2] — 2026-10-04

### Changed

- Releases now go through GitHub Actions with npm Trusted Publishing (OIDC): no npm token exists anywhere, so there is nothing to rotate or expire. A `v*` tag triggers the workflow, which verifies the tag against `package.json` and refuses to run when any token is configured.

### Notes

- No functional change to the plugin: this release exercises the new release pipeline end to end.

## [0.3.0] — 2026-10-04

The console stops being read-only about the skill ecosystem: it can now find skills, install them, and upgrade them — safely, through the official `skills` CLI, while keeping every v0.2.x guarantee.

### Added

- **Tabs.** The page is now Installed / Discover / Quarantine / Health.
- **Installed, enriched.** Each row shows where the skill came from (`source`, upstream `skillPath`), when it was installed and updated, whether it has been **edited locally** since install, and whether **upstream has moved on**. Skills are grouped by their origin repository; locally written skills get their own group.
- **Discover.** Search skills.sh from the page (installs, source, owner filter), preview a skill's `SKILL.md` together with its Snyk / Socket verdicts, and install it into the DSH root in one click. Sources with fewer than 100 installs from an unrecognised owner require an explicit confirmation.
- **Check for updates.** Update availability compares the upstream git tree SHA of the skill folder against the reference recorded when this plugin installed or upgraded it — no clone, no install, nothing touched, and independent of line endings. The CLI lock's own hashes are unusable for this on Windows: the CLI writes CRLF-converted bytes and stores a payload hash, so neither its 64-hex value nor a raw upstream hash matches what is on disk (measured; `docs/SPEC-v0.3.0.md` F3/F4).
- **Upgrade, single / preview / all.** A dry-run preview lists what would upgrade and what would be skipped; the previous version is moved into quarantine (`reason: upgrade-backup`) before the new one is fetched, and restored automatically if the install fails.
- **Local-edit protection.** An upgrade of a skill whose files no longer match the baseline recorded at install time is skipped unless the user explicitly ticks "force overwrite".
- **Environment self-check (Health tab).** Reports whether the `skills` CLI is present, its version, whether it still carries the local `dsh` agent patch, and where the CLI lock and this plugin's state file live.
- **Own state file**: `<profile>/dsh-skillbox-state.json`, holding install baselines, the auto-quarantine switch (0.4.0) and the quarantine ledger. The v0.2.x `removedSkills` config entry is migrated on first read and never written again — config writes re-apply the plugin, which is the wrong thing to do from a request handler.

### Changed

- Quarantine records now carry a **reason** (`manual` / `upgrade-backup` / `auto` / `legacy`) and a timestamp, shown in the UI.
- A skill that leaves the catalog also drops its baseline hash, so a later reinstall cannot be misread as "locally modified".
- Every install goes through `skills add … -g -y -a dsh --copy --full-depth --json`. `--full-depth` is not optional: without it the CLI's repository discovery stops early and returns a partial skill list (measured 2/5 successes against 5/5 with the flag).

### Notes

- Requires the `skills` CLI (npm `skills`) with the `dsh` agent entry; when it is missing or unpatched the Discover tab is disabled and the Health tab says why. See `docs/SPEC-v0.3.0.md` and the companion `find-skills` skill for the patch script.
- `skills check` / `skills update` are deliberately **not** used. Measured: with an update pending, `skills check -g` performs the install itself and overwrites a locally edited skill — it deleted a marker file placed in the skill directory. Update detection and upgrades are therefore driven here instead.
- A GitHub token is optional but recommended: update checks use the GitHub API, whose anonymous quota is 60/hour and is also consumed by `skills add` itself. When the quota is exhausted the plugin degrades to "update status unknown" with the reason shown — it never guesses and never touches files. Set `GITHUB_TOKEN` (or `GH_TOKEN`) to raise the limit.
- Applying this version needs one restart of the Host process; the Client half only needs a page refresh.
- Still true, unchanged: no file is ever deleted, and no `SKILL.md` is ever edited.

## [0.3.1] — 2026-10-04

### Fixed

- **Discover gave no feedback after installing.** The card that was clicked stayed unchanged and the page jumped to another tab, so a successful install looked like nothing had happened. The card now shows *installing* while the CLI works, flips to **Installed** in place when it lands, and the catalog refreshes immediately and again once the provider watcher has settled — without switching tabs.
- **Search results did not say what was already installed.** A result whose skill is already present now carries an **Installed** tag, shows an **Update available** tag when upstream has moved on, and offers **Upgrade** instead of a second install — pressing install on a locally edited skill would have overwritten it.

### Added

- `test/client-smoke.mjs`: renders the client half in Node with a stub React and a stub cordis context, so the discover card's installed/upgrade states are covered without a browser (`node test/client-smoke.mjs`).

### Notes

- Client-half only: refresh the page. No Host restart is needed for this release.

## [0.4.0] — 2026-10-04

### Added

- **Health tab.** DSH silently ignores a `SKILL.md` it cannot accept, so a broken skill is not disabled — it is invisible, and nothing reports an error. The console now scans the two global roots itself (`user-dsh` and `user-agents`, including flat `<name>.md` skills) and lists everything DSH will not load, with a reason and a suggestion each: missing frontmatter, missing `name` or `description`, a `name` that is not kebab-case, a retired invocation key (`modelInvocable` / `userInvocable` / `disableModelInvocation`), frontmatter that cannot be parsed, an unreadable file. `.system` is skipped, exactly as the provider does. The CLI's own listing is not used for this: measured, it reports a missing description but lists a skill with a legacy key as if it were fine.
- **Auto-quarantine**, off by default. Switching it on requires one **rehearsal** first — the page lists exactly what would move and touches nothing — and each pass reports what it moved. Findings go through the same reversible quarantine a manual uninstall uses, so they stay restorable from the Quarantine tab. No file is ever deleted and no `SKILL.md` is ever edited.
- **Restore wins.** A skill you restore while the automation is on is not moved again during that run (the pass marks it `restored by you`); toggling the automation either way, or restarting DSH, resets that.
- **The page now uses DSH's shared client controls** (`@deepseek-ai/dsh-client-ui-primitives`) — `Pill` for view switching and filters, `Button` for actions, `Tag` for badges, `Input` for search, `Switch` for the automation toggle, `StateDot` for row state — the same primitives the plugin manager page is built from, rather than hand-rolled markup. A third-party client may not see that module in the browser table, so every control degrades to the previous plain element; both paths are tested.
- `npm test` runs four dependency-free suites: `test/health.mjs`, `test/flows.mjs`, `test/host-health.mjs` and `test/client-smoke.mjs` (the last renders the client in Node with a stub React and a stub cordis context, covering the shared-control and fallback paths plus the health tab).

### Notes

- Health scanning and auto-quarantine are limited to the global roots. Project-level skills are never scanned and never moved.
- Applying this version needs one restart of the Host process; the Client half only needs a page refresh.
- Still true, unchanged: no file is ever deleted, and no `SKILL.md` is ever edited.



