/**
 * dsh-skillbox — On-disk locations (v0.3.0).
 *
 * Pure path arithmetic, shared by the Host half and the operation flows so there is
 * exactly one definition of "where does an uninstalled skill go". The rules are
 * unchanged from v0.2.2 — they are what makes uninstalling reversible without ever
 * deleting a file:
 *
 *   - a `user-dsh` skill moves to `<root>/.system/<name>`; that root is declared with
 *     `skipSystem: true`, so DSH stops seeing it while it stays on the same volume;
 *   - every other writable root moves to `<root>/../.skill-console-removed/<root name>/<name>`,
 *     which sits outside the scanned root;
 *   - a flat `<name>.md` skill is renamed to `<name>.md.removed`.
 */

import { stat, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export const SYSTEM_DIR = '.system';
export const QUARANTINE_DIR = '.skill-console-removed';
export const FLAT_SUFFIX = '.removed';

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
export async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} path
 * @returns {Promise<import('node:fs').Dirent[]>}
 */
export async function readDirSafe(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * On-disk location of a live skill, or `undefined` for plugin-provided ones.
 *
 * @param {{ path?: unknown, resourceBase?: unknown }} summary
 * @returns {{ kind: 'dir' | 'file', root: string, from: string } | undefined}
 */
export function locationOf(summary) {
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

/**
 * Where a skill is parked when it leaves discovery. Never inside the scanned root.
 *
 * @param {{ kind: 'dir' | 'file', root: string, from: string }} location
 * @param {string} source
 * @param {string} name
 * @returns {string}
 */
export function quarantineTarget(location, source, name) {
  if (location.kind === 'file') return `${location.from}${FLAT_SUFFIX}`;
  if (source === 'user-dsh') return join(location.root, SYSTEM_DIR, name);
  return join(dirname(location.root), QUARANTINE_DIR, basename(location.root), name);
}

/**
 * The two directory shapes a quarantined item can live in, for a given root.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function quarantineDirsFor(root) {
  return [join(root, SYSTEM_DIR), join(dirname(root), QUARANTINE_DIR, basename(root))];
}

/**
 * Name of the skill a quarantine directory entry belongs to.
 *
 * @param {string} entryName
 * @returns {string}
 */
export function quarantineEntryName(entryName) {
  return entryName;
}
