/**
 * dsh-skillbox — Skill folder hashing (v0.3.0).
 *
 * `localContentHash` reproduces the official `skills` CLI's `computeSkillFolderHash`
 * bit-for-bit, so "has this skill been edited locally?" means exactly the same thing
 * to both tools:
 *
 *   1. walk every file under the skill directory, skipping `.git` and `node_modules`;
 *   2. turn each path into a POSIX-style path relative to the skill directory;
 *   3. sort by that relative path;
 *   4. sha256 over (relative path bytes, file bytes), concatenated in that order.
 *
 * Two different hashes live in this plugin — do not mix them up:
 *
 *   - `localContentHash` (here): content hash of the folder as it sits on disk,
 *     recomputed on demand to detect local edits.
 *   - `skillFolderHash` (CLI lock): the git tree SHA of the *upstream* folder, i.e.
 *     what the source repository looked like when the skill was installed. Read it,
 *     never compute it.
 *
 * See docs/SPEC-v0.3.0.md §2 (F3/F4) for how both were established.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

/** Directory names skipped while walking a skill folder (same set as the CLI). */
const SKIP_DIRS = new Set(['.git', 'node_modules']);

/** Guard against pathological trees and symlink cycles. */
const MAX_DEPTH = 24;

/**
 * Collect every regular file under a skill folder.
 *
 * Symlinked directories (a `--copy`-less install leaves a junction in the DSH root)
 * are followed, because the CLI hashes the real content and our answer must agree
 * with it. Cycles are bounded by `MAX_DEPTH`.
 *
 * @param {string} skillDir Absolute skill directory.
 * @returns {Promise<Array<{ relativePath: string, content: Buffer }>>}
 */
export async function collectSkillFiles(skillDir) {
  const files = [];
  await walk(skillDir, skillDir, files, 0);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return files;
}

/**
 * @param {string} base
 * @param {string} current
 * @param {Array<{ relativePath: string, content: Buffer }>} out
 * @param {number} depth
 */
async function walk(base, current, out, depth) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(current, entry.name);
    let isDirectory = entry.isDirectory();
    if (!isDirectory && entry.isSymbolicLink()) {
      try {
        isDirectory = (await stat(full)).isDirectory();
      } catch {
        continue;
      }
    }
    if (isDirectory) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(base, full, out, depth + 1);
      continue;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    try {
      const content = await readFile(full);
      out.push({ relativePath: relative(base, full).split('\\').join('/'), content });
    } catch {
      /* unreadable file: skip, same as the CLI failing the walk is not an option */
    }
  }
}

/**
 * Content hash over already-sorted file entries — the shared core of every hash in
 * this plugin, so a hash computed from disk and a hash computed from upstream bytes
 * always mean the same thing.
 *
 * @param {Array<{ relativePath: string, content: Buffer }>} entries Sorted by `relativePath`.
 * @returns {string} Lowercase hex sha256.
 */
export function hashFileEntries(entries) {
  const hash = createHash('sha256');
  for (const file of entries) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }
  return hash.digest('hex');
}

/**
 * Content hash of a skill folder — byte-compatible with the official CLI.
 *
 * @param {string} skillDir Absolute skill directory.
 * @returns {Promise<string>} Lowercase hex sha256.
 */
export async function localContentHash(skillDir) {
  const files = await collectSkillFiles(skillDir);
  return hashFileEntries(files);
}

/**
 * Compare a recorded baseline against what is on disk right now.
 *
 * @param {string} skillDir
 * @param {string | null | undefined} baselineHash
 * @returns {Promise<'clean' | 'modified' | 'unknown'>} `unknown` when there is no
 *   baseline (a skill installed by hand, or before this plugin tracked it).
 */
export async function compareWithBaseline(skillDir, baselineHash) {
  if (typeof baselineHash !== 'string' || baselineHash === '') return 'unknown';
  const current = await localContentHash(skillDir);
  return current === baselineHash ? 'clean' : 'modified';
}

/**
 * Per-file line counts, used by the upgrade preview to explain what would be
 * overwritten without shipping a full diff engine.
 *
 * @param {string} skillDir
 * @returns {Promise<{ files: number, bytes: number }>}
 */
export async function folderStats(skillDir) {
  const files = await collectSkillFiles(skillDir);
  let bytes = 0;
  for (const file of files) bytes += file.content.length;
  return { files: files.length, bytes };
}
