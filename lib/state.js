/**
 * dsh-skillbox — Persistent state (v0.3.0).
 *
 * State lives in the profile directory, next to the profile's own `cordis.patch.yml`:
 *
 *   <profileDir>/dsh-skillbox-state.json
 *
 * The profile directory is resolved from the running Harness itself — the config
 * editor knows the patch document it edits — and only then from environment
 * variables. It is never guessed from a fixed path.
 *
 * Why not the plugin's profile config entry, where v0.2.x kept `removedSkills`?
 * Every config write re-applies the plugin, which disposes the live route mid-flight.
 * State that changes on ordinary user actions (install, upgrade, quarantine) must not
 * trigger that, so it lives in its own file. The legacy ledger is absorbed into this
 * file on first read; the config key is left untouched so a downgrade still works.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const STATE_FILENAME = 'dsh-skillbox-state.json';
export const STATE_VERSION = 1;

/** Quarantine reasons this plugin writes. */
export const REASON_MANUAL = 'manual';
export const REASON_UPGRADE_BACKUP = 'upgrade-backup';
export const REASON_AUTO = 'auto';
export const REASON_LEGACY = 'legacy';

/** @returns {object} A fresh, empty state document. */
export function emptyState() {
  return {
    version: STATE_VERSION,
    baseline: {},
    auto: { enabled: false, rehearsalConfirmed: false },
    quarantine: [],
  };
}

/**
 * Resolve the profile directory, plus how it was found (surfaced in the UI so the
 * answer is never a mystery).
 *
 * @param {import('@deepseek-ai/cordis').Context} [ctx]
 * @returns {{ dir: string, via: string }}
 */
export function resolveProfileDir(ctx) {
  const fromEditor = documentPathOf(ctx);
  if (fromEditor !== undefined) {
    const dir = dirname(fromEditor);
    if (existsSync(dir)) return { dir, via: 'configEditor.documentPath' };
  }

  const explicit = trimmed(process.env.DSH_PROFILE_DIR);
  if (explicit !== undefined && existsSync(explicit)) return { dir: explicit, via: 'DSH_PROFILE_DIR' };

  const home = trimmed(process.env.DSH_HOME) ?? join(homedir(), '.dsh');
  const name = trimmed(process.env.DSH_PROFILE) ?? 'desktop';
  const named = join(home, 'profiles', name);
  if (existsSync(named)) return { dir: named, via: 'DSH_HOME/profiles/DSH_PROFILE' };

  return { dir: join(home, 'profiles', 'desktop'), via: 'fallback' };
}

/**
 * @param {import('@deepseek-ai/cordis').Context} [ctx]
 * @returns {string | undefined} The patch document this profile is running, if known.
 */
function documentPathOf(ctx) {
  try {
    const editor = ctx?.get?.('configEditor');
    const documentPath = editor?.documentPath;
    if (typeof documentPath === 'string' && documentPath !== '') return documentPath;
  } catch {
    /* an absent service is not an error here */
  }
  return undefined;
}

/**
 * @param {import('@deepseek-ai/cordis').Context} [ctx]
 * @returns {string} Absolute path of the state document.
 */
export function statePath(ctx) {
  return join(resolveProfileDir(ctx).dir, STATE_FILENAME);
}

/**
 * Read state, tolerating anything: a missing file, a hand-edited file, or a file
 * written by a newer version. A broken state file must never take the page down.
 *
 * @param {import('@deepseek-ai/cordis').Context} [ctx]
 * @param {{ legacyRemovals?: unknown[] }} [options]
 * @returns {Promise<{ state: object, path: string, via: string, existed: boolean, error: string | null }>}
 */
export async function readState(ctx, options = {}) {
  const { dir, via } = resolveProfileDir(ctx);
  const path = join(dir, STATE_FILENAME);
  let state = emptyState();
  let existed = false;
  let error = null;
  try {
    const text = await readFile(path, 'utf8');
    existed = true;
    state = normalizeState(JSON.parse(text));
  } catch (caught) {
    if (caught?.code !== 'ENOENT') error = String(caught?.message ?? caught);
  }
  const before = state.quarantine.length;
  state.quarantine = mergeLegacy(state.quarantine, options.legacyRemovals);
  return { state, path, via, existed, error, migrated: state.quarantine.length - before };
}

