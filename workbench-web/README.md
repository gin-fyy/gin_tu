# 我的工作台（自用软件版）

同一个「我的工作台」，这次不依赖微信：**一个网页版 + 一个安卓 App**。

- **网页版**：`www/index.html`，双击就能用（不需要装任何东西、不需要注册、不联网）。数据存在浏览器本机。
- **安卓 App**：用 Capacitor 把同一份网页包成 APK，装到手机上就是一个普通 App，还能用**系统定时通知**提醒（关掉 App 也能收到）。
- 逻辑（任务/分类/重复/统计/提醒扫描）在 `www/js/core.js`，**与微信小程序版 `my-workbench/utils/*` 是同一套算法**，并且有 72 项单元测试覆盖。

## 一、三种用法

### 1) 电脑上直接用（最省事）
双击 `www/index.html` 即可。
> 注意：某些浏览器对 `file://` 页面禁用 localStorage，此时页面会**自动降级为内存模式**（“我的 → 数据”里有提示），关掉页面数据就没了。要么用下面的本地服务器方式，要么装 APK。

### 2) 手机浏览器用（推荐先试这个）
在项目目录执行：

```bash
node _tools/serve.js
```

它会打印本机与局域网地址（例如 `http://192.168.1.5:5173/`）。手机连同一个 Wi-Fi 打开该地址即可；iOS/Android 浏览器菜单里可以「添加到主屏幕」，图标和全屏体验都接近原生 App。
> 局域网 HTTP 无法启用 Service Worker 离线缓存（浏览器要求 HTTPS），但功能完全可用；要真正的“装上就是 App”，用第 3 种方式。

### 3) 装成安卓 APK
见下面「打包 APK」。

## 二、目录结构

```
workbench-web/
├── www/                       ← 网页本体（Capacitor 的 webDir）
│   ├── index.html             单页应用（四个页签：工作台/任务/统计/我的）
│   ├── css/app.css            样式（配色与小程序版一致）
│   ├── js/core.js             共享逻辑：storage 适配 + datetime + store + stats + views + reminder
│   ├── js/app.js              界面层：渲染、事件、弹层、通知桥接
│   ├── manifest.webmanifest   PWA 清单
│   ├── sw.js                  离线缓存（https/localhost 下才注册）
│   └── icons/                 App 图标（由脚本生成）
├── _tools/
│   ├── serve.js               零依赖静态服务器（给手机访问）
│   ├── gen-app-icons.js       零依赖生成图标（手写 PNG 编码 + SDF 形状）
│   ├── install-toolchain.js   下载安装 JDK 21 + Android SDK（约 1GB，幂等）
│   └── build-apk.js           一键打包：图标 → cap add/sync → gradlew → dist/*.apk
├── tests/
│   ├── check-web.js           静态检查：语法/manifest/引用/元素 id/CSS/图标
│   ├── logic-tests.js         逻辑测试：72 项（两种存储模式各跑一遍）
│   └── ui-smoke.js            jsdom 界面冒烟测试：真的跑一遍 app.js
├── capacitor.config.json      App 名、包名（com.workbench.local）、webDir
└── package.json               依赖与脚本
```

## 三、功能

| 模块 | 说明 |
|---|---|
| 工作台 | 问候语 + 今日待办/今日完成/已逾期 + 快速添加 + 逾期/今天/即将到来/无日期分组 |
| 任务 | 关键词搜索、状态筛选、分类筛选、按日期与优先级分组排序 |
| 新建/编辑 | 标题、备注、分类、优先级、日期、时间、提醒开关、重复（每天/每周/每月） |
| 重复任务 | 完成一次 → 记一条完成记录 + 日期滚到下一周期；再点一次撤销（不会重复计数） |
| 统计 | 累计完成/近7天/连续打卡/完成率/进行中/已逾期 + 近 7 天柱状图 + 分类分布 |
| 我的 | 昵称、分类管理、通知权限、导出 JSON 文件、复制到剪贴板、导入（文件或粘贴）、清空 |
| 提醒 | 网页版：页面开着时系统通知 + 页面提示（到期 2 小时内、每时间点一次）；APK：系统定时通知 |
| 防误触 | **完成任务时二次确认**（默认开启，可在「我的 → 偏好设置」关闭）；「取消完成」是恢复操作，不弹确认 |

