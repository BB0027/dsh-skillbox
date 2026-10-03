# dsh-skillbox 需求规格（v0.3.0 / v0.4.0 · 已确认）

> 在 v0.2.2 之上的一次增补，经五轮问答确认（2026-10-04）。
> 标【实测】的结论来自 2026-10-04 在真机（DSH 0.2.0-rc.2 / skills CLI 1.7.0 / Node 24.21.0）上的验证，不是推断。

## 0. 一句话

把「技能控制台」从 **看 + 隔离/恢复** 扩成 **看 + 装 + 升 + 体检 + 批量**；外观仍是设置页里的一页，内部变成四个 Tab。
分两期交付：**0.3.0 = 安装/升级链路**，**0.4.0 = 体检/自动隔离**。

## 1. 确认结论

| 议题 | 结论 |
|---|---|
| 要做的能力 | 搜索+一键安装；来源/版本可见 + 检查更新 + 一键升级；技能体检；分组批量管理（**审计历史、会话/AI 联动不做**） |
| 写操作由谁执行 | 优先调本机 `skills` CLI；缺失时按 §5 降级 |
| 写权限边界 | 可安装 / 升级 / 卸载(隔离)；**仍不删除任何文件**；**仍不编辑 SKILL.md** |
| 状态记账 | 官方 CLI lock 为主；**本地改动用插件自己的记录（基线内容 hash）** |
| 状态文件位置 | **`<profile>/dsh-skillbox-state.json`**（本机 `E:\DSH\home\profiles\desktop\dsh-skillbox-state.json`），跟 profile 一起备份/迁移 |
| 升级策略 | 未改过 → 自动覆盖（旧版先进隔离区）；改过 → 跳过并在列表标红 |
| 体检发现问题 | 自动隔离并报告（0.4.0）；默认关、先预演、可关、可恢复 |
| 体检扫描范围 | 只找「DSH 会忽略的坏技能」；扫 `user-dsh` + `user-agents` |
| 本地改动是否进体检 | 不进，只用于升级判定 |
| 自动隔离白名单 | **不做**，只按规则判定（隔离都可恢复） |
| 内容预览 | **做**：发现页可展开看 `SKILL.md` 正文 |
| 安装落点 | 只全局：`E:\DSH\home\skills` |
| 安全门 | 展示装机量 + Gen/Socket/Snyk；低可信度二次确认，不硬拦 |
| 批量 | 分组批量卸载/恢复/升级 + 升级前 dry-run 预览 + 「全部升级」 |
| UI | 现有 Skills 页加 Tab：已安装 / 发现 / 隔离区 / 体检 |
| CLI 缺失时 | 发现 Tab 置灰 + 引导安装；其余功能照常 |
| 交付节奏 | **分期**：0.3.0 先上安装/升级，0.4.0 上体检/自动隔离；两期都走 npm + GitHub 发布 |

## 2. 实测事实（决定实现方式，别绕开）

- **F1｜DSH 静默忽略哪些技能**：无 frontmatter、缺 `name`/`description`、`name` 非 kebab-case、YAML 解析失败，以及出现旧键 `modelInvocable` / `userInvocable` / `disableModelInvocation`。
  【实测】同一个根里放三个假技能，只有合法那个出现在 DSH 技能目录，另两个（旧键 / 缺 description）**完全不出现**。
- **F2｜CLI 的 `ls --json` 不能替代体检**：它能报 `missing required frontmatter field(s): description`，但把带旧键的技能**当正常技能列出**（DSH 却忽略它）。
- **F3｜CLI lock**：`~/.agents/.skill-lock.json`（有 `$XDG_STATE_HOME` 时为 `$XDG_STATE_HOME/skills/.skill-lock.json`），`version: 3`。
  字段：`source`、`sourceType`、`sourceUrl`、`skillPath`、`skillFolderHash`、`installedAt`、`updatedAt`。
  **`skillFolderHash` 的语义随写入路径而变**：刚 `add` 完是 **64 位 payload/内容 hash**（如 `6b526d01…`），跑过一次 CLI `check`/`update` 后变成 **40 位 git tree SHA**（如 `343db721…`）。两种都实测出现过，代码不能只认一种。
