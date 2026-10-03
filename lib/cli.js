/**
 * dsh-skillbox — `skills` CLI adapter (v0.3.0).
 *
 * Every mutating action in this plugin goes through the official CLI, so the plugin
 * inherits its repository resolution, security assessment and lock bookkeeping. The
 * adapter is deliberately small and defensive:
 *
 *   - detection is cached briefly and never throws; a missing CLI is a state, not an
 *     error, because the whole "discover" tab degrades when it is absent;
 *   - `--full-depth` is ALWAYS passed to `add`. Without it the CLI's repository
 *     discovery stops at the first `SKILL.md` it happens to see and returns a partial
 *     skill list: measured 2/5 successes, versus 5/5 with the flag
 *     (docs/SPEC-v0.3.0.md F6);
 *   - `add` is retried, because a failing discovery pass is transient and the CLI
 *     reports it as "No matching skill found", which is indistinguishable from a
 *     genuinely absent skill;
 *   - `skills check` / `skills update` are NOT used for upgrades. Both can spawn
 *     `add … -g -y` without `-a`, i.e. install into agents this plugin never chose.
 *     Update availability is computed by the plugin itself (lib/upstream.js) and
 *     upgrades are executed here with an explicit `-a dsh`.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';

/** The agent id this plugin registers in the CLI (see docs/PUBLISHING.md). */
export const DSH_AGENT = 'dsh';

const DEFAULT_TIMEOUT_MS = 180_000;
const DETECT_TTL_MS = 30_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_ATTEMPTS = 3;

/**
 * @param {{ log?: (level: string, message: string) => void, timeoutMs?: number, attempts?: number }} [options]
 */
