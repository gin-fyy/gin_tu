# 我的工作台（My Workbench）

自己用的任务管理 + 课表 + 养成小宠物的 App：**数据全部存本机，无后端、不上传任何东西**。
两套实现、共享同一套核心逻辑（任务 / 分类 / 重复 / 搜索 / 统计 / 到期提醒）：

| 目录 | 是什么 | 怎么跑 |
|---|---|---|
| [`workbench-web/`](workbench-web/) | **主力版**：零依赖网页版 + Capacitor 安卓 App（当前 **v1.6.1**） | 双击 `workbench-web/www/index.html`；或按下面步骤打 APK |
| [`my-workbench/`](my-workbench/) | 早期的微信小程序版（原生 WXML/WXSS/JS） | 微信开发者工具导入该目录 |

> **这个仓库同时是手机更新源**：`docs/` 是发布目录（落地页 + 网页版 + APK + 更新信息）。
> App 里内置了 5 个更新源（CDN + 国内镜像），所以**不用改任何 GitHub 设置**：
> ```
> https://gh-proxy.com/https://raw.githubusercontent.com/gin-fyy/gin_tu/main/docs
> https://ghfast.top/https://raw.githubusercontent.com/gin-fyy/gin_tu/main/docs
> https://ghproxy.net/https://raw.githubusercontent.com/gin-fyy/gin_tu/main/docs
> https://cdn.jsdelivr.net/gh/gin-fyy/gin_tu@main/docs
> https://raw.githubusercontent.com/gin-fyy/gin_tu/main/docs
> ```
> （可选）仓库 `Settings → Pages → Deploy from a branch → main / docs`，之后也能用
> `https://gin-fyy.github.io/gin_tu` 当更新源。

## 现在有哪些功能（v1.6.1）

**任务**
- 标题、备注、分类、优先级、日期、时间、到期提醒、重复（每天/每周/每月）
- 重复任务：完成一次 → 记一条记录 + 日期滚到下一周期；再点一次撤销（不重复计数）
- 完成任务**二次确认**（默认开，可在「我的 → 偏好设置」关）
- 列表：搜索、状态筛选、分类筛选、分组；统计页：累计/7 天/连续/完成率/柱状图/分类分布
- 数据：导出 JSON、复制、导入、清空（保留分类与设置）

**课表**（独立页签）
- 周一~周日 × 节次的网格，可切周次、隐藏周末、设置学期首周（单双周才算得准）
- 今天有几节课自动列出；点格子即可编辑/删除
- **粘贴文字导入**：本地规则解析（不联网、不花钱），认「周一 1-2节 高等数学 教三101」「@实验楼B203」「1-16周」「第5周」「单周/双周」
- **图片识别导入**：拍/选课表截图，交给视觉大模型读成课程（需在「AI 配置」里填 Key，如智谱 `glm-4v-flash`，有免费额度；Key 只存本机）；解析器对模型的 JSON 手抖有 4 层容错
- 节次时间可自己改（你们学校作息）

**养成宠物**（完成即成长）
- 四种：🐉 二次元飞龙、🐱 猫、🐶 狗、🐳 深海小鲸灵「渊渊」（DeepSeek 的鲸鱼形象）
- 生命周期：**蛋 → 幼崽期 → 成长期 → 成熟期 → 老年期 →（寿终/体弱）离世**，离世进纪念册
- 规则（都可在代码 `PET_RULES` 里调）：

  | 项目 | 数值 |
  |---|---|
  | 完成一个待办 | +10 经验、+1 食物、+8 心情 |
  | 孵化 / 成长期 / 成熟期 | 30 / 100 / 300 经验 |
  | 老年期 | 出生满 150 天 |
  | 寿命 | 默认 180 天（可在偏好设置关掉「生老病死」） |
  | **每日经验上限** | **120**（所有加经验方式共用） |
  | **速通拦截** | 新建后 **不到 2 小时**就勾掉的，不给经验/食物 |
  | 饱食 / 心情衰减 | 约 31 小时掉完饱食；饿或心情差会掉健康 |
  | 生病 | 健康 ≤ 30 → 🤒，治疗消耗 2 食物 |
  | 喂食 / 陪玩 | +35 饱食 / +22 心情（陪玩 2 小时冷却） |
  | 番茄钟奖励 | 完成一段 ≥30 分钟专注：+20 经验、+1 食物 |