## 四、数据与备份

- 存储位置：浏览器 `localStorage`（key 前缀 `wb_`）。
- 备份：**我的 → 导出（下载 JSON 文件）**；换机/换浏览器用 **导入**（选文件或粘贴）。
- 导入是覆盖式的，会替换任务、分类与完成记录。
- 想彻底清空：**我的 → 清空所有数据**（会保留分类与设置）。

## 五、开发脚本

```bash
node tests/check-web.js       # 静态检查：语法/manifest/引用/元素 id/CSS/图标
node tests/logic-tests.js     # 72 项逻辑测试（两种存储模式各跑一遍）
node tests/ui-smoke.js        # 12 项界面冒烟：jsdom 真跑一遍 app.js 并模拟点击
node _tools/gen-app-icons.js  # 重新生成图标
node _tools/serve.js          # 起本地服务器（手机同 Wi-Fi 可访问）
node _tools/inspect-apk.js    # 产物自检：APK 结构/打包内容/图标/签名/插件

# 也可以直接用 npm 脚本
npm.cmd test          # = check-web + logic-tests
npm.cmd run test:ui   # = ui-smoke
npm.cmd run test:apk  # = inspect-apk
```

## 六、打包 APK

```bash
# 1) 装工具链（JDK 21 + Android SDK，约 1GB，装在项目 .toolchain/ 里，不动系统环境）
node _tools/install-toolchain.js
#    会按 Microsoft → 华为云 → Adoptium 的顺序自动选快的源下载
#    （实测 Adoptium 官方 API 在部分网络下只有 0.02 MB/s，Microsoft/华为云有 8~9 MB/s）

# 2) 装依赖（PowerShell 里 npm.ps1 常被执行策略拦住，用 npm.cmd）
npm.cmd install

# 3) 一键打包
npm.cmd run apk        # 等价于 node _tools/build-apk.js

# 4) 产物自检（结构、打包内容、图标、签名、本地通知插件）
npm.cmd run test:apk
```

产物：`dist/workbench-debug.apk`，传到手机点击安装（需允许“安装未知来源应用”），或用数据线 `adb install -r dist/workbench-debug.apk`。

脚本内部做的事：生成图标 → `cap add android`（首次）→ 写 `android/local.properties` → `cap sync android` → `gradlew assembleDebug --no-daemon` → 拷贝 APK 到 `dist/`。

### 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `无法加载文件 ...npm.ps1，因为在此系统上禁止运行脚本` | PowerShell 执行策略。用 `npm.cmd`，或 `Set-ExecutionPolicy -Scope Process Bypass` |
| 第一次打包很久 / 卡在 Gradle | 首次要下载 Gradle 发行包与 AGP 依赖（几百 MB），耐心等；重跑会走缓存 |
| `SDK location not found` | 用 `npm.cmd run apk`（脚本会写 `android/local.properties`），不要直接 `gradlew` |
| 手机装不上 APK | 这是 debug 签名包，允许“未知来源”即可；正式分发需自己签名 |
| 通知不响 | 首次要手动点“我的 → 开启通知权限”；Android 13+ 还需在系统设置里允许通知 |
| 关掉 App 后提醒不准 | Android 厂商省电策略会限制定时任务；可在系统设置里把本 App 设为“不受限制” |

## 七、和微信小程序版的关系

| | 小程序版 `workspace/default/my-workbench` | 本自用版 `workbench-web` |
|---|---|---|
| 运行环境 | 微信（需 AppID、发布审核） | 浏览器 / 安卓 App（零注册） |
| 数据 | 微信 storage | localStorage（可导出 JSON） |
| 提醒 | 打开小程序时弹窗；订阅消息需服务端 | 网页通知；APK 里是系统定时通知 |
| 逻辑来源 | `utils/{store,datetime,stats}.js` | `www/js/core.js`（同算法，含缺陷修复） |

