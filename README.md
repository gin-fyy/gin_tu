# 我的工作台（My Workbench）

自己用的任务管理，两套实现、同一套逻辑（任务 / 分类 / 重复 / 搜索 / 统计 / 到期提醒），**数据全部存本机，无后端、不联网**。

| 目录 | 是什么 | 怎么跑 |
|---|---|---|
| [`workbench-web/`](workbench-web/) | **自用版**：零依赖网页版 + Capacitor 安卓 App | 双击 `workbench-web/www/index.html`；或按下面步骤打出安卓包 |
| [`my-workbench/`](my-workbench/) | **微信小程序版**（原生 WXML/WXSS/JS） | 微信开发者工具导入该目录即可运行 |

## 自用版快速开始

```powershell
cd workbench-web

# 网页版：直接双击 www\index.html 就能用
# 想让手机访问（同一个 Wi-Fi）：
node _tools/serve.js

# 打安卓 APK（会在项目内 .toolchain 装 JDK 21 + Android SDK，不动系统环境）
node _tools/install-toolchain.js
npm.cmd install
npm.cmd run apk        # 产物：dist\workbench-debug.apk
```

## 测试与自检

```powershell
cd workbench-web
npm.cmd test          # 静态检查 + 76 项逻辑测试
npm.cmd run test:ui   # 14 项界面冒烟（jsdom 真跑一遍 app.js）
npm.cmd run test:apk  # APK 产物自检（结构/资源/签名/插件类是否真的在 dex 里）
```

小程序版的自检：

```powershell
cd my-workbench
node scripts/check-project.js   # JS/JSON/WXML/WXSS/路径/图标
node scripts/check-icons.js     # tabBar 图标尺寸颜色
node tests/run-tests.js         # 逻辑测试
```

## 功能

- 任务：标题、备注、分类、优先级（高/中/低）、日期、时间、到期提醒、重复（每天/每周/每月）
- 重复任务：完成一次 → 记一条完成记录 + 日期滚到下一周期；再点一次撤销（不会重复计数）
- **防误触**：完成任务时二次确认（默认开启，可在「我的 → 偏好设置」关闭）
- 列表：关键词搜索、状态筛选（进行中/已完成/全部）、分类筛选、按日期与优先级分组
- 统计：累计完成 / 近 7 天 / 连续打卡 / 完成率 / 进行中 / 已逾期 + 近 7 天柱状图 + 分类分布
- 数据：导出 JSON 文件、复制到剪贴板、粘贴或选文件导入、清空（保留分类与设置）
- 提醒：网页版用系统通知 + 页面提示；安卓 App 用系统定时通知（关掉 App 也能收到）
- 更新：App 内「检查更新」（下载新 APK 覆盖安装）与「检查热更新」（只换网页层，不用重装）

## 数据与隐私

- 存储位置：浏览器 `localStorage`（网页版/App）；微信 storage（小程序版）。没有账号、没有云同步、不上传任何数据。
- 仓库里**没有任何密钥或凭据**；构建工具链（JDK/Android SDK）、`node_modules`、生成的 `android/`、`dist/` 都不入库（见 [.gitignore](.gitignore)）。
- 备份方式：应用内「我的 → 导出（下载 JSON 文件）」。

## 目录

```
.
├── workbench-web/          自用版（网页 + 安卓 App）
│   ├── www/                网页本体：index.html + css + js（core.js 逻辑 / app.js 界面）
│   ├── _tools/             serve.js、图标生成、工具链安装、打包、APK 自检、热更新打包
│   ├── tests/              静态检查 / 逻辑测试 / 界面冒烟
│   └── README.md           完整说明（含更新流程与真机验证清单）
└── my-workbench/           微信小程序版
    ├── pages/ components/ utils/
    ├── scripts/ tests/
    └── README.md
```
