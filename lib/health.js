/**
 * dsh-skillbox — Skill health (v0.4.0).
 *
 * DSH silently ignores a `SKILL.md` it cannot accept. That makes a broken skill worse
 * than a disabled one: it is invisible. Nothing in `ctx.skills` will ever mention it,
 * and the CLI's own listing disagrees with DSH about one of the cases (it reports a
 * missing description but lists a skill that uses a legacy invocation key as if it were
 * fine) — both measured, see docs/SPEC-v0.3.0.md F1/F2. So this module reads the roots
 * itself and applies DSH's rules directly.
 *
 * The rules, exactly as DSH implements them (`parseSkillFile` + `parseInvocationPolicy`):
 *
 *   - there must be a YAML frontmatter block;
 *   - `name` and `description` must both be present and non-empty;
 *   - `name` must match `^[a-z0-9]+(-[a-z0-9]+)*$`;
 *   - `modelInvocable`, `userInvocable` and `disableModelInvocation` are rejected
 *     outright — a single legacy key discards the whole skill.
 *
 * A finding means "DSH is not loading this file". It never means "delete it": the caller
 * moves the entry into the same quarantine every other removal uses, so it stays
 * restorable.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** Problem codes; the client translates these. */
export const PROBLEM = {
  NO_FRONTMATTER: 'no-frontmatter',
  MISSING_NAME: 'missing-name',
  MISSING_DESCRIPTION: 'missing-description',
  BAD_NAME: 'bad-name',
  LEGACY_KEY: 'legacy-key',
  BAD_FRONTMATTER: 'bad-frontmatter',
  UNREADABLE: 'unreadable',
};

/** The grammar DSH enforces on `name`. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Frontmatter keys that make DSH discard the whole skill. */
const LEGACY_KEYS = ['disableModelInvocation', 'modelInvocable', 'userInvocable'];

/** Directories a root scan must skip (mirrors the provider's `skipSystem`). */
const SKIP_DIRS = new Set(['.system', 'node_modules']);

const MAX_SKILL_BYTES = 1024 * 1024;

/**
 * Scan the given roots for skills DSH will not load.
 *
 * @param {Array<{ path: string, source: string }>} roots Global roots only.
 * @returns {Promise<{ findings: object[], scanned: object[], errors: string[] }>}
 */
export async function scanRoots(roots) {
  const findings = [];
  const scanned = [];
  const errors = [];

  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root.path, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== 'ENOENT') errors.push(`${root.path}: ${String(error?.message ?? error)}`);
      scanned.push({ root: root.path, source: root.source, entries: 0, findings: 0, present: error?.code !== 'ENOENT' });
      continue;
    }

    let count = 0;
    let found = 0;
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.') {
        // A dot-entry is either the provider's own bookkeeping or a hidden file; DSH's
        // file provider only walks plain `<name>/SKILL.md` and flat `<name>.md`.
        if (SKIP_DIRS.has(entry.name)) continue;
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const skillFile = join(root.path, entry.name, 'SKILL.md');
        const info = await statOrNull(skillFile);
        if (info === null || !info.isFile()) continue;
        count += 1;
        const finding = await inspect({ file: skillFile, dir: join(root.path, entry.name), kind: 'dir', root, entryName: entry.name });
        if (finding !== null) {
          findings.push(finding);
          found += 1;
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith('.md') || entry.name.toLowerCase().endsWith('.md.removed')) continue;
      count += 1;
      const file = join(root.path, entry.name);
      const finding = await inspect({ file, dir: null, kind: 'file', root, entryName: entry.name.replace(/\.md$/iu, '') });
      if (finding !== null) {
        findings.push(finding);
        found += 1;
      }
    }
    scanned.push({ root: root.path, source: root.source, entries: count, findings: found, present: true });
  }

  findings.sort((left, right) => left.name.localeCompare(right.name));
  return { findings, scanned, errors };
}

/**
 * Inspect one skill file and describe every reason DSH would ignore it.
 *
 * @param {{ file: string, dir: string | null, kind: 'dir' | 'file', root: { path: string, source: string }, entryName: string }} target
 * @returns {Promise<object | null>} `null` when DSH would load it fine.
 */
