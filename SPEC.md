# dsh-skillbox — 需求规格

> 第一轮（v0.1.0，浏览+启停）经三轮确认；第二轮（v0.2.0/v0.2.2）把"禁用"改为"卸载"，经一轮确认。
> 第三轮（v0.3.0 安装/升级，v0.4.0 体检/自动隔离）经五轮确认，逐条决议与实测事实见
> [docs/SPEC-v0.3.0.md](docs/SPEC-v0.3.0.md)。
> 运行时事实基准：`@deepseek-ai/dsh` = `0.2.0-rc.2`，`skills` CLI = `1.7.0`（Node 24 LTS）。

## 1. 目标

在 DSH Web 设置里提供技能控制台：看清这台机器上 DSH 解析到的全部技能，**从 skills.sh 搜索安装、安全升级**，并能**卸载**（可恢复）或**恢复**它们。插件自带的技能不在此列。
分两期：**0.3.0 = 安装/升级链路**，**0.4.0 = 技能体检与自动隔离**。

## 2. 范围（IN）

### 2.1 基础（v0.1.0 / v0.2.x，已交付）

| # | 能力 |
|---|---|
| 1 | 设置页顶级入口 `Skills`（客户端槽位 `settings.section`） |
| 2 | 全局列出所有来源的技能：bundled / user-dsh / user-agents / project-dsh / project-agents / runtime / custom |
| 3 | 对 name / description / whenToUse 全文搜索 |
| 4 | 按来源过滤 |
| 5 | 展示调用策略（模型可调 / 仅用户可调） |
| 6 | 同名冲突**风险提示**（不列被遮蔽候选） |
| 7 | 技能路径可点击复制 |
| 8 | **卸载**：移入隔离区，可一键恢复；绝不删除 |
| 9 | **恢复**：单项恢复 + 全部恢复；含「隔离区（可恢复）」分区 |
| 10 | 隔离台账写入本插件状态文件，并同时扫描隔离区（配置被重置也不丢） |
| 11 | 项目级技能需二次确认，并先显示被改动的仓库目录 |
| 12 | 插件自带技能标为不可卸载，按钮禁用并给出原因 |
| 13 | 中英双语文案，跟随 DSH locale |

### 2.2 v0.3.0（本期）

| # | 能力 |
|---|---|
| 14 | **Tab 化**：已安装 / 发现 / 隔离区 / 体检 |
| 15 | **已安装增强**：来源(`source`)、上游路径(`skillPath`)、安装/更新时间、**本地已修改**标记、**有更新**标记；按来源仓库分组 |
| 16 | **升级**：单个 / 全部；升级前 dry-run 预览（会升 N / 跳过 M）；旧版先进隔离区；失败回滚 |
| 17 | **发现**：skills.sh 搜索（装机量、来源、限定作者）；`SKILL.md` 内容预览 + Snyk/Socket 评级；一键安装到 user-dsh |
| 18 | **安全门**：装机量 < 100 且来源不在可信集合时，需二次确认（不硬拦） |
| 19 | **批量**：按来源分组批量卸载 / 恢复 / 升级 |
| 20 | **环境自检**：`skills` CLI 是否存在与版本、`dsh` agent 补丁是否还在；缺失时发现 Tab 置灰并给可复制引导 |
| 21 | 状态文件 `<profile>/dsh-skillbox-state.json`：安装基线、隔离台账、自动隔离开关；v0.2.x `removedSkills` 首次读取时迁移 |

### 2.3 v0.4.0（下一期）

