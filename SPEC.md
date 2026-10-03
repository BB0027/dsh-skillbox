# dsh-skillbox — 需求规格

> 第一轮（v0.1.0，浏览+启停）经三轮确认；第二轮（v0.2.0）把"禁用"改为"卸载"，经一轮确认。
> 运行时事实基准：`@deepseek-ai/dsh` = `0.2.0-rc.2`

## 1. 目标

在 DSH Web 设置里提供技能控制台：看清这台机器上 DSH 解析到的全部技能，并能**卸载**（可恢复）或**恢复**它们。插件自带的技能不在此列。

## 2. 范围（IN）

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
| 9 | **恢复**：单项恢复 + 全部恢复；含「已卸载（可恢复）」分区 |
| 10 | 卸载记录写入插件 profile 条目（`removedSkills`），并同时扫描隔离区（配置被重置也不丢） |
| 11 | 项目级技能需二次确认，并先显示被改动的仓库目录 |
| 12 | 插件自带技能标为不可卸载，按钮禁用并给出原因 |
| 13 | 中英双语文案，跟随 DSH locale |

## 3. 明确不做（OUT）

- 不编辑 `SKILL.md`、不新建技能、不从 GitHub 导入/安装技能
- 不列出同名冲突的被遮蔽候选详情（`ctx.skills` 只返回胜出者，且无 provider 枚举 API）
- 不做按工作区/按会话的差异化
- 不做变更历史
- **任何情况下不删除技能文件**（只移动）

## 4. 关键约束（实测得出）

1. `ctx.skills` 只有 `registerProvider` / `register` / `list` / `snapshot` / `get`；无 enable/disable/write/delete。
2. `SkillSummary` 无 `enabled` 字段；插件自带技能无 `path`（因此无自有目录）。
3. 注册表分层合并，`list()` 只返回胜出者，**无 provider 枚举 API**。
4. `user-dsh` 根由 `dsh-skill-filesystem` 以 `skipSystem: true` 声明，其根扫描**跳过顶层 `.system` 条目** → 这就是原生隔离位。
5. 宿主插件 fiber 可能早于 webserver 启动：必须用 `ctx.inject([...], cb)` 等待服务，否则 boot 时注册路由会失败（已修）。

## 5. 卸载语义

| 来源 | 隔离位置 |
|---|---|
| `user-dsh` | `<root>/.system/<name>` |
| `user-agents` / `project-dsh` / `project-agents` / `custom` | `<root>/../.skill-console-removed/<root 名>/<name>` |
| 扁平 `<name>.md` | 改名为 `<name>.md.removed` |

- 全局生效；不需要重启 DSH（provider watcher 会失效缓存）。
- 已进入对话的内容不会被回收（历史即历史）；卸载只是阻止未来的加载与读取。
- 隔离项是普通目录，可手工拖回；恢复会在原位置被占用时拒绝并报错。

## 6. 交付形态

- npm 包名 `dsh-skillbox`，GitHub 仓库同名，License MIT
- 一个包内含 host + client 两个纯 JS 半边；host 改动需重启 DSH 生效，client 改动只需刷新页面
- 安装前走 `dsh-plugin-install` 技能的三步体检

## 7. 验收标准

1. 设置里出现 `Skills` 页，全局列出所有来源技能
2. 卸载某技能后，DSH 不再解析到它；隔离位置存在且原位置消失
3. 恢复后技能重新可用，隔离位置消失
4. 插件自带技能按钮禁用并给出原因
5. 项目级技能先显示仓库目录，确认后才移动
6. 假技能全流程自测通过，且不触碰用户真实技能
