/**
 * 一条命令更新到手机：npm.cmd run ship
 *   1) 打包（_tools/build-apk.js）
 *   2) 产物自检（_tools/inspect-apk.js）
 *   3) 若检测到已连接的安卓设备 → adb install -r（覆盖安装，保留 App 数据）
 *      否则打印 APK 路径与手动安装方式
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ADB = path.join(ROOT, '.toolchain', 'android-sdk', 'platform-tools', 'adb.exe');
const APK = path.join(ROOT, 'dist', 'workbench-debug.apk');

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ stdio: 'inherit', cwd: ROOT }, opts || {}));
  if (r.error) {
    console.error('✗ ' + cmd + ' 启动失败: ' + r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log('=== 1/3 打包 ===');
run(process.execPath, [path.join('_tools', 'build-apk.js')]);

console.log('\n=== 2/3 产物自检 ===');
run(process.execPath, [path.join('_tools', 'inspect-apk.js')]);

console.log('\n=== 3/3 安装到手机（若已连接） ===');
if (!fs.existsSync(ADB)) {
  console.log('! 找不到 adb，跳过自动安装。');
  console.log('  手动：把 ' + APK + ' 传到手机点击安装（覆盖安装，数据保留）。');
  process.exit(0);
}

const res = spawnSync(ADB, ['devices'], { encoding: 'utf8' });
const lines = String(res.stdout || '')
  .split(/\r?\n/)
  .filter((l) => l.trim() && !/^List of devices/.test(l));
const devices = lines.map((l) => l.split(/\s+/)[0]).filter(Boolean);

if (!devices.length) {
  console.log('! 没有检测到已连接的安卓设备。');
  console.log('  手动安装：把下面这个文件传到手机（数据线拷贝 / 微信文件传输助手），点击安装即可覆盖旧版：');
  console.log('    ' + APK);
  console.log('  想自动安装：手机「设置 → 关于手机 → 连点版本号 7 次」开启开发者选项 →');
  console.log('  打开「USB 调试」→ 插线并在手机上授权本电脑 → 再跑一次 npm.cmd run ship。');
  process.exit(0);
}

devices.forEach((serial) => {
  console.log('安装到设备 ' + serial + '（-r 覆盖安装，App 数据保留）…');
  run(ADB, ['-s', serial, 'install', '-r', APK]);
});

console.log('\n✅ 更新完成。手机上打开「我的工作台」就是新版；');
console.log('   若到点通知没响，进 App 到「我的 → 开启通知权限」确认一次（覆盖安装后建议顺手看一眼）。');
