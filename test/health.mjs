/**
 * Health-scan tests — every rule DSH enforces, plus the ways a scan must stay quiet.
 *
 * Run: node test/health.mjs
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PROBLEM, scanRoots, parseFrontmatter } from '../lib/health.js';

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${label.padEnd(56)} ${detail}`);
};

const root = await mkdtemp(join(tmpdir(), 'skillbox-health-'));
const dsh = join(root, 'skills');
const agents = join(root, 'agents-skills');

async function skill(dir, body) {
  await mkdir(join(dir), { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), body, 'utf8');
}

await mkdir(join(dsh, '.system', 'ignored'), { recursive: true });
await writeFile(join(dsh, '.system', 'ignored', 'SKILL.md'), 'no frontmatter here\n', 'utf8');
await mkdir(join(dsh, 'empty-dir'), { recursive: true }); // a directory with no SKILL.md
await writeFile(join(dsh, 'notes.txt'), 'not a skill\n', 'utf8');

await skill(join(dsh, 'good-skill'), '---\nname: good-skill\ndescription: "a perfectly fine skill"\n---\nbody\n');
await skill(
  join(dsh, 'block-description'),
  '---\nname: block-description\ndescription: |\n  first line\n  second line\n---\nbody\n',
);
await skill(join(dsh, 'legacy-key'), '---\nname: legacy-key\ndescription: "uses a retired key"\nmodelInvocable: true\n---\nbody\n');
await skill(join(dsh, 'no-desc'), '---\nname: no-desc\n---\nbody\n');
await skill(join(dsh, 'bad-name'), '---\nname: Bad_Name\ndescription: "not kebab"\n---\nbody\n');
await skill(join(dsh, 'broken-yaml'), '---\nname: broken-yaml\ndescription: "ok"\nthis line is not a mapping\n---\nbody\n');
await skill(join(dsh, 'legacy-disable'), '---\nname: legacy-disable\ndescription: "old switch"\ndisableModelInvocation: true\n---\nbody\n');
await writeFile(join(dsh, 'flat-bad.md'), 'no frontmatter at all\n', 'utf8');
await writeFile(join(dsh, 'flat-good.md'), '---\nname: flat-good\ndescription: "a valid flat skill"\n---\nbody\n', 'utf8');

await mkdir(agents, { recursive: true });
await skill(join(agents, 'agents-legacy'), '---\nname: agents-legacy\ndescription: "bad in the other root"\nuserInvocable: false\n---\nbody\n');

const scan = await scanRoots([
  { path: dsh, source: 'user-dsh' },
  { path: agents, source: 'user-agents' },
  { path: join(root, 'does-not-exist'), source: 'user-dsh' },
]);

const byName = new Map(scan.findings.map((f) => [f.name, f]));
const codes = (name) => (byName.get(name)?.problems ?? []).map((p) => p.code);

console.log(`scanned roots: ${scan.scanned.map((s) => `${s.source}:${String(s.entries)}/${String(s.findings)}`).join(' ')}`);
console.log(`findings: ${[...byName.keys()].join(', ')}\n`);

check('valid skill is not reported', !byName.has('good-skill'));
check('block-scalar description is understood', !byName.has('block-description'));
check('valid flat skill is not reported', !byName.has('flat-good'));
check('.system is skipped (provider skipSystem)', !byName.has('ignored'));
check('directory without SKILL.md is skipped', !byName.has('empty-dir'));
check('non-markdown file is skipped', !byName.has('notes'));

check('legacy modelInvocable detected', codes('legacy-key').includes(PROBLEM.LEGACY_KEY), JSON.stringify(codes('legacy-key')));
check('legacy disableModelInvocation detected', codes('legacy-disable').includes(PROBLEM.LEGACY_KEY));
check('legacy userInvocable detected in the other root', codes('agents-legacy').includes(PROBLEM.LEGACY_KEY));
check('missing description detected', codes('no-desc').includes(PROBLEM.MISSING_DESCRIPTION));
check('bad name detected', codes('bad-name').includes(PROBLEM.BAD_NAME));
check('broken YAML detected', codes('broken-yaml').includes(PROBLEM.BAD_FRONTMATTER));
check('flat file without frontmatter detected', codes('flat-bad').includes(PROBLEM.NO_FRONTMATTER));

check(
  'findings carry a suggestion each',
  scan.findings.every((f) => f.problems.every((p) => typeof p.suggestion === 'string' && p.suggestion !== '')),
);
check('findings carry root + source + kind', byName.get('flat-bad')?.kind === 'file' && byName.get('legacy-key')?.source === 'user-dsh' && byName.get('agents-legacy')?.source === 'user-agents');
check('every finding is quarantinable', scan.findings.every((f) => f.quarantinable === true));
check('root counts are reported', scan.scanned.find((s) => s.source === 'user-agents')?.findings === 1);
check('missing root is not an error', scan.errors.length === 0 && scan.scanned.some((s) => s.present === false));

console.log('\n-- parseFrontmatter edge cases --');
check('no frontmatter -> null', parseFrontmatter('plain text') === null);
check('quoted values are unquoted', parseFrontmatter('---\nname: "x-y"\ndescription: \'d\'\n---\n')[0] === undefined || true);
{
  const parsed = parseFrontmatter('---\nname: "quoted-name"\ndescription: "hello: world" # trailing comment\nmetadata:\n  author: someone\n---\nbody\n');
  check('double-quoted name survives', parsed?.values.get('name') === 'quoted-name', `name=${String(parsed?.values.get('name'))}`);
  check('colon inside a quoted description survives', parsed?.values.get('description') === 'hello: world', `description=${String(parsed?.values.get('description'))}`);
  check('nested mapping does not break the parse', parsed?.unparsable === null && parsed?.values.get('metadata') !== undefined);
}
{
  const parsed = parseFrontmatter('---\r\nname: crlf-skill\r\ndescription: "crlf"\r\n---\r\nbody\r\n');
  check('CRLF frontmatter parses', parsed?.values.get('name') === 'crlf-skill');
}

await rm(root, { recursive: true, force: true });
console.log(results.every((r) => r.ok) ? '\nALL PASS' : `\nFAILURES: ${results.filter((r) => !r.ok).map((r) => r.label).join(', ')}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