- **F4｜内容 hash 对比在 Windows 上不可用**（实测，2026-10-04）：
  - CLI 在 Windows clone 后落盘的是 **CRLF**，上游 raw 是 **LF** → 逐文件字节对比 75/75 全不同；
  - 落盘目录与上游技能目录的**文件集合也不同**（本地 75 个 vs 上游 63 个），所以「行尾归一化后再 hash」同样不相等；
  - 结论：**不要用内容 hash 判断「上游有没有新版」**。改成：安装/升级时本插件记录**上游 git tree SHA**（`baseline.upstreamTreeHash` + `upstreamRef`），之后把当前 tree SHA 与它比较 —— 与行尾无关、每仓库一次 API 调用、结果精确；CLI lock 若有 40 位 tree SHA 则直接复用。
  - 同款内容 hash 算法（跳过 `.git`/`node_modules`、相对路径转 POSIX 排序、`sha256(路径+内容字节)`）仍用于**本地漂移判定**（与本插件自己的基线比）。
- **F5｜CLI 会覆盖本地改动**：故意制造「上游有更新」后跑 `skills check -g`，它直接 `Updating … ✓ Updated`，把放进去的 marker 文件一并抹掉 → 「检查更新」**不能**交给 CLI，升级必须由插件执行，漂移判定与「跳过改过的」也要插件自己做。
- **F6｜`skills add` 的仓库发现会提前停止**：不加 `--full-depth` 实测成功率 **2/5**，加上后 **5/5** → 安装必须带 `--full-depth`（重试只是兜底）。
- **F7｜`skills check` 不认 `--json`**（仍输出人类文本）→ 本插件不用它做检查（见 F5）。
- **F8｜安装语义**：`skills add <src> -g -y -a dsh --copy` 把真文件写进 `E:\DSH\home\skills\<name>`；不加 `--copy` 则真文件在 `~/.agents/skills`、DSH 目录是 junction。**统一用 `--copy`**。
- **F9｜沿用 v0.2.2 宿主约束**：单路由 + POST action；`configEditor` 写入会 re-apply 插件 → 高频状态**不写** profile config（所以状态放独立 JSON 文件）。
- **F10｜`dsh` agent 是本地补丁**：CLI 升级会冲掉 `dist/cli.mjs`，整条安装链随之失效 → 插件需自检并提示重跑 `patch-skills-cli-dsh.ps1`。
- **F11｜GitHub 匿名配额是硬约束**：60 次/小时，且 `skills add` 自己也会消耗。配额耗尽时插件**优雅降级**：记不到参考值 → 更新状态显示 `unknown` + 原因与建议（设置 `GITHUB_TOKEN`），其余功能不受影响。

## 3. 范围

### 0.3.0（本期）

1. **Tab 化**：已安装 / 发现 / 隔离区（体检 Tab 先占位或暂不显示），共用现有页面外壳。
2. **已安装增强**：每行显示 来源(`source`)、上游路径(`skillPath`)、安装/更新时间、**本地已修改**标记、**有更新**标记；按来源分组；行内操作：卸载(隔离)、升级、复制路径。
3. **发现**：搜索走 skills.sh API（装机量、Gen/Socket/Snyk、描述、来源）；`SKILL.md` 内容预览；一键安装到 `E:\DSH\home\skills`；低可信度二次确认。
4. **检查更新 / 升级**：单个 / 批量 / 全部升级；升级前 dry-run 预览（会升 N、跳过 M、冲突 K）；旧版先入隔离区；失败自动回滚。
5. **批量**：按来源分组批量卸载 / 恢复 / 升级。
6. **环境自检**：CLI 是否存在与版本、`dsh` agent 补丁是否还在（F10），缺失时给可复制命令 + 重新检测。

### 0.4.0（下一期）

