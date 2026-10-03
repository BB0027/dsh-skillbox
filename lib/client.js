/**
 * dsh-skillbox — Client half (v0.2.0).
 *
 * One top-level Settings page (`settings.section`) that lists every skill DSH
 * resolves and lets the user UNINSTALL a skill — a reversible move into the
 * quarantine location the Host half owns — and restore it again.
 *
 * Plain-JS ModuleLoader entry: no bundler, no Harness Client package imports.
 * React comes from the browser module table; styles are component-local and every
 * selector carries the `dsc-` prefix, so nothing leaks into the host UI.
 */
window.__ModuleLoader__.load({
  id: 'dsh-skillbox',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-skillbox';
    const ROUTE = '/plugins/dsh-skillbox/skills';
    const SECTION_ID = 'skill-console';
    const SECTION_ORDER = 30;

    const DICT = {
      zh: {
        nav: '技能',
        title: '技能控制台',
        intro: '卸载会把技能目录移入隔离区，随时可以一键恢复——不会删除任何文件。插件自带的技能不在这里卸载。',
        search: '搜索名称、描述或使用时机…',
        allSources: '全部来源',
        statTotal: '共 {0}',
        statUninstallable: '可卸载 {0}',
        statBlocked: '插件自带 {0}',
        statRemoved: '已卸载 {0}',
        removedGroup: '已卸载（可恢复）',
        allGroup: '全部技能',
        uninstall: '卸载',
        confirm: '确认卸载',
        cancel: '取消',
        restore: '恢复',
        restoreAll: '全部恢复',
        confirmHint: '这会移动该技能目录，影响仓库：{0}',
        blockedPlugin: '插件自带，需卸载对应插件',
        blockedSource: '来源 {0} 不由本控制台管理',
        loading: '正在读取技能…',
        retry: '重试',
        empty: '没有匹配的技能。',
        emptyAll: 'DSH 当前没有解析到任何技能。',
        modelInvocable: '模型可调',
        userOnly: '仅用户可调',
        conflictHint: '同名冲突风险',
        copyPath: '点击复制路径',
        copied: '已复制',
        doneUninstall: '已卸载：{0}',
        refreshPending: '卸载已生效，但目录刷新有延迟，正在自动重试…',
        doneRestore: '已恢复：{0}',
        quarantineMissing: '隔离项已丢失，无法恢复',
        actionFailed: '操作失败',
        persistWarning: '卸载记录暂时无法写入 profile（{0}），重启后可能丢失（文件仍在隔离区）。',
        workspaces: '可见于',
        root: '目录',
      },
      en: {
        nav: 'Skills',
        title: 'Skill console',
        intro: 'Uninstalling moves a skill directory into quarantine, restorable with one click — no file is ever deleted. Plugin-provided skills are not uninstalled here.',
        search: 'Search name, description, or when to use…',
        allSources: 'All sources',
        statTotal: '{0} total',
        statUninstallable: '{0} uninstallable',
        statBlocked: '{0} plugin-provided',
        statRemoved: '{0} uninstalled',
        removedGroup: 'Uninstalled (restorable)',
        allGroup: 'All skills',
        uninstall: 'Uninstall',
        confirm: 'Confirm uninstall',
        cancel: 'Cancel',
        restore: 'Restore',
        restoreAll: 'Restore all',
        confirmHint: 'This moves the skill directory and touches the repository: {0}',
        blockedPlugin: 'Plugin-provided: uninstall the owning plugin instead',
        blockedSource: 'Source {0} is not managed by this console',
        loading: 'Reading skills…',
        retry: 'Retry',
        empty: 'No skills match.',
        emptyAll: 'DSH resolves no skills right now.',
        modelInvocable: 'Model-invocable',
        userOnly: 'User-only',
        conflictHint: 'Same-name risk',
        copyPath: 'Click to copy the path',
        copied: 'Copied',
        doneUninstall: 'Uninstalled: {0}',
        refreshPending: 'The move is done but the catalog refresh is lagging; retrying…',
        doneRestore: 'Restored: {0}',
        quarantineMissing: 'The quarantined item is gone; it cannot be restored',
        actionFailed: 'Action failed',
        persistWarning: 'The removal record could not be written to the profile ({0}); it may not survive a restart (files stay quarantined).',
        workspaces: 'Visible in',
        root: 'Directory',
      },
    };

    const SOURCE_LABEL = {
      bundled: { zh: '内置', en: 'Bundled' },
      'user-dsh': { zh: '用户级 .dsh', en: 'User (.dsh)' },
      'user-agents': { zh: '用户级 .agents', en: 'User (.agents)' },
      'project-dsh': { zh: '项目级 .dsh', en: 'Project (.dsh)' },
      'project-agents': { zh: '项目级 .agents', en: 'Project (.agents)' },
      runtime: { zh: '运行时', en: 'Runtime' },
      custom: { zh: '自定义', en: 'Custom' },
    };

    const CSS = `
.dsc-root { display: flex; flex-direction: column; gap: 16px; width: 100%; box-sizing: border-box; }
.dsc-head { display: flex; flex-direction: column; gap: 6px; }
.dsc-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsc-intro { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.dsc-stats { display: flex; flex-wrap: wrap; gap: 8px; }
.dsc-stat { padding: 2px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; font-size: 12px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.dsc-stat-off { color: var(--dsw-alias-state-warn-primary); }
.dsc-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dsc-input, .dsc-select { height: 30px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; outline: none; }
.dsc-input { flex: 1 1 200px; min-width: 160px; }
.dsc-input:focus, .dsc-select:focus { border-color: var(--dsw-alias-brand-primary); }
.dsc-btn { height: 30px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; cursor: pointer; }
.dsc-btn:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dsc-btn:disabled { cursor: default; opacity: .5; }
.dsc-btn-danger:hover:not(:disabled) { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }
.dsc-notice { padding: 8px 12px; border-radius: 8px; font-size: 12px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.dsc-notice-warn { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
.dsc-notice-error { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.dsc-group { display: flex; flex-direction: column; gap: 8px; }
.dsc-group-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dsc-list { display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.dsc-row { display: flex; gap: 12px; align-items: flex-start; padding: 10px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsc-row:last-child { border-bottom: none; }
.dsc-row-removed { background: var(--dsw-alias-bg-layer-2); }
.dsc-row-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 auto; }
.dsc-row-title { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.dsc-name { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsc-row-removed .dsc-name { color: var(--dsw-alias-label-secondary); }
.dsc-tag { padding: 1px 6px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsc-tag-warn { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
.dsc-tag-muted { color: var(--dsw-alias-state-idle-primary); }
.dsc-desc { font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dsc-when { font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary); opacity: .85; overflow-wrap: anywhere; }
.dsc-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); opacity: .85; overflow-wrap: anywhere; }
.dsc-path { align-self: flex-start; max-width: 100%; padding: 0; border: none; background: none; font-size: 11px; color: var(--dsw-alias-label-secondary); text-align: left; cursor: pointer; overflow-wrap: anywhere; }
.dsc-path:hover { color: var(--dsw-alias-brand-primary); }
.dsc-actions { flex: 0 0 auto; display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
.dsc-confirm { display: flex; flex-direction: column; gap: 6px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-bg-layer-2); }
.dsc-confirm-text { font-size: 11px; line-height: 1.5; color: var(--dsw-alias-state-warn-primary); overflow-wrap: anywhere; }
.dsc-confirm-row { display: flex; gap: 8px; }
.dsc-empty { padding: 18px 12px; text-align: center; font-size: 12px; color: var(--dsw-alias-label-secondary); }
`;

    const text = (localeId, key, args) => {
      const dict = /^zh/i.test(localeId) ? DICT.zh : DICT.en;
      let value = dict[key] ?? DICT.en[key] ?? key;
      (args ?? []).forEach((arg, index) => {
        value = value.replace(`{${String(index)}}`, String(arg));
      });
      return value;
    };

    const readLocaleId = (locale) => {
      try {
        const snapshot = locale?.getSnapshot?.() ?? locale?.getLocale?.();
        return String(snapshot?.id ?? snapshot?.locale ?? snapshot?.language ?? snapshot?.current ?? 'en');
      } catch {
        return 'en';
      }
    };

    const sourceLabel = (source, localeId) => {
      const entry = SOURCE_LABEL[source];
      if (entry === undefined) return source;
      return /^zh/i.test(localeId) ? entry.zh : entry.en;
    };

    return {
      // `locale` must be declared: the Client context refuses plain property
      // access to a service the plugin did not inject.
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = (() => {
          try {
            const viaGet = typeof ctx.get === 'function' ? ctx.get('locale') : undefined;
            if (viaGet !== undefined && viaGet !== null) return viaGet;
          } catch {
            /* fall through to the property form */
          }
          try {
            return ctx.locale;
          } catch {
            return undefined;
          }
        })();
        try {
          locale?.register?.(NS, 'zh', DICT.zh);
          locale?.register?.(NS, 'en', DICT.en);
        } catch {
          /* localization is best-effort; the page falls back to English */
        }

        function useLocale() {
          const [, force] = React.useReducer((n) => n + 1, 0);
          React.useEffect(() => {
            if (typeof locale?.subscribe !== 'function') return undefined;
            return locale.subscribe(() => force());
          }, []);
          const localeId = readLocaleId(locale);
          const t = React.useCallback((key, ...args) => text(localeId, key, args), [localeId]);
          return { localeId, t };
        }

        function useCatalog() {
          const [revision, setRevision] = React.useState(0);
          const [state, setState] = React.useState({ status: 'loading', data: null, error: null });
          React.useEffect(() => {
            let cancelled = false;
            setState((previous) => ({ ...previous, status: 'loading' }));
            fetch(ROUTE, { cache: 'no-store', headers: { accept: 'application/json' } })
              .then(async (response) => ({ ok: response.ok, status: response.status, body: await response.json().catch(() => null) }))
              .then(({ ok, status, body }) => {
                if (cancelled) return;
                if (ok && body?.ok) setState({ status: 'ready', data: body, error: null });
                else setState({ status: 'error', data: null, error: body?.error ?? `HTTP ${String(status)}` });
              })
              .catch((error) => {
                if (!cancelled) setState({ status: 'error', data: null, error: String(error?.message ?? error) });
              });
            return () => {
              cancelled = true;
            };
          }, [revision]);
          const reload = React.useCallback(() => setRevision((n) => n + 1), []);
          const adopt = React.useCallback((body) => {
            if (body?.ok === true) setState({ status: 'ready', data: body, error: null });
          }, []);
          return { state, reload, adopt };
        }

        function Console() {
          const { localeId, t } = useLocale();
          const { state, reload, adopt } = useCatalog();
          const [query, setQuery] = React.useState('');
          const [sourceFilter, setSourceFilter] = React.useState('all');
          const [busy, setBusy] = React.useState(null);
          const [notice, setNotice] = React.useState(null);
          const [confirming, setConfirming] = React.useState(null);

          const skills = Array.isArray(state.data?.skills) ? state.data.skills : [];
          const removed = Array.isArray(state.data?.removed) ? state.data.removed : [];
          const stats = state.data?.stats ?? { total: skills.length, uninstallable: 0, blocked: 0, removed: removed.length };

          const sources = React.useMemo(() => {
            const seen = new Set();
            for (const skill of skills) if (typeof skill.source === 'string') seen.add(skill.source);
            return [...seen].sort();
          }, [skills]);

          const filtered = React.useMemo(() => {
            const needle = query.trim().toLowerCase();
            return skills.filter((skill) => {
              if (sourceFilter !== 'all' && skill.source !== sourceFilter) return false;
              if (needle === '') return true;
              const haystack = `${String(skill.name)}\n${String(skill.description ?? '')}\n${String(skill.whenToUse ?? '')}`.toLowerCase();
              return haystack.includes(needle);
            });
          }, [skills, query, sourceFilter]);

          const post = React.useCallback(
            async (payload) => {
              const response = await fetch(ROUTE, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
              });
              const body = await response.json().catch(() => null);
              if (!response.ok || body?.ok !== true) throw new Error(body?.error ?? `HTTP ${String(response.status)}`);
              adopt(body);
              return body;
            },
            [adopt],
          );

          const doUninstall = React.useCallback(
            async (skill, confirmed) => {
              setBusy(skill.name);
              setNotice(null);
              try {
                const body = await post({ action: 'uninstall', name: skill.name, confirm: confirmed === true });
                setConfirming(null);
                setNotice(
                  body?.result?.settled === false
                    ? { kind: 'warn', text: t('refreshPending') }
                    : { kind: 'info', text: t('doneUninstall', skill.name) },
                );
                setTimeout(reload, 1200);
              } catch (error) {
                setNotice({ kind: 'error', text: `${t('actionFailed')}: ${String(error?.message ?? error)}` });
              } finally {
                setBusy(null);
              }
            },
            [post, t],
          );

          const doRestore = React.useCallback(
            async (item) => {
              setBusy(item.to);
              setNotice(null);
              try {
                const body = await post({ action: 'restore', target: item.to });
                setNotice(
                  body?.result?.settled === false
                    ? { kind: 'warn', text: t('refreshPending') }
                    : { kind: 'info', text: t('doneRestore', item.name) },
                );
                setTimeout(reload, 1200);
              } catch (error) {
                setNotice({ kind: 'error', text: `${t('actionFailed')}: ${String(error?.message ?? error)}` });
              } finally {
                setBusy(null);
              }
            },
            [post, t],
          );

          const doRestoreAll = React.useCallback(async () => {
            const pending = removed.filter((item) => item.present === true);
            if (pending.length === 0) return;
            setBusy('all');
            setNotice(null);
            try {
              for (const item of pending) await post({ action: 'restore', target: item.to });
              setNotice({ kind: 'info', text: t('doneRestore', `${String(pending.length)}`) });
              setTimeout(reload, 1200);
            } catch (error) {
              setNotice({ kind: 'error', text: `${t('actionFailed')}: ${String(error?.message ?? error)}` });
            } finally {
              setBusy(null);
            }
          }, [post, removed, t]);

          const copyPath = React.useCallback(
            (path) => {
              try {
                void navigator.clipboard?.writeText?.(path);
                setNotice({ kind: 'info', text: `${t('copied')}: ${path}` });
              } catch {
                setNotice({ kind: 'info', text: path });
              }
            },
            [t],
          );

          const blockedText = React.useCallback(
            (skill) => {
              const reason = String(skill.blockedReason ?? '');
              if (reason.startsWith('plugin-provided')) return t('blockedPlugin');
              const match = /^source "([^"]+)"/.exec(reason);
              return t('blockedSource', sourceLabel(match === null ? String(skill.source) : match[1], localeId));
            },
            [localeId, t],
          );

          const header = h(
            'div',
            { className: 'dsc-head' },
            h('h2', { className: 'dsc-title' }, t('title')),
            h('p', { className: 'dsc-intro' }, t('intro')),
            h(
              'div',
              { className: 'dsc-stats' },
              h('span', { className: 'dsc-stat' }, t('statTotal', stats.total)),
              h('span', { className: 'dsc-stat' }, t('statUninstallable', stats.uninstallable)),
              h('span', { className: 'dsc-stat' }, t('statBlocked', stats.blocked)),
              h('span', { className: stats.removed > 0 ? 'dsc-stat dsc-stat-off' : 'dsc-stat' }, t('statRemoved', stats.removed)),
            ),
          );

          const toolbar = h(
            'div',
            { className: 'dsc-toolbar' },
            h('input', {
              className: 'dsc-input',
              type: 'search',
              value: query,
              placeholder: t('search'),
              onChange: (event) => setQuery(event.target.value),
            }),
            h(
              'select',
              { className: 'dsc-select', value: sourceFilter, onChange: (event) => setSourceFilter(event.target.value) },
              h('option', { value: 'all' }, t('allSources')),
              ...sources.map((source) => h('option', { key: source, value: source }, sourceLabel(source, localeId))),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsc-btn',
                disabled: busy !== null || removed.filter((item) => item.present === true).length === 0,
                onClick: () => void doRestoreAll(),
              },
              t('restoreAll'),
            ),
          );

          const actionFor = (skill) => {
            if (confirming === skill.name) {
              return h(
                'div',
                { className: 'dsc-confirm' },
                h('div', { className: 'dsc-confirm-text' }, t('confirmHint', String(skill.root ?? skill.dir ?? skill.path ?? ''))),
                h(
                  'div',
                  { className: 'dsc-confirm-row' },
                  h(
                    'button',
                    { type: 'button', className: 'dsc-btn dsc-btn-danger', disabled: busy !== null, onClick: () => void doUninstall(skill, true) },
                    t('confirm'),
                  ),
                  h('button', { type: 'button', className: 'dsc-btn', disabled: busy !== null, onClick: () => setConfirming(null) }, t('cancel')),
                ),
              );
            }
            if (skill.uninstallable === true) {
              return h(
                'div',
                { className: 'dsc-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsc-btn dsc-btn-danger',
                    disabled: busy !== null,
                    onClick: () => (skill.needsConfirm === true ? setConfirming(skill.name) : void doUninstall(skill, false)),
                  },
                  t('uninstall'),
                ),
              );
            }
            return h(
              'div',
              { className: 'dsc-actions' },
              h('button', { type: 'button', className: 'dsc-btn', disabled: true, title: blockedText(skill) }, t('uninstall')),
              h('span', { className: 'dsc-meta' }, blockedText(skill)),
            );
          };

          const liveRow = (skill) =>
            h(
              'div',
              { key: skill.name, className: 'dsc-row' },
              h(
                'div',
                { className: 'dsc-row-main' },
                h(
                  'div',
                  { className: 'dsc-row-title' },
                  h('span', { className: 'dsc-name' }, skill.name),
                  h('span', { className: 'dsc-tag' }, sourceLabel(skill.source, localeId)),
                  skill.invocation?.modelInvocable === true
                    ? h('span', { className: 'dsc-tag' }, t('modelInvocable'))
                    : h('span', { className: 'dsc-tag dsc-tag-muted' }, t('userOnly')),
                  skill.conflict === true ? h('span', { className: 'dsc-tag dsc-tag-warn' }, t('conflictHint')) : null,
                ),
                skill.whenToUse ? h('div', { className: 'dsc-when' }, skill.whenToUse) : null,
                h('div', { className: 'dsc-desc' }, String(skill.description ?? '')),
                skill.path
                  ? h('button', { type: 'button', className: 'dsc-path', title: t('copyPath'), onClick: () => copyPath(skill.path) }, skill.path)
                  : null,
                skill.needsConfirm === true && skill.root
                  ? h('div', { className: 'dsc-meta' }, `${t('root')}: ${String(skill.root)}`)
                  : null,
                skill.workspaces?.length ? h('div', { className: 'dsc-meta' }, `${t('workspaces')}: ${skill.workspaces.join(' · ')}`) : null,
              ),
              actionFor(skill),
            );

          const removedRow = (item) =>
            h(
              'div',
              { key: item.to, className: 'dsc-row dsc-row-removed' },
              h(
                'div',
                { className: 'dsc-row-main' },
                h(
                  'div',
                  { className: 'dsc-row-title' },
                  h('span', { className: 'dsc-name' }, item.name),
                  h('span', { className: 'dsc-tag' }, sourceLabel(item.source, localeId)),
                ),
                h('button', { type: 'button', className: 'dsc-path', title: t('copyPath'), onClick: () => copyPath(String(item.to)) }, String(item.to)),
                item.present === true ? null : h('div', { className: 'dsc-meta dsc-tag-warn' }, t('quarantineMissing')),
              ),
              h(
                'div',
                { className: 'dsc-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsc-btn',
                    disabled: busy !== null || item.present !== true,
                    onClick: () => void doRestore(item),
                  },
                  t('restore'),
                ),
              ),
            );

          const group = (key, title, rows) =>
            rows.length === 0
              ? null
              : h(
                  'div',
                  { className: 'dsc-group' },
                  h('div', { className: 'dsc-group-title' }, `${title} · ${String(rows.length)}`),
                  h('div', { className: 'dsc-list' }, ...rows),
                );

          const body =
            state.status === 'loading'
              ? h('div', { className: 'dsc-empty' }, t('loading'))
              : state.status === 'error'
                ? h(
                    'div',
                    { className: 'dsc-group' },
                    h('div', { className: 'dsc-notice dsc-notice-error' }, state.error),
                    h('div', null, h('button', { type: 'button', className: 'dsc-btn', onClick: reload }, t('retry'))),
                  )
                : skills.length === 0 && removed.length === 0
                  ? h('div', { className: 'dsc-empty' }, t('emptyAll'))
                  : h(
                      React.Fragment,
                      null,
                      group('removed', t('removedGroup'), removed.map(removedRow)),
                      filtered.length === 0
                        ? h('div', { className: 'dsc-empty' }, t('empty'))
                        : group('live', t('allGroup'), filtered.map(liveRow)),
                    );

          const persistWarning =
            state.data?.persisted === false && state.data?.persistError
              ? h('div', { className: 'dsc-notice dsc-notice-warn' }, t('persistWarning', state.data.persistError))
              : null;

          return h(
            'div',
            { className: 'dsc-root' },
            h('style', null, CSS),
            header,
            toolbar,
            persistWarning,
            notice ? h('div', { className: notice.kind === 'error' ? 'dsc-notice dsc-notice-error' : 'dsc-notice' }, notice.text) : null,
            body,
          );
        }

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: SECTION_ID,
              order: SECTION_ORDER,
              label: () => text(readLocaleId(locale), 'nav'),
            },
            Console,
          ),
        );
      },
    };
  },
});