export function createSkillsCli(options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {};
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const attempts = Number.isInteger(options.attempts) && options.attempts > 0 ? options.attempts : DEFAULT_ATTEMPTS;

  /** @type {{ value: object, at: number } | null} */
  let cached = null;
  /** Serialises mutating calls: one writer at a time. */
  let queue = Promise.resolve();

  /**
   * Detect the CLI. Never throws.
   *
   * @param {{ force?: boolean }} [opts]
   * @returns {Promise<{ available: boolean, command: string | null, via: string | null, version: string | null, packageDir: string | null, patchApplied: boolean | null, error: string | null, checkedAt: string }>}
   */
  async function detect(opts = {}) {
    if (!opts.force && cached !== null && Date.now() - cached.at < DETECT_TTL_MS) return cached.value;

    const result = {
      available: false,
      command: null,
      via: null,
      version: null,
      packageDir: null,
      patchApplied: null,
      error: null,
      checkedAt: new Date().toISOString(),
    };

    for (const candidate of candidateCommands()) {
      let probe;
      try {
        probe = await run(candidate.command, ['--version'], { timeoutMs: 20_000 });
      } catch (error) {
        result.error = String(error?.message ?? error);
        continue;
      }
      const version = firstVersion(probe.stdout) ?? firstVersion(probe.stderr);
      if (probe.code !== 0 && version === null) continue;
      result.available = true;
      result.command = candidate.command;
      result.via = candidate.via;
      result.version = version;
      result.packageDir = findPackageDir(candidate.command);
      result.patchApplied = result.packageDir === null ? null : await hasDshAgent(result.packageDir);
      result.error = null;
      break;
    }

    cached = { value: result, at: Date.now() };
    if (!result.available) log('warn', `skills CLI not found (${result.error ?? 'no candidate worked'})`);
    return result;
  }

  /**
   * Commands worth trying, in order: an explicit override, then whatever PATH holds.
   * @returns {Array<{ command: string, via: string }>}
   */
  function candidateCommands() {
    const out = [];
    const override = trimmed(process.env.SKILLS_CLI);
    if (override !== undefined) out.push({ command: override, via: 'SKILLS_CLI' });
    out.push({ command: 'skills', via: 'PATH' });
    const extensions = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
    for (const dir of String(process.env.PATH ?? '').split(delimiter)) {
      if (dir === '') continue;
      for (const extension of extensions) {
        const candidate = join(dir, `skills${extension}`);
        if (existsSync(candidate)) out.push({ command: candidate, via: `PATH:${dir}` });
      }
    }
    const appData = trimmed(process.env.APPDATA);
    if (appData !== undefined) {
      const npmShim = join(appData, 'npm', process.platform === 'win32' ? 'skills.cmd' : 'skills');
      if (existsSync(npmShim)) out.push({ command: npmShim, via: 'APPDATA/npm' });
    }
    const seen = new Set();
    return out.filter((entry) => {
      const key = entry.command.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Run the CLI once.
   *
   * @param {string[]} args
   * @param {{ timeoutMs?: number, command?: string }} [opts]
   * @returns {Promise<{ code: number, stdout: string, stderr: string, timedOut: boolean, command: string }>}
   */
  async function exec(args, opts = {}) {
    const detected = opts.command === undefined ? await detect() : null;
    const command = opts.command ?? detected?.command;
    if (command === null || command === undefined) throw new Error('skills CLI is not available');
    return await run(command, args, { timeoutMs: opts.timeoutMs ?? timeoutMs });
  }

  /**
   * `skills ls -g -a dsh --json` — the catalog as the CLI sees it. Diagnostics such as
   * "Skipped … missing description" arrive on stderr and are returned separately.
   *
   * @returns {Promise<{ ok: boolean, skills: object[], diagnostics: string[], raw: string, error: string | null }>}
   */
  async function list() {
    const probe = await exec(['ls', '-g', '-a', DSH_AGENT, '--json']);
    const parsed = extractJson(probe.stdout) ?? extractJson(probe.stderr);
    const diagnostics = probe.stderr
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('⚠') || line.startsWith('Skipped'));
    if (parsed === null || !Array.isArray(parsed)) {
      return { ok: false, skills: [], diagnostics, raw: probe.stdout, error: probe.code === 0 ? 'unreadable listing' : `exit ${probe.code}` };
    }
    return { ok: true, skills: parsed, diagnostics, raw: probe.stdout, error: null };
  }

  /**
   * Install a skill globally into the DSH root. Serialised, retried, and never silent
   * about what happened.
   *
   * @param {string} spec `<owner>/<repo>@<skill>` or any source the CLI accepts.
   * @returns {Promise<{ ok: boolean, attempts: number, entry: object | null, stdout: string, stderr: string, error: string | null }>}
   */
  async function add(spec) {
    return await enqueue(async () => {
      let last = { stdout: '', stderr: '', error: 'not attempted' };
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        let probe;
        try {
          probe = await exec([
            'add',
            spec,
            '-g',
            '-y',
            '-a',
            DSH_AGENT,
            '--copy',
            '--full-depth',
            '--json',
          ]);
        } catch (error) {
          last = { stdout: '', stderr: '', error: String(error?.message ?? error) };
          continue;
        }
        const parsed = extractJson(probe.stdout) ?? extractJson(probe.stderr);
        const entry = Array.isArray(parsed) ? parsed[0] ?? null : null;
        if (entry !== null && entry.status === 'installed') {
          log('info', `installed ${spec} (attempt ${attempt})`);
          return { ok: true, attempts: attempt, entry, stdout: probe.stdout, stderr: probe.stderr, error: null };
        }
        last = {
          stdout: probe.stdout,
          stderr: probe.stderr,
          error: entry?.reason ?? (probe.code === 0 ? 'skill not installed' : `exit ${probe.code}`),
        };
        log('warn', `add ${spec} attempt ${attempt}/${attempts} failed: ${last.error}`);
        if (attempt < attempts) await delay(600 * attempt);
      }
      return { ok: false, attempts, entry: null, stdout: last.stdout, stderr: last.stderr, error: last.error };
    });
  }

  /**
   * Remove a skill from this agent's directory. The plugin quarantines first; this is
   * only used to clean up after a failed install or an explicit user removal.
   *
   * @param {string} name
   * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, error: string | null }>}
   */
  async function remove(name) {
    return await enqueue(async () => {
      const probe = await exec(['remove', '-g', name, '-y', '-a', DSH_AGENT]);
      const ok = probe.code === 0 && !/No skills found to remove/i.test(probe.stdout);
      return { ok, stdout: probe.stdout, stderr: probe.stderr, error: ok ? null : (probe.stderr.trim() || probe.stdout.trim() || `exit ${probe.code}`) };
    });
  }

  /**
   * Run a task with the write lock held.
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  function enqueue(task) {
    const next = queue.then(task, task);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /**
   * Node itself, which the whole install chain depends on: the runtime this plugin is
   * running inside, plus a `node` on PATH (the CLI's shims shell out to it).
   *
   * @returns {Promise<{ runtime: string, runtimePath: string | null, onPath: string | null, version: string | null, ok: boolean }>}
   */
  async function detectNode() {
    const extensions = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
    let onPath = null;
    for (const dir of String(process.env.PATH ?? '').split(delimiter)) {
      if (dir === '') continue;
      for (const extension of extensions) {
        const candidate = join(dir, `node${extension}`);
        if (existsSync(candidate)) {
          onPath = candidate;
          break;
        }
      }
      if (onPath !== null) break;
    }
    let version = null;
    if (onPath !== null) {
      try {
        const probe = await run(onPath, ['--version'], { timeoutMs: 15_000 });
        version = firstVersion(probe.stdout) ?? firstVersion(probe.stderr);
      } catch {
        /* a broken shim is reported as "no version" rather than as an error */
      }
    }
    return { runtime: process.version, runtimePath: process.execPath, onPath, version, ok: version !== null };
  }

  return {
    detect,
    detectNode,
    exec,
    list,
    add,
    remove,
    enqueue,
    /** @returns {object | null} The last detection result, if any. */
    lastDetection: () => cached?.value ?? null,
  };
}

/**
 * Spawn a CLI process and collect its output.
 *
 * Windows shims are `.cmd` files, which cannot be executed directly: they are run
 * through `cmd.exe /d /s /c` with quoted arguments. `shell: true` is avoided because
 * it would silently drop the quoting of any argument containing a space.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ timeoutMs: number }} options
 * @returns {Promise<{ code: number, stdout: string, stderr: string, timedOut: boolean, command: string }>}
 */
function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const isShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
    const file = isShim ? (trimmed(process.env.ComSpec) ?? 'cmd.exe') : command;
    const argv = isShim ? ['/d', '/s', '/c', [command, ...args].map(quoteIfNeeded).join(' ')] : args;

    let child;
    try {
      child = spawn(file, argv, { windowsHide: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const cap = (current, chunk) => (current.length >= MAX_OUTPUT_BYTES ? current : current + chunk.toString('utf8'));

    child.stdout?.on('data', (chunk) => {
      stdout = cap(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = cap(stderr, chunk);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }, options.timeoutMs);

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, timedOut, command });
    });
  });
}