7. **体检**：扫 `user-dsh` + `user-agents`，按 DSH 语义列出「DSH 看不见的坏技能」+ 原因 + 建议。
8. **自动隔离**：默认关；首次预演（只列会动谁）；打开后按规则自动移入隔离区并报告；无白名单；全部可恢复、有台账。

### OUT（明确不做）

- 不删除任何文件（只移动）；不做「彻底删除」入口。
- 不编辑 `SKILL.md`（体检只报告 + 隔离，不做一键修复）。
- 不做项目级安装（只全局 `user-dsh`）。
- 不做审计历史（台账只保留当前状态 + 隔离记录）。
- 不做会话/AI 联动、不做按会话或按工作区差异化。
- 不在插件里重实现完整安装解析（CLI 缺失时按 §5 降级）。
- 不做自动隔离白名单（已确认不要）。

## 4. 数据与台账

- **状态文件**：`<profile>/dsh-skillbox-state.json`
  ```json
  { "version": 1,
    "baseline": { "<name>": { "contentHash": "...", "source": "...", "skillPath": "...", "upstreamTreeHash": "...", "upstreamRef": "...", "installedAt": "...", "updatedAt": "...", "by": "user|ai" } },
    "auto": { "enabled": false, "rehearsalConfirmed": false },
    "quarantine": [ { "name": "...", "from": "...", "to": "...", "source": "...", "kind": "dir|file", "at": "...", "reason": "manual|auto|upgrade-backup" } ] }
  ```
- **读** CLI lock 拿 `source / sourceType / skillPath / skillFolderHash / installedAt / updatedAt`；**不写** CLI lock。
- 现有 `removedSkills`（profile config）保持兼容：首次启动迁移进状态文件，迁移后不再写 config。

## 5. skills CLI 集成

| 项 | 约定 |
|---|---|
| 探测 | `skills --version`；PATH 找不到就试 `E:\software\node_js\node_global\skills.cmd`；结果缓存 30s |
| 调用 | `spawn`；安装固定 `add <src> -g -y -a dsh --copy --full-depth --json`；超时 120s |
| 重试 | 失败重试到 3 次（发现过程会提前停止，F6），仍失败则明确报错并把原始输出留给用户 |
| 解析 | `add` / `ls` 读 stdout JSON；**stderr 单独收集**（`Skipped …` 在 stderr） |
| 不使用 | `skills check` / `skills update`（会覆盖本地改动，F5）；升级一律由本插件执行 |
| 并发 | 插件内串行队列，同一时刻只跑一个写操作 |
| 缺失时 | 发现 Tab 置灰 + 可复制安装引导 + 「重新检测」；已安装 / 隔离区照常 |

## 6. 升级流程

1. **漂移判定**：重算内容 hash（F4 的算法）与本插件台账 `baseline.contentHash` 比较；无 baseline（手工装的或 CLI 直接装的）→ 视为「未知」，**默认跳过并提示**。
2. **更新判定**：参考值取 `baseline.upstreamTreeHash`（本插件安装/升级时记录）；缺省时退回 CLI lock 里的 40 位 tree SHA；两者都没有 → `unknown` + 原因（不猜、不误报）。当前上游 tree SHA 与参考值比较 → `current` / `available`。
3. **未改过 + 有更新**：旧目录移入隔离区（`reason: upgrade-backup`）→ `skills add <source>@<name> -g -y -a dsh --copy --full-depth --json` → 失败则从隔离区回滚 → 成功则刷新 baseline（内容 hash + 新的上游参考值）。
4. **改过**：不动文件，标红「本地已修改，已跳过」；要覆盖必须显式勾选「强制覆盖」，覆盖前同样先进隔离区。
5. **批量**：先出 dry-run 表 → 确认 → 逐个执行，**失败即停**并报告已完成/未完成清单。
6. **配额**（F11）：GitHub API 记不到参考值时按 `unknown` 呈现并提示设置 `GITHUB_TOKEN`；不会因此误报「有更新」，也不会因此动文件。

## 7. 体检规则（0.4.0，按 DSH 语义）