/**
 * Write state atomically: a temp file in the same directory is renamed over the
 * target, so a crash can never leave a half-written ledger behind.
 *
 * @param {import('@deepseek-ai/cordis').Context} [ctx]
 * @param {object} state
 * @returns {Promise<{ path: string, bytes: number }>}
 */
export async function writeState(ctx, state) {
  const { dir } = resolveProfileDir(ctx);
  await mkdir(dir, { recursive: true });
  const path = join(dir, STATE_FILENAME);
  const temporary = `${path}.tmp`;
  const text = `${JSON.stringify(normalizeState(state), null, 2)}\n`;
  await writeFile(temporary, text, 'utf8');
  await rename(temporary, path);
  return { path, bytes: Buffer.byteLength(text) };
}

/**
 * @param {unknown} raw
 * @returns {object} A state document with only known-good fields.
 */
export function normalizeState(raw) {
  const state = emptyState();
  if (raw === null || typeof raw !== 'object') return state;

  const baseline = raw.baseline;
  if (baseline !== null && typeof baseline === 'object') {
    for (const [name, entry] of Object.entries(baseline)) {
      if (typeof name !== 'string' || name === '') continue;
      if (entry === null || typeof entry !== 'object') continue;
      const contentHash = typeof entry.contentHash === 'string' ? entry.contentHash : null;
      if (contentHash === null) continue;
      state.baseline[name] = {
        contentHash,
        source: typeof entry.source === 'string' ? entry.source : null,
        skillPath: typeof entry.skillPath === 'string' ? entry.skillPath : null,
        // Upstream reference recorded when this plugin wrote the skill: the git tree SHA
        // of the installed revision, which is what later update checks compare against.
        upstreamTreeHash: typeof entry.upstreamTreeHash === 'string' ? entry.upstreamTreeHash : null,
        upstreamRef: typeof entry.upstreamRef === 'string' ? entry.upstreamRef : null,
        installedAt: typeof entry.installedAt === 'string' ? entry.installedAt : null,
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
        by: entry.by === 'ai' ? 'ai' : 'user',
      };
    }
  }

  const auto = raw.auto;
  if (auto !== null && typeof auto === 'object') {
    state.auto.enabled = auto.enabled === true;
    state.auto.rehearsalConfirmed = auto.rehearsalConfirmed === true;
  }

  if (Array.isArray(raw.quarantine)) state.quarantine = normalizeQuarantine(raw.quarantine);
  return state;
}

/**
 * @param {unknown[]} items
 * @returns {Array<object>}
 */
function normalizeQuarantine(items) {
  const out = [];
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue;
    const { name, from, to, source, kind, at, reason } = item;
    if (typeof name !== 'string' || typeof from !== 'string' || typeof to !== 'string') continue;
    out.push({
      name,
      from,
      to,
      source: typeof source === 'string' ? source : 'custom',
      kind: kind === 'file' ? 'file' : 'dir',
      at: typeof at === 'string' ? at : null,
      reason: typeof reason === 'string' ? reason : REASON_MANUAL,
    });
  }
  return out;
}

/**
 * Absorb v0.2.x `removedSkills` entries (and anything the config still holds) into the
 * state file's quarantine list, keyed by target path so re-running is idempotent.
 *
 * @param {Array<object>} quarantine
 * @param {unknown[] | undefined} legacy
 * @returns {Array<object>}
 */
function mergeLegacy(quarantine, legacy) {
  if (!Array.isArray(legacy) || legacy.length === 0) return quarantine;
  const seen = new Set(quarantine.map((entry) => entry.to));
  const merged = [...quarantine];
  for (const entry of normalizeQuarantine(legacy)) {
    if (seen.has(entry.to)) continue;
    seen.add(entry.to);
    merged.push({ ...entry, reason: REASON_LEGACY });
  }
  return merged;
}

/**
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
function trimmed(value) {
  if (typeof value !== 'string') return undefined;
  const out = value.trim();
  return out === '' ? undefined : out;
}
