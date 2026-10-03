/**
 * Client-half smoke test — no browser, no bundler, no dependencies.
 *
 * `lib/client.js` is a `window.__ModuleLoader__` factory, so it can be loaded in Node
 * with a stub React and a stub cordis context. Both rendering paths are covered:
 *
 *   - with `@deepseek-ai/dsh-client-ui-primitives` available, controls must come from
 *     that module (that is what makes the page look like the plugin manager page);
 *   - without it, every control must fall back to a plain element carrying its `dsc-`
 *     class, so a third-party client never renders a blank page.
 *
 * Run: node test/client-smoke.mjs
 */

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${label.padEnd(56)} ${detail}`);
};

const element = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) });

function makeReact({ tab, catalog, discover }) {
  return {
    createElement: element,
    Fragment: 'Fragment',
    useReducer: (reducer, initial) => [initial, () => {}],
    useState: (initial) => {
      if (initial === 'installed') return [tab, () => {}];
      if (initial && typeof initial === 'object' && initial.status === 'loading' && catalog !== null) return [{ status: 'ready', data: catalog, error: null }, () => {}];
      if (initial && typeof initial === 'object' && initial.status === 'idle' && discover !== null) return [discover, () => {}];
      return [initial, () => {}];
    },
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  };
}

let captured = null;
globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec; } } };
await import('file:///E:/Workspace/dsh-skillbox/lib/client.js');
check('client.js registers a module', captured?.id === 'dsh-skillbox', `id=${captured?.id}`);

/** Stub of the shared control package: each control is its own element type. */
function makeUi() {
  const stub = (name) => (props) => element(`ui:${name}`, props);
  return {
    Button: stub('Button'),
    Tag: stub('Tag'),
    Pill: stub('Pill'),
    Switch: stub('Switch'),
    Input: stub('Input'),
    StateDot: stub('StateDot'),
    IconSkillOutlineRegular: stub('IconSkill'),
  };
}

function renderWith({ tab = 'installed', catalog, discover = { status: 'idle', results: [], error: null }, ui = null }) {
  const React = makeReact({ tab, catalog, discover });
  const mod = captured.factory((name) => {
    if (name === 'react') return React;
    if (name === '@deepseek-ai/dsh-client-ui-primitives') {
      if (ui === null) throw new Error('module not available');
      return ui;
    }
    throw new Error(`unexpected require(${name})`);
  });
  const registrations = [];
  const ctx = {
    get: (name) => (name === 'locale' ? { getSnapshot: () => ({ id: 'zh-CN' }), register: () => {}, subscribe: () => () => {} } : undefined),
    slots: {
      inject: (_slot, cb) => cb(),
      register: (options, component) => {
        registrations.push({ options, component });
      },
    },
  };
  mod.apply(ctx);
  const bySlot = (name) => registrations.find((entry) => entry.options?.name === name) ?? null;
  return { registrations, bySlot, component: registrations[0]?.component, options: registrations[0]?.options };
}

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
function nodes(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const child of node) nodes(child, predicate, out); return out; }
  if (predicate(node)) out.push(node);
  if (node.children !== undefined) for (const child of node.children) nodes(child, predicate, out);
  return out;
}
const labelOf = (node) => texts(node).join(' ').replace(/\s+/g, ' ').trim();

const catalog = {
  ok: true,
  skills: [
    { name: 'find-skills', source: 'user-dsh', path: 'E:/x/find-skills/SKILL.md', description: 'local skill', drift: 'unknown', update: { status: 'untracked' }, uninstallable: true, invocation: { modelInvocable: true } },
    { name: 'vercel-react-best-practices', source: 'user-dsh', origin: 'vercel-labs/agent-skills', skillPath: 'skills/react-best-practices/SKILL.md', description: 'installed from upstream', drift: 'clean', update: { status: 'available' }, uninstallable: true, invocation: { modelInvocable: true } },
  ],
  removed: [],
  env: { available: true, version: '1.7.0', patchApplied: true },
  integration: { lockPath: 'C:/x/.skill-lock.json', statePath: 'E:/p/dsh-skillbox-state.json', stateVia: 'configEditor.documentPath' },
  stats: { total: 2, uninstallable: 2, blocked: 0, modified: 0, upgradable: 1, removed: 0, findings: 1 },
  warnings: [],
  cliDiagnostics: [],
  health: {
    findings: [
      {
        name: 'legacy-key',
        path: 'E:/DSH/home/skills/legacy-key/SKILL.md',
        dir: 'E:/DSH/home/skills/legacy-key',
        kind: 'dir',
        root: 'E:/DSH/home/skills',
        source: 'user-dsh',
        problems: [{ code: 'legacy-key', detail: 'frontmatter uses the retired key "modelInvocable"', suggestion: 'rename it to disable-model-invocation' }],
      },
    ],
    scanned: [{ root: 'E:/DSH/home/skills', source: 'user-dsh', entries: 3, findings: 1, present: true }],
    errors: [],
    auto: { enabled: false, rehearsalConfirmed: false },
    autoReport: null,
    roots: [{ path: 'E:/DSH/home/skills', source: 'user-dsh' }, { path: 'C:/Users/x/.agents/skills', source: 'user-agents' }],
  },
};

const searchResults = [
  { id: 'vercel-labs/agent-skills/vercel-react-best-practices', source: 'vercel-labs/agent-skills', skillId: 'vercel-react-best-practices', name: 'vercel-react-best-practices', installs: 767049 },
  { id: 'vercel-labs/agent-skills/vercel-react-native-skills', source: 'vercel-labs/agent-skills', skillId: 'vercel-react-native-skills', name: 'vercel-react-native-skills', installs: 230494 },
];

// ---------------------------------------------------------------- navigation placement
console.log('== where the console lives ==');
{
  const ui = makeUi();
  const { bySlot, component } = renderWith({ tab: 'installed', catalog, ui });
  const panel = bySlot('main');
  const entry = bySlot('sidebar.panellist');
  const settings = bySlot('settings.section');
  check('page is registered in the sidebar panel slot', panel?.options?.key === 'skill-console' && typeof panel?.component === 'function', JSON.stringify(panel?.options));
  check(
    'sidebar entry matches the plugins/automation panels',
    entry?.options?.id === 'skill-console' && entry?.options?.order === 20 && typeof entry?.component === 'function',
    JSON.stringify(entry?.options),
  );
  check('sidebar label follows the locale', entry?.options?.label?.() === '技能', String(entry?.options?.label?.()));
  check('settings entry kept as a second way in', settings?.options?.id === 'skill-console');
  const icon = entry.component();
  check('the sidebar icon comes from the shared icon set', icon?.type === ui.IconSkillOutlineRegular, String(icon?.type));
  const fallbackIcon = (() => {
    const bare = renderWith({ tab: 'installed', catalog, ui: null });
    return bare.bySlot('sidebar.panellist').component();
  })();
  check('the sidebar icon degrades to a plain element', fallbackIcon?.type === 'span' && String(fallbackIcon?.props?.className).includes('dsc-panel-icon'));
  check('the registered page component is the console', typeof component === 'function');
}

// ---------------------------------------------------------------- fallback path
console.log('\n== without the shared controls (fallback markup) ==');
{
  const { component, bySlot } = renderWith({ tab: 'installed', catalog });
  check('settings entry is registered too', bySlot('settings.section')?.options?.id === 'skill-console');
  const tree = component({});
  const text = labelOf(tree);
  check('installed tab renders both skills', text.includes('find-skills') && text.includes('vercel-react-best-practices'));
  check('installed tab shows an update marker', text.includes('有更新'));
  check('fallback buttons keep their dsc classes', nodes(tree, (n) => n.type === 'button' && typeof n.props.className === 'string' && n.props.className.includes('dsc-btn')).length > 0);
  const pills = nodes(tree, (n) => n.type === 'button' && typeof n.props.className === 'string' && n.props.className.includes('dsc-pill'));
  const pillLabels = pills.map(labelOf);
  check(
    'fallback tabs and filters render as dsc pills',
    pills.length >= 4 && ['已安装', '发现', '隔离区', '体检'].every((label) => pillLabels.includes(label)),
    `count=${String(pills.length)} labels=${JSON.stringify(pillLabels)}`,
  );
}
{
  const { component } = renderWith({ tab: 'discover', catalog, discover: { status: 'ready', results: searchResults, error: null } });
  const tree = component({});
  const labels = nodes(tree, (n) => n.type === 'button').map(labelOf);
  check('installed result is marked 已安装', labelOf(tree).includes('已安装'));
  check('installed + upgradable offers 升级', labels.includes('升级'), JSON.stringify(labels));
  check('not-installed still offers 安装', labels.filter((l) => l === '安装').length === 1);
}
{
  const { component } = renderWith({ tab: 'health', catalog });
  const tree = component({});
  const text = labelOf(tree);
  check('health tab lists the finding', text.includes('legacy-key') && text.includes('frontmatter'), text.slice(0, 90));
  check('health tab shows the rehearsal gate', text.includes('预演'));
  check('health tab offers a per-item quarantine', nodes(tree, (n) => n.type === 'button').map(labelOf).includes('移入隔离区'));
}

// ---------------------------------------------------------------- shared-control path
console.log('\n== with the shared controls ==');
const ui = makeUi();
{
  const { component } = renderWith({ tab: 'installed', catalog, ui });
  const tree = component({});
  check('buttons come from the shared package', nodes(tree, (n) => n.type === ui.Button).length > 0, `count=${String(nodes(tree, (n) => n.type === ui.Button).length)}`);
  check('badges come from the shared package', nodes(tree, (n) => n.type === ui.Tag).length > 0, `count=${String(nodes(tree, (n) => n.type === ui.Tag).length)}`);
  check('tabs come from the shared package', nodes(tree, (n) => n.type === ui.Pill).length >= 4, `count=${String(nodes(tree, (n) => n.type === ui.Pill).length)}`);
  check('no plain dsc buttons remain', nodes(tree, (n) => n.type === 'button' && typeof n.props.className === 'string' && n.props.className.includes('dsc-btn')).length === 0);
  const tones = nodes(tree, (n) => n.type === ui.Tag).map((n) => n.props.tone);
  check('badges carry tones', tones.includes('warning') && tones.includes('success'), JSON.stringify(tones));
}
{
  const { component } = renderWith({ tab: 'discover', catalog, discover: { status: 'ready', results: searchResults, error: null }, ui });
  const tree = component({});
  check('search field comes from the shared package', nodes(tree, (n) => n.type === ui.Input).length > 0);
  check('discover cards still offer the right actions', nodes(tree, (n) => n.type === ui.Button).map(labelOf).includes('升级'));
}
{
  const { component } = renderWith({ tab: 'health', catalog, ui });
  const tree = component({});
  check('auto-quarantine toggle is the shared Switch', nodes(tree, (n) => n.type === ui.Switch).length === 1, JSON.stringify(nodes(tree, (n) => n.type === ui.Switch).map((n) => n.props.label)));
  check('the switch starts off and needs the rehearsal', nodes(tree, (n) => n.type === ui.Switch)[0]?.props.checked === false);
}
{
  const withReport = {
    ...catalog,
    health: {
      ...catalog.health,
      auto: { enabled: true, rehearsalConfirmed: true },
      autoReport: [
        { name: 'legacy-key', to: 'E:/DSH/home/skills/.system/legacy-key', problems: ['legacy-key'] },
        { name: 'no-desc', to: null, problems: ['missing-description'], skipped: 'restored by you' },
      ],
      findings: [],
    },
  };
  const { component } = renderWith({ tab: 'health', catalog: withReport, ui });
  const text = labelOf(component({}));
  check('the auto report is shown', text.includes('自动隔离 1') && text.includes('跳过 1'), text.slice(0, 120));
}

console.log(results.every((r) => r.ok) ? '\nALL PASS' : `\nFAILURES: ${results.filter((r) => !r.ok).map((r) => r.label).join(', ')}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
