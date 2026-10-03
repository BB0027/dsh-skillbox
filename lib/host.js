/**
 * dsh-skillbox — Host half (v0.2.0).
 *
 * v0.2.0 changes the model from "disable" to "UNINSTALL": a skill leaves
 * discovery by MOVING into a quarantine location. Nothing is ever deleted.
 *
 *   - `user-dsh` skills move to `<root>/.system/<name>`. That root is declared
 *     with `skipSystem: true` by @deepseek-ai/dsh-skill-filesystem, whose root
 *     scan skips a top-level `.system` entry — so DSH stops seeing the skill
 *     while the directory stays on the same volume for a one-click restore.
 *   - every other writable root (`user-agents`, `project-dsh`, `project-agents`,
 *     `custom`) moves to `<root>/../.skill-console-removed/<root name>/<name>`,
 *     which sits outside the scanned root.
 *   - a flat `<name>.md` skill is renamed to `<name>.md.removed`, so it no longer
 *     matches the provider's `.md` entry test.
 *
 * Plugin-provided skills (`bundled` from dsh-office / dsh-feishu-config / …, and
 * `runtime`) own no path: they are reported as not uninstallable and the UI
 * disables their button with a reason.
 *
 * Every move is recorded in this plugin's profile-entry config (`removedSkills`)
 * so a restore never depends on rediscovering a root; the page additionally scans
 * the quarantine locations, so records survive a config reset.
 *
 * Project sources need an explicit confirmation from the caller, and the UI shows
 * the repository path before asking for it.
 */