| # | 能力 |
|---|---|
| 22 | **体检**：扫 `user-dsh` + `user-agents`（含扁平 `<name>.md`，跳过 `.system`），列出「DSH 读不了的技能」+ 原因 + 建议；六类判定：无 frontmatter / 缺 name 或 description / name 非 kebab-case / 旧键 / frontmatter 无法解析 / 文件读不了 |
| 23 | **自动隔离**：默认关；首次必须先**预演**（只列不动）；开启后每次进入本页按规则移入隔离区并报告；可关、可恢复、每次写台账；不做白名单 |
| 24 | **恢复优先**：手动恢复过的技能在同一次运行内不再被自动隔离（报告标注 `restored by you`）；重新开关自动化或重启 DSH 后复位 |
| 25 | **前端与插件管理页一致**：复用 `@deepseek-ai/dsh-client-ui-primitives`（`Pill` 视图切换与筛选、`Button` 操作、`Tag` 徽章、`Input` 搜索、`Switch` 开关、`StateDot` 行状态）；该模块对第三方插件不可见时降级为原来的朴素元素，两条路径都有测试 |
| 26 | **基础设置页**（设置 → 技能，section id `skill-settings`）：界面语言（跟随 DSH / 中文 / English，存状态文件；DSH 无语言时回退中文）、台账导入导出（**只动记录**，不移动/改写/删除任何文件）、Node.js + `skills` CLI + `dsh` 补丁环境检查；完整控制台在侧栏面板 |
| 27 | **侧栏位置与布局**：面板注册进 `main` + `sidebar.panellist`（`order: 5`，位于「插件」`0` 与「自动化任务」`10` 之间）；页面自带滚动宿主，标题 / 副标题 / 分组计数 / 行卡片节奏照插件页 |

## 3. 明确不做（OUT）

- 不编辑 `SKILL.md`、不新建技能、不做"一键修复"（体检只报告 + 隔离）
- 不列出同名冲突的被遮蔽候选详情（`ctx.skills` 只返回胜出者，且无 provider 枚举 API）
- 不做按工作区/按会话的差异化
- 不做变更历史/审计流水（台账只保留当前状态 + 隔离记录）
- 不做项目级安装（只全局 user-dsh）
- 不做自动隔离白名单（已确认：只按规则判定）
- 不在插件里重实现完整安装解析（CLI 缺失时降级为"发现 Tab 置灰 + 引导安装"）
- **任何情况下不删除技能文件**（只移动）

## 4. 关键约束（实测得出）

v0.2.x：

1. `ctx.skills` 只有 `registerProvider` / `register` / `list` / `snapshot` / `get`；无 enable/disable/write/delete。
2. `SkillSummary` 无 `enabled` 字段；插件自带技能无 `path`（因此无自有目录）。
3. 注册表分层合并，`list()` 只返回胜出者，**无 provider 枚举 API**。
4. `user-dsh` 根由 `dsh-skill-filesystem` 以 `skipSystem: true` 声明，其根扫描**跳过顶层 `.system` 条目** → 这就是原生隔离位。
5. 宿主插件 fiber 可能早于 webserver 启动：必须用 `ctx.inject([...], cb)` 等待服务（已修）。
6. 写 profile 配置会 re-apply 插件并拆掉正在响应的路由 → 高频状态改放独立状态文件。

v0.3.0 追加（详见 docs/SPEC-v0.3.0.md §2）：

7. DSH 静默忽略：无 frontmatter、缺 `name`/`description`、`name` 非 kebab-case、YAML 坏，以及旧键 `modelInvocable` / `userInvocable` / `disableModelInvocation`（0.4.0 体检据此判定）。
8. `skills` CLI 的 `ls --json` **不能**替代体检：它把带旧键的技能当正常技能列出。
9. CLI lock（`~/.agents/.skill-lock.json`，v3）字段：`source` / `sourceType` / `sourceUrl` / `skillPath` / `skillFolderHash` / `installedAt` / `updatedAt`；**`skillFolderHash` 语义随写入路径而变**：刚 `add` 完是 64 位 payload hash，跑过 CLI `check`/`update` 后是 40 位 git tree SHA。
10. **内容 hash 不能用于更新判定**（Windows 实测）：CLI 落盘 CRLF、上游 raw 是 LF，且落盘文件集合与上游目录不同（75 vs 63）→ 改为安装/升级时记录**上游 git tree SHA** 作为参考值；内容 hash 只用于本地漂移判定。
11. **CLI 会覆盖本地改动**：`skills check -g` 在「有更新」时直接重装（实测抹掉放入的 marker 文件）→ 检查与升级都由插件自持，不用 `check` / `update`。
12. `skills add` 的仓库发现会**提前停止**：不加 `--full-depth` 实测成功率 2/5，加上 5/5 → 安装必须带 `--full-depth`。
13. profile 目录由 `configEditor.documentPath` 的 dirname 解析（不依赖 shell 注入的 `DSH_PROFILE_DIR`）。
14. GitHub 匿名配额 60/h（`skills add` 也消耗）→ 记不到参考值时更新状态降级为 `unknown` 并提示设置 `GITHUB_TOKEN`，不误报、不动文件。