- 遍历 `user-dsh`（跳过 `.system`）与 `user-agents` 顶层条目，含扁平 `<name>.md`。
- 判为「DSH 会忽略」：无 frontmatter / 缺 `name` 或 `description` / `name` 不符 `^[a-z0-9]+(-[a-z0-9]+)*$` / 出现三个旧键之一 / YAML 解析失败。
- 报告路径、原因、建议；自动隔离受「总开关（默认关）+ 首次预演确认」约束；每次动作写台账，隔离区可一键恢复。
- 隔离位置沿用 v0.2.2：`user-dsh` → `<root>/.system/<name>`；`user-agents` → `<root>/../.skill-console-removed/<root 名>/<name>`。

## 8. 安全门

- 安装前展示：装机量、Gen / Socket / Snyk、来源仓库。
- 装机量 < 100，或来源不在可信集合（`vercel-labs` / `anthropics` / `microsoft` 等）→ 需勾选确认（不硬拦）。
- 高危评级不禁止安装，但在同一确认框显式展示。

## 9. UI

- 现有 Skills 页顶部加 Tab；中英双语文案，跟随 DSH locale。
- **已安装**：来源分组 + 现有搜索框 + 行内操作 + 本地改动/更新可用标记。
- **发现**：搜索框 + 结果卡片（名字、装机量、评级、描述、来源、预览展开）+ 安装按钮。
- **隔离区**：沿用现有分区，增加「来源：手动卸载 / 升级备份 / 自动隔离」标记与原因。
- **体检**（0.4.0）：自动隔离开关 + 预演结果 + 问题列表。

## 10. 交付与发布

- 源码：`E:\Workspace\dsh-skillbox`（git）→ `dsh plugin --profile desktop add link:<目录>` 联调。
- 版本 **0.3.0**（本期）/ 0.4.0（下期）；更新 `CHANGELOG.md`、`README.md`、`README.zh.md`、`SPEC.md`（把本文并入、删掉与 IN 冲突的 OUT 条款）。
- 发布：按 `dsh-plugin-release` 流程走 npm（Trusted Publishing / OIDC）+ GitHub tag。
- 验收：安装、升级、回滚各跑一遍；0.4.0 追加体检、自动隔离、恢复；**全程不伤真实技能**（联调期只用假技能）。

## 11. 决定记录

| 日期 | 决定 |
|---|---|
| 2026-10-04 | 能力面、执行者（CLI 优先）、写权限边界（可装/可升/可隔离，不删不改）、状态记账（lock 为主 + 自有基线）、升级策略（改过跳过）、体检=自动隔离+报告、扫描范围（DSH 忽略类 + 两个根）、安装只全局、安全门（展示+低可信度确认）、批量三件套、UI 四 Tab、CLI 缺失置灰引导、分期交付 |
| 2026-10-04 | 状态文件放 profile 目录；发现页要内容预览；**不做**自动隔离白名单；先发 0.3.0 |
| 2026-10-04 | 实施期实测修正：CLI 落盘 CRLF + 文件集合与上游不同 → **内容 hash 不能用于更新判定**，改为安装/升级时记录上游 git tree SHA；`skills check` 实测会覆盖本地改动 → 升级链路完全自持；`--full-depth` 成为必需（2/5 → 5/5） |

## 12. 已知风险与对策

| 风险 | 对策 |
|---|---|
| 自动隔离判定有 bug → 动真实技能（0.4.0） | 默认关 + 首次预演 + 全部可恢复 + 台账记录 + 开发期只用假技能 |
| CLI 瞬时失败（F6）被当成「技能不存在」 | 强制重试 + 明确报错，原始输出留档 |
| 两种 hash 语义混淆（tree SHA vs 内容 hash） | 代码分别命名 `upstreamTreeHash` / `localContentHash` 并注释来源 |
| Windows junction / copy 行为不一致 | 统一 `--copy` |
| 升级 CLI 冲掉 `dsh` agent 补丁（F10） | 环境自检 + 提示重跑补丁脚本 |
| 大文件操作阻塞设置页 | 插件内串行队列 + 轮询状态；失败/超时都有明确文案 |