import { mkdir, readdir, rename, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';

const PKG = 'dsh-skillbox';
const ROUTE = '/plugins/dsh-skillbox/skills';
const LEDGER_KEY = 'removedSkills';
const SYSTEM_DIR = '.system';
const QUARANTINE_DIR = '.skill-console-removed';
const FLAT_SUFFIX = '.removed';
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

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readDirSafe(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** On-disk location of a live skill, or undefined for plugin-provided ones. */
function locationOf(summary) {
  const path = typeof summary.path === 'string' ? summary.path : undefined;
  if (path === undefined) return undefined;
  const base = summary.resourceBase;
  const baseDir =
    base !== null && typeof base === 'object' && base.kind === 'directory' && typeof base.path === 'string' ? base.path : undefined;
  if (/\.md$/i.test(path) && !/(^|[\\/])SKILL\.md$/i.test(path)) {
    return { kind: 'file', root: baseDir ?? dirname(path), from: path };
  }
  if (baseDir === undefined) return undefined;
  return { kind: 'dir', root: dirname(baseDir), from: baseDir };
}

/** Where an uninstalled skill is parked: never inside the scanned root. */
function quarantineTarget(location, source, name) {
  if (location.kind === 'file') return `${location.from}${FLAT_SUFFIX}`;
  if (source === 'user-dsh') return join(location.root, SYSTEM_DIR, name);
  return join(dirname(location.root), QUARANTINE_DIR, basename(location.root), name);
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ removedSkills?: unknown[] } | undefined} config
 */
export function apply(ctx, config) {
  let ledger = normalizeLedger(config?.[LEDGER_KEY]);
  const status = { persisted: null, persistError: null, lastWrite: null };

  const log = (level, message) => {
    try {
      const logger = ctx.logger;
      if (logger !== undefined && typeof logger[level] === 'function') logger[level](`[${PKG}] ${message}`);
    } catch {
      /* logging is best-effort */
    }
  };

  const findOwnEntry = (configEditor) => {
    let entries = [];
    try {
      entries = configEditor.entries() ?? [];
    } catch (error) {
      log('warn', `configEditor.entries() failed: ${String(error?.message ?? error)}`);
      return undefined;
    }
    for (const entry of entries) {
      const options = entry?.options ?? {};
      if (options.name === PKG) return entry;
      if (options.id === 'skill-console' && (options.name === undefined || options.name === PKG)) return entry;
    }
    return undefined;
  };

  const persist = async () => {
    const configEditor = ctx.get('configEditor');
    if (configEditor === undefined) {
      status.persisted = false;
      status.persistError = 'config editor unavailable';
      return false;
    }
    const entry = findOwnEntry(configEditor);
    if (entry === undefined) {
      status.persisted = false;
      status.persistError = 'own profile entry not found';
      log('warn', status.persistError);
      return false;
    }
    try {
      await configEditor.edit(entry, (current) => {
        const next = { ...(current ?? {}), [LEDGER_KEY]: ledger };
        // v0.1.0's disable policy is gone; drop its key instead of carrying it forever.
        delete next.disabledSkills;
        return next;
      });
      status.persisted = true;
      status.persistError = null;
      status.lastWrite = new Date().toISOString();
      return true;
    } catch (error) {
      status.persisted = false;
      status.persistError = String(error?.message ?? error);
      log('warn', `persist failed: ${status.persistError}`);
      return false;
    }
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
  const waitForCatalog = async (name, shouldExist, budgetMs = 6000, stepMs = 250) => {
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

  /** Quarantined items: the ledger first, then whatever a scan still finds. */
  const collectRemoved = async () => {
    const byTarget = new Map();
    for (const entry of ledger) byTarget.set(entry.to, { ...entry, inLedger: true });
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
          inLedger: false,
        });
      }
    }
    const removed = [];
    for (const entry of byTarget.values()) removed.push({ ...entry, present: await exists(entry.to) });
    removed.sort((left, right) => String(right.at ?? '').localeCompare(String(left.at ?? '')) || left.name.localeCompare(right.name));
    return removed;
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
    const skills = ctx.get('skills');
    const summary = (await snapshot(skills, {})).find((item) => item?.name === name);
    const location = summary === undefined ? undefined : locationOf(summary);
    if (location === undefined) throw new Error('the skill has no on-disk location any more');
    if ((await exists(location.from)) !== true) throw new Error(`the skill location is missing: ${location.from}`);
    const desired = quarantineTarget(location, record.source, name);
    const target = (await exists(desired)) ? `${desired}-${String(Date.now())}` : desired;
    await mkdir(dirname(target), { recursive: true });
    await rename(location.from, target);
    const settled = await waitForCatalog(name, false);
    ledger = ledger.filter((entry) => entry.to !== target && entry.name !== name);
    ledger.push({ name, from: location.from, to: target, source: record.source, kind: location.kind, at: new Date().toISOString() });
    log('info', `uninstalled "${name}": ${location.from} -> ${target}`);
    void persist();
    return { name, from: location.from, to: target, source: record.source, kind: location.kind, settled };
  };

  const restore = async (target) => {
    if (typeof target !== 'string' || target === '') throw new Error('restore requires the quarantine path');
    const removed = await collectRemoved();
    const entry = removed.find((item) => item.to === target);
    if (entry === undefined) throw new Error('not a recorded removal');
    if (entry.present !== true) throw new Error('the quarantined item is missing');
    if (await exists(entry.from)) throw new Error(`the original location is occupied: ${entry.from}`);
    await mkdir(dirname(entry.from), { recursive: true });
    await rename(entry.to, entry.from);
    const settled = await waitForCatalog(entry.name, true);
    ledger = ledger.filter((item) => item.to !== target);
    log('info', `restored "${entry.name}": ${entry.to} -> ${entry.from}`);
    void persist();
    return { name: entry.name, from: entry.from, to: entry.to, settled };
  };

  const send = (response, statusCode, value) => {
    response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(value));
  };

  const payload = async () => {
    const data = await collect();
    if (data.ok === false) return data;
    const removed = await collectRemoved();
    return {
      ok: true,
      persisted: status.persisted,
      persistError: status.persistError,
      ...data,
      removed,
      stats: {
        total: data.skills.length,
        uninstallable: data.skills.filter((skill) => skill.uninstallable).length,
        blocked: data.skills.filter((skill) => !skill.uninstallable).length,
        removed: removed.length,
      },
    };
  };

  // Boot order matters: this plugin's fiber can start before the webserver's, so
  // wait for the service through dependency injection instead of reading it once
  // and giving up. Reading it once caused a 404 after every DSH restart until the
  // row was toggled by hand.
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
            let result;
            if (action === 'uninstall') result = await uninstall(body?.name, body?.confirm === true);
            else if (action === 'restore') result = await restore(body?.target);
            else throw new Error(`unknown action: ${String(action)}`);
            // Answer before persisting: a config write re-applies this plugin and
            // would otherwise dispose this route mid-response.
            const data = await payload();
            send(response, 200, { ...data, result });
          } catch (error) {
            send(response, 400, { ok: false, error: String(error?.message ?? error) });
          }
        },
      }),
    );
  });

  log('info', `active; route ${ROUTE}; ${String(ledger.length)} recorded removal(s)`);
}