**番茄钟 + 专注锁**
- 30 / 45 / 60 分钟（最短 30），开始 / 暂停 / 继续 / 重置，倒计时到点发**系统通知**
- 专注期间**全屏专注页**盖住 App（宠物在陪你），放弃要**连点两次确认**
- 安卓上同时请求**屏幕固定**（把界面钉在本 App；系统没开屏幕固定就只保留 App 内锁定）

**外观 / 其他**
- 壁纸：内置 5 张 + 自己相册的照片（存 IndexedDB，压缩到不低于屏幕分辨率、JPEG 92%），可调遮罩浓度
- **液态玻璃**效果 + **界面透明度**（覆盖所有界面）；**轮盘**（抽吃什么 / 抽任务）；**每日一句**（含毒舌）

**更新**
- 发现新版本自动弹窗（含更新日志）→ 一键在应用内下载并拉起系统安装器（断点续传、失败换源、sha256 校验）
- 安装包用**带版本号的文件名**（`workbench-x.y.z.apk`），避免 CDN/镜像缓存给到旧包

## 自用版快速开始

```powershell
cd workbench-web

# 网页版：直接双击 www\index.html 就能用
# 手机访问（同一 Wi-Fi）：node _tools/serve.js

node _tools/install-toolchain.js   # 项目内装 JDK 21 + Android SDK（不动系统环境）
npm.cmd install
npm.cmd run apk                    # 产物：dist\workbench-<版本>.apk
```

## 测试与自检

```powershell
cd workbench-web
npm.cmd test              # 静态检查 + 108 项逻辑测试（两种存储模式各跑一遍）
npm.cmd run test:ui       # 27 项界面冒烟（jsdom 真跑 app.js：课表/宠物/番茄钟/专注锁/更新弹窗…）
npm.cmd run test:apk      # APK 产物自检（结构/资源/签名/插件类/largeHeap/包内版本号）

node _tools/verify-update-flow.js   # 逐源核对线上更新信息（线上最新版本 == 刚发布的版本）
node _tools/e2e-update-test.js --installed 1.2.2 --installed-code 12   # 真网络跑一遍完整更新下载
```

小程序版自检：

```powershell
cd my-workbench
node scripts/check-project.js && node scripts/check-icons.js && node tests/run-tests.js
```

## 发布流程（每次发版）

```powershell
cd workbench-web
# 1) 改版本号：package.json 与 www/js/core.js 的 APP_VERSION 必须一致（静态检查会校验）
# 2) 在 CHANGELOG.md 顶部加一段（会显示在 App 的更新弹窗里）
npm.cmd test && npm.cmd run test:ui
npm.cmd run apk && npm.cmd run test:apk          # 打包 + 自检
npm.cmd run pages -- --out ..\docs               # 生成发布目录（含带版本号的 APK）
cd .. && git add -A && git commit -m "release: x.y.z"
git -c http.sslVerify=false push                  # 若开了 Steam++ 加速需带这个参数
cd workbench-web && npm.cmd run purge             # 刷新 jsDelivr 缓存
node _tools/verify-update-flow.js                 # 核对线上
```

## 数据与隐私

- 存储：任务/设置/宠物记录在 `localStorage`（大图壁纸在 IndexedDB）；小程序版在微信 storage
- **没有账号、没有云同步、不上传数据**；唯一的联网行为是「检查更新」和「AI 图片识别」（用你自己填的 Key，只发你选的那张图）
- 仓库里**没有任何密钥或凭据**；`.gitignore` 排除 `node_modules/`、`.toolchain/`、`.git-toolchain/`、生成的 `android/`、`dist/`、临时测试目录
- 备份：App 内「我的 → 导出（下载 JSON 文件）」；换手机时导入即可

## 目录

```
.
├── workbench-web/                    主力版（网页 + 安卓 App）
│   ├── www/                          index.html + css + js（core.js 逻辑 / app.js 界面）
│   ├── native-plugins/               两个本地 Capacitor 插件
│   │   ├── apk-installer/            应用内下载 APK + 拉起系统安装器
│   │   └── focus-lock/               专注期间的屏幕固定（startLockTask）
│   ├── _tools/                       serve / 图标 / 工具链 / 打包 / 自检 / 热更新 / 发布 / 链路验证
│   ├── tests/                        静态检查 / 逻辑测试 / 界面冒烟
│   ├── CHANGELOG.md                  更新日志（会进 App 的更新弹窗）
│   └── README.md                     更细的说明（更新机制、真机验证清单、踩坑记录）
├── docs/                             发布目录（更新源：version.json + APK + 网页版）
└── my-workbench/                     小程序版
```
