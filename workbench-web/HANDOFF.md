# 交接说明

> 目标：把「我的工作台」做成自用软件 —— **网页版 + 安卓 APK**。两者都已完成并验证。
>
> 当前版本 **v1.1.1**（APK versionCode 2）：完成任务二次确认（默认开启，可在「我的 → 偏好设置」关闭）；App 内可「检查更新」（装新 APK）与「检查热更新」（只换网页层）。

## 一、最终状态：全部完成 ✅

| 事项 | 状态 / 证据 |
|---|---|
| ZCode 小程序版补完（`workspace/default/my-workbench`） | ✅ `check-project` / `check-icons` / 30 项逻辑测试全绿 |
| 网页版（`workspace/default/workbench-web/www`） | ✅ 任务/分类/重复/搜索/统计/导入导出/提醒，数据存本机 |
| 静态检查 `tests/check-web.js` | ✅ 全绿（语法/manifest/引用/元素 id/CSS/图标/sw 清单） |
| 逻辑测试 `tests/logic-tests.js` | ✅ **72 项**全绿（内存降级模式 + localStorage 模式各一遍） |
| 界面冒烟 `tests/ui-smoke.js`（jsdom 真跑 app.js） | ✅ **12 项**全绿 |
| 安卓工具链（本地 `.toolchain/`：Microsoft OpenJDK 21.0.12 + android-35 + build-tools 35.0.0 + platform-tools） | ✅ 已装 |
| **APK** | ✅ `dist/workbench-debug.apk`，**3.93 MB**，Gradle 构建 4m54s |
| APK 自检 `_tools/inspect-apk.js` | ✅ **16 项**全过：zip 结构 453 条目、AndroidManifest、classes.dex、resources.arsc、`assets/public/*`（index.html/core.js/app.js/app.css/manifest 都在包里）、15 个启动图标、**debug 签名**（META-INF/CERT.RSA+SF）、LocalNotifications 插件已注册 |

冒烟测试抓出并修掉的真 bug：**`index.html` 三个优先级按钮缺少 `data-act="pickPriority"`，点了一点反应都没有**。
另外补了：**安卓返回键 / 浏览器后退先关弹层**（`history.pushState` + `popstate`，`file://` 下自动跳过）。

## 二、拿到手怎么用

### 网页版（马上能用）
- 双击 `www\index.html`；
- 或 `node _tools\serve.js` 起本地服务，手机同 Wi-Fi 打开打印出来的地址（推荐，localStorage 一定能用）。

### 装到手机（APK 已就绪）
```powershell
Set-Location 'D:\D\.zcode\workspace\default\workbench-web'
& '.toolchain\android-sdk\platform-tools\adb.exe' install -r 'dist\workbench-debug.apk'
# 或把 dist\workbench-debug.apk 传到手机，点击安装（需允许“安装未知来源应用”）
```
装完建议：打开 App →「我的 → 开启通知权限」（Android 13+ 还要在系统设置里允许通知）；厂商省电策略可能限制定时通知，可在系统设置里把本 App 设为“不受限制”。

### 重新打包 / 重新验证
```powershell
npm.cmd run apk        # 图标 → cap sync → gradlew assembleDebug → dist\workbench-debug.apk
npm.cmd run test:apk   # 产物自检
npm.cmd test           # 静态检查 + 72 项逻辑测试
npm.cmd run test:ui    # 12 项界面冒烟
```

## 三、唯一还没做的（需要你的手机）

- [ ] 真机装一次 APK，验证：App 能启动、四个页签正常、**关掉 App 后到点能收到系统通知**、返回键行为、深色模式下配色。
  我这边没有可用设备（`adb devices` 没能跑成，见第五节），也无法启动模拟器，所以只能验证到“结构正确 + 已签名 + 网页资源确实打进包”。

## 四、下载源与镜像（实测，脚本已内置自动选择）

| 源 | 速度 |
|---|---|
| Adoptium 官方 API（最初方案） | **0.02 MB/s**（195MB 要 2 小时+，已弃用） |
| Amazon Corretto | 0.27 MB/s |
| **Microsoft OpenJDK 21** | **7.68 MB/s** ✅ 已用它 |
| 华为云 OpenJDK 21 | 9.21 MB/s ✅ 备用 |
| Google cmdline-tools / SDK | 10 MB/s ✅ |
| **腾讯云 Gradle 镜像** | ✅ `build-apk.js` 自动探测并改写 `gradle-wrapper.properties`（官方 `services.gradle.org` 直连 10 秒超时，实测不可用） |
| 阿里云 Maven 镜像 | 备用：`WB_MAVEN_MIRROR=1 npm.cmd run apk`（走 `mirror.init.gradle`，不改 cap 生成的文件） |

## 五、环境坑 + 当前沙箱权限状况

