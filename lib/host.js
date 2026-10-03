/**
 * dsh-skillbox — Host half (v0.3.0).
 *
 * The console started as "list every skill, uninstall reversibly, restore". v0.3.0
 * keeps those guarantees and adds the other half of managing skills: discovering them
 * on skills.sh, installing them into the DSH root, upgrading them safely, and saying
 * out loud what the local `skills` CLI situation is.
 *
 * Invariants (they do not bend):
 *
 *   - **no file is ever deleted.** Leaving the catalog means moving into quarantine:
 *     `user-dsh` → `<root>/.system/<name>`, other writable roots →
 *     `<root>/../.skill-console-removed/<root name>/<name>`, flat files → `.removed`.
 *   - **no `SKILL.md` is ever edited.** The console reports problems; it does not fix
 *     them by rewriting a skill's own files.
 *   - **installs only ever target the DSH root** (`-a dsh --copy`), never another
 *     agent's directory.
 *   - **an upgrade either lands or rolls back**, because the previous version goes to
 *     quarantine before the new one is fetched.
 *
 * State that changes on ordinary actions lives in `<profile>/dsh-skillbox-state.json`
 * rather than in this plugin's profile config entry: a config write re-applies the
 * plugin and would dispose this route mid-response (v0.2.2 learned that the hard way).
 * The v0.2.x `removedSkills` ledger is still read and migrated on first use.
 */

import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';

import { createSkillsCli } from './cli.js';
import { createFlows, parseRegistryId } from './flows.js';
import { scanRoots } from './health.js';
import { buildInventory, lockPath as cliLockPath } from './registry.js';
import { readState, writeState, normalizeState } from './state.js';
import { createUpstream } from './upstream.js';
import { SYSTEM_DIR, FLAT_SUFFIX, QUARANTINE_DIR, exists, locationOf, readDirSafe } from './paths.js';

const PKG = 'dsh-skillbox';
const ROUTE = '/plugins/dsh-skillbox/skills';
const LEDGER_KEY = 'removedSkills';
const BODY_LIMIT = 512 * 1024;

/** Sources whose skills live in a directory we are allowed to move out of. */
const UNINSTALLABLE_SOURCES = new Set(['user-dsh', 'user-agents', 'project-dsh', 'project-agents', 'custom']);
/** Sources that need an explicit confirmation because they touch a repository. */
const PROJECT_SOURCES = new Set(['project-dsh', 'project-agents']);

function normalizeLedger(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue;
    const { name, from, to, source, kind, at } = item;
    if (typeof name !== 'string' || typeof from !== 'string' || typeof to !== 'string') continue;
    out.push({
      name,
      from,
      to,
      source: typeof source === 'string' ? source : 'custom',
      kind: kind === 'file' ? 'file' : 'dir',
      at: typeof at === 'string' ? at : null,
    });
  }
  return out;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error('request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text === '') return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    request.on('error', reject);
  });
}

function sameOrigin(request) {
  const origin = request.headers?.origin;
  if (typeof origin !== 'string' || origin === '') return true;
  try {
    return new URL(origin).host === request.headers?.host;
  } catch {
    return false;
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ removedSkills?: unknown[] } | undefined} config
 */
