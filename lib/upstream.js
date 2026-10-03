/**
 * dsh-skillbox — Upstream data (v0.3.0).
 *
 * Everything the plugin needs to talk to the outside world, and nothing else:
 *
 *   - `search`      the skills.sh search API (installs, owner, skill id);
 *   - `resolveSkill` which directory a registry skill id lives in, inside its repo.
 *                   skills.sh ids are frontmatter `name` values and do NOT always
 *                   match the directory (`vercel-react-best-practices` lives in
 *                   `skills/react-best-practices`), so the same two-step resolution
 *                   the official CLI uses is repeated here;
 *   - `security`    Snyk / Socket verdicts, parsed from the audit pages on demand;
 *   - `treeHash`    the upstream git tree SHA of a skill folder, which is what the
 *                   CLI lock records as `skillFolderHash` — comparing it is how we
 *                   answer "is there an update?" without touching the install.
 *
 * Update checks need the GitHub API; without a token the anonymous quota (60/hour)
 * is shared per IP and will run out. That is reported, never hidden, and never
 * silently treated as "up to date".
 */

const GITHUB_API = 'https://api.github.com';
const JSDELIVR_API = 'https://data.jsdelivr.com/v1/packages/gh';
const RAW_BASE = 'https://raw.githubusercontent.com';
const CDN_BASE = 'https://cdn.jsdelivr.net/gh';
const USER_AGENT = 'dsh-skillbox/0.3.0 (+https://github.com/BB0027/dsh-skillbox)';

/**
 * @param {{ log?: (level: string, message: string) => void, timeoutMs?: number, token?: string | null }} [options]
 */
