/**
 * dsh-skillbox — Client half (v0.3.0).
 *
 * One top-level Settings page (`settings.section`) with four tabs:
 *
 *   1. **Installed** — every skill DSH resolves, with where it came from, whether it
 *      was edited here, whether upstream moved on, and per-row upgrade / uninstall.
 *   2. **Discover**  — search skills.sh, preview a skill's `SKILL.md`, install it into
 *      the DSH root, with a confirmation step for low-trust sources.
 *   3. **Quarantine** — everything this console has moved out of discovery, with the
 *      reason (manual / upgrade backup) and a one-click restore.
 *   4. **Health**    — environment self-check: is the `skills` CLI present, which
 *      version, does it still carry the `dsh` agent patch, and where do the lock file
 *      and this plugin's state file live. Full skill health checks land in 0.4.0.
 *
 * Plain-JS ModuleLoader entry: no bundler, no Harness Client package imports. React
 * comes from the browser module table; styles are component-local and every selector
 * carries the `dsc-` prefix, so nothing leaks into the host UI.
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
    /** Owners whose skills need no extra confirmation before install. */
    const TRUSTED_OWNERS = new Set(['vercel-labs', 'anthropics', 'microsoft', 'openai', 'google']);
    /** A source below this many installs gets an explicit confirmation. */
    const TRUSTED_INSTALLS = 100;

    const DICT = {
      zh: {
        nav: '技能',
        title: '技能控制台',
        intro: '总览 DSH 解析到的技能，可从 skills.sh 搜索安装、安全升级；卸载只是移入隔离区，随时可恢复——不会删除任何文件，也不会改写技能的 SKILL.md。',
        tabInstalled: '已安装',
        tabDiscover: '发现',
        tabQuarantine: '隔离区',
        tabHealth: '体检',
        search: '搜索名称、描述或使用时机…',
        allSources: '全部来源',
        statTotal: '共 {0}',
        statUninstallable: '可卸载 {0}',
        statBlocked: '插件自带 {0}',
        statModified: '本地已改 {0}',
        statUpgradable: '有更新 {0}',
        statRemoved: '隔离 {0}',
        removedGroup: '隔离区（可恢复）',
        allGroup: '全部技能',
        localGroup: '本地手写',
        originGroup: '来自 {0}',
        uninstall: '卸载',
        confirm: '确认卸载',
        cancel: '取消',
        restore: '恢复',
        restoreAll: '全部恢复',
        confirmHint: '这会移动该技能目录，影响仓库：{0}',
        confirmUninstallHint: '这会把它移入隔离区（可恢复）：{0}',
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
        doneUninstall: '已移入隔离区：{0}',
        refreshPending: '操作已生效，但目录刷新有延迟，正在自动重试…',
        doneRestore: '已恢复：{0}',
        doneInstall: '已安装：{0}',
        doneUpgrade: '已升级：{0}',
        quarantineMissing: '隔离项已丢失，无法恢复',
        actionFailed: '操作失败',
        workspaces: '可见于',
        root: '目录',
        origin: '来源',
        skillPath: '上游路径',
        installedAt: '安装于',
        updatedAt: '更新于',
        installedBy: '由{0}安装',
        byUser: '你',
        byAi: 'AI',
        driftClean: '与安装时一致',
        driftModified: '本地已修改',
        driftUnknown: '无基线记录',
        updateCurrent: '已是最新',
        updateAvailable: '有更新可用',
        updateUntracked: '无法比对上游',
        updateUnknown: '更新状态未知',
        upgrade: '升级',
        upgradeForce: '强制覆盖',
        upgradeSkipModified: '本地已修改，已跳过（要覆盖请用强制）',
        confirmUpgrade: '确认升级',
        confirmUpgradeHint: '升级会先把当前版本移入隔离区，再重新安装；失败会自动回滚。',
        upgradePlan: '升级预览',
        upgradePlanRun: '预览可升级项',
        upgradeAll: '全部升级',
        upgradeDo: '开始升级',
        planUpgradable: '将升级 {0}',
        planSkipped: '将跳过 {0}',
        planTotal: '共检查 {0}',
        planActionUpgrade: '升级',
        planActionSkip: '跳过',
        doneUpgradeAll: '批量升级完成：成功 {0}，跳过 {1}，失败 {2}',
        doneUpgradePlan: '预览完成，未改动任何文件。',
        forceConfirm: '我知道这会覆盖本地改动',
        discoverIntro: '在 skills.sh 上搜索，预览 SKILL.md，然后一键装进 DSH 的用户级技能目录。',
        discoverPlaceholder: '英文关键词，例如 react performance',
        discoverOwner: '限定作者（可选）',
        discoverSearch: '搜索',
        discoverSearching: '正在搜索…',
        discoverEmpty: '没有结果，换个英文关键词试试。',
        discoverFailed: '搜索失败：{0}',
        installs: '{0} 次安装',
        preview: '预览',
        previewLoading: '正在读取 SKILL.md…',
        previewFailed: '预览失败：{0}',
        security: '安全审计',
        snyk: 'Snyk',
        socket: 'Socket',
        install: '安装',
        confirmInstall: '确认安装',
        confirmInstallHint: '这个来源可信度较低（{0}）。第三方技能是外部内容，只当资料，不要照抄执行。',
        installing: '正在安装…',
        tagInstalled: '已安装',
        tagHasUpdate: '有更新',
        tagInstalling: '正在安装…',
        discoverInstalledHint: '这个技能已经在你的技能目录里；“已安装”页可以升级或卸载。',
        doneInstallWhere: '已安装 {0} —— 卡片已标记，可在“已安装”页升级或卸载。',
        cliMissing: '未检测到 skills CLI，安装功能不可用。',
        cliMissingHint: '装上 Node.js 与 skills 后点“重新检测”：npm i -g skills；随后运行补丁脚本加入 DSH agent。',
        cliMissingPatch: 'skills CLI 缺少 dsh agent 补丁，安装会装错位置，请重跑补丁脚本。',
        envCheck: '重新检测',
        envTitle: '环境自检',
        envCli: 'skills CLI',
        envVersion: '版本',
        envPatch: 'DSH agent 补丁',
        envCommand: '命令',
        envLock: 'CLI lock',
        envState: '本插件状态',
        envStateVia: '解析方式',
        envAvailable: '可用',
        envUnavailable: '不可用',
        envPatchYes: '在',
        envPatchNo: '缺失',
        envPatchUnknown: '读不到',
        healthIntro0_3: '0.3.0 先交付“安装/升级”这条链；技能体检与自动隔离在 0.4.0。',
        healthDiagnostics: 'CLI 报告的异常',
        healthNoDiagnostics: 'CLI 没有报告异常。',
        rateLimit: 'GitHub API 限流，更新检查可能不准（设置 GITHUB_TOKEN 可缓解）。',
        warnings: '提示',
      },
      en: {
        nav: 'Skills',
        title: 'Skill console',
        intro: 'Overview of every skill DSH resolves, plus search-and-install from skills.sh and safe upgrades. Uninstalling only moves a directory into quarantine — no file is deleted, no SKILL.md is ever rewritten.',
        tabInstalled: 'Installed',
        tabDiscover: 'Discover',
        tabQuarantine: 'Quarantine',
        tabHealth: 'Health',
        search: 'Search name, description, or when to use…',
        allSources: 'All sources',
        statTotal: '{0} total',
        statUninstallable: '{0} uninstallable',
        statBlocked: '{0} plugin-provided',
        statModified: '{0} edited locally',
        statUpgradable: '{0} upgradable',
        statRemoved: '{0} quarantined',
        removedGroup: 'Quarantine (restorable)',
        allGroup: 'All skills',
        localGroup: 'Written locally',
        originGroup: 'From {0}',
        uninstall: 'Uninstall',
        confirm: 'Confirm uninstall',
        cancel: 'Cancel',
        restore: 'Restore',
        restoreAll: 'Restore all',
        confirmHint: 'This moves the skill directory and touches the repository: {0}',
        confirmUninstallHint: 'This moves it into quarantine (restorable): {0}',
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
        doneUninstall: 'Moved to quarantine: {0}',
        refreshPending: 'The action is done but the catalog refresh is lagging; retrying…',
        doneRestore: 'Restored: {0}',
        doneInstall: 'Installed: {0}',
        doneUpgrade: 'Upgraded: {0}',
        quarantineMissing: 'The quarantined item is gone; it cannot be restored',
        actionFailed: 'Action failed',
        workspaces: 'Visible in',
        root: 'Directory',
        origin: 'Source',
        skillPath: 'Upstream path',
        installedAt: 'Installed',
        updatedAt: 'Updated',
        installedBy: 'Installed by {0}',
        byUser: 'you',
        byAi: 'AI',
        driftClean: 'Matches install',
        driftModified: 'Edited locally',
        driftUnknown: 'No baseline',
        updateCurrent: 'Up to date',
        updateAvailable: 'Update available',
        updateUntracked: 'No upstream to compare',
        updateUnknown: 'Update status unknown',
        upgrade: 'Upgrade',
        upgradeForce: 'Force overwrite',
        upgradeSkipModified: 'Edited locally — skipped (use force to overwrite)',
        confirmUpgrade: 'Confirm upgrade',
        confirmUpgradeHint: 'The current version moves into quarantine first, then the skill is reinstalled; a failure rolls back.',
        upgradePlan: 'Upgrade preview',
        upgradePlanRun: 'Preview upgrades',
        upgradeAll: 'Upgrade all',
        upgradeDo: 'Run upgrade',
        planUpgradable: '{0} to upgrade',
        planSkipped: '{0} skipped',
        planTotal: '{0} checked',
        planActionUpgrade: 'upgrade',
        planActionSkip: 'skip',
        doneUpgradeAll: 'Batch upgrade: {0} upgraded, {1} skipped, {2} failed',
        doneUpgradePlan: 'Preview complete — nothing was changed.',
        forceConfirm: 'I understand this overwrites my local edits',
        discoverIntro: 'Search skills.sh, preview the SKILL.md, then install it into the DSH user-level skill directory.',
        discoverPlaceholder: 'English keywords, e.g. react performance',
        discoverOwner: 'Limit to owner (optional)',
        discoverSearch: 'Search',
        discoverSearching: 'Searching…',
        discoverEmpty: 'No results — try different English keywords.',
        discoverFailed: 'Search failed: {0}',
        installs: '{0} installs',
        preview: 'Preview',
        previewLoading: 'Reading SKILL.md…',
        previewFailed: 'Preview failed: {0}',
        security: 'Security audits',
        snyk: 'Snyk',
        socket: 'Socket',
        install: 'Install',
        confirmInstall: 'Confirm install',
        confirmInstallHint: 'This source looks low-trust ({0}). Third-party skills are external content: treat them as reference, do not execute them blindly.',
        installing: 'Installing…',
        tagInstalled: 'Installed',
        tagHasUpdate: 'Update available',
        tagInstalling: 'Installing…',
        discoverInstalledHint: 'This skill is already in your skill directory; upgrade or uninstall it from the Installed tab.',
        doneInstallWhere: 'Installed {0} — the card is marked; upgrade or uninstall it from the Installed tab.',
        cliMissing: 'The skills CLI was not found, so installing is unavailable.',
        cliMissingHint: 'Install Node.js and skills, then press “Check again”: npm i -g skills; then run the patch script to add the DSH agent.',
        cliMissingPatch: 'The skills CLI is missing the dsh agent patch; installs would land in the wrong place. Re-run the patch script.',
        envCheck: 'Check again',
        envTitle: 'Environment',
        envCli: 'skills CLI',
        envVersion: 'Version',
        envPatch: 'DSH agent patch',
        envCommand: 'Command',
        envLock: 'CLI lock',
        envState: 'Plugin state',
        envStateVia: 'Resolved via',
        envAvailable: 'available',
        envUnavailable: 'unavailable',
        envPatchYes: 'present',
        envPatchNo: 'missing',
        envPatchUnknown: 'unreadable',
        healthIntro0_3: '0.3.0 ships the install/upgrade chain; skill health checks and auto-quarantine arrive in 0.4.0.',
        healthDiagnostics: 'Reported by the CLI',
        healthNoDiagnostics: 'The CLI reported nothing unusual.',
        rateLimit: 'GitHub API is rate limited, so update checks may be incomplete (set GITHUB_TOKEN to improve).',
        warnings: 'Notes',
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

    const REASON_LABEL = {
      manual: { zh: '手动卸载', en: 'Uninstalled by hand' },
      'upgrade-backup': { zh: '升级前备份', en: 'Pre-upgrade backup' },
      auto: { zh: '自动隔离', en: 'Auto-quarantined' },
      legacy: { zh: '旧版记录', en: 'Legacy record' },
    };

    const CSS = `
.dsc-root { display: flex; flex-direction: column; gap: 16px; width: 100%; box-sizing: border-box; }
.dsc-head { display: flex; flex-direction: column; gap: 6px; }
.dsc-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsc-intro { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.dsc-stats { display: flex; flex-wrap: wrap; gap: 8px; }
.dsc-stat { padding: 2px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; font-size: 12px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.dsc-stat-off { color: var(--dsw-alias-state-warn-primary); }
.dsc-tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--dsw-alias-border-l1); padding-bottom: 6px; }
.dsc-tab { height: 28px; padding: 0 12px; border: 1px solid transparent; border-radius: 8px; background: none; color: var(--dsw-alias-label-secondary); font-size: 12px; cursor: pointer; }
.dsc-tab:hover:not(:disabled) { color: var(--dsw-alias-brand-primary); }
.dsc-tab-on { border-color: var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-weight: 600; }
.dsc-tab:disabled { opacity: .45; cursor: default; }
.dsc-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dsc-input, .dsc-select { height: 30px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; outline: none; }
.dsc-input { flex: 1 1 200px; min-width: 160px; }
.dsc-input:focus, .dsc-select:focus { border-color: var(--dsw-alias-brand-primary); }
.dsc-btn { height: 30px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; cursor: pointer; white-space: nowrap; }
.dsc-btn:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dsc-btn:disabled { cursor: default; opacity: .5; }
.dsc-btn-danger:hover:not(:disabled) { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }
.dsc-btn-primary { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dsc-check { display: flex; gap: 6px; align-items: center; font-size: 11px; color: var(--dsw-alias-state-warn-primary); }
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
.dsc-tag-ok { color: var(--dsw-alias-state-success-primary, var(--dsw-alias-brand-primary)); border-color: var(--dsw-alias-border-l1); }
.dsc-tag-muted { color: var(--dsw-alias-state-idle-primary); }
.dsc-desc { font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dsc-when { font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary); opacity: .85; overflow-wrap: anywhere; }
.dsc-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); opacity: .85; overflow-wrap: anywhere; }
.dsc-path { align-self: flex-start; max-width: 100%; padding: 0; border: none; background: none; font-size: 11px; color: var(--dsw-alias-label-secondary); text-align: left; cursor: pointer; overflow-wrap: anywhere; }
.dsc-path:hover { color: var(--dsw-alias-brand-primary); }
.dsc-actions { flex: 0 0 auto; display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
.dsc-confirm { display: flex; flex-direction: column; gap: 6px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-bg-layer-2); }
.dsc-confirm-text { font-size: 11px; line-height: 1.5; color: var(--dsw-alias-state-warn-primary); overflow-wrap: anywhere; }
.dsc-confirm-row { display: flex; gap: 8px; flex-wrap: wrap; }
.dsc-empty { padding: 18px 12px; text-align: center; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsc-card { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.dsc-card-head { display: flex; gap: 12px; align-items: flex-start; }
.dsc-pre { margin: 0; padding: 10px; max-height: 260px; overflow: auto; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
.dsc-kv { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsc-kv b { font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsc-plan { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); }
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

    const reasonLabel = (reason, localeId) => {
      const entry = REASON_LABEL[reason];
      if (entry === undefined) return String(reason ?? '');
      return /^zh/i.test(localeId) ? entry.zh : entry.en;
    };

    const formatCount = (value) => {
      const number = Number(value);
      return Number.isFinite(number) ? number.toLocaleString() : String(value);
    };

    const shortDate = (value) => {
      if (typeof value !== 'string' || value === '') return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
            setState((previous) => ({ ...previous, status: previous.data === null ? 'loading' : previous.status }));
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
          const [tab, setTab] = React.useState('installed');
          const [busy, setBusy] = React.useState(null);
          const [notice, setNotice] = React.useState(null);
          const [confirming, setConfirming] = React.useState(null);
          const [forceKeys, setForceKeys] = React.useState({});
          const [plan, setPlan] = React.useState(null);
          const [query, setQuery] = React.useState('');
          const [sourceFilter, setSourceFilter] = React.useState('all');
          const [onlyModified, setOnlyModified] = React.useState(false);
          const [discoverQuery, setDiscoverQuery] = React.useState('');
          const [discoverOwner, setDiscoverOwner] = React.useState('');
          const [discover, setDiscover] = React.useState({ status: 'idle', results: [], error: null });
          const [previews, setPreviews] = React.useState({});

          const data = state.data;
          const skills = Array.isArray(data?.skills) ? data.skills : [];
          const removed = Array.isArray(data?.removed) ? data.removed : [];
          const env = data?.env ?? null;
          const cliReady = env?.available === true;
          const stats = data?.stats ?? { total: skills.length, uninstallable: 0, blocked: 0, removed: removed.length, modified: 0, upgradable: 0 };
          const warnings = Array.isArray(data?.warnings) ? data.warnings : [];

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

          const run = React.useCallback(
            async (key, payload, work) => {
              setBusy(key);
              setNotice(null);
              try {
                const body = await post(payload);
                if (typeof work === 'function') work(body);
                return body;
              } catch (error) {
                setNotice({ kind: 'error', text: `${t('actionFailed')}: ${String(error?.message ?? error)}` });
                return null;
              } finally {
                setBusy(null);
              }
            },
            [post, t],
          );

          const sources = React.useMemo(() => {
            const seen = new Set();
            for (const skill of skills) if (typeof skill.source === 'string') seen.add(skill.source);
            return [...seen].sort();
          }, [skills]);

          /**
           * A search result must say whether it is already installed, and offer an
           * upgrade instead of a second install. The card is the only thing the user is
           * looking at right after pressing Install, so it has to change in place.
           */
          const installedByName = React.useMemo(() => {
            const map = new Map();
            for (const skill of skills) map.set(skill.name, skill);
            return map;
          }, [skills]);

          const localFor = React.useCallback(
            (result) => installedByName.get(String(result?.skillId ?? '')) ?? installedByName.get(String(result?.name ?? '')) ?? null,
            [installedByName],
          );

          const filtered = React.useMemo(() => {
            const needle = query.trim().toLowerCase();
            return skills.filter((skill) => {
              if (sourceFilter !== 'all' && skill.source !== sourceFilter) return false;
              if (onlyModified && skill.drift !== 'modified') return false;
              if (needle === '') return true;
              const haystack = `${String(skill.name)}\n${String(skill.description ?? '')}\n${String(skill.whenToUse ?? '')}\n${String(skill.origin ?? '')}`.toLowerCase();
              return haystack.includes(needle);
            });
          }, [skills, query, sourceFilter, onlyModified]);

          const grouped = React.useMemo(() => {
            const byOrigin = new Map();
            for (const skill of filtered) {
              const key = typeof skill.origin === 'string' && skill.origin !== '' ? skill.origin : '__local__';
              if (!byOrigin.has(key)) byOrigin.set(key, []);
              byOrigin.get(key).push(skill);
            }
            return [...byOrigin.entries()].sort((left, right) => left[0].localeCompare(right[0]));
          }, [filtered]);

          const copyPath = React.useCallback(
            (value) => {
              try {
                void navigator.clipboard?.writeText?.(value);
                setNotice({ kind: 'info', text: `${t('copied')}: ${value}` });
              } catch {
                setNotice({ kind: 'info', text: value });
              }
            },
            [t],
          );

          const doUninstall = React.useCallback(
            async (skill, confirmed) => {
              const body = await run(`uninstall:${skill.name}`, { action: 'uninstall', name: skill.name, confirm: confirmed === true }, (result) => {
                setConfirming(null);
                setNotice(
                  result?.result?.settled === false
                    ? { kind: 'warn', text: t('refreshPending') }
                    : { kind: 'info', text: t('doneUninstall', skill.name) },
                );
                setTimeout(reload, 1200);
              });
              return body;
            },
            [reload, run, t],
          );

          const doRestore = React.useCallback(
            async (item) => {
              await run(`restore:${item.to}`, { action: 'restore', target: item.to }, (body) => {
                setNotice(
                  body?.result?.settled === false
                    ? { kind: 'warn', text: t('refreshPending') }
                    : { kind: 'info', text: t('doneRestore', item.name) },
                );
                setTimeout(reload, 1200);
              });
            },
            [reload, run, t],
          );

          const doRestoreAll = React.useCallback(async () => {
            const pending = removed.filter((item) => item.present === true);
            if (pending.length === 0) return;
            setBusy('restore-all');
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
          }, [post, removed, reload, t]);

          const doUpgrade = React.useCallback(
            async (skill, force) => {
              await run(`upgrade:${skill.name}`, { action: 'upgrade', name: skill.name, force: force === true }, (body) => {
                const result = body?.result;
                if (result?.status === 'upgraded') setNotice({ kind: 'info', text: t('doneUpgrade', skill.name) });
                else if (result?.status === 'skipped') setNotice({ kind: 'warn', text: `${skill.name}: ${result.reason ?? t('upgradeSkipModified')}` });
                else setNotice({ kind: 'error', text: `${skill.name}: ${result?.error ?? 'failed'}` });
                setTimeout(reload, 1200);
              });
            },
            [reload, run, t],
          );

          const doPlan = React.useCallback(async () => {
            await run('plan', { action: 'upgrade-plan' }, (body) => {
              setPlan(body?.result?.items ?? []);
              setNotice({ kind: 'info', text: t('doneUpgradePlan') });
            });
          }, [run, t]);

          const doUpgradeAll = React.useCallback(async () => {
            await run('upgrade-all', { action: 'upgrade-all' }, (body) => {
              const results = Array.isArray(body?.result?.results) ? body.result.results : [];
              const upgraded = results.filter((item) => item.status === 'upgraded').length;
              const skipped = results.filter((item) => item.status === 'skipped').length;
              const failed = results.filter((item) => item.status === 'failed').length;
              setPlan(body?.result?.plan?.items ?? []);
              setNotice({ kind: failed > 0 ? 'error' : 'info', text: t('doneUpgradeAll', upgraded, skipped, failed) });
              setTimeout(reload, 1500);
            });
          }, [reload, run, t]);

          const doSearch = React.useCallback(async () => {
            const needle = discoverQuery.trim();
            if (needle === '') return;
            setDiscover((previous) => ({ ...previous, status: 'loading', error: null }));
            setBusy('search');
            try {
              const body = await post({ action: 'search', query: needle, owner: discoverOwner.trim(), limit: 12 });
              const result = body?.result ?? { ok: false, results: [], error: 'no result' };
              setDiscover({ status: result.ok === true ? 'ready' : 'error', results: result.results ?? [], error: result.error ?? null });
            } catch (error) {
              setDiscover({ status: 'error', results: [], error: String(error?.message ?? error) });
            } finally {
              setBusy(null);
            }
          }, [discoverOwner, discoverQuery, post]);

          const doPreview = React.useCallback(
            async (id) => {
              if (previews[id] !== undefined) {
                setPreviews((previous) => {
                  const next = { ...previous };
                  delete next[id];
                  return next;
                });
                return;
              }
              setPreviews((previous) => ({ ...previous, [id]: { status: 'loading' } }));
              setBusy(`preview:${id}`);
              try {
                const body = await post({ action: 'preview', id });
                setPreviews((previous) => ({ ...previous, [id]: { status: 'ready', result: body?.result ?? null } }));
              } catch (error) {
                setPreviews((previous) => ({ ...previous, [id]: { status: 'error', error: String(error?.message ?? error) } }));
              } finally {
                setBusy(null);
              }
            },
            [post, previews],
          );

          const doInstall = React.useCallback(
            async (result) => {
              await run(`install:${result.id}`, { action: 'install', id: result.id }, (body) => {
                setConfirming(null);
                setNotice(
                  body?.result?.settled === false
                    ? { kind: 'warn', text: t('refreshPending') }
                    : { kind: 'info', text: t('doneInstallWhere', body?.result?.name ?? result.id) },
                );
                // Stay on Discover so the card visibly flips to "installed"; refresh now
                // and again once the provider watcher has had time to settle.
                reload();
                setTimeout(reload, 2500);
              });
            },
            [reload, run, t],
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
              h('span', { className: stats.modified > 0 ? 'dsc-stat dsc-stat-off' : 'dsc-stat' }, t('statModified', stats.modified)),
              h('span', { className: stats.upgradable > 0 ? 'dsc-stat dsc-stat-off' : 'dsc-stat' }, t('statUpgradable', stats.upgradable)),
              h('span', { className: stats.removed > 0 ? 'dsc-stat dsc-stat-off' : 'dsc-stat' }, t('statRemoved', stats.removed)),
            ),
          );

          const tabButton = (id, label, disabled) =>
            h(
              'button',
              {
                key: id,
                type: 'button',
                className: tab === id ? 'dsc-tab dsc-tab-on' : 'dsc-tab',
                disabled: disabled === true,
                onClick: () => setTab(id),
              },
              label,
            );

          const tabs = h(
            'div',
            { className: 'dsc-tabs' },
            tabButton('installed', t('tabInstalled')),
            tabButton('discover', t('tabDiscover'), cliReady !== true),
            tabButton('quarantine', `${t('tabQuarantine')}${removed.length > 0 ? ` · ${String(removed.length)}` : ''}`),
            tabButton('health', t('tabHealth')),
          );

          const noticeNode = notice
            ? h('div', { className: notice.kind === 'error' ? 'dsc-notice dsc-notice-error' : notice.kind === 'warn' ? 'dsc-notice dsc-notice-warn' : 'dsc-notice' }, notice.text)
            : null;

          const warningsNode = warnings.length > 0
            ? h(
                'div',
                { className: 'dsc-notice dsc-notice-warn' },
                `${t('warnings')}: ${warnings.join(' · ')}`,
              )
            : null;

          const blockedText = React.useCallback(
            (skill) => {
              const reason = String(skill.blockedReason ?? '');
              if (reason.startsWith('plugin-provided')) return t('blockedPlugin');
              const match = /^source "([^"]+)"/.exec(reason);
              return t('blockedSource', sourceLabel(match === null ? String(skill.source) : match[1], localeId));
            },
            [localeId, t],
          );

          const driftTag = (skill) => {
            if (skill.drift === 'modified') return h('span', { className: 'dsc-tag dsc-tag-warn' }, t('driftModified'));
            if (skill.drift === 'clean') return h('span', { className: 'dsc-tag dsc-tag-ok' }, t('driftClean'));
            return h('span', { className: 'dsc-tag dsc-tag-muted' }, t('driftUnknown'));
          };

          const updateTag = (skill) => {
            const status = skill.update?.status;
            if (status === 'available') return h('span', { className: 'dsc-tag dsc-tag-warn' }, t('updateAvailable'));
            if (status === 'current') return h('span', { className: 'dsc-tag dsc-tag-ok' }, t('updateCurrent'));
            if (status === 'untracked') return h('span', { className: 'dsc-tag dsc-tag-muted' }, t('updateUntracked'));
            return null;
          };

          const installedRow = (skill) => {
            const forceKey = `force:${skill.name}`;
            const canUpgrade = skill.uninstallable === true && typeof skill.origin === 'string' && skill.origin !== '';
            const needsForce = skill.drift !== 'clean';
            const confirmingThis = confirming === `upgrade:${skill.name}`;
            return h(
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
                  driftTag(skill),
                  updateTag(skill),
                  skill.invocation?.modelInvocable === true
                    ? h('span', { className: 'dsc-tag' }, t('modelInvocable'))
                    : h('span', { className: 'dsc-tag dsc-tag-muted' }, t('userOnly')),
                  skill.conflict === true ? h('span', { className: 'dsc-tag dsc-tag-warn' }, t('conflictHint')) : null,
                ),
                skill.whenToUse ? h('div', { className: 'dsc-when' }, skill.whenToUse) : null,
                h('div', { className: 'dsc-desc' }, String(skill.description ?? '')),
                h(
                  'div',
                  { className: 'dsc-kv' },
                  skill.origin ? h('span', null, `${t('origin')}: `, h('b', null, skill.origin)) : null,
                  skill.skillPath ? h('span', null, `${t('skillPath')}: `, h('b', null, skill.skillPath)) : null,
                  skill.installedAt ? h('span', null, `${t('installedAt')}: `, h('b', null, shortDate(skill.installedAt))) : null,
                  skill.updatedAt ? h('span', null, `${t('updatedAt')}: `, h('b', null, shortDate(skill.updatedAt))) : null,
                  skill.installedBy ? h('span', null, t('installedBy', skill.installedBy === 'ai' ? t('byAi') : t('byUser'))) : null,
                ),
                skill.path
                  ? h('button', { type: 'button', className: 'dsc-path', title: t('copyPath'), onClick: () => copyPath(skill.path) }, skill.path)
                  : null,
                skill.needsConfirm === true && skill.root
                  ? h('div', { className: 'dsc-meta' }, `${t('root')}: ${String(skill.root)}`)
                  : null,
                skill.workspaces?.length ? h('div', { className: 'dsc-meta' }, `${t('workspaces')}: ${skill.workspaces.join(' · ')}`) : null,
              ),
              confirmingThis
                ? h(
                    'div',
                    { className: 'dsc-confirm' },
                    h('div', { className: 'dsc-confirm-text' }, t('confirmUpgradeHint')),
                    needsForce
                      ? h(
                          'label',
                          { className: 'dsc-check' },
                          h('input', {
                            type: 'checkbox',
                            checked: forceKeys[forceKey] === true,
                            onChange: (event) => setForceKeys((previous) => ({ ...previous, [forceKey]: event.target.checked })),
                          }),
                          t('forceConfirm'),
                        )
                      : null,
                    h(
                      'div',
                      { className: 'dsc-confirm-row' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsc-btn dsc-btn-primary',
                          disabled: busy !== null || (needsForce && forceKeys[forceKey] !== true),
                          onClick: () => void doUpgrade(skill, needsForce),
                        },
                        t('confirmUpgrade'),
                      ),
                      h('button', { type: 'button', className: 'dsc-btn', disabled: busy !== null, onClick: () => setConfirming(null) }, t('cancel')),
                    ),
                  )
                : skill.uninstallable === true
                  ? h(
                      'div',
                      { className: 'dsc-actions' },
                      canUpgrade
                        ? h(
                            'button',
                            {
                              type: 'button',
                              className: 'dsc-btn',
                              disabled: busy !== null || skill.update?.status !== 'available',
                              title: skill.update?.status === 'available' ? '' : (skill.update?.reason ?? ''),
                              onClick: () => setConfirming(`upgrade:${skill.name}`),
                            },
                            t('upgrade'),
                          )
                        : null,
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsc-btn dsc-btn-danger',
                          disabled: busy !== null,
                          onClick: () => (skill.needsConfirm === true ? setConfirming(`uninstall:${skill.name}`) : void doUninstall(skill, false)),
                        },
                        t('uninstall'),
                      ),
                      confirming === `uninstall:${skill.name}`
                        ? h(
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
                          )
                        : null,
                    )
                  : h(
                      'div',
                      { className: 'dsc-actions' },
                      h('button', { type: 'button', className: 'dsc-btn', disabled: true, title: blockedText(skill) }, t('uninstall')),
                      h('span', { className: 'dsc-meta' }, blockedText(skill)),
                    ),
            );
          };

          const planNode = plan === null
            ? null
            : h(
                'div',
                { className: 'dsc-plan' },
                h(
                  'div',
                  { className: 'dsc-group-title' },
                  `${t('upgradePlan')} · ${t('planTotal', plan.length)} · ${t('planUpgradable', plan.filter((item) => item.action === 'upgrade').length)} · ${t('planSkipped', plan.filter((item) => item.action !== 'upgrade').length)}`,
                ),
                ...plan.map((item) =>
                  h(
                    'div',
                    { key: item.name, className: 'dsc-meta' },
                    `${item.name} — ${item.action === 'upgrade' ? t('planActionUpgrade') : t('planActionSkip')}${item.reason ? ` (${item.reason})` : ''}`,
                  ),
                ),
              );

          const installedTab = h(
            React.Fragment,
            null,
            h(
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
                'label',
                { className: 'dsc-check' },
                h('input', { type: 'checkbox', checked: onlyModified, onChange: (event) => setOnlyModified(event.target.checked) }),
                t('driftModified'),
              ),
              h(
                'button',
                { type: 'button', className: 'dsc-btn', disabled: busy !== null || !cliReady, onClick: () => void doPlan() },
                t('upgradePlanRun'),
              ),
              h(
                'button',
                { type: 'button', className: 'dsc-btn dsc-btn-primary', disabled: busy !== null || !cliReady, onClick: () => void doUpgradeAll() },
                t('upgradeAll'),
              ),
            ),
            planNode,
            filtered.length === 0
              ? h('div', { className: 'dsc-empty' }, t('empty'))
              : h(
                  React.Fragment,
                  null,
                  ...grouped.map(([origin, rows]) =>
                    h(
                      'div',
                      { key: origin, className: 'dsc-group' },
                      h('div', { className: 'dsc-group-title' }, `${origin === '__local__' ? t('localGroup') : t('originGroup', origin)} · ${String(rows.length)}`),
                      h('div', { className: 'dsc-list' }, ...rows.map(installedRow)),
                    ),
                  ),
                ),
          );

          const discoverRow = (result) => {
            const preview = previews[result.id];
            const owner = String(result.id).split('/')[0] ?? '';
            const trusted = TRUSTED_OWNERS.has(owner.toLowerCase()) || Number(result.installs) >= 1000;
            const lowTrust = TRUSTED_OWNERS.has(owner.toLowerCase()) !== true && Number(result.installs) < TRUSTED_INSTALLS;
            const confirmingThis = confirming === `install:${result.id}`;
            const local = localFor(result);
            const installing = busy === `install:${result.id}`;
            const upgradable = local !== null && local.update?.status === 'available';
            return h(
              'div',
              { key: result.id, className: 'dsc-card' },
              h(
                'div',
                { className: 'dsc-card-head' },
                h(
                  'div',
                  { className: 'dsc-row-main' },
                  h(
                    'div',
                    { className: 'dsc-row-title' },
                    h('span', { className: 'dsc-name' }, result.name || result.skillId),
                    h('span', { className: 'dsc-tag' }, result.source),
                    h('span', { className: 'dsc-tag' }, t('installs', formatCount(result.installs))),
                    local === null ? null : h('span', { className: 'dsc-tag dsc-tag-ok' }, t('tagInstalled')),
                    upgradable ? h('span', { className: 'dsc-tag dsc-tag-warn' }, t('tagHasUpdate')) : null,
                    trusted ? null : h('span', { className: 'dsc-tag dsc-tag-warn' }, owner),
                  ),
                  h('div', { className: 'dsc-meta' }, result.id),
                  local === null ? null : h('div', { className: 'dsc-meta' }, t('discoverInstalledHint')),
                ),
                h(
                  'div',
                  { className: 'dsc-actions' },
                  h(
                    'button',
                    { type: 'button', className: 'dsc-btn', disabled: busy !== null, onClick: () => void doPreview(result.id) },
                    t('preview'),
                  ),
                  installing
                    ? h('button', { type: 'button', className: 'dsc-btn', disabled: true }, t('tagInstalling'))
                    : local !== null
                      ? upgradable
                        ? h(
                            'button',
                            {
                              type: 'button',
                              className: 'dsc-btn dsc-btn-primary',
                              disabled: busy !== null,
                              onClick: () => void doUpgrade(local, false),
                            },
                            t('upgrade'),
                          )
                        : h('button', { type: 'button', className: 'dsc-btn', disabled: true }, t('tagInstalled'))
                      : confirmingThis
                        ? null
                        : h(
                            'button',
                            {
                              type: 'button',
                              className: 'dsc-btn dsc-btn-primary',
                              disabled: busy !== null || !cliReady,
                              onClick: () => (lowTrust ? setConfirming(`install:${result.id}`) : void doInstall(result)),
                            },
                            t('install'),
                          ),
                ),
              ),
              confirmingThis
                ? h(
                    'div',
                    { className: 'dsc-confirm' },
                    h('div', { className: 'dsc-confirm-text' }, t('confirmInstallHint', `${owner} · ${formatCount(result.installs)}`)),
                    h(
                      'div',
                      { className: 'dsc-confirm-row' },
                      h(
                        'button',
                        { type: 'button', className: 'dsc-btn dsc-btn-primary', disabled: busy !== null, onClick: () => void doInstall(result) },
                        t('confirmInstall'),
                      ),
                      h('button', { type: 'button', className: 'dsc-btn', disabled: busy !== null, onClick: () => setConfirming(null) }, t('cancel')),
                    ),
                  )
                : null,
              preview === undefined
                ? null
                : preview.status === 'loading'
                  ? h('div', { className: 'dsc-meta' }, t('previewLoading'))
                  : preview.status === 'error'
                    ? h('div', { className: 'dsc-meta dsc-tag-warn' }, t('previewFailed', preview.error))
                    : h(
                        React.Fragment,
                        null,
                        h(
                          'div',
                          { className: 'dsc-kv' },
                          h('span', null, `${t('security')}: `, h('b', null, `${t('snyk')} ${String(preview.result?.security?.snyk ?? '—')} · ${t('socket')} ${String(preview.result?.security?.socket ?? '—')}`)),
                          h('span', null, `${t('skillPath')}: `, h('b', null, String(preview.result?.dir ?? ''))),
                        ),
                        h('pre', { className: 'dsc-pre' }, String(preview.result?.markdown ?? '')),
                      ),
            );
          };

          const discoverTab = h(
            React.Fragment,
            null,
            h('p', { className: 'dsc-intro' }, t('discoverIntro')),
            cliReady
              ? null
              : h(
                  'div',
                  { className: 'dsc-notice dsc-notice-warn' },
                  h('div', null, t('cliMissing')),
                  h('div', { className: 'dsc-meta' }, t('cliMissingHint')),
                ),
            h(
              'div',
              { className: 'dsc-toolbar' },
              h('input', {
                className: 'dsc-input',
                type: 'search',
                value: discoverQuery,
                placeholder: t('discoverPlaceholder'),
                onChange: (event) => setDiscoverQuery(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') void doSearch();
                },
              }),
              h('input', {
                className: 'dsc-input',
                type: 'text',
                value: discoverOwner,
                placeholder: t('discoverOwner'),
                onChange: (event) => setDiscoverOwner(event.target.value),
              }),
              h('button', { type: 'button', className: 'dsc-btn dsc-btn-primary', disabled: busy !== null || !cliReady, onClick: () => void doSearch() }, t('discoverSearch')),
            ),
            discover.status === 'loading'
              ? h('div', { className: 'dsc-empty' }, t('discoverSearching'))
              : discover.status === 'error'
                ? h('div', { className: 'dsc-notice dsc-notice-error' }, t('discoverFailed', discover.error ?? ''))
                : discover.results.length === 0
                  ? h('div', { className: 'dsc-empty' }, t('discoverEmpty'))
                  : h('div', { className: 'dsc-group' }, ...discover.results.map(discoverRow)),
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
                  h('span', { className: 'dsc-tag dsc-tag-muted' }, reasonLabel(item.reason, localeId)),
                  item.at ? h('span', { className: 'dsc-tag dsc-tag-muted' }, shortDate(item.at)) : null,
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

          const quarantineTab = h(
            React.Fragment,
            null,
            h(
              'div',
              { className: 'dsc-toolbar' },
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
            ),
            removed.length === 0
              ? h('div', { className: 'dsc-empty' }, t('emptyAll'))
              : h(
                  'div',
                  { className: 'dsc-group' },
                  h('div', { className: 'dsc-group-title' }, `${t('removedGroup')} · ${String(removed.length)}`),
                  h('div', { className: 'dsc-list' }, ...removed.map(removedRow)),
                ),
          );

          const healthTab = h(
            React.Fragment,
            null,
            h('p', { className: 'dsc-intro' }, t('healthIntro0_3')),
            h(
              'div',
              { className: 'dsc-card' },
              h('div', { className: 'dsc-group-title' }, t('envTitle')),
              h(
                'div',
                { className: 'dsc-kv' },
                h('span', null, `${t('envCli')}: `, h('b', null, cliReady ? t('envAvailable') : t('envUnavailable'))),
                env?.version ? h('span', null, `${t('envVersion')}: `, h('b', null, String(env.version))) : null,
                h(
                  'span',
                  null,
                  `${t('envPatch')}: `,
                  h('b', null, env?.patchApplied === true ? t('envPatchYes') : env?.patchApplied === false ? t('envPatchNo') : t('envPatchUnknown')),
                ),
                env?.command ? h('span', null, `${t('envCommand')}: `, h('b', null, String(env.command))) : null,
                data?.integration?.lockPath ? h('span', null, `${t('envLock')}: `, h('b', null, String(data.integration.lockPath))) : null,
                data?.integration?.statePath ? h('span', null, `${t('envState')}: `, h('b', null, String(data.integration.statePath))) : null,
                data?.integration?.stateVia ? h('span', null, `${t('envStateVia')}: `, h('b', null, String(data.integration.stateVia))) : null,
              ),
              env?.patchApplied === false
                ? h('div', { className: 'dsc-notice dsc-notice-warn' }, t('cliMissingPatch'))
                : cliReady
                  ? null
                  : h('div', { className: 'dsc-notice dsc-notice-warn' }, t('cliMissingHint')),
              h(
                'div',
                { className: 'dsc-confirm-row' },
                h(
                  'button',
                  { type: 'button', className: 'dsc-btn', disabled: busy !== null, onClick: () => void run('env-check', { action: 'env-check' }) },
                  t('envCheck'),
                ),
              ),
            ),
            h(
              'div',
              { className: 'dsc-card' },
              h('div', { className: 'dsc-group-title' }, t('healthDiagnostics')),
              Array.isArray(data?.cliDiagnostics) && data.cliDiagnostics.length > 0
                ? h('div', { className: 'dsc-meta' }, data.cliDiagnostics.join(' · '))
                : h('div', { className: 'dsc-meta' }, t('healthNoDiagnostics')),
            ),
          );

          const body =
            state.status === 'loading' && data === null
              ? h('div', { className: 'dsc-empty' }, t('loading'))
              : state.status === 'error'
                ? h(
                    'div',
                    { className: 'dsc-group' },
                    h('div', { className: 'dsc-notice dsc-notice-error' }, state.error),
                    h('div', null, h('button', { type: 'button', className: 'dsc-btn', onClick: reload }, t('retry'))),
                  )
                : tab === 'discover'
                  ? discoverTab
                  : tab === 'quarantine'
                    ? quarantineTab
                    : tab === 'health'
                      ? healthTab
                      : installedTab;

          return h(
            'div',
            { className: 'dsc-root' },
            h('style', null, CSS),
            header,
            tabs,
            warningsNode,
            noticeNode,
            state.status === 'loading' && data !== null ? h('div', { className: 'dsc-meta' }, t('loading')) : null,
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
