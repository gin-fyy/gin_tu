# 进度与续接（本文件给"下次接着做"用）

> 最后更新：v1.6.1 发布之后。发布目录在仓库根 `docs/`，App 内置 5 个更新源（见 README）。

## 一、当前状态

| 项 | 状态 |
|---|---|
| 主线版本 | **workbench-web v1.6.1（versionCode 25）已发布**，线上逐源核对通过 |
| 测试 | 静态检查 ✓ · 逻辑 **108** 项 ✓ · 界面冒烟 **27** 项 ✓ · APK 自检（插件类/largeHeap/包内版本号）✓ |
| 更新链路 | App 内弹窗 + 一键下载安装 ✓；安装包按版本号命名，CDN/镜像缓存不会再给旧包 |
| 本地原生插件 | `apk-installer`（应用内装 APK）、`focus-lock`（专注屏幕固定） |
| 桌面产物 | `workbench-v1.6.1.apk`（微信传手机，覆盖安装保留数据） |
| 小程序版 | `my-workbench/` 仍是早期版本（任务/统计/提醒），**没有**同步课表/宠物/番茄钟 |

## 二、已实现的功能（要点）

- **任务**：分类/优先级/日期时间/到期提醒/重复（滚动+撤销）/搜索筛选/统计/导入导出/完成二次确认
- **课表**：周×节网格、周次切换、学期首周、今天课程；**文字导入**（本地规则解析）；**图片识别**（视觉大模型，自填 Key，4 层 JSON 容错）；节次时间可改
- **宠物**：蛋 → 幼崽 → 成长 → 成熟 → 老年 →（寿终/体弱）；饱食/心情/健康随真实时间变化，会生病；喂食/陪玩/治疗；纪念册；规则集中在 `www/js/core.js` 的 `PET_RULES`
  - 每完成一个待办：**+10 经验、+1 食物、+8 心情**
  - **每日经验上限 120**、**建完不到 2 小时就勾掉不给经验**（速通拦截）、撤销不扣/重勾不再发（高水位记账）
  - 完成一段 ≥30 分钟番茄：+20 经验、+1 食物（同样受每日上限）
- **番茄钟**：30/45/60 分钟、暂停/继续/重置、到点系统通知、跨重启接着走
- **专注锁**：全屏专注页（放弃要连点两次）+ 安卓屏幕固定（真机需在系统设置里开「屏幕固定」）
- **外观**：壁纸（内置 5 张 + 相册照片，存 IndexedDB，画质不低于屏幕分辨率）、遮罩浓度、液态玻璃、界面透明度
- **其他**：轮盘（抽吃什么/抽任务）、每日一句（20 条含毒舌）、`largeHeap`、只重绘当前页签

## 三、可能接着做的（按价值排序，等你点单）

1. **放宽"速通"规则**：现在是 2 小时，可改 30 分钟；或只拦"勾掉后立刻又勾回来"的刷分行为
2. **小程序版同步新功能**（课表/宠物/番茄钟）—— 工作量大，需要重做 WXML 结构
3. **iPhone（PWA）体验**：iPhone 上只能用网页版（加到主屏幕）；可加「网页版无需更新」提示、备份提醒
4. **专注锁加强**：把 App 装成「设备所有者」（电脑 ADB 一条命令）后可真正锁死整机 —— 侵入性强，需你明确同意
5. **宠物扩展**：与课表联动（上课也算陪伴）、成长曲线、食物/道具、宠物说话
6. **轮盘扩展**：选项权重、一次抽多个、抽中结果写成任务
7. **数据**：自动备份提醒（7 天没导出就提示）、导出图片版周报

## 四、发布清单（照抄）

```powershell
cd D:\D\.zcode\workspace\default\workbench-web
# 1) 同时改 package.json 与 www/js/core.js 的 APP_VERSION（静态检查会校验一致）
# 2) CHANGELOG.md 顶部加一段（会进 App 更新弹窗）
npm.cmd test && npm.cmd run test:ui
npm.cmd run apk && npm.cmd run test:apk
npm.cmd run pages -- --out ..\docs
cd .. ; git add -A ; git commit -m "release: x.y.z" ; git -c http.sslVerify=false push
cd workbench-web ; npm.cmd run purge ; node _tools\verify-update-flow.js
Copy-Item ..\docs\update\workbench-x.y.z.apk "$([Environment]::GetFolderPath('Desktop'))\"
```

## 五、环境备忘（这台机器上踩过的坑）

- **命令必须带 `sandbox_permissions: danger-full-access`**：沙箱给 `D:\D\.zcode` 授写权限会失败（Win32 5），普通命令起不来
- **npm 用 `npm.cmd`**；后台 job 是 Windows PowerShell 5.1（无 `pwsh`，`.ps1` 被执行策略挡，中文易乱码）→ 工具链都写成纯 Node
- **git 是便携版** `.git-toolchain\git\cmd\git.exe`；开 **Steam++（Watt Toolkit）GitHub 加速**时必须加 `-c http.sslVerify=false`，关掉加速则可能直连不通（时好时坏，重试即可）
- **发布目录生成失败会静默**：`build-pages.js` 曾因只读文件崩掉导致 docs 没更新（已修 + 新增「线上最新 == 刚发布」自检）
- 大文件（壁纸等）**不要**放 localStorage（5MB 限制，写入会静默失败）→ 一律 IndexedDB
- 静态检查会校验：`APP_VERSION` 与 package.json 一致、JS 里用到的 id 都在 HTML 里、sw.js 缓存清单

## 六、安全提醒

- 仓库**公开**：**不要**把 API Key、课表等个人数据写进代码或提交（课表文本在 `.gitignore` 的临时目录 + 桌面）
- 智谱 API Key 只存在手机本地（App 内「AI 配置」）；若怀疑泄露，去 bigmodel.cn 重新生成