## 八、以后怎么更新

**网页版：改完文件就是新版，刷新即可**
- 双击 `www/index.html` 用：覆盖文件后重新打开就是新版；
- 用 `node _tools/serve.js`（局域网）或部署到 HTTPS 用：刷新页面就是新版 —— `sw.js` 是**网络优先**策略，离线时才回落缓存，所以不会卡在旧版本；
- 数据存在浏览器本机，**更新代码不动数据**；随时可在「我的 → 导出」备份。

**安卓 APK：重新打包 + 覆盖安装**
```powershell
# 改完代码后一条命令：打包 → 产物自检 → 若手机连着就自动覆盖安装
npm.cmd run ship
```
- 只想打包：`npm.cmd run apk`（产物 `dist/workbench-debug.apk`）；只自检：`npm.cmd run test:apk`。
- 手机没插线也没关系：`ship` 会提示你把 APK 传到手机点击安装。
- **覆盖安装会保留 App 数据**（同包名 `com.workbench.local` + 同签名）。**不要先卸载再装**，那会清掉任务数据；真要重置就先「我的 → 导出」。
- 版本号：`package.json` 的 `version` 会写进 APK 的 `versionName`；版本号一变，`versionCode` 自动 +1（由 `_tools/build-apk.js` 处理）。
- 签名：现在是 debug 签名，只要一直在**这台电脑的这个 Windows 账号**下打包，签名就一致、能一直覆盖升级。换电脑前请把 `C:\Users\<你>\.android\debug.keystore` 一并带走，否则无法覆盖升级（只能卸载重装 → 数据丢失，先导出）。
- 通知：覆盖安装后进 App 到「我的 → 开启通知权限」确认一次，任务提醒会重新排定。

## 九、手机端更新（自更新 + 热更新）

手机 App 里「我的」页底部有**更新**一栏：显示当前版本、可填「更新地址」、两个按钮（检查更新 / 检查热更新）。

### 1) 准备更新源（电脑上，和手机同一个 Wi-Fi）
```powershell
npm.cmd run apk     # 出 dist/workbench-debug.apk 和 dist/version.json
npm.cmd run ota     # 出 dist/ota/www-<版本>.zip 和 dist/ota/latest.json（热更新用）
node _tools/serve.js  # 打印局域网地址，例如 http://192.168.1.5:5173
```
把那个局域网地址填进 App 的「更新地址」并保存。（`serve.js` 会同时提供：网页版 `/`、下载页 `/update/`、版本信息 `/update/version.json`、APK `/update/<文件名>`、热更新 `/ota/latest.json` 与 `/ota/<zip>`。）

### 2) 检查更新（装新 APK）
App 里点「检查更新」→ 读 `/update/version.json` → 与自己的 `versionName/versionCode` 比较：
- 有新版：弹窗提示 → 用系统浏览器打开下载页 → 下载 APK → **系统安装器确认一次** → 覆盖安装（数据保留）。
- 没有新版：提示「已是最新」。

> 安卓不允许应用静默安装（除非 root / 企业设备管理），所以系统那一次「是否安装」必须点。这是系统限制，不是实现偷懒。

### 3) 检查热更新（不装 APK，直接换网页层）
App 里点「检查热更新」→ 读 `/ota/latest.json` → 用 `@capgo/capacitor-updater` 下载 zip → 应用并自动重启。

| 你改了什么 | 用什么 |
|---|---|
| 页面、样式、逻辑（`www/` 里的 js/css/html） | `npm.cmd run ota` → App 内「检查热更新」 |
| 图标、权限、插件、通知能力（原生部分） | `npm.cmd run ship` → 装新 APK |