/**
 * @param {string} value
 * @returns {string}
 */
function quoteIfNeeded(value) {
  return /[\s"]/u.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/**
 * Pull the first JSON array/object out of CLI output, which mixes a banner with JSON.
 *
 * @param {string} text
 * @returns {unknown | null}
 */
export function extractJson(text) {
  if (typeof text !== 'string' || text === '') return null;
  const cleaned = text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  const lines = cleaned.split('\n');
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith('[') || line.startsWith('{')) starts.push(index);
  }
  for (const start of starts.reverse()) {
    const candidate = lines.slice(start).join('\n').trim();
    try {
      return JSON.parse(candidate);
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * @param {string} text
 * @returns {string | null}
 */
function firstVersion(text) {
  const match = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(text ?? '');
  return match === null ? null : match[1];
}

/**
 * Locate the installed package behind a CLI shim, so its version and the state of the
 * local `dsh` agent patch can be reported.
 *
 * @param {string} command
 * @returns {string | null}
 */
function findPackageDir(command) {
  const dir = dirname(command);
  const candidates = [
    join(dir, 'node_modules', 'skills'),
    join(dir, '..', 'lib', 'node_modules', 'skills'),
    join(dir, '..', 'skills'),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }
  for (const pathEntry of String(process.env.PATH ?? '').split(delimiter)) {
    if (pathEntry === '') continue;
    const candidate = join(pathEntry, 'node_modules', 'skills');
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }
  return null;
}

/**
 * Does the installed CLI still carry the `dsh` agent entry? An upgrade replaces
 * `dist/cli.mjs` and silently drops a local patch, which would make every install in
 * this plugin target the wrong agent — so the question is asked out loud.
 *
 * @param {string} packageDir
 * @returns {Promise<boolean | null>} `null` when the bundle cannot be read.
 */
async function hasDshAgent(packageDir) {
  const bundle = join(packageDir, 'dist', 'cli.mjs');
  try {
    const text = await readFile(bundle, 'utf8');
    return /(^|\n)\s*dsh:\s*\{/u.test(text);
  } catch {
    return null;
  }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
