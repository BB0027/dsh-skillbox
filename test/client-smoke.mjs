/**
 * Client-half smoke test — no browser, no bundler, no dependencies.
 *
 * `lib/client.js` is a `window.__ModuleLoader__` factory, so it can be loaded in Node
 * with a stub React and a stub cordis context. That is enough to catch the failures
 * that hurt: a typo in the render path, a hook used before its definition, or the
 * discover card failing to mark an already-installed skill.
 *
 * Run: node test/client-smoke.mjs
 */

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${label.padEnd(52)} ${detail}`);
};

// ---------------------------------------------------------------- stub React
const element = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) });

function makeReact(overrides = {}) {
  const state = { tab: overrides.tab ?? 'installed', catalog: overrides.catalog ?? null, discover: overrides.discover ?? { status: 'idle', results: [], error: null } };
  const React = {
    createElement: element,
    Fragment: 'Fragment',
    useReducer: (reducer, initial) => [initial, () => {}],
    useState: (initial) => {
      if (initial === 'installed') return [state.tab, () => {}];
      if (initial === null && state.catalog !== null && !state.catalogUsed) {
        // `useCatalog`'s second useState starts as { status: 'loading', data: null }
      }
      if (initial && typeof initial === 'object' && initial.status === 'loading' && state.catalog !== null) {
        state.catalogUsed = true;
        return [{ status: 'ready', data: state.catalog, error: null }, () => {}];
      }
      if (initial && typeof initial === 'object' && initial.status === 'idle' && state.discover !== null) {
        return [state.discover, () => {}];
      }
      return [initial, () => {}];
    },
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  };
  return React;
}

// ---------------------------------------------------------------- load client.js
let captured = null;
globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec; } } };
await import('file:///E:/Workspace/dsh-skillbox/lib/client.js');
check('client.js registers a module', captured?.id === 'dsh-skillbox', `id=${captured?.id}`);

function renderWith({ tab, catalog, discover }) {
  const React = makeReact({ tab, catalog, discover });
  const mod = captured.factory((name) => {
    if (name === 'react') return React;
    throw new Error(`unexpected require(${name})`);
  });
  let registered = null;
  const ctx = {
    get: (name) => (name === 'locale' ? { getSnapshot: () => ({ id: 'zh-CN' }), register: () => {}, subscribe: () => () => {} } : undefined),
    slots: { inject: (_slot, cb) => cb(), register: (options, component) => { registered = { options, component }; } },
  };
  mod.apply(ctx);
  return { component: registered?.component, options: registered?.options };
}

const catalog = {
  ok: true,
  skills: [
    { name: 'find-skills', source: 'user-dsh', path: 'E:/x/find-skills/SKILL.md', description: 'local skill', drift: 'unknown', update: { status: 'untracked' }, uninstallable: true, invocation: { modelInvocable: true } },
    { name: 'vercel-react-best-practices', source: 'user-dsh', origin: 'vercel-labs/agent-skills', skillPath: 'skills/react-best-practices/SKILL.md', description: 'installed from upstream', drift: 'clean', update: { status: 'available' }, uninstallable: true, invocation: { modelInvocable: true } },
  ],
  removed: [],
  env: { available: true, version: '1.7.0', patchApplied: true },
  integration: { lockPath: 'C:/x/.skill-lock.json', statePath: 'E:/p/dsh-skillbox-state.json', stateVia: 'configEditor.documentPath' },
  stats: { total: 2, uninstallable: 2, blocked: 0, modified: 0, upgradable: 1, removed: 0 },
  warnings: [],
  cliDiagnostics: [],
};

const searchResults = [
  { id: 'vercel-labs/agent-skills/vercel-react-best-practices', source: 'vercel-labs/agent-skills', skillId: 'vercel-react-best-practices', name: 'vercel-react-best-practices', installs: 767049 },
  { id: 'vercel-labs/agent-skills/vercel-react-native-skills', source: 'vercel-labs/agent-skills', skillId: 'vercel-react-native-skills', name: 'vercel-react-native-skills', installs: 230494 },
];

// ---------------------------------------------------------------- collect text + find buttons
function texts(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const child of node) texts(child, out); return out; }
  if (typeof node === 'object') {
    if (node.children !== undefined) for (const child of node.children) texts(child, out);
    return out;
  }
  return out;
}
function buttons(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const child of node) buttons(child, out); return out; }
  if (node.type === 'button') out.push(node);
  if (node.children !== undefined) for (const child of node.children) buttons(child, out);
  return out;
}
const labelOf = (node) => texts(node).join(' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- installed tab
{
  const { component, options } = renderWith({ tab: 'installed', catalog });
  check('slot is settings.section', options?.name === 'settings.section' && options?.id === 'skill-console', `id=${options?.id}`);
  const tree = component({});
  const text = labelOf(tree);
  check('installed tab renders both skills', text.includes('find-skills') && text.includes('vercel-react-best-practices'));
  check('installed tab shows an update marker', text.includes('有更新'), text.slice(0, 120));
}

// ---------------------------------------------------------------- discover tab
{
  const { component } = renderWith({ tab: 'discover', catalog, discover: { status: 'ready', results: searchResults, error: null } });
  const tree = component({});
  const text = labelOf(tree);
  const labels = buttons(tree).map(labelOf);
  check('discover renders both results', text.includes('vercel-react-best-practices') && text.includes('vercel-react-native-skills'));
  check('installed result is marked 已安装', (text.match(/已安装/g) ?? []).length >= 1, `已安装 x${(text.match(/已安装/g) ?? []).length}`);
  check('installed + upgradable result offers 升级', labels.some((l) => l === '升级'), `buttons=${JSON.stringify(labels)}`);
  check('not-installed result still offers 安装', labels.includes('安装'), `buttons=${JSON.stringify(labels)}`);
  check('no second install button for the installed one', labels.filter((l) => l === '安装').length === 1, `安装 x${labels.filter((l) => l === '安装').length}`);
}

// ---------------------------------------------------------------- health + quarantine tabs render
for (const tab of ['health', 'quarantine']) {
  const { component } = renderWith({ tab, catalog });
  const tree = component({});
  const text = labelOf(tree);
  check(`${tab} tab renders`, text.length > 10 && (tab !== 'health' || text.includes('skills')), `${text.slice(0, 80)}`);
}

console.log(results.every((r) => r.ok) ? '\nALL PASS' : `\nFAILURES: ${results.filter((r) => !r.ok).map((r) => r.label).join(', ')}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
