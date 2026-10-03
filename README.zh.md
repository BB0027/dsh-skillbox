# dsh-skillbox（DSH 技能控制台）

给 **DeepSeek Harness（dsh）** 用的技能控制台：一眼看清 DSH 解析到的全部技能，还能从 [skills.sh](https://skills.sh) **搜索安装**、**安全升级**，并在设置里**卸载或恢复**——可逆，**绝不删除任何文件**，也**绝不改写技能自己的 `SKILL.md`**。

> English: [README.md](README.md)

## 它能做什么

四个 Tab，注册为**与「插件 / 自动化任务」同级的侧栏面板**（`main` 面板槽 + `sidebar.panellist` 入口，order 20），同时仍能从**设置 → 技能**进入：

| Tab | 内容 |
|---|---|
| **已安装** | 每个技能的来源（`bundled` / `user-dsh` / `user-agents` / `project-dsh` / `project-agents` / `runtime` / `custom`）、调用策略、`SKILL.md` 路径、同名冲突提示；再加上**它从哪来**、安装/更新时间、**是否被本地改过**、**上游有没有新版**。按来源仓库分组。 |
| **发现** | 搜索 skills.sh（装机量、限定作者），预览技能的 `SKILL.md` 与 Snyk / Socket 评级，一键装进 DSH 技能根。低可信来源会先要一次确认。 |
| **隔离区** | 本控制台移出发现范围的所有技能，带原因（手动卸载 / 升级前备份），单项或全部一键恢复。 |
| **体检** | **技能体检**：自己扫全局技能根，把「DSH 读不了、因此被静默忽略」的技能连原因带建议列出来；同时做环境自检（`skills` CLI 在不在、什么版本、`dsh` agent 补丁还在不在、CLI lock 与本插件状态文件在哪）。 |

另外：名称/描述/使用时机全文搜索、按来源过滤、只看「本地已改」、统计行（总数 / 可卸载 / 插件自带 / 已改 / 有更新 / 隔离），以及**升级预览**——动手前先列出「会升哪些、会跳过哪些」。

## 安全承诺

- **永不删除文件**：卸载与升级都是「移动」，旧版本进隔离区，不删。
- **永不编辑 `SKILL.md`**：只安装、移动、升级、报告，不改写技能自己的文件。
- **安装只落到 DSH 技能根**（`skills add … -a dsh --copy`），不会装进别的 agent 目录。
- **升级要么成功要么回滚**：当前版本先进隔离区，安装失败就移回来。
- **保护本地改动**：与安装时记录的基线不一致的技能默认跳过，除非你显式勾选「强制覆盖」。

## 技能体检，以及唯一会自己动手的那件事

DSH 会**静默忽略**它读不了的 `SKILL.md`：不报错、不列出、不留痕。体检 Tab 自己读全局技能根（`user-dsh`、`user-agents`，含扁平的 `<name>.md` 技能），把 DSH 读不了的每个文件列出来 —— 无 frontmatter、缺 `name`/`description`、`name` 非 kebab-case、用了旧键（`modelInvocable` / `userInvocable` / `disableModelInvocation`）、frontmatter 无法解析 —— 每条都带原因和建议。CLI 自己的列表做不到这件事：实测它只报缺 description，却把带旧键的技能当正常技能列出。

**自动隔离**是本插件唯一不经询问就动手的功能，且**默认关闭**。打开前必须先做一次**预演**：页面只列出「将会移动谁」，不碰任何文件。之后每次进入本页才会把这些问题文件移进与手动卸载同一套**可恢复隔离区**，并报告移动了什么。自动化开启期间你手动恢复过的技能不会在同一轮里被再次移走；重新开关自动化或重启 DSH 后复位。问题文件**只移动、不改写、不删除**，随时能在隔离区一键恢复。

扫描与自动化都只作用于全局根：项目级技能既不扫也不动。

页面本身用 DSH 的共享客户端组件（`@deepseek-ai/dsh-client-ui-primitives`）搭建 —— 与插件管理页同一套原语；若某个客户端拿不到该模块，会自动降级为朴素元素。

## 设置

「设置 → 技能」故意做得很小 —— 所有管理技能的能力都在侧栏面板里。它只有三件事：

- **界面语言** —— 跟随 DSH / 中文 / English，存在插件状态里，作用于本插件所有页面；DSH 报不出语言时回退到中文。
- **台账导入导出** —— 把安装基线、隔离台账、开关与偏好导出成 JSON，也可以粘贴一份回来整体替换。**只动记录**：导入不会移动、改写或删除任何文件。
- **Node.js 检查** —— 插件运行环境版本、PATH 里的 `node`、`skills` CLI 版本、`dsh` agent 补丁是否还在，外加一个「重新检测」。

## 依赖

凡是「写」操作都走官方 **`skills` CLI**（npm 包 `skills`，skills.sh 生态的包管理器）：

```bash
npm i -g skills
```

CLI 里需要有本机 `dsh` agent 条目，`-a dsh` 才会装进 DSH 技能根。上游暂时还没有这条，配套的 **`find-skills`** 技能里带了幂等补丁脚本：

```powershell
pwsh -NoProfile -File "<dsh-home>\skills\find-skills\scripts\patch-skills-cli-dsh.ps1" [-Check|-Revert]
```

没有 CLI（或没打补丁）时：「发现」Tab 置灰、「体检」Tab 说明原因；列表与隔离区照常工作。

## 卸载是怎么工作的

不删除任何文件，每个来源有自己的隔离位置：

| 来源 | 隔离位置 |
|---|---|
| `user-dsh` | `<root>/.system/<name>`——文件系统 provider 以 `skipSystem: true` 声明该根，会跳过顶层 `.system` 条目，所以 DSH 立刻看不见它，而目录仍留在同一磁盘卷上 |
| `user-agents`、`project-dsh`、`project-agents`、`custom` | `<root>/../.skill-console-removed/<root 名>/<name>` |
| 扁平 `<name>.md` 技能 | 改名为 `<name>.md.removed` |

- **插件自带的技能无法在这里卸载**：`dsh-office` / `dsh-feishu-config` / `dsh-windows-acl` 提供的 `bundled` 技能与 `runtime` 技能没有自己的目录。按钮会禁用并显示原因。
- **项目级技能需要二次确认**，确认前会显示会被改动的仓库目录。
- 隔离台账存在 `<profile>/dsh-skillbox-state.json`（见下），同时页面会扫描隔离区，所以配置被重置也不会丢记录。
- 卸载全局生效、**不需要重启 DSH**（provider watcher 会失效缓存）。
- 已进入对话的内容不会消失：卸载阻止的是未来的加载与读取，不回收历史。

## 状态文件

安装基线（本插件最后一次写入技能时记录的内容 hash）、隔离台账、自动隔离开关（0.4.0）都存在：

```
<profile>/dsh-skillbox-state.json
```

它与 profile 自己的 `cordis.patch.yml` 同级，路径由运行中的 Harness 提供（`configEditor.documentPath`），所以会跟着 profile 备份一起走。**不**写在插件的配置条目里——写配置会 re-apply 插件，把正在响应的路由拆掉，v0.2.x 已经踩过这个坑。v0.2.x 的 `removedSkills` 会在首次读取时迁移过来，之后不再写配置。

## 安装

```bash
dsh plugin --profile <profile> add dsh-skillbox
```

重启 DSH（host 半边会在启动时注册一条数据路由），然后点侧栏的「技能」—— 就是「插件 / 自动化任务」旁边那个面板；同一页面也能从 **设置 → 技能** 进入。卸载插件用 `dsh plugin --profile <profile> remove dsh-skillbox`；已卸载的技能仍在隔离区，卸载插件前后都能恢复。

### 从本仓库安装

同一份包，直接从源码安装 —— 这也正是本插件的开发验证方式：

```bash
git clone https://github.com/BB0027/dsh-skillbox.git
dsh plugin --profile <profile> add link:/path/to/dsh-skillbox
```

每个 Release 也附带预打包的 `dsh-skillbox-<版本>.tgz`，解压后用同样的 `link:` 形式安装。装完重启 DSH。

## 开发

纯 JS，**不需要打包、无运行时依赖**：

| 文件 | 职责 |
|---|---|
| `lib/host.js` | 路由 `/plugins/dsh-skillbox/skills`（GET 读，POST 动作）、目录装配与接线。用 `ctx.inject(['webServer'], …)` 等待 webserver，启动顺序永远不成问题。 |
| `lib/cli.js` | `skills` CLI 适配层：探测（PATH / `SKILLS_CLI` / npm shim）、Windows `.cmd` 包装启动、JSON 提取、重试、串行写、始终带 `--full-depth`。 |
| `lib/upstream.js` | skills.sh 搜索、`skillId` → 仓库目录解析、`SKILL.md` 预览、Snyk/Socket 评级、上游 git tree SHA。 |
| `lib/registry.js` | 把 DSH 目录 + CLI lock + 自有基线 + 上游合并成富信息清单。 |
| `lib/flows.js` | 所有写操作：隔离、恢复、安装、升级预览 / 单个 / 全部，含回滚。 |
| `lib/hash.js` | 目录内容 hash，与 CLI 自己的 `computeSkillFolderHash` 逐位一致。 |
| `lib/state.js` | profile 目录解析与原子状态文件。 |
| `lib/paths.js` | 隔离位置运算，host 与 flows 共用。 |
| `lib/client.js` | `window.__ModuleLoader__` 工厂，注册设置页；React 来自浏览器模块表，样式是组件内局部、统一 `dsc-` 前缀。 |

```bash
dsh plugin --profile <profile> add link:/path/to/dsh-skillbox
```

## 兼容性

针对 `@deepseek-ai/dsh` `0.2.0-rc.2` 与 `skills` CLI `1.7.0` 开发并验证。需要 `skills` 服务与 Web 设置界面；无运行时依赖（`@deepseek-ai/cordis` 为可选 peer）。

## 许可证

MIT，见 [LICENSE](LICENSE)。
