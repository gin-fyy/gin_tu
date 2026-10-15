# apk-installer（本地 Capacitor 插件）

用途：让「我的工作台」App 能**在应用内下载新版 APK 并拉起系统安装器**，实现自更新。

因为它是本地插件（不是从 npm 装的），放在 `workbench-web/native-plugins/apk-installer`，
通过 `package.json` 的 `"apk-installer": "file:native-plugins/apk-installer"` 注册，`cap sync` 会自动把它
编进安卓工程（`android/capacitor.settings.gradle` + `capacitor.plugins.json`）。

## JS 里的用法（本项目的 app.js 就是这么调的）

```js
var P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ApkInstaller;

await P.canInstall();            // { allowed: boolean, sdk: number }
await P.openInstallSettings();   // 跳到系统设置，让用户允许本应用安装未知来源应用
P.addListener('progress', (d) => { /* { progress, received, total } */ });
var r = await P.download({ url: 'https://…/workbench-debug.apk', fileName: 'workbench-1.1.3.apk' });
// r = { path: '/storage/…/Android/data/<pkg>/files/update/workbench-1.1.3.apk', size }
await P.install({ path: r.path }); // { started: true } 或 { needPermission: true }
```

## 平台限制（重要）

- Android 不允许普通应用**静默安装**：`install()` 只能拉起系统安装界面，**最后那一次「安装」必须用户点**。
- Android 8+ 需要用户为本应用授权一次「安装未知来源应用」；未授权时 `install()` 返回 `{ needPermission: true }`，
  前端应调用 `openInstallSettings()` 引导用户去开。
- 下载目录是应用私有目录 `getExternalFilesDir(null)/update/`，通过 FileProvider（authority `${applicationId}.apkinstaller`）授权给系统安装器读取。

## 能力清单

| 方法 | 说明 |
|---|---|
| `canInstall()` | 是否已允许本应用安装应用 |
| `openInstallSettings()` | 打开系统「安装未知应用」授权页 |
| `download({url, fileName})` | 应用内下载，`progress` 事件上报百分比；返回本地路径与大小 |
| `install({path})` | 用 FileProvider + ACTION_VIEW 拉起系统安装器 |
