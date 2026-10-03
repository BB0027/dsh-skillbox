# dsh-skillbox（DSH 技能控制台）

给 **DeepSeek Harness（dsh）** 用的技能控制台：一眼看清 DSH 解析到的全部技能，并在设置里**卸载或恢复**它们——可逆，且**绝不删除任何文件**。

> English: [README.md](README.md)

## 它能做什么

- 在「设置」里新增一个顶级页面「技能」（`settings.section`）。
- 列出每个技能的来源（`bundled` / `user-dsh` / `user-agents` / `project-dsh` / `project-agents` / `runtime` / `custom`）、提供者、调用策略（模型可调 / 仅用户可调）、`SKILL.md` 路径，以及同名冲突风险提示。
- 支持名称/描述/使用时机全文搜索、按来源过滤，以及统计行：总数 / 可卸载 / 插件自带 / 已卸载。
- **卸载**把技能移出所有被扫描的根目录进入隔离区；**恢复**把它移回原处，支持单项与全部恢复。「已卸载（可恢复）」分区会一直保留它们，不会被遗忘。

## 卸载是怎么工作的

不删除任何文件，每个来源有自己的隔离位置：

| 来源 | 隔离位置 |
|---|---|
| `user-dsh` | `<root>/.system/<name>`——文件系统 provider 以 `skipSystem: true` 声明该根，会跳过顶层 `.system` 条目，所以 DSH 立刻看不见它，而目录仍留在同一磁盘卷上 |
| `user-agents`、`project-dsh`、`project-agents`、`custom` | `<root>/../.skill-console-removed/<root 名>/<name>` |
| 扁平 `<name>.md` 技能 | 改名为 `<name>.md.removed` |

- **插件自带的技能无法在这里卸载**：`dsh-office` / `dsh-feishu-config` / `dsh-windows-acl` 提供的 `bundled` 技能与 `runtime` 技能没有自己的目录。按钮会禁用并显示原因。
- **项目级技能需要二次确认**，确认前会显示会被改动的仓库目录。
- 卸载记录写在本插件的 profile 条目（`config.removedSkills`），同时页面会扫描隔离区，所以配置被重置也不会丢记录。
- 卸载全局生效、**不需要重启 DSH**（provider watcher 会失效缓存）。
- 已进入对话的内容不会消失：卸载阻止的是未来的加载与读取，不回收历史。

## 安装

```bash
dsh plugin --profile <profile> add dsh-skillbox
```

重启 DSH（host 半边会在启动时注册一条数据路由），然后打开 **设置 → 技能**。卸载插件用 `dsh plugin --profile <profile> remove dsh-skillbox`；已卸载的技能仍在隔离区，卸载插件前后都能恢复。

### 从本仓库安装

同一份包，直接从源码安装 —— 这也正是本插件的开发验证方式：

```bash
git clone https://github.com/BB0027/dsh-skillbox.git
dsh plugin --profile <profile> add link:/path/to/dsh-skillbox
```

每个 Release 也附带预打包的 `dsh-skillbox-<版本>.tgz`，解压后用同样的 `link:` 形式安装。装完重启 DSH。

## 开发

两个纯 JS 半边，**不需要打包**：

- `lib/host.js`——读目录（`ctx.skills.snapshot`），用 `/plugins/dsh-skillbox/skills` 提供数据（GET 读，POST `uninstall` / `restore`），用 `node:fs` 执行移动，并通过配置编辑器持久化卸载台账。它用 `ctx.inject(['webServer'], …)` 等待 webserver，所以启动顺序永远不成问题。
- `lib/client.js`——`window.__ModuleLoader__` 工厂，注册设置页；React 来自浏览器模块表，样式是组件内局部、统一 `dsc-` 前缀。

```bash
dsh plugin --profile <profile> add link:/path/to/dsh-skillbox
```

## 兼容性

针对 `@deepseek-ai/dsh` `0.2.0-rc.2` 开发并验证。需要 `skills` 服务与 Web 设置界面；无运行时依赖（`@deepseek-ai/cordis` 为可选 peer）。

## 许可证

MIT，见 [LICENSE](LICENSE)。