export function apply(ctx, config) {
  const legacyLedger = normalizeLedger(config?.[LEDGER_KEY]);

  const log = (level, message) => {
    try {
      const logger = ctx.logger;
      if (logger !== undefined && typeof logger[level] === 'function') logger[level](`[${PKG}] ${message}`);
    } catch {
      /* logging is best-effort */
    }
  };

  const cli = createSkillsCli({ log });
  const upstream = createUpstream({ log });

  /**
   * State lives in the profile directory. Reads are cheap; every mutation goes through
   * `save`, which writes atomically.
   */
  const stateHandle = {
    load: async () => (await readState(ctx, { legacyRemovals: legacyLedger })).state,
    save: async (next) => await writeState(ctx, next),
    describe: async () => {
      const result = await readState(ctx, { legacyRemovals: legacyLedger });
      return {
        path: result.path,
        via: result.via,
        existed: result.existed,
        error: result.error,
        migrated: result.migrated,
        quarantine: result.state.quarantine.length,
        baselines: Object.keys(result.state.baseline).length,
      };
    },
  };

  const workspaces = () => {
    const registry = ctx.get('workspaceRegistry');
    try {
      return registry?.list?.() ?? [];
    } catch (error) {
      log('warn', `workspace listing failed: ${String(error?.message ?? error)}`);
      return [];
    }
  };

  /** Roots we can enumerate ourselves, without a skill-service root API. */
  const candidateRoots = () => {
    const roots = [];
    const dshHome = (process.env.DSH_HOME ?? '').trim() !== '' ? process.env.DSH_HOME.trim() : join(homedir(), '.dsh');
    roots.push({ path: join(dshHome, 'skills'), source: 'user-dsh' });
    const agentsHome = (process.env.DSH_AGENTS_HOME ?? '').trim() !== '' ? process.env.DSH_AGENTS_HOME.trim() : join(homedir(), '.agents');
    roots.push({ path: join(agentsHome, 'skills'), source: 'user-agents' });
    for (const workspace of workspaces()) {
      const cwd = workspace?.path;
      if (typeof cwd !== 'string' || cwd === '') continue;
      roots.push({ path: join(cwd, '.dsh', 'skills'), source: 'project-dsh' });
      roots.push({ path: join(cwd, '.agents', 'skills'), source: 'project-agents' });
    }
    return roots;
  };

  const snapshot = async (skills, options) => {
    try {
      const result = await skills.snapshot(options);
      return Array.isArray(result?.skills) ? result.skills : [];
    } catch (error) {
      log('warn', `skill snapshot failed: ${String(error?.message ?? error)}`);
      return [];
    }
  };

  /**
   * The provider invalidates discovery from filesystem watchers, so the service can
   * still answer with the pre-move catalog for a moment after a move. Poll until the
   * catalog agrees, bounded, so a caller never sees a skill that is already gone.
   */
  const waitForCatalog = async (name, shouldExist, budgetMs = 8000, stepMs = 250) => {
    const skills = ctx.get('skills');
    if (skills === undefined) return false;
    const deadline = Date.now() + budgetMs;
    for (;;) {
      const present = (await snapshot(skills, {})).some((item) => item?.name === name);
      if (present === shouldExist) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, stepMs));
    }
  };

  /** Live skills across the global layer plus every registered workspace. */
  const collect = async () => {
    const skills = ctx.get('skills');
    if (skills === undefined) return { ok: false, error: 'skills service unavailable' };
    const byName = new Map();
    const absorb = (summary, workspace) => {
      const name = summary?.name;
      if (typeof name !== 'string' || name === '') return;
      let record = byName.get(name);
      if (record === undefined) {
        const source = typeof summary.source === 'string' ? summary.source : 'custom';
        const location = locationOf(summary);
        const uninstallable = location !== undefined && UNINSTALLABLE_SOURCES.has(source);
        record = {
          name,
          description: typeof summary.description === 'string' ? summary.description : '',
          whenToUse: typeof summary.whenToUse === 'string' ? summary.whenToUse : null,
          invocation: {
            modelInvocable: summary.invocation?.modelInvocable !== false,
            userInvocable: summary.invocation?.userInvocable !== false,
          },
          source,
          provider: typeof summary.provider === 'string' ? summary.provider : '',
          path: typeof summary.path === 'string' ? summary.path : null,
          dir: location !== undefined && location.kind === 'dir' ? location.from : null,
          root: location !== undefined ? location.root : null,
          kind: location !== undefined ? location.kind : null,
          needsConfirm: PROJECT_SOURCES.has(source),
          uninstallable,
          blockedReason: uninstallable
            ? null
            : location === undefined
              ? 'plugin-provided: no directory of its own; uninstall the owning plugin instead'
              : `source "${source}" is not managed by this console`,
          sources: [],
          workspaces: [],
        };
        byName.set(name, record);
      }
      if (typeof summary.source === 'string' && !record.sources.includes(summary.source)) record.sources.push(summary.source);
      if (typeof workspace === 'string' && !record.workspaces.includes(workspace)) record.workspaces.push(workspace);
    };

    for (const summary of await snapshot(skills, {})) absorb(summary, undefined);
    const labels = [];
    for (const workspace of workspaces()) {
      const cwd = workspace?.path;
      if (typeof cwd !== 'string' || cwd === '') continue;
      const label = typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : cwd;
      labels.push(label);
      for (const summary of await snapshot(skills, { cwd })) absorb(summary, label);
    }

    const list = [...byName.values()].map((record) => ({ ...record, conflict: record.sources.length > 1 }));
    list.sort((left, right) => left.name.localeCompare(right.name));
    return { ok: true, skills: list, workspaces: labels };
  };

  const flows = createFlows({ cli, upstream, log, collect, waitForCatalog, roots: candidateRoots, state: stateHandle });

  /**
   * Health work is deliberately limited to the global roots. Project-level skills live
   * in the user's repositories, and this console does not reach into those on its own.
   */
  const healthRoots = () => candidateRoots().filter((root) => root.source === 'user-dsh' || root.source === 'user-agents');

  const healthScan = async () => await scanRoots(healthRoots());

  /**
   * Paths the user has restored during this plugin instance.
   *
   * Restoring is a deliberate "keep this, I know" action, so the automation must not
   * undo it on the next page load — otherwise restore would look broken. The set lasts
   * for the life of this plugin instance; toggling the automation (either way) clears
   * it, and a DSH restart clears it too.
   *
   * @type {Set<string>}
   */
  const restoredPaths = new Set();

  /**
   * The one place this plugin acts without being asked, and only while the user has
   * switched it on: move every finding out of discovery, using the same reversible
   * quarantine as a manual uninstall, and report exactly what was moved.
   *
   * @param {object[]} findings
   * @returns {Promise<Array<{ name: string, to: string | null, problems: string[], skipped?: string }>>}
   */
  const runAutoQuarantine = async (findings) => {
    const moved = [];
    for (const finding of findings) {
      const key = finding.dir ?? finding.path;
      if (restoredPaths.has(key)) {
        moved.push({ name: finding.name, to: null, problems: finding.problems.map((entry) => entry.code), skipped: 'restored by you' });
        continue;
      }
      try {
        const result = await flows.quarantineSkill(
          {
            name: finding.name,
            dir: finding.dir,
            path: finding.path,
            root: finding.root,
            source: finding.source,
            kind: finding.kind,
          },
          'auto',
          'user',
        );
        moved.push({ name: result.name, to: result.to, problems: finding.problems.map((entry) => entry.code) });
        log('info', `auto-quarantined a skill DSH cannot load: ${finding.path}`);
      } catch (error) {
        log('warn', `auto-quarantine failed for ${finding.path}: ${String(error?.message ?? error)}`);
      }
    }
    return moved;
  };

  /** Quarantined items: the state file first, then whatever a scan still finds. */
  const collectRemoved = async () => {
    const state = await stateHandle.load();
    const byTarget = new Map();
    for (const entry of state.quarantine) byTarget.set(entry.to, { ...entry, inLedger: true });
    for (const root of candidateRoots()) {
      const dirs = [join(root.path, SYSTEM_DIR), join(dirname(root.path), QUARANTINE_DIR, basename(root.path))];
      for (const dir of dirs) {
        for (const entry of await readDirSafe(dir)) {
          const target = join(dir, entry.name);
          if (byTarget.has(target)) continue;
          byTarget.set(target, {
            name: entry.name,
            from: join(root.path, entry.name),
            to: target,
            source: root.source,
            kind: entry.isDirectory() ? 'dir' : 'file',
            at: null,
            reason: 'manual',
            inLedger: false,
          });
        }
      }
      for (const entry of await readDirSafe(root.path)) {
        if (!entry.isFile() || !entry.name.endsWith(`.md${FLAT_SUFFIX}`)) continue;
        const original = entry.name.slice(0, -FLAT_SUFFIX.length);
        const target = join(root.path, entry.name);
        if (byTarget.has(target)) continue;
        byTarget.set(target, {
          name: original.replace(/\.md$/i, ''),
          from: join(root.path, original),
          to: target,
          source: root.source,
          kind: 'file',
          at: null,
          reason: 'manual',
          inLedger: false,
        });
      }
    }
    const removed = [];
    for (const entry of byTarget.values()) removed.push({ ...entry, present: await exists(entry.to) });
    removed.sort((left, right) => String(right.at ?? '').localeCompare(String(left.at ?? '')) || left.name.localeCompare(right.name));
    return removed;
  };

  /**
   * Enrich the DSH catalog with what only the CLI lock, our own baseline and upstream
   * know: where a skill came from, whether it was edited here, whether it moved on.
   */
  const enrich = async (skills, checkUpdates) => {
    const dirs = new Map();
    for (const skill of skills) {
      if (typeof skill.dir === 'string' && skill.dir !== '') dirs.set(skill.name, skill.dir);
    }
    try {
      return await buildInventory({ cli, upstream, state: await stateHandle.load(), dirs, checkUpdates, log });
    } catch (error) {
      log('warn', `inventory failed: ${String(error?.message ?? error)}`);
      return {
        entries: new Map(),
        env: { available: false, error: String(error?.message ?? error) },
        warnings: [],
        lockPath: cliLockPath(),
        diagnostics: [],
      };
    }
  };

  const uninstall = async (name, confirm) => {
    if (typeof name !== 'string' || name === '') throw new Error('uninstall requires a skill name');
    const data = await collect();
    if (data.ok === false) throw new Error(data.error);
    const record = data.skills.find((skill) => skill.name === name);
    if (record === undefined) throw new Error(`no live skill named "${name}"`);
    if (record.uninstallable !== true) throw new Error(record.blockedReason ?? 'this skill cannot be uninstalled here');
    if (record.needsConfirm === true && confirm !== true) {
      throw new Error(`confirm required: this would modify ${String(record.root ?? 'the project')}`);
    }
    const moved = await flows.quarantineSkill(record, 'manual', 'user');
    const settled = await waitForCatalog(name, false);
    return { ...moved, settled };
  };

  const restore = async (target) => await flows.restoreItem(target);

  /** Search + preview, the read-only half of the discover tab. */
  const preview = async (id) => {
    const parsed = parseRegistryId(id);
    const resolved = await upstream.resolveSkill({ owner: parsed.owner, repo: parsed.repo, skillId: parsed.skillId });
    if (resolved.ok !== true) return { ok: false, id, error: resolved.error };
    const [markdown, security] = await Promise.all([
      upstream.skillMarkdown({ owner: parsed.owner, repo: parsed.repo, ref: resolved.ref, dir: resolved.dir }),
      upstream.security(id),
    ]);
    return {
      ok: true,
      id,
      source: parsed.source,
      skillId: parsed.skillId,
      ref: resolved.ref,
      dir: resolved.dir,
      files: resolved.files,
      markdown: markdown.ok ? markdown.text : null,
      markdownError: markdown.error,
      security: { snyk: security.snyk, socket: security.socket },
    };
  };

  const send = (response, statusCode, value) => {
    response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(value));
  };

  const payload = async (options = {}) => {
    const data = await collect();
    if (data.ok === false) return data;
    const removed = await collectRemoved();
    const inventory = await enrich(data.skills, options.checkUpdates === true);
    const skills = data.skills.map((skill) => {
      const info = inventory.entries.get(skill.name);
      return {
        ...skill,
        origin: info?.lock?.source ?? info?.baseline?.source ?? null,
        originUrl: info?.lock?.sourceUrl ?? null,
        skillPath: info?.lock?.skillPath ?? info?.baseline?.skillPath ?? null,
        installedAt: info?.lock?.installedAt ?? info?.baseline?.installedAt ?? null,
        updatedAt: info?.lock?.updatedAt ?? info?.baseline?.updatedAt ?? null,
        installedBy: info?.baseline?.by ?? null,
        drift: info?.drift ?? 'unknown',
        update: info?.update ?? { status: 'unknown', reason: 'not checked' },
        contentHash: info?.contentHash ?? null,
      };
    });
    const state = await stateHandle.describe();
    const current = await stateHandle.load();
    const scan = await healthScan();
    let findings = scan.findings;
    let autoReport = null;
    if (current.auto.enabled === true && scan.findings.length > 0) {
      autoReport = await runAutoQuarantine(scan.findings);
      findings = (await healthScan()).findings;
    }
    return {
      ok: true,
      skills,
      workspaces: data.workspaces,
      removed,
      env: inventory.env,
      node: await cli.detectNode(),
      ui: { locale: current.ui?.locale ?? 'auto' },
      warnings: inventory.warnings ?? [],
      cliDiagnostics: inventory.diagnostics ?? [],
      health: {
        findings,
        scanned: scan.scanned,
        errors: scan.errors,
        auto: { enabled: current.auto.enabled === true, rehearsalConfirmed: current.auto.rehearsalConfirmed === true },
        autoReport,
        roots: healthRoots().map((root) => ({ path: root.path, source: root.source })),
      },
      integration: {
        lockPath: inventory.lockPath ?? cliLockPath(),
        statePath: state.path,
        stateVia: state.via,
        stateExisted: state.existed,
        stateError: state.error,
        migrated: state.migrated,
        checkedAt: inventory.checkedAt ?? null,
      },
      stats: {
        total: skills.length,
        uninstallable: skills.filter((skill) => skill.uninstallable).length,
        blocked: skills.filter((skill) => !skill.uninstallable).length,
        removed: removed.length,
        modified: skills.filter((skill) => skill.drift === 'modified').length,
        upgradable: skills.filter((skill) => skill.update?.status === 'available').length,
        findings: findings.length,
      },
    };
  };

  // Boot order matters: this plugin's fiber can start before the webserver's, so
  // wait for the service through dependency injection instead of reading it once
  // and giving up. Reading it once caused a 404 after every DSH restart.
  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(() =>
      scoped.webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: async (request, response) => {
          try {
            if (request.method === 'GET' || request.method === 'HEAD') {
              const data = await payload();
              return send(response, data.ok === false ? 503 : 200, data);
            }
            if (request.method !== 'POST') {
              response.writeHead(405, { allow: 'GET, HEAD, POST' });
              response.end();
              return;
            }
            if (sameOrigin(request) === false) return send(response, 403, { ok: false, error: 'cross-origin request refused' });

            const body = await readJson(request);
            const action = body?.action;
            const by = body?.by === 'ai' ? 'ai' : 'user';
            let result;
            let refresh = { checkUpdates: false };
            switch (action) {
              case 'uninstall':
                result = await uninstall(body?.name, body?.confirm === true);
                break;
              case 'restore': {
                result = await restore(body?.target);
                if (typeof result?.from === 'string' && result.from !== '') restoredPaths.add(result.from);
                // A skill DSH cannot load will never appear in the catalog, so waiting for
                // it would report a phantom "refresh pending". Say what is actually true.
                const afterRestore = await healthScan();
                if (afterRestore.findings.some((entry) => (entry.dir ?? entry.path) === result?.from)) {
                  result = { ...result, settled: true, catalogExpected: false };
                }
                break;
              }
              case 'env-check':
                result = { cli: await cli.detect({ force: true }), node: await cli.detectNode() };
                break;
              case 'set-ui': {
                const currentState = await stateHandle.load();
                currentState.ui = { locale: body?.locale === 'zh' || body?.locale === 'en' ? body.locale : 'auto' };
                await stateHandle.save(currentState);
                result = { ui: currentState.ui };
                break;
              }
              case 'export-state': {
                const currentState = await stateHandle.load();
                const described = await stateHandle.describe();
                result = {
                  filename: `dsh-skillbox-state-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`,
                  path: described.path,
                  data: currentState,
                };
                break;
              }
              case 'import-state': {
                let incoming = body?.data;
                if (typeof incoming === 'string') {
                  try {
                    incoming = JSON.parse(incoming);
                  } catch (error) {
                    throw new Error(`the pasted JSON could not be parsed: ${String(error?.message ?? error)}`);
                  }
                }
                if (incoming === null || typeof incoming !== 'object') throw new Error('import needs a state object');
                const next = normalizeState(incoming);
                await stateHandle.save(next);
                result = {
                  imported: true,
                  baseline: Object.keys(next.baseline).length,
                  quarantine: next.quarantine.length,
                  auto: next.auto,
                  ui: next.ui,
                };
                break;
              }
              case 'search':
                result = await upstream.search(body?.query, { limit: body?.limit, owner: body?.owner });
                break;
              case 'preview':
                result = await preview(body?.id);
                break;
              case 'install':
                result = await flows.installFromRegistry(body?.id, by);
                break;
              case 'check-updates':
                refresh = { checkUpdates: true };
                result = { checked: true };
                break;
              case 'upgrade-plan':
                refresh = { checkUpdates: true };
                result = await flows.planUpgrades({ names: body?.names, force: body?.force === true });
                break;
              case 'upgrade':
                result = await flows.upgradeOne(body?.name, { force: body?.force === true, by });
                break;
              case 'upgrade-all':
                refresh = { checkUpdates: true };
                result = await flows.upgradeAll({ force: body?.force === true, by });
                break;
              case 'health-scan': {
                const scan = await healthScan();
                result = { findings: scan.findings, scanned: scan.scanned, errors: scan.errors };
                break;
              }
              case 'health-rehearsal': {
                // Listing what would move is the gate for switching the automation on.
                const scan = await healthScan();
                const current = await stateHandle.load();
                current.auto.rehearsalConfirmed = true;
                await stateHandle.save(current);
                result = { findings: scan.findings, scanned: scan.scanned, wouldMove: scan.findings.length };
                break;
              }
              case 'auto-quarantine': {
                const enabled = body?.enabled === true;
                const current = await stateHandle.load();
                if (enabled && current.auto.rehearsalConfirmed !== true) {
                  throw new Error('run the rehearsal first — it lists exactly what would be moved');
                }
                current.auto.enabled = enabled;
                await stateHandle.save(current);
                // Any change of the switch is a fresh start for "restored by you".
                restoredPaths.clear();
                const moved = enabled ? await runAutoQuarantine((await healthScan()).findings) : [];
                result = { enabled, moved };
                break;
              }
              case 'quarantine-bad': {
                const scan = await healthScan();
                const wanted = typeof body?.path === 'string' ? body.path : null;
                const target =
                  (wanted === null ? undefined : scan.findings.find((entry) => entry.path === wanted)) ??
                  scan.findings.find((entry) => entry.name === body?.name);
                if (target === undefined) throw new Error('that finding is gone — rescan the health tab');
                result = await flows.quarantineSkill(
                  { name: target.name, dir: target.dir, path: target.path, root: target.root, source: target.source, kind: target.kind },
                  'manual',
                  by,
                );
                break;
              }
              default:
                throw new Error(`unknown action: ${String(action)}`);
            }
            const data = await payload(refresh);
            send(response, 200, { ...data, result });
          } catch (error) {
            send(response, 400, { ok: false, error: String(error?.message ?? error) });
          }
        },
      }),
    );
  });

  log('info', `active; route ${ROUTE}; v0.3.0; ${String(legacyLedger.length)} legacy removal(s) to migrate`);
}
