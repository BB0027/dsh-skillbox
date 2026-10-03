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
