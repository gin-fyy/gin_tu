# 我的工作台（my-workbench）

一个**零依赖、纯本地**的微信小程序工作台：记任务、按时提醒、看完成情况。
数据只存在手机本机（`wx storage`），没有后端、没有登录、不联网。

> 生成自 ZCode 会话（GLM-5.3，该会话在自检阶段因额度耗尽中断），后续由 DSH 接手补完：
> 修掉「重复任务连点重复计数 / 无法撤销」和「新增分类污染默认分类」两个缺陷，
> 补齐数据导入、任务搜索、统计卡片，并加上工程自检与逻辑测试。

## 功能

| 模块 | 说明 |
|---|---|
| 工作台首页 | 问候语 + 今日概览（今日待办 / 今日完成 / 已逾期）+ 快速添加（默认加到今天）+ 逾期 / 今天 / 即将到来 / 无日期分组 |
| 任务列表 | 关键词搜索（标题 + 备注）、状态筛选（进行中 / 已完成 / 全部）、分类胶囊筛选、按日期与优先级自动分组排序 |
| 任务编辑 | 标题、备注、分类、优先级（高 / 中 / 低）、日期、时间、到期提醒开关、重复（不重复 / 每天 / 每周 / 每月） |
| 重复任务 | 完成一次 = 记一条完成记录 + 日期滚到下一周期（任务仍留在进行中）；**再点一次即可撤销**，日期滚回、记录删除，不会重复计数 |
| 提醒 | 本地提醒：设了「日期 + 时间 + 提醒开关」的任务，到期后 2 小时内打开或在停留小程序时弹窗提醒一次（每任务每个时间点只提醒一次）；前台每 60s 轮询一次 |
| 统计 | 累计完成 / 近 7 天完成 / 连续打卡 / 完成率 / 进行中 / 已逾期，近 7 天柱状图，分类完成分布 |
| 我的 | 昵称、分类增删（删分类时任务自动归入剩余分类）、订阅消息模板 ID、导出到剪贴板、**粘贴 JSON 导入**、清空数据 |

## 目录结构

```
my-workbench/
├── app.js / app.json / app.wxss      入口、页面注册与 tabBar、主题变量与通用样式
├── pages/
│   ├── index/                        工作台首页
│   ├── tasks/                        任务列表（搜索 + 筛选 + 分组）
│   ├── stats/                        统计
│   ├── mine/                         我的（分类 / 提醒配置 / 数据管理）
│   └── task-edit/                    新建 / 编辑任务
├── components/task-card/             任务卡片（task + cats 派生展示字段）
├── utils/
│   ├── store.js                      数据层：全部读写走 wx storage
│   ├── datetime.js                   日期工具（本地时区）
│   ├── stats.js                      统计纯函数（可被 node 直接测试）
│   └── subscribe.js                  订阅消息（可选，需自建服务端）
├── scripts/
│   ├── gen-icons.js                  零依赖生成 tabBar 图标（手写 PNG 编码 + SDF 形状）
│   ├── check-icons.js                图标自检（解码 PNG 验尺寸 / 颜色 / 居中）
│   ├── check-project.js              工程自检（JS/JSON/WXML/WXSS/路径/图标）
│   └── preview.png                   图标预览图（生成产物）
├── tests/run-tests.js                逻辑测试（打桩 wx storage，测 store/datetime/stats）
├── images/tab/                       8 个 tabBar 图标（灰 / 蓝两套）
└── project.config.json               开发者工具配置（含打包忽略 scripts、tests）
```

## 快速开始

1. 打开**微信开发者工具** → 导入项目 → 目录选择本文件夹（`my-workbench`）。
2. AppID 用默认的 `touristappid`（游客模式）即可直接运行；要真机预览 / 发布，把 `project.config.json` 的 `appid` 换成你自己的。
3. 无需 `npm install`，项目没有任何依赖。

## 开发脚本

```bash
node scripts/gen-icons.js      # 重新生成 8 个 tabBar 图标 + preview.png
node scripts/check-project.js  # 工程自检：语法 / JSON / WXML / WXSS / 路径 / 组件 / 图标
node scripts/check-icons.js    # 图标自检：尺寸 81x81、RGBA、颜色、覆盖率、居中度
node tests/run-tests.js        # 逻辑测试：store / datetime / stats
```

`scripts/` 和 `tests/` 已在 `project.config.json` 的 `packOptions.ignore` 里排除，不会打进小程序包。

## 数据存储

| storage key | 内容 |
|---|---|
| `wb_tasks` | 任务数组（id/title/note/category/priority/date/time/remind/repeat/done/doneAt/lastRoll/createdAt/updatedAt） |
| `wb_categories` | 分类数组（默认：工作 / 学习 / 生活 / 其他） |
| `wb_completions` | 完成记录（统计与连续打卡用，最多保留 2000 条） |
| `wb_settings` | 昵称、订阅消息模板 ID |
| `wb_notified` | 已提醒过的「任务@日期 时间」标记，最多 200 条 |

导出格式（`我的 → 导出数据到剪贴板`）：

```json
{ "app": "my-workbench", "version": 2, "exportedAt": "...", "tasks": [], "categories": [], "completions": [], "settings": {} }
```

`导入` 只接受 `app === "my-workbench"` 的 JSON，导入是**覆盖式**的（会替换任务 / 分类 / 完成记录，保留并合并设置）。

## 提醒能力边界

- **本地提醒**：只在打开小程序（或停留在小程序内）时生效，属于「进来就告诉你」，不是系统级推送。
- **订阅消息**：真正到点推送需要在小程序后台申请订阅消息模板，并由**服务端**调用微信接口下发；本仓库只实现了前端授权与模板 ID 配置（`utils/subscribe.js` + 我的页），服务端需自行搭建。

## 后续可做

- 日历 / 周视图、番茄钟、标签、附件
- 服务端 + 订阅消息真正到点推送
- 云端同步与多设备
