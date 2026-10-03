/**
 * Health automation tests at the Host boundary — stub cordis context, temporary
 * DSH_HOME, no real skills and no network.
 *
 * What this pins down: the scan sees what DSH ignores, nothing moves until the user has
 * seen the rehearsal, enabling the automation moves exactly the findings into the same
 * quarantine a manual uninstall uses, the ledger records the reason, restore brings one
 * back, disabling stops it, and a healthy skill is never touched.
 *
 * Run: node test/host-health.mjs
 */

import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${label.padEnd(54)} ${detail}`);
};

const base = await mkdtemp(join(tmpdir(), 'skillbox-host-health-'));
const dshHome = join(base, 'dsh-home');
const agentsHome = join(base, 'agents-home');
const profile = join(base, 'profile');
const root = join(dshHome, 'skills');
const agentsRoot = join(agentsHome, 'skills');
await mkdir(root, { recursive: true });
await mkdir(agentsRoot, { recursive: true });
await mkdir(profile, { recursive: true });

process.env.DSH_HOME = dshHome;
process.env.DSH_AGENTS_HOME = agentsHome;
process.env.DSH_PROFILE_DIR = profile;

const write = async (dir, body) => {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), body, 'utf8');
};

await write(join(root, 'healthy-skill'), '---\nname: healthy-skill\ndescription: "fine"\n---\nbody\n');
await write(join(root, 'legacy-key'), '---\nname: legacy-key\ndescription: "uses a retired key"\nmodelInvocable: true\n---\nbody\n');
await write(join(root, 'no-desc'), '---\nname: no-desc\n---\nbody\n');
await writeFile(join(root, 'flat-bad.md'), 'no frontmatter\n', 'utf8');
await write(join(agentsRoot, 'agents-legacy'), '---\nname: agents-legacy\ndescription: "bad in the other root"\nuserInvocable: false\n---\nbody\n');

const { apply } = await import('../lib/host.js');

const routes = [];
const ctx = {
  logger: { info: () => {}, warn: (m) => console.log('    [ctx.warn]', m), debug: () => {} },
  get(name) {
    if (name === 'skills') {
      // DSH would only resolve the healthy skill; the broken ones are invisible.
      return {
        snapshot: async () => ({
          skills: existsSync(join(root, 'healthy-skill'))
            ? [
                {
                  name: 'healthy-skill',
                  description: 'fine',
                  path: join(root, 'healthy-skill', 'SKILL.md'),
                  resourceBase: { kind: 'directory', path: join(root, 'healthy-skill') },
                  source: 'user-dsh',
                  invocation: { modelInvocable: true, userInvocable: true },
                },
              ]
            : [],
        }),
      };
    }
    if (name === 'configEditor') return { documentPath: join(profile, 'cordis.patch.yml'), entries: () => [], edit: async () => {} };
    if (name === 'workspaceRegistry') return { list: () => [] };
    return undefined;
  },
  inject(_deps, cb) { cb(this); },
  effect(fn) { return fn(); },
  webServer: { register(route) { routes.push(route); } },
};
apply(ctx, {});
check('route registered', routes.length === 1 && routes[0].path === '/plugins/dsh-skillbox/skills');

function call(method, body) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const dataFns = [];
    const endFns = [];
    const req = {
      method,
      headers: { host: 'x', origin: 'http://x' },
      on(event, fn) { if (event === 'data') dataFns.push(fn); else if (event === 'end') endFns.push(fn); return req; },
      destroy() {},
    };
    const res = { writeHead() {}, end(text) { try { resolve(JSON.parse(text)); } catch { resolve({ raw: text }); } } };
    routes[0].handler(req, res).then(() => {}, reject);
    if (payload !== '') for (const fn of dataFns) fn(Buffer.from(payload));
    for (const fn of endFns) fn();
  });
}
const post = (body) => call('POST', body);
const stateFile = join(profile, 'dsh-skillbox-state.json');
const readState = async () => JSON.parse(await readFile(stateFile, 'utf8'));

console.log('\n== scan ==');
let payload = await call('GET');
const names = payload.health.findings.map((f) => f.name).sort();
check('finds every broken skill', names.join(',') === 'agents-legacy,flat-bad,legacy-key,no-desc', `findings=${names.join(',')}`);
check('healthy skill is not a finding', !names.includes('healthy-skill'));
check('scans only the two global roots', payload.health.roots.every((r) => r.source === 'user-dsh' || r.source === 'user-agents') && payload.health.roots.length === 2);
check('stat exposes the finding count', payload.stats.findings === 4, `findings=${String(payload.stats.findings)}`);
check('automation starts disabled', payload.health.auto.enabled === false);

console.log('\n== enabling needs the rehearsal ==');
const tooEarly = await post({ action: 'auto-quarantine', enabled: true });
check('refuses to enable before a rehearsal', tooEarly.ok === false && /rehearsal/i.test(String(tooEarly.error)), String(tooEarly.error));
check('nothing moved yet', existsSync(join(root, 'legacy-key')));

const rehearsal = await post({ action: 'health-rehearsal' });
check('rehearsal lists what would move', rehearsal.result.wouldMove === 4 && rehearsal.result.findings.length === 4);
check('rehearsal moves nothing', existsSync(join(root, 'no-desc')) && existsSync(join(root, 'flat-bad.md')));
check('rehearsal is recorded', (await readState()).auto.rehearsalConfirmed === true);

console.log('\n== auto-quarantine on ==');
const enabled = await post({ action: 'auto-quarantine', enabled: true });
check('reports four moves', enabled.result.enabled === true && enabled.result.moved.length === 4, JSON.stringify(enabled.result.moved.map((m) => m.name)));
check('broken directories are gone from the root', !existsSync(join(root, 'legacy-key')) && !existsSync(join(root, 'no-desc')) && !existsSync(join(agentsRoot, 'agents-legacy')));
check('flat file was renamed, not deleted', !existsSync(join(root, 'flat-bad.md')) && existsSync(join(root, 'flat-bad.md.removed')));
check('healthy skill untouched', existsSync(join(root, 'healthy-skill', 'SKILL.md')));
check('quarantine lives under the provider-skipped .system dir', existsSync(join(root, '.system', 'legacy-key')) && existsSync(join(agentsRoot, '..', '.skill-console-removed', 'skills', 'agents-legacy')));
check('findings are now empty', (await call('GET')).health.findings.length === 0);
const state = await readState();
check('ledger records the auto reason', state.quarantine.every((q) => q.reason === 'auto') && state.quarantine.length === 4, JSON.stringify(state.quarantine.map((q) => q.reason)));
const after = await call('GET');
check('quarantined items are listed as restorable', after.removed.length === 4 && after.removed.every((item) => item.present === true));

console.log('\n== restore one (automation still on) ==');
const target = after.removed.find((item) => item.name === 'legacy-key');
const restored = await post({ action: 'restore', target: target.to });
check('restore puts the skill back', restored.result.settled === true && existsSync(join(root, 'legacy-key', 'SKILL.md')));
const rescanned = await call('GET');
check('the restored skill is a finding again', rescanned.health.findings.some((f) => f.name === 'legacy-key'), `findings=${rescanned.health.findings.map((f) => f.name).join(',')}`);
check('restore is not immediately undone', existsSync(join(root, 'legacy-key', 'SKILL.md')));
check(
  'the auto report explains the skip',
  (rescanned.health.autoReport ?? []).some((m) => m.name === 'legacy-key' && typeof m.skipped === 'string'),
  JSON.stringify((rescanned.health.autoReport ?? []).map((m) => `${m.name}:${m.skipped ?? 'moved'}`)),
);

console.log('\n== auto-quarantine off ==');
const disabled = await post({ action: 'auto-quarantine', enabled: false });
check('reports disabled', disabled.result.enabled === false);
check('the finding stays put while off', existsSync(join(root, 'legacy-key')));

console.log('\n== manual per-item disable ==');
const manual = await post({ action: 'quarantine-bad', path: join(root, 'legacy-key', 'SKILL.md') });
check('manual quarantine works', manual.result.reason === 'manual' && !existsSync(join(root, 'legacy-key')));
check('ledger keeps manual and auto apart', (await readState()).quarantine.some((q) => q.reason === 'manual'));

console.log('\n== cleanup ==');
await rm(base, { recursive: true, force: true });
delete process.env.DSH_HOME;
delete process.env.DSH_AGENTS_HOME;
delete process.env.DSH_PROFILE_DIR;
console.log(results.every((r) => r.ok) ? '\nALL PASS' : `\nFAILURES: ${results.filter((r) => !r.ok).map((r) => r.label).join(', ')}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
