/**
 * Operation-flow tests — deterministic, offline, no real skills touched.
 *
 * The flows under test are the ones that move files, so everything runs against a
 * temporary root with a stubbed `skills` CLI and a stubbed upstream. That makes the
 * interesting cases (drift, guard, rollback, quarantine) provable without spending
 * GitHub quota or touching the user's skill directory.
 *
 * Run: node test/flows.mjs
 */

import { readFile, writeFile, mkdir, rm, readdir, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFlows } from '../lib/flows.js';
import { buildInventory } from '../lib/registry.js';

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${label.padEnd(52)} ${detail}`);
};

const LOCK = join(homedir(), '.agents', '.skill-lock.json');
const NAME = 'demo-skill';
const base = await mkdtemp(join(tmpdir(), 'skillbox-flows-'));
const ROOT = join(base, 'skills');
const DIR = join(ROOT, NAME);

// The CLI lock is read by the flows; keep the real file intact and restore it at the end.
const lockOriginal = await readFile(LOCK, 'utf8').catch(() => null);
const lock = lockOriginal === null ? { version: 3, skills: {}, dismissed: {} } : JSON.parse(lockOriginal);
lock.skills[NAME] = {
  source: 'acme/demo',
  sourceType: 'github',
  sourceUrl: 'https://github.com/acme/demo.git',
  skillPath: 'skills/demo/SKILL.md',
  skillFolderHash: 'b'.repeat(64),
  installedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
await mkdir(ROOT, { recursive: true });
await writeFile(LOCK, JSON.stringify(lock, null, 2), 'utf8');

let upstreamSha = 'a'.repeat(40);
const upstream = {
  treeHash: async () => ({ ok: true, sha: upstreamSha, ref: 'main', error: null }),
  search: async () => ({ ok: true, results: [], error: null }),
};
const skillBody = (extra = '') => `---\nname: ${NAME}\ndescription: stub\n---\nbody\n${extra}`;
let cliAdds = 0;
const cli = {
  add: async () => {
    cliAdds += 1;
    await mkdir(DIR, { recursive: true });
    await writeFile(join(DIR, 'SKILL.md'), skillBody(), 'utf8');
    return { ok: true, attempts: 1, entry: { mode: 'copy' }, stdout: '', stderr: '', error: null };
  },
  remove: async () => ({ ok: true }),
  list: async () => ({ ok: true, skills: [], diagnostics: [] }),
  detect: async () => ({ available: true, version: 'test', patchApplied: true }),
};
const stateDoc = { version: 1, baseline: {}, auto: { enabled: false, rehearsalConfirmed: false }, quarantine: [] };
const state = {
  load: async () => JSON.parse(JSON.stringify(stateDoc)),
  save: async (next) => {
    Object.assign(stateDoc, JSON.parse(JSON.stringify(next)));
  },
};
const collect = async () => {
  const names = (await readdir(ROOT, { withFileTypes: true })).filter((e) => e.isDirectory() && e.name !== '.system').map((e) => e.name);
  return {
    ok: true,
    skills: names.map((n) => ({ name: n, source: 'user-dsh', dir: join(ROOT, n), root: ROOT, kind: 'dir', path: join(ROOT, n, 'SKILL.md'), uninstallable: true, needsConfirm: false })),
    workspaces: [],
  };
};
const logs = [];
const log = (level, message) => logs.push(`${level}: ${message}`);
const flows = createFlows({ cli, upstream, log, collect, waitForCatalog: async () => true, roots: () => [{ path: ROOT, source: 'user-dsh' }], state });
const dirs = () => new Map([[NAME, DIR]]);
const inventory = async () => buildInventory({ cli, upstream, state: stateDoc, dirs: dirs(), checkUpdates: true, log });

console.log('== install records the upstream reference ==');
const installed = await flows.installFromRegistry('acme/demo/demo-skill', 'user');
check('installFromRegistry', installed.name === NAME && installed.settled === true, `dir=${installed.dir}`);
const recorded = stateDoc.baseline[NAME];
check('baseline keeps content hash + upstream tree + ref', recorded?.contentHash?.length === 64 && recorded?.upstreamTreeHash === 'a'.repeat(40) && recorded?.upstreamRef === 'main');

console.log('\n== update status ==');
let inv = await inventory();
check('same upstream -> current', inv.entries.get(NAME).update.status === 'current', JSON.stringify(inv.entries.get(NAME).update));
upstreamSha = 'c'.repeat(40);
inv = await inventory();
check('moved upstream -> available', inv.entries.get(NAME).update.status === 'available', JSON.stringify(inv.entries.get(NAME).update));

console.log('\n== drift and the upgrade guard ==');
await writeFile(join(DIR, 'SKILL.md'), skillBody('local edit\n'), 'utf8');
inv = await inventory();
check('local edit -> modified', inv.entries.get(NAME).drift === 'modified');
const plan = await flows.planUpgrades({});
const item = plan.items.find((x) => x.name === NAME);
check('plan skips the modified skill', item?.action === 'skip' && /local/i.test(String(item?.reason)), `reason=${item?.reason}`);
const guarded = await flows.upgradeOne(NAME, {});
check('upgradeOne refuses without force', guarded.status === 'skipped', `status=${guarded.status}`);

console.log('\n== forced upgrade ==');
const forced = await flows.upgradeOne(NAME, { force: true });
const refreshed = stateDoc.baseline[NAME];
check('forced upgrade lands', forced.status === 'upgraded' && String(forced.quarantine ?? '').includes('.system'));
check('baseline refreshed to the new upstream', refreshed.upstreamTreeHash === 'c'.repeat(40));
check('quarantine entry recorded with a reason', stateDoc.quarantine.length === 1 && stateDoc.quarantine[0].reason === 'upgrade-backup');
check('content is the fresh copy', !(await readFile(join(DIR, 'SKILL.md'), 'utf8')).includes('local edit'));

console.log('\n== rollback when the install fails ==');
await rm(join(ROOT, '.system'), { recursive: true, force: true });
stateDoc.quarantine = [];
await writeFile(join(DIR, 'SKILL.md'), skillBody('local edit 2\n'), 'utf8');
const failingCli = { ...cli, add: async () => ({ ok: false, attempts: 3, entry: null, error: 'simulated upstream failure', stdout: '', stderr: '' }) };
const flowsFailing = createFlows({ cli: failingCli, upstream, log, collect, waitForCatalog: async () => true, roots: () => [{ path: ROOT, source: 'user-dsh' }], state });
const failed = await flowsFailing.upgradeOne(NAME, { force: true });
check('failed upgrade rolls back', failed.status === 'failed' && failed.rolledBack === true);
check('the edited copy is back in place', (await readFile(join(DIR, 'SKILL.md'), 'utf8')).includes('local edit 2'));

console.log('\n== quarantine + restore ==');
const before = cliAdds;
const moved = await flows.quarantineSkill((await collect()).skills[0], 'manual', 'user');
check('quarantine moves the directory', !existsSync(DIR) && existsSync(moved.to), `to=${moved.to}`);
check('baseline is dropped with the skill', stateDoc.baseline[NAME] === undefined);
const restored = await flows.restoreItem(moved.to);
check('restore puts it back', restored.settled === true && existsSync(DIR));
check('restore clears the ledger entry', stateDoc.quarantine.length === 0);
check('no extra CLI installs happened', cliAdds === before);

console.log('\n== cleanup ==');
if (lockOriginal === null) await rm(LOCK, { force: true });
else await writeFile(LOCK, lockOriginal, 'utf8');
await rm(base, { recursive: true, force: true });
console.log(results.every((r) => r.ok) ? '\nALL PASS' : `\nFAILURES: ${results.filter((r) => !r.ok).map((r) => r.label).join(', ')}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
