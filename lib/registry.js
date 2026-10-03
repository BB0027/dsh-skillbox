/**
 * dsh-skillbox — Inventory assembly (v0.3.0).
 *
 * One place that answers, per installed skill: where it came from, which upstream
 * revision it was taken from, whether it has been edited locally since, and whether
 * upstream has moved on. Three sources are merged and each one is labelled, because
 * they disagree in useful ways:
 *
 *   1. the DSH catalog   — what the Harness actually resolves, and where it lives;
 *   2. the CLI lock      — `source`, `skillPath`, `skillFolderHash` (upstream git tree
 *                          SHA), install/update timestamps, for CLI-managed skills;
 *   3. our own baseline  — content hash captured when this plugin last wrote a skill,
 *                          which is the only way to notice local edits (the CLI does
 *                          not track them; docs/SPEC-v0.3.0.md F5).
 *
 * Update checks cost GitHub API calls, so they are opt-in: the page loads the cheap
 * view and the user presses "check for updates".
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { compareWithBaseline, localContentHash } from './hash.js';

/**
 * Path of the CLI's lock file, mirroring the CLI's own resolution.
 *
 * @returns {string}
 */
export function lockPath() {
  const xdg = typeof process.env.XDG_STATE_HOME === 'string' ? process.env.XDG_STATE_HOME.trim() : '';
  if (xdg !== '') return join(xdg, 'skills', '.skill-lock.json');
  return join(homedir(), '.agents', '.skill-lock.json');
}

/**
 * @returns {Promise<Record<string, object>>} `skills` map from the CLI lock, or `{}`.
 */
export async function readLock() {
  try {
    const parsed = JSON.parse(await readFile(lockPath(), 'utf8'));
    if (parsed === null || typeof parsed !== 'object') return {};
    if (parsed.skills === null || typeof parsed.skills !== 'object') return {};
    return parsed.skills;
  } catch {
    return {};
  }
}

/**
 * Build the merged inventory.
 *
 * @param {{
 *   cli: ReturnType<typeof import('./cli.js').createSkillsCli>,
 *   upstream: ReturnType<typeof import('./upstream.js').createUpstream>,
 *   state: object,
 *   dirs: Map<string, string>,
 *   checkUpdates?: boolean,
 *   log?: (level: string, message: string) => void,
 * }} request
 * @returns {Promise<{ entries: Map<string, object>, env: object, warnings: string[], checkedAt: string }>}
 */
export async function buildInventory(request) {
  const { cli, upstream, state, dirs } = request;
  const log = typeof request.log === 'function' ? request.log : () => {};
  const checkUpdates = request.checkUpdates === true;
  const warnings = [];

  const env = await cli.detect();
  const listing = env.available ? await cli.list() : { ok: false, skills: [], diagnostics: [], error: 'CLI unavailable' };
  if (env.available && listing.ok === false) warnings.push(`skills ls failed: ${listing.error}`);
  if (env.available && env.patchApplied === false) {
    warnings.push('skills CLI no longer carries the dsh agent patch — re-run scripts/patch-skills-cli-dsh.ps1');
  }
  const listed = new Map();
  for (const item of listing.skills ?? []) {
    if (typeof item?.name === 'string') listed.set(item.name, item);
  }

  const lock = await readLock();
  const baseline = state?.baseline ?? {};

  /** @type {Map<string, object>} */
  const entries = new Map();
  for (const [name, dir] of dirs.entries()) {
    const lockEntry = lock[name] ?? null;
    const recorded = baseline[name] ?? null;
    const drift = await resolveDrift(dir, recorded);
    entries.set(name, {
      name,
      dir,
      onDisk: true,
      cli: listed.get(name) ?? null,
      lock:
        lockEntry === null
          ? null
          : {
              source: lockEntry.source ?? null,
              sourceType: lockEntry.sourceType ?? null,
              sourceUrl: lockEntry.sourceUrl ?? null,
              skillPath: lockEntry.skillPath ?? null,
              skillFolderHash: lockEntry.skillFolderHash ?? null,
              ref: lockEntry.ref ?? null,
              installedAt: lockEntry.installedAt ?? null,
              updatedAt: lockEntry.updatedAt ?? null,
            },
      baseline: recorded,
      drift,
      update: { status: 'unknown', reason: 'not checked' },
      contentHash: await safeHash(dir),
    });
  }

  if (checkUpdates) {
    await attachUpdates({ entries, upstream, warnings, log });
  }

  return { entries, env, warnings, checkedAt: new Date().toISOString(), lockPath: lockPath(), diagnostics: listing.diagnostics ?? [] };
}