export function createUpstream(options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {};
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30_000;
  const token = options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
  const searchBase = (process.env.SKILLS_API_URL ?? 'https://skills.sh').replace(/\/+$/u, '');

  /** @type {Map<string, { sha: string | null, tree: Array<{ path: string, type: string, sha: string }> | undefined, at: number }>} */
  const treeCache = new Map();
  /** @type {Map<string, string>} */
  const defaultBranchCache = new Map();
  const TREE_TTL_MS = 5 * 60_000;

  /**
   * @param {string} query
   * @param {{ limit?: number, owner?: string }} [opts]
   * @returns {Promise<{ ok: boolean, results: object[], error: string | null }>}
   */
  async function search(query, opts = {}) {
    const text = String(query ?? '').trim();
    if (text === '') return { ok: true, results: [], error: null };
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? Math.min(opts.limit, 50) : 10;
    const url = `${searchBase}/api/search?q=${encodeURIComponent(text)}&limit=${opts.owner === undefined ? limit : Math.min(limit * 4, 50)}`;
    try {
      const body = await fetchJson(url);
      const skills = Array.isArray(body?.skills) ? body.skills : [];
      const owner = typeof opts.owner === 'string' && opts.owner !== '' ? opts.owner.toLowerCase() : null;
      const results = skills
        .filter((skill) => owner === null || String(skill?.id ?? '').toLowerCase().startsWith(`${owner}/`))
        .slice(0, limit)
        .map((skill) => ({
          id: String(skill?.id ?? ''),
          source: String(skill?.source ?? ''),
          skillId: String(skill?.skillId ?? ''),
          name: String(skill?.name ?? ''),
          installs: Number.isFinite(skill?.installs) ? skill.installs : 0,
        }));
      return { ok: true, results, error: null };
    } catch (error) {
      const message = String(error?.message ?? error);
      log('warn', `search "${text}" failed: ${message}`);
      return { ok: false, results: [], error: message };
    }
  }

  /**
   * Find the directory that holds a registry skill id, and list its files.
   *
   * @param {{ owner: string, repo: string, ref?: string | null, skillId: string }} request
   * @returns {Promise<{ ok: boolean, ref: string | null, dir: string | null, files: string[], via: string | null, error: string | null }>}
   */
  async function resolveSkill(request) {
    const { owner, repo, skillId } = request;
    const refs = request.ref !== undefined && request.ref !== null && request.ref !== '' ? [request.ref] : ['main', 'master'];
    const errors = [];
    for (const ref of refs) {
      let files;
      try {
        files = await listRepoFiles(owner, repo, ref);
      } catch (error) {
        errors.push(`jsdelivr@${ref}: ${String(error?.message ?? error)}`);
        continue;
      }
      if (files.length === 0) continue;
      const dir = await matchSkillDir({ owner, repo, ref, files, skillId });
      if (dir === null) {
        errors.push(`no skill named "${skillId}" in ${owner}/${repo}@${ref}`);
        continue;
      }
      return { ok: true, ref, dir, files: files.filter((file) => file === `${dir}/SKILL.md` || file.startsWith(`${dir}/`)), via: 'jsdelivr', error: null };
    }
    return { ok: false, ref: null, dir: null, files: [], via: null, error: errors.join(' | ') || 'skill not found' };
  }

  /**
   * @param {{ owner: string, repo: string, ref: string, files: string[], skillId: string }} request
   * @returns {Promise<string | null>} Directory path inside the repository.
   */
  async function matchSkillDir({ owner, repo, ref, files, skillId }) {
    const candidates = files.filter((file) => /(^|\/)SKILL\.md$/u.test(file)).map((file) => file.replace(/\/SKILL\.md$/u, ''));
    if (candidates.length === 0) return null;
    const byDirectory = candidates.filter((dir) => (dir.split('/').pop() ?? '') === skillId);
    if (byDirectory.length > 0) return byDirectory.sort((a, b) => a.split('/').length - b.split('/').length)[0];
    for (const dir of [...candidates].sort((a, b) => a.split('/').length - b.split('/').length)) {
      try {
        const text = await fetchText(`${RAW_BASE}/${owner}/${repo}/${ref}/${dir}/SKILL.md`);
        const match = /(?:^|\n)name:\s*["']?([^"'\r\n]+)/u.exec(text);
        if (match !== null && match[1].trim() === skillId) return dir;
      } catch {
        /* try the next candidate */
      }
    }
    return candidates.length === 1 ? candidates[0] : null;
  }

  /**
   * The SKILL.md body of a repository skill, for the preview pane.
   *
   * @param {{ owner: string, repo: string, ref: string, dir: string }} request
   * @returns {Promise<{ ok: boolean, text: string | null, error: string | null }>}
   */
  async function skillMarkdown(request) {
    const { owner, repo, ref, dir } = request;
    try {
      const text = await fetchText(`${RAW_BASE}/${owner}/${repo}/${ref}/${dir}/SKILL.md`);
      return { ok: true, text, error: null };
    } catch (error) {
      return { ok: false, text: null, error: String(error?.message ?? error) };
    }
  }

  /**
   * Snyk and Socket verdicts for a registry skill, read from the audit pages.
   * Two requests per skill: only fetched when a card is expanded.
   *
   * @param {string} id `owner/repo/skillId`
   * @returns {Promise<{ ok: boolean, snyk: string | null, socket: string | null, error: string | null }>}
   */
  async function security(id) {
    const [snyk, socket] = await Promise.all([auditVerdict(id, 'snyk'), auditVerdict(id, 'socket')]);
    return { ok: snyk !== null || socket !== null, snyk, socket, error: snyk === null && socket === null ? 'audit pages unavailable' : null };
  }

  /**
   * @param {string} id
   * @param {'snyk' | 'socket'} vendor
   * @returns {Promise<string | null>}
   */
  async function auditVerdict(id, vendor) {
    try {
      const html = await fetchText(`${searchBase}/${id}/security/${vendor}`);
      const text = html
        .replace(/<script[\s\S]*?<\/script>/giu, ' ')
        .replace(/<style[\s\S]*?<\/style>/giu, ' ')
        .replace(/<[^>]+>/gu, ' ')
        .replace(/\s+/gu, ' ');
      if (vendor === 'snyk') {
        const match = /Risk Level:?\s*([A-Za-z ]{2,20}?)(?:\s|$)/u.exec(text);
        return match === null ? null : match[1].trim().toUpperCase();
      }
      const match = /\b(Pass|Fail|Warn(?:ing)?)\b/u.exec(text);
      return match === null ? null : match[1].toUpperCase();
    } catch {
      return null;
    }
  }

  /**
   * Upstream git tree SHA of a skill folder — comparable with the lock's
   * `skillFolderHash`. One request per repository+ref, cached.
   *
   * @param {{ owner: string, repo: string, ref?: string | null, skillPath: string }} request
   * @returns {Promise<{ ok: boolean, sha: string | null, ref: string | null, error: string | null, rateLimited?: boolean }>}
   */
  async function treeHash(request) {
    const { owner, repo, skillPath } = request;
    const ref = request.ref ?? (await defaultBranch(owner, repo));
    const cacheKey = `${owner}/${repo}@${ref}`;
    const cachedTree = treeCache.get(cacheKey);
    if (cachedTree !== undefined && Date.now() - cachedTree.at < TREE_TTL_MS) {
      return resolveFromTree(cachedTree, skillPath, ref);
    }
    try {
      const url = `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
      const body = await fetchJson(url, { token });
      treeCache.set(cacheKey, { sha: body?.sha ?? null, at: Date.now(), tree: body?.tree });
      return resolveFromTree({ sha: body?.sha ?? null, tree: body?.tree }, skillPath, ref);
    } catch (error) {
      const message = String(error?.message ?? error);
      const rateLimited = /rate limit|403/u.test(message);
      log('warn', `tree hash ${cacheKey} failed: ${message}`);
      return { ok: false, sha: null, ref, error: message, rateLimited };
    }
  }

  /**
   * @param {{ sha: string | null, tree?: Array<{ path: string, type: string, sha: string }> } | null} tree
   * @param {string} skillPath
   * @param {string} ref
   */
  function resolveFromTree(tree, skillPath, ref) {
    if (tree === null || tree.sha === null) return { ok: false, sha: null, ref, error: 'tree unavailable' };
    const folder = String(skillPath ?? '').replace(/\\/gu, '/').replace(/\/?SKILL\.md$/iu, '').replace(/\/$/u, '');
    if (folder === '') return { ok: true, sha: tree.sha, ref, error: null };
    const entry = Array.isArray(tree.tree) ? tree.tree.find((item) => item.type === 'tree' && item.path === folder) : undefined;
    if (entry === undefined) return { ok: false, sha: null, ref, error: `folder ${folder} not found upstream` };
    return { ok: true, sha: entry.sha, ref, error: null };
  }

  /**
   * @param {string} owner
   * @param {string} repo
   * @returns {Promise<string>}
   */
  async function defaultBranch(owner, repo) {
    const key = `${owner}/${repo}`;
    const cached = defaultBranchCache.get(key);
    if (cached !== undefined) return cached;
    try {
      const body = await fetchJson(`${GITHUB_API}/repos/${owner}/${repo}`, { token });
      const branch = typeof body?.default_branch === 'string' && body.default_branch !== '' ? body.default_branch : 'main';
      defaultBranchCache.set(key, branch);
      return branch;
    } catch {
      defaultBranchCache.set(key, 'main');
      return 'main';
    }
  }

  /**
   * Repo stars, used by the low-trust confirmation as a second signal.
   *
   * @param {string} owner
   * @param {string} repo
   * @returns {Promise<number | null>}
   */
  async function repoStars(owner, repo) {
    try {
      const body = await fetchJson(`${GITHUB_API}/repos/${owner}/${repo}`, { token });
      return Number.isFinite(body?.stargazers_count) ? body.stargazers_count : null;
    } catch {
      return null;
    }
  }

  return { search, resolveSkill, skillMarkdown, security, treeHash, repoStars };
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} ref
 * @returns {Promise<string[]>} POSIX-style paths relative to the repository root.
 */
async function listRepoFiles(owner, repo, ref) {
  const body = await fetchJson(`${JSDELIVR_API}/${owner}/${repo}@${ref}?structure=flat`);
  if (!Array.isArray(body?.files)) throw new Error('unexpected listing payload');
  return body.files.map((file) => String(file?.name ?? '').replace(/^\/+/u, '')).filter((name) => name !== '');
}

/**
 * @param {string} url
 * @param {{ token?: string | null }} [opts]
 * @returns {Promise<any>}
 */
async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, opts);
  return JSON.parse(text);
}

/**
 * @param {string} url
 * @param {{ token?: string | null }} [opts]
 * @returns {Promise<string>}
 */
async function fetchText(url, opts = {}) {
  const headers = { 'user-agent': USER_AGENT, accept: 'application/json, text/plain, */*' };
  if (typeof opts.token === 'string' && opts.token !== '') headers.authorization = `Bearer ${opts.token}`;
  let lastError = null;
  // Two retries: a cold DNS/TLS handshake in a freshly started process, and an
  // occasional hiccup from jsDelivr / raw.githubusercontent, both surface as a bare
  // "fetch failed". The discover tab must not report those as dead ends (one of each
  // was observed in live runs on 2026-10-04).
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${new URL(url).host}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      const transient = !/^[45]\d\d /u.test(String(error?.message ?? ''));
      if (transient !== true || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  throw lastError ?? new Error('fetch failed');
}