1. **后台作业的 shell 是 Windows PowerShell 5.1**（不是 pwsh）：`pwsh` 不在 PATH；**执行策略禁止运行 .ps1**（要 `-ExecutionPolicy Bypass` 起子进程）；**按 GBK 读脚本**，含中文的 .ps1 会语法错。
   → 所以工具链安装、打包、自检全部是**纯 Node 脚本**，不经 PowerShell。
2. **npm 必须用 `npm.cmd`**（`npm.ps1` 被执行策略拦住）。
3. **沙箱权限（已部分修复，但未完全解决）**：本会话普通命令一直失败在 `SetNamedSecurityInfoW failed (Win32 5): grantWrite(D:\D\.zcode)`。
   用 `diagnose-windows-sandbox-acl` 技能修了两处：
   - `D:\D\.zcode`（工作区根）：缺少「取得所有权」→ 已补当前用户完全控制，**已验证**；
   - `D:\Temp`（沙箱临时区）：同样缺「取得所有权」→ 已补，**已验证**。
   但受限模式重试仍报 `sandbox-local windows-acl temp grant materialization failed`。剩下的可疑对象是 **`D:\` 盘根目录（所有者为 SYSTEM，当前用户没有「修改权限」）**，它在允许范围之外，技能按设计不会去改它。
   - 备份与回滚脚本（需要时按顺序执行即可撤销上面两处改动）：
     - `pwsh -NoProfile -File 'D:\D\acl-recovery\acl-backup-f3ab37666f7d4c8a83cc82aa48aab950.json.ps1' -Path 'D:\D\.zcode' -AllowRoot 'D:\D\.zcode' -Restore 'D:\D\acl-recovery\acl-backup-f3ab37666f7d4c8a83cc82aa48aab950.json'`
     - `pwsh -NoProfile -File 'D:\D\acl-recovery\acl-backup-4980c045fe224c7f899d6c2e183958bf.json.ps1' -Path 'D:\Temp' -AllowRoot 'D:\Temp' -Restore 'D:\D\acl-recovery\acl-backup-4980c045fe224c7f899d6c2e183958bf.json'`
   - 报告：`D:\D\acl-recovery\acl-report-a723b48b8c984329ba17e0db1bf4b98b.jsonl`、`acl-report-86a68247fbd742d3a481ade6da28d313.jsonl`
   - 现状：**每条 shell 命令仍需带「放宽权限」授权**（文件读写工具不受影响）。如果想彻底解决，可把本会话切成「完全权限」(full access) 继续用。

## 六、目录速览

```
workspace/default/
├── my-workbench/           微信小程序版（已补完：README / scripts 自检 / tests）
└── workbench-web/          自用软件版
    ├── www/                网页本体：index.html + css/app.css + js/{core.js,app.js} + manifest + sw.js + icons/
    ├── _tools/             serve.js / gen-app-icons.js / install-toolchain.js / build-apk.js / inspect-apk.js
    ├── tests/              check-web.js / logic-tests.js（72）/ ui-smoke.js（12）
    ├── android/            cap add 生成的原生工程（已 gitignore；改 Gradle 源会重写 wrapper properties）
    ├── dist/               workbench-debug.apk（3.93 MB）
    ├── .toolchain/         JDK 21 + Android SDK（已 gitignore）
    ├── capacitor.config.json   名称「我的工作台」，包名 com.workbench.local，webDir=www
    ├── HANDOFF.md          本文件
    └── README.md           三种用法、打包步骤、常见问题
```

## 七、以后怎么更新

### 网页版
改 `www/` 里的文件 → 刷新即新版（`sw.js` 已改为网络优先，不会卡旧缓存）；数据不受影响。

### 手机 App：两条路（App 内「我的 → 更新」栏操作）
| 改了什么 | 命令 | 手机上的动作 |
|---|---|---|
| 页面/样式/逻辑 | `npm.cmd run ota` | App 内「检查热更新」→ 自动下载并重启，**不用重装 APK** |
| 图标/权限/插件等原生部分 | `npm.cmd run ship` | 「检查更新」→ 下载 APK → 系统安装器确认一次（**覆盖安装，数据保留**） |

- 两个都要先：`node _tools/serve.js` 起服务，把它打印的局域网地址填进 App 的「更新地址」。
- 版本号：`package.json` 的 `version` → APK `versionName`；版本号变了 `versionCode` 自动 +1（状态在 `android/.build-version*`）。
- OTA 每次构建都会生成新版本号 `1.1.0-<时间戳>`（`_tools/build-ota.js`），产物在 `dist/ota/`。
- 签名：debug 签名在 `C:\Users\Gin\.android\debug.keystore`。换机器打包前要带走它，否则签名不同、只能卸载重装（先导出数据）。
- 覆盖安装后建议进 App 到「我的 → 开启通知权限」确认一次。

## 八、可选后续

- release 签名（现在是 debug 包，正式分发要自己签名）
- 把 `www/` 丢到任意静态托管（GitHub Pages 等，需 HTTPS），安卓 Chrome 可直接「安装应用」
- 日历/周视图、番茄钟、标签