async function inspect(target) {
  const { file, dir, kind, root, entryName } = target;
  let text;
  try {
    const info = await stat(file);
    if (info.size > MAX_SKILL_BYTES) {
      return finding(target, [problem(PROBLEM.UNREADABLE, `file is ${String(info.size)} bytes`, 'split it or trim it — DSH reads the whole file')]);
    }
    text = await readFile(file, 'utf8');
  } catch (error) {
    return finding(target, [problem(PROBLEM.UNREADABLE, String(error?.message ?? error), 'make the file readable, then reload')]);
  }

  const parsed = parseFrontmatter(text);
  if (parsed === null) {
    return finding(target, [
      problem(PROBLEM.NO_FRONTMATTER, 'no YAML frontmatter block', 'start the file with ---, then name and description, then ---'),
    ]);
  }

  const problems = [];
  if (parsed.unparsable !== null) {
    problems.push(problem(PROBLEM.BAD_FRONTMATTER, parsed.unparsable, 'fix the YAML in the frontmatter block'));
  }

  const name = scalar(parsed.values.get('name'));
  const description = scalar(parsed.values.get('description'));
  if (name === null) problems.push(problem(PROBLEM.MISSING_NAME, 'frontmatter has no name', 'add name: <kebab-case-name>'));
  else if (!SKILL_NAME_PATTERN.test(name)) {
    problems.push(problem(PROBLEM.BAD_NAME, `name "${name}" is not kebab-case`, 'use lowercase letters, digits and single hyphens (^[a-z0-9]+(-[a-z0-9]+)*$)'));
  }
  if (description === null) problems.push(problem(PROBLEM.MISSING_DESCRIPTION, 'frontmatter has no description', 'add description: "what it does and when to use it"'));

  for (const key of LEGACY_KEYS) {
    if (!parsed.values.has(key)) continue;
    const replacement = key === 'disableModelInvocation' || key === 'modelInvocable' ? 'disable-model-invocation' : 'user-invocable';
    problems.push(problem(PROBLEM.LEGACY_KEY, `frontmatter uses the retired key "${key}"`, `rename it to ${replacement} — DSH discards a skill that uses "${key}"`));
  }

  if (problems.length === 0) return null;
  const result = finding(target, problems);
  result.frontmatter = { name, description };
  // `name` stays the on-disk entry name: that is what quarantine moves, and what a
  // restore has to put back. The frontmatter name (when it differs) is reported
  // alongside for display.
  return result;
}

/**
 * @param {{ file: string, dir: string | null, kind: 'dir' | 'file', root: { path: string, source: string }, entryName: string }} target
 * @param {object[]} problems
 */
function finding(target, problems) {
  return {
    name: target.entryName,
    dir: target.dir,
    path: target.file,
    kind: target.kind,
    root: target.root.path,
    source: target.root.source,
    entryName: target.entryName,
    problems,
    frontmatter: null,
    /** Always true: findings are quarantined by moving, never deleted. */
    quarantinable: true,
    detail: problems.map((entry) => entry.detail).join('; '),
  };
}

/**
 * @param {string} code
 * @param {string} detail
 * @param {string} suggestion
 */
function problem(code, detail, suggestion) {
  return { code, detail, suggestion };
}

/**
 * A deliberately small YAML reader: frontmatter uses top-level scalars, and that is all
 * this scan needs to judge. It never pretends to be a general parser — anything that
 * does not look like a top-level `key: value` mapping is reported so the user can look.
 *
 * @param {string} text
 * @returns {{ values: Map<string, string>, unparsable: string | null } | null} `null` when there is no frontmatter block.
 */
export function parseFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/u, '');
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/u.exec(normalized);
  if (match === null) return null;

  const values = new Map();
  let unparsable = null;
  const lines = match[1].split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^[ \t]/u.test(line)) continue; // nested mapping / block scalar content
    const pair = /^([A-Za-z0-9_.-]+)[ \t]*:[ \t]*(.*)$/u.exec(line);
    if (pair === null) {
      if (unparsable === null) unparsable = `line ${String(index + 1)} is not a "key: value" mapping: ${line.trim().slice(0, 60)}`;
      continue;
    }
    const key = pair[1];
    let value = pair[2];
    if (/^[|>][-+]?\d*$/u.test(value.trim())) {
      // Block scalar: gather the indented body so "description: |" is not read as empty.
      const body = [];
      let cursor = index + 1;
      while (cursor < lines.length && (/^[ \t]/u.test(lines[cursor]) || lines[cursor].trim() === '')) {
        body.push(lines[cursor].trim());
        cursor += 1;
      }
      index = cursor - 1;
      values.set(key, body.join(' ').trim());
      continue;
    }
    values.set(key, unquote(value));
  }
  return { values, unparsable };
}

/**
 * @param {string} raw
 * @returns {string}
 */
function unquote(raw) {
  const value = raw.trim();
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    // Take the quoted payload; a trailing comment after the closing quote is dropped.
    const end = value.indexOf(quote, 1);
    if (end > 0) return value.slice(1, end).trim();
  }
  return value.replace(/\s+#.*$/u, '').trim();
}

/**
 * @param {string | undefined} value
 * @returns {string | null}
 */
function scalar(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * @param {string} path
 * @returns {Promise<import('node:fs').Stats | null>}
 */
async function statOrNull(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

/**
 * Human-readable name of the quarantine target for a finding, used in reports.
 *
 * @param {object} finding
 * @returns {string}
 */
export function displayName(finding) {
  return finding.name !== '' ? finding.name : basename(finding.path).replace(/\.md$/iu, '');
}