/**
 * Compare each skill's recorded upstream revision with the current one.
 *
 * One GitHub tree request per repository+ref serves every skill from that repository,
 * and the result is cached inside the upstream module for a few minutes.
 *
 * @param {{ entries: Map<string, object>, upstream: object, warnings: string[], log: Function }} request
 */
async function attachUpdates({ entries, upstream, warnings, log }) {
  let rateLimited = false;
  for (const entry of entries.values()) {
    const lock = entry.lock;
    const baseline = entry.baseline;
    const source =
      typeof lock?.source === 'string' && lock.source !== ''
        ? lock.source
        : typeof baseline?.source === 'string' && baseline.source !== ''
          ? baseline.source
          : null;
    if (source === null) {
      entry.update = { status: 'untracked', reason: 'no source recorded (installed by hand)' };
      continue;
    }
    const [owner, repo] = source.split('/');
    if (owner === undefined || repo === undefined || owner === '' || repo === '') {
      entry.update = { status: 'untracked', reason: `unrecognised source "${source}"` };
      continue;
    }
    const skillPath =
      typeof lock?.skillPath === 'string' && lock.skillPath !== ''
        ? lock.skillPath
        : typeof baseline?.skillPath === 'string' && baseline.skillPath !== ''
          ? baseline.skillPath
          : null;
    if (skillPath === null) {
      entry.update = { status: 'unknown', reason: 'no upstream path recorded' };
      continue;
    }

    // The reference is the upstream git tree SHA of the version that was installed.
    // It is recorded by this plugin at install/upgrade time; a 40-hex value in the CLI
    // lock (written by a CLI check/update cycle) is equivalent. The lock's 64-hex
    // values are NOT usable here: they are hashes of the CLI's cloned payload, whose
    // bytes differ from upstream on Windows (CRLF) and from what is on disk.
    const reference =
      typeof baseline?.upstreamTreeHash === 'string' && /^[0-9a-f]{40}$/iu.test(baseline.upstreamTreeHash)
        ? baseline.upstreamTreeHash
        : typeof lock?.skillFolderHash === 'string' && /^[0-9a-f]{40}$/iu.test(lock.skillFolderHash)
          ? lock.skillFolderHash
          : null;
    if (reference === null) {
      entry.update = {
        status: 'unknown',
        reason: 'no upstream reference recorded yet — install or upgrade it through this console to enable update tracking',
      };
      continue;
    }

    const result = await upstream.treeHash({ owner, repo, ref: baseline?.upstreamRef ?? lock?.ref ?? null, skillPath });
    if (result.ok !== true) {
      if (result.rateLimited === true) rateLimited = true;
      entry.update = { status: 'unknown', reason: result.error ?? 'upstream check failed' };
      continue;
    }
    entry.update = result.sha === reference
      ? { status: 'current', method: 'tree', ref: result.ref }
      : { status: 'available', method: 'tree', ref: result.ref, upstreamSha: result.sha, installedSha: reference };
  }
  if (rateLimited) {
    const message = 'GitHub API rate limit reached — set GITHUB_TOKEN to check updates reliably';
    warnings.push(message);
    log('warn', message);
  }
}

/**
 * Decide whether a skill still matches what this plugin installed.
 *
 * Only our own baseline is authoritative. The CLI's hashes cannot stand in for it: the
 * bytes it writes on Windows differ from upstream (CRLF), so neither its content hash
 * nor a raw upstream hash matches what is on disk (measured 2026-10-04).
 *
 * @param {string} dir
 * @param {{ contentHash?: string } | null} recorded
 * @returns {Promise<'clean' | 'modified' | 'unknown'>}
 */
async function resolveDrift(dir, recorded) {
  if (recorded === null) return 'unknown';
  return await compareWithBaseline(dir, recorded.contentHash);
}

/**
 * @param {string} dir
 * @returns {Promise<string | null>}
 */
async function safeHash(dir) {
  try {
    return await localContentHash(dir);
  } catch {
    return null;
  }
}