## 5. 卸载语义

| 来源 | 隔离位置 |
|---|---|
| `user-dsh` | `<root>/.system/<name>` |
| `user-agents` / `project-dsh` / `project-agents` / `custom` | `<root>/../.skill-console-removed/<root 名>/<name>` |
| 扁平 `<name>.md` | 改名为 `<name>.md.removed` |

- 全局生效；不需要重启 DSH（provider watcher 会失效缓存）。
- 已进入对话的内容不会被回收（历史即历史）；卸载只是阻止未来的加载与读取。
- 隔离项是普通目录，可手工拖回；恢复会在原位置被占用时拒绝并报错。
- 隔离记录带 `reason`（`manual` / `upgrade-backup` / `auto` / `legacy`）与时间戳。
- 技能离开目录时同时删除它的基线 hash，避免重装后被误判为"本地已修改"。

## 6. 升级语义（v0.3.0）

1. **漂移判定**：重算内容 hash 与台账基线比较；无基线视为"未知"，默认跳过并提示。
2. **未改过**：旧目录移入隔离区（`reason: upgrade-backup`）→ `skills add <source>@<name> -g -y -a dsh --copy --full-depth --json` → 失败则从隔离区回滚 → 成功刷新基线。
3. **改过**：不动文件，标红"本地已修改，已跳过"；要覆盖必须显式勾选。
4. **批量**：先 dry-run 预览 → 确认 → 逐个执行，失败即停并报告。

## 7. 交付形态

- npm 包名 `dsh-skillbox`，GitHub 仓库同名，License MIT
- 一个包内含 host + client 两个纯 JS 半边，无运行时依赖；host 改动需重启 DSH 生效，client 改动只需刷新页面
- `skills` CLI 是运行期依赖（写操作）：缺失或未打 `dsh` agent 补丁时降级为只读 + 引导
- 安装前走 `dsh-plugin-install` 技能的三步体检；发布走 `dsh-plugin-release` 流程（npm Trusted Publishing + GitHub tag）

## 8. 验收标准

1. 设置里出现 `Skills` 页，四个 Tab 可切换，全局列出所有来源技能
2. 卸载某技能后，DSH 不再解析到它；隔离位置存在且原位置消失
3. 恢复后技能重新可用，隔离位置消失
4. 插件自带技能按钮禁用并给出原因
5. 项目级技能先显示仓库目录，确认后才移动
6. **发现**：搜索出结果、能预览 `SKILL.md`、一键安装后新技能出现在已安装列表
7. **升级**：预览列出会升/会跳过；未改过的技能能升级且旧版在隔离区；本地改过的默认被跳过
8. **回滚**：模拟安装失败时旧版本回到原位
9. **环境自检**：CLI 缺失 / 补丁缺失时给出明确提示，且其余功能照常
10. 假技能全流程自测通过，且不触碰用户真实技能
11. **体检**：造出的坏技能（旧键 / 缺 description / 非法 name / YAML 坏 / 扁平 `.md` 无 frontmatter）全部被列出且各带建议；合法技能与块状 description 不误报；`.system` 被跳过
12. **自动隔离**：未预演时拒绝开启；预演只列不动；开启后坏技能进入 `.system`（扁平文件改名 `.removed`），台账 `reason=auto`，可在隔离区一键恢复；合法技能始终不动
13. **恢复优先**：自动化开启期间手动恢复的技能不会被立刻再移走，报告标注跳过
14. **前端降级**：`@deepseek-ai/dsh-client-ui-primitives` 可用时控件来自该包；不可用时全部降级为带 `dsc-` 类的朴素元素，页面不白屏
15. **基础设置页**：语言切换落盘且对所有页面生效（DSH 无语言时报中文）；导出 → 导入往返不改变任何技能文件；坏 JSON 被明确拒绝；环境检查同时报出宿主 Node、PATH 的 `node`、CLI 版本与补丁状态
16. **侧栏位置**：`sidebar.panellist` 的 `order` 在插件（0）与自动化任务（10）之间；页面要素齐全（标题 / 副标题 / 分组计数 / 行图标块），且在面板内可滚动
