/**
 * dsh-skillbox — Operation flows (v0.3.0).
 *
 * The mutating half of the plugin, kept out of the route handler so the rules are
 * readable in one place. Four guarantees hold for everything in this file:
 *
 *   1. **nothing is deleted** — a skill that leaves the catalog is moved into
 *      quarantine, and every move is recorded with a reason;
 *   2. **`SKILL.md` is never edited** — the plugin installs, upgrades, moves and
 *      reports, but it never rewrites a skill's own files;
 *   3. **installs always go to the DSH root** — through `skills add … -a dsh --copy`;
 *   4. **an upgrade either lands or rolls back** — the previous version is moved to
 *      quarantine first, and restored if the install fails.
 *
 * Upgrade decision (docs/SPEC-v0.3.0.md §6): a skill whose files differ from the
 * baseline recorded at install time is *modified locally* and is skipped unless the
 * caller explicitly forces it. The CLI does not make this judgement for us (F5).
 */

import { mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { compareWithBaseline, localContentHash } from './hash.js';
import { buildInventory, readLock } from './registry.js';
import { REASON_UPGRADE_BACKUP, REASON_MANUAL } from './state.js';
import { exists, quarantineTarget } from './paths.js';

/**
 * @param {{
 *   cli: object,
 *   upstream: object,
 *   log: (level: string, message: string) => void,
 *   collect: () => Promise<{ ok: boolean, skills: object[], error?: string }>,
 *   waitForCatalog: (name: string, shouldExist: boolean) => Promise<boolean>,
 *   roots: () => Array<{ path: string, source: string }>,
 *   state: { load: () => Promise<object>, save: (state: object) => Promise<unknown> },
 * }} deps
 */
export function createFlows(deps) {
  const { cli, upstream, log, collect, waitForCatalog, roots, state } = deps;

  /**
   * The DSH skill root — rank 400, the only place this plugin installs to.
   * @returns {string}
   */
  function dshRoot() {
    const root = roots().find((candidate) => candidate.source === 'user-dsh');
    if (root === undefined) throw new Error('the DSH skill root could not be resolved');
    return root.path;
  }

  /**
   * Move a live skill out of discovery, recording why.
   *
   * @param {object} record A record from `collect()`.
   * @param {string} reason One of the `REASON_*` values.
   * @param {'user' | 'ai'} by
   * @returns {Promise<{ name: string, from: string, to: string, source: string, kind: 'dir' | 'file', reason: string, at: string }>}
   */
  async function quarantineSkill(record, reason = REASON_MANUAL, by = 'user') {
    const from = record.kind === 'file' ? record.path : record.dir;
    if (typeof from !== 'string' || from === '') throw new Error(`"${record.name}" has no on-disk location`);
    if ((await exists(from)) !== true) throw new Error(`the skill location is missing: ${from}`);
    const desired = quarantineTarget({ kind: record.kind === 'file' ? 'file' : 'dir', root: record.root, from }, record.source, record.name);
    const target = (await exists(desired)) ? `${desired}-${String(Date.now())}` : desired;
    await mkdir(dirname(target), { recursive: true });
    await rename(from, target);
    const at = new Date().toISOString();
    const current = await state.load();
    current.quarantine = [...current.quarantine.filter((item) => item.to !== target && item.name !== record.name), {
      name: record.name,
      from,
      to: target,
      source: record.source,
      kind: record.kind === 'file' ? 'file' : 'dir',
      at,
      reason,
    }];
    // The skill no longer sits on disk, so its baseline describes nothing. Keeping it
    // would make a later reinstall look "locally modified" against a stale hash.
    delete current.baseline[record.name];
    await state.save(current);
    log('info', `quarantined "${record.name}" (${reason}${by === 'ai' ? ', by ai' : ''}): ${from} -> ${target}`);
    return { name: record.name, from, to: target, source: record.source, kind: record.kind === 'file' ? 'file' : 'dir', reason, at };
  }

  /**
   * Put a quarantined item back where it came from. Refuses if the original location
   * is occupied, because overwriting a live skill is exactly what this plugin promises
   * never to do.
   *
   * @param {string} target Absolute quarantine path.
   * @returns {Promise<{ name: string, from: string, to: string, settled: boolean }>}
   */
  async function restoreItem(target) {
    const current = await state.load();
    const entry = current.quarantine.find((item) => item.to === target);
    if (entry === undefined) throw new Error('not a recorded removal');
    if ((await exists(entry.to)) !== true) throw new Error('the quarantined item is missing');
    if ((await exists(entry.from)) === true) throw new Error(`the original location is occupied: ${entry.from}`);
    await mkdir(dirname(entry.from), { recursive: true });
    await rename(entry.to, entry.from);
    const settled = await waitForCatalog(entry.name, true);
    current.quarantine = current.quarantine.filter((item) => item.to !== target);
    await state.save(current);
    log('info', `restored "${entry.name}": ${entry.to} -> ${entry.from}`);
    return { name: entry.name, from: entry.from, to: entry.to, settled };
  }

  /**
   * Install a registry skill into the DSH root and record its baseline.
   *
   * @param {string} id `owner/repo/skillId` or `owner/repo@skillId`.
   * @param {'user' | 'ai'} by
   * @returns {Promise<object>}
   */
  async function installFromRegistry(id, by = 'user') {
    const parsed = parseRegistryId(id);
    const spec = `${parsed.source}@${parsed.skillId}`;
    const result = await cli.add(spec);
    if (result.ok !== true) {
      throw new Error(`install failed after ${result.attempts} attempt(s): ${result.error ?? 'unknown error'}`);
    }
    const dir = join(dshRoot(), parsed.skillId);
    const settled = await waitForCatalog(parsed.skillId, true);
    const lockEntry = (await readLock())[parsed.skillId] ?? null;
    const skillPath = lockEntry?.skillPath ?? null;
    const reference = await readUpstreamReference({ source: parsed.source, skillPath, ref: lockEntry?.ref ?? null });
    const current = await state.load();
    current.baseline[parsed.skillId] = {
      contentHash: await hashDir(dir),
      source: parsed.source,
      skillPath,
      upstreamTreeHash: reference.upstreamTreeHash,
      upstreamRef: reference.upstreamRef,
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      by,
    };
    await state.save(current);
    log('info', `installed "${parsed.skillId}" from ${parsed.source} into ${dir}`);
    return {
      name: parsed.skillId,
      dir,
      source: parsed.source,
      settled,
      attempts: result.attempts,
      mode: result.entry?.mode ?? null,
      security: result.entry?.security ?? null,
    };
  }

  /**
   * Decide what an upgrade would do, without touching anything.
   *
   * @param {{ names?: string[], force?: boolean }} [options]
   * @returns {Promise<{ items: object[], warnings: string[], env: object }>}
   */
  async function planUpgrades(options = {}) {
    const data = await collect();
    if (data.ok === false) throw new Error(data.error);
    const dirs = new Map();
    for (const skill of data.skills) {
      if (typeof skill.dir === 'string' && skill.dir !== '') dirs.set(skill.name, skill.dir);
    }
    const inventory = await buildInventory({
      cli,
      upstream,
      state: await state.load(),
      dirs,
      checkUpdates: true,
      log,
    });
    const wanted = Array.isArray(options.names) && options.names.length > 0 ? new Set(options.names) : null;
    const force = options.force === true;
    const items = [];
    for (const skill of data.skills) {
      if (wanted !== null && !wanted.has(skill.name)) continue;
      if (skill.uninstallable !== true) continue;
      const info = inventory.entries.get(skill.name);
      const recorded = info?.baseline ?? null;
      const lockEntry = info?.lock ?? null;
      const source = recorded?.source ?? lockEntry?.source ?? null;
      const drift = info?.drift ?? 'unknown';
      const update = info?.update ?? { status: 'unknown', reason: 'not checked' };
      let action = 'skip';
      let reason = null;
      if (source === null) {
        reason = 'no source recorded (installed by hand)';
      } else if (update.status === 'available') {
        if (drift === 'clean' || force) {
          action = 'upgrade';
        } else {
          reason = drift === 'modified' ? 'locally modified — skipped' : 'no baseline to compare against';
        }
      } else if (update.status === 'current') {
        reason = 'already up to date';
      } else {
        reason = update.reason ?? 'update status unknown';
      }
      items.push({ name: skill.name, source, drift, update, action, reason });
    }
    return { items, warnings: inventory.warnings, env: inventory.env };
  }

  /**
   * Upgrade one skill: quarantine the current version, install, roll back on failure.
   *
   * @param {string} name
   * @param {{ force?: boolean, by?: 'user' | 'ai' }} [options]
   * @returns {Promise<object>}
   */
  async function upgradeOne(name, options = {}) {
    const force = options.force === true;
    const by = options.by ?? 'user';
    const data = await collect();
    if (data.ok === false) throw new Error(data.error);
    const record = data.skills.find((skill) => skill.name === name);
    if (record === undefined) throw new Error(`no live skill named "${name}"`);
    if (record.uninstallable !== true) throw new Error(record.blockedReason ?? 'this skill cannot be upgraded here');

    const current = await state.load();
    const recorded = current.baseline[name] ?? null;
    const lockEntry = (await readLock())[name] ?? null;
    const source = recorded?.source ?? lockEntry?.source ?? null;
    if (source === null) return { name, status: 'skipped', reason: 'no source recorded (installed by hand)' };

    const drift = recorded === null ? 'unknown' : await compareWithBaseline(record.dir, recorded.contentHash);
    if (drift !== 'clean' && force !== true) {
      return {
        name,
        status: 'skipped',
        drift,
        reason: drift === 'modified' ? 'locally modified — skipped' : 'no baseline to compare against',
      };
    }

    const moved = await quarantineSkill(record, REASON_UPGRADE_BACKUP, by);
    const result = await cli.add(`${source}@${name}`);
    if (result.ok !== true) {
      let rolledBack = false;
      try {
        await restoreItem(moved.to);
        rolledBack = true;
      } catch (error) {
        log('warn', `rollback of "${name}" failed: ${String(error?.message ?? error)}`);
      }
      return { name, status: 'failed', error: result.error ?? 'install failed', attempts: result.attempts, rolledBack, quarantine: moved.to };
    }

    const settled = await waitForCatalog(name, true);
    const freshLock = (await readLock())[name] ?? null;
    const skillPath = freshLock?.skillPath ?? recorded?.skillPath ?? null;
    const reference = await readUpstreamReference({ source, skillPath, ref: freshLock?.ref ?? recorded?.upstreamRef ?? null });
    const refreshed = await state.load();
    refreshed.baseline[name] = {
      contentHash: await hashDir(record.dir),
      source,
      skillPath,
      upstreamTreeHash: reference.upstreamTreeHash,
      upstreamRef: reference.upstreamRef,
      installedAt: refreshed.baseline[name]?.installedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      by,
    };
    await state.save(refreshed);
    log('info', `upgraded "${name}" from ${source}; previous version at ${moved.to}`);
    return {
      name,
      status: 'upgraded',
      source,
      settled,
      attempts: result.attempts,
      quarantine: moved.to,
      security: result.entry?.security ?? null,
    };
  }

  /**
   * Upgrade everything the plan marks as upgradeable, one at a time, stopping at the
   * first failure so a broken source cannot cascade.
   *
   * @param {{ force?: boolean, by?: 'user' | 'ai' }} [options]
   * @returns {Promise<{ plan: object, results: object[] }>}
   */
  async function upgradeAll(options = {}) {
    const plan = await planUpgrades({ force: options.force });
    const results = [];
    for (const item of plan.items) {
      if (item.action !== 'upgrade') {
        results.push({ name: item.name, status: 'skipped', reason: item.reason });
        continue;
      }
      const result = await upgradeOne(item.name, { force: options.force, by: options.by });
      results.push(result);
      if (result.status === 'failed') break;
    }
    return { plan, results };
  }

  /**
   * @param {string} dir
   * @returns {Promise<string | null>}
   */
  async function hashDir(dir) {
    try {
      return await localContentHash(dir);
    } catch {
      return null;
    }
  }

  /**
   * The upstream git tree SHA of the revision just installed — the reference every
   * later update check compares against. Recording it here is what makes update
   * detection reliable: the CLI lock's hashes are unusable on Windows, because the CLI
   * writes CRLF-converted bytes while the lock holds a hash of its own payload
   * (docs/SPEC-v0.3.0.md F3/F4).
   *
   * @param {{ source: string | null, skillPath: string | null, ref: string | null }} request
   * @returns {Promise<{ upstreamTreeHash: string | null, upstreamRef: string | null }>}
   */
  async function readUpstreamReference(request) {
    const { source, skillPath, ref } = request;
    if (typeof source !== 'string' || source === '' || typeof skillPath !== 'string' || skillPath === '') {
      return { upstreamTreeHash: null, upstreamRef: null };
    }
    const [owner, repo] = source.split('/');
    if (owner === undefined || repo === undefined) return { upstreamTreeHash: null, upstreamRef: null };
    try {
      const result = await upstream.treeHash({ owner, repo, ref, skillPath });
      if (result.ok === true && typeof result.sha === 'string') {
        return { upstreamTreeHash: result.sha, upstreamRef: result.ref ?? null };
      }
      log('warn', `upstream reference unavailable for ${source}: ${String(result.error ?? 'unknown')}`);
    } catch (error) {
      log('warn', `upstream reference failed for ${source}: ${String(error?.message ?? error)}`);
    }
    return { upstreamTreeHash: null, upstreamRef: null };
  }

  return { dshRoot, quarantineSkill, restoreItem, installFromRegistry, planUpgrades, upgradeOne, upgradeAll };
}

/**
 * Parse a registry id into a source and a skill id.
 *
 * @param {string} id `owner/repo/skillId`, `owner/repo@skillId`, or a skills.sh URL.
 * @returns {{ owner: string, repo: string, source: string, skillId: string }}
 */
export function parseRegistryId(id) {
  const text = String(id ?? '').trim();
  if (text === '') throw new Error('a skill id is required');
  const fromUrl = /^https?:\/\/skills\.sh\/(.+)$/u.exec(text);
  const body = fromUrl === null ? text : fromUrl[1];
  const at = body.indexOf('@');
  if (at > 0) {
    const source = body.slice(0, at);
    const skillId = body.slice(at + 1);
    const [owner, repo] = source.split('/');
    if (!owner || !repo || skillId === '') throw new Error(`unrecognised skill id "${id}"`);
    return { owner, repo, source: `${owner}/${repo}`, skillId };
  }
  const parts = body.split('/').filter((part) => part !== '');
  if (parts.length < 3) throw new Error(`skill id must be <owner>/<repo>/<skillId>, received "${id}"`);
  return { owner: parts[0], repo: parts[1], source: `${parts[0]}/${parts[1]}`, skillId: parts[parts.length - 1] };
}