热更新注意事项：
- 插件配置为 `autoUpdate: false` + 手动 `download/set`（见 `capacitor.config.json`），每次 `npm.cmd run ota` 都生成新的版本号 `1.1.0-<时间戳>`，App 才会认为有更新。
- App 启动时会调 `notifyAppReady()`；若新 bundle 起不来，插件会**自动回滚**到上一个可用版本。
- `resetWhenUpdate: true`：一旦你装了新 APK（原生版本变了），之前的热更新会被清掉、回到 APK 内置的那份，避免新旧错配。
- bundle 里**不能有隐藏文件**、不能加密；脚本已自动跳过 `.` 开头的文件和 `version.json`（那是原生版本，要读 APK 里的）。
- 热更新只在 APK 内可用；网页版刷新就是最新。

### 4) 真机验证清单（我没设备，需要你确认）
- [ ] 装新 APK 后：App 能启动，四个页签正常，任务数据还在
- [ ] 「我的」显示当前版本；填对更新地址后「检查更新」能读到版本号
- [ ] 造一个新版本（改 `package.json` 的 version → `npm.cmd run apk` → 覆盖 `dist/`）后，App 能提示发现新版并打开下载页
- [ ] 关掉 App 后到点能收到系统通知
- [ ] `npm.cmd run ota` 后，「检查热更新」能下载并自动重启到新版本

## 十、把更新源放到 GitHub（不插电脑也能更新）

先把发布目录生成好并推上去：

```powershell
cd workbench-web
npm.cmd run apk                       # 出 APK 与 version.json
npm.cmd run ota                       # 出热更新 bundle 与 latest.json
npm.cmd run pages -- --out ..\docs    # 生成「仓库根目录」的 docs/（落地页 + 网页版 + APK + 更新文件）
cd ..
git add -A; git commit -m "update"; git push
```

然后**二选一**对外提供（App 的「更新地址」填对应的 base，末尾不要斜杠）：

### 方式 A：jsDelivr CDN（最省事，不用改任何 GitHub 设置）✅ 实测可用

App「更新地址」填：

```
https://cdn.jsdelivr.net/gh/<用户名>/<仓库名>@main/docs
```

| App 会请求的地址 | 内容 |
|---|---|
| `.../update/version.json` | 版本信息（「检查更新」读它） |
| `.../update/workbench-debug.apk` | 安装包 |
| `.../ota/latest.json` + `.../ota/www-*.zip` | 热更新（「检查热更新」读它） |

- **发新版本后跑一次 `npm.cmd run purge`**：jsDelivr 对 `@main` 有缓存，刷新后手机才能马上看到新版本。
- 实测（本机网络）：小文件秒开；5.6MB 的 APK 第一次要等 jsDelivr 回源（约 70–90 KB/s），之后走缓存会快。

### 方式 B：GitHub Pages（有落地页，手机浏览器可直接打开下载）

仓库 `Settings → Pages → Source: Deploy from a branch → 分支 main / 目录 /docs`（新版界面**没有 Save 按钮**，选完即生效），等一两分钟：

| 地址 | 内容 |
|---|---|
| `https://<用户名>.github.io/<仓库名>/` | 落地页（下载 APK / 打开网页版） |
| `.../update/version.json`、`.../update/workbench-debug.apk` | 「检查更新」 |
| `.../ota/latest.json`、`.../ota/www-*.zip` | 「检查热更新」 |

> `docs/` 是生成物，每次发版重新生成再提交；`workbench-web/dist/` 与它内容重复，已 gitignore（只让 `docs/` 入库）。
> 提醒：`github.io`、`raw.githubusercontent.com` 在国内手机上经常连不上；连不上就用方式 A 或局域网更新。

## 十一、版本

- v1.1.1：完成任务增加二次确认（可开关，默认开启，防误触）；版本号自动写入 APK 与 `version.json`
- v1.1.0-web：首版网页版 + Capacitor 安卓壳（任务/分类/重复/搜索/统计/导入导出/提醒）
