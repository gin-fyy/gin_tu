/**
 * 打包安卓 APK：node _tools/build-apk.js
 * 流程：图标 → cap add/sync → Gradle 镜像（自动探测）→ gradlew assembleDebug → 拷到 dist/
 * 用本地 .toolchain（JDK 21 + android-35 + build-tools 35.0.0），不依赖系统环境变量、不需要 Android Studio。
 *
 * 环境变量：
 *   WB_MAVEN_MIRROR=1   依赖下载卡住时启用阿里云 Maven 镜像（走 init script，不改 cap 生成的文件）
 */
const { spawnSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TC = path.join(ROOT, '.toolchain');
const JDK = path.join(TC, 'jdk');
const SDK = path.join(TC, 'android-sdk');
const ANDROID = path.join(ROOT, 'android');
const DIST = path.join(ROOT, 'dist');

function log(msg) { console.log('\n=== ' + msg + ' ==='); }
function die(msg) { console.error('✗ ' + msg); process.exit(1); }
function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ stdio: 'inherit', cwd: ROOT }, opts || {}));
  if (r.error) die(cmd + ' 启动失败: ' + r.error.message);
  if (r.status !== 0) die(cmd + ' ' + args.join(' ') + ' 退出码 ' + r.status);
}

/* ---------- Gradle 发行包镜像探测 ---------- */
const GRADLE_MIRRORS = [
  'https://mirrors.cloud.tencent.com/gradle/',
  'https://mirrors.huaweicloud.com/gradle/',
  'https://mirrors.aliyun.com/gradle/'
];

function head(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { method: 'HEAD', headers: { 'user-agent': 'workbench-build' } }, (res) => {
      const ok = res.statusCode >= 200 && res.statusCode < 400;
      res.resume();
      resolve(ok);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(8000, () => { req.destroy(); resolve(false); });
  });
}

async function configureGradleMirror() {
  const propsPath = path.join(ANDROID, 'gradle', 'wrapper', 'gradle-wrapper.properties');
  if (!fs.existsSync(propsPath)) {
    console.log('! 没找到 gradle-wrapper.properties，跳过 Gradle 镜像配置');
    return;
  }
  const text = fs.readFileSync(propsPath, 'utf8');
  const line = text.split(/\r?\n/).find((l) => l.trim().startsWith('distributionUrl='));
  if (!line) {
    console.log('! 没解析出 distributionUrl，跳过 Gradle 镜像配置');
    return;
  }

  const rawUrl = line.trim().slice('distributionUrl='.length).replace(/\\:/g, ':');
  const file = rawUrl.split('/').pop();

  if (!/services\.gradle\.org/.test(rawUrl)) {
    console.log('   Gradle 源已自定义，保持：' + rawUrl);
    return;
  }

  for (const base of GRADLE_MIRRORS) {
    const url = base + file;
    if (await head(url)) {
      const newLine = 'distributionUrl=' + url.replace(/:/g, '\\:');
      fs.writeFileSync(propsPath, text.replace(line, newLine), 'utf8');
      console.log('   Gradle 发行包改用镜像：' + url);
      return;
    }
    console.log('   镜像不可用，跳过：' + url);
  }
  console.log('! 所有镜像都不可用，仍用官方源（可能很慢）');
}

/* ---------- Maven 镜像（可选） ---------- */
function writeMavenInitScript() {
  const initPath = path.join(ANDROID, 'mirror.init.gradle');
  fs.writeFileSync(initPath, [
    '// 由 _tools/build-apk.js 生成：阿里云 Maven 镜像优先，缺失时自动回落到 google()/mavenCentral()',
    'settingsEvaluated { settings ->',
    '    settings.pluginManagement {',
    '        repositories {',
    "            maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }",
    "            maven { url 'https://maven.aliyun.com/repository/google' }",
    "            maven { url 'https://maven.aliyun.com/repository/public' }",
    '            gradlePluginPortal()',
    '            google()',
    '            mavenCentral()',
    '        }',
    '    }',
    '}',
    'allprojects {',
    '    buildscript {',
    '        repositories {',
    "            maven { url 'https://maven.aliyun.com/repository/google' }",
    "            maven { url 'https://maven.aliyun.com/repository/public' }",
    '        }',
    '    }',
    '    repositories {',
    "        maven { url 'https://maven.aliyun.com/repository/google' }",
    "        maven { url 'https://maven.aliyun.com/repository/public' }",
    '    }',
    '}',
    ''
  ].join('\n'), 'utf8');
  return initPath;
}

/* ---------- 版本号（写进 APK，覆盖升级时用来识别） ---------- */
function bumpVersion() {
  const gradlePath = path.join(ANDROID, 'app', 'build.gradle');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const versionName = pkg.version || '1.0.0';
  const codePath = path.join(ANDROID, '.build-version');
  const namePath = path.join(ANDROID, '.build-version-name');

  const lastCode = fs.existsSync(codePath) ? (Number(fs.readFileSync(codePath, 'utf8').trim()) || 0) : 0;
  const lastName = fs.existsSync(namePath) ? fs.readFileSync(namePath, 'utf8').trim() : '';
  // package.json 里的版本号变了 → versionCode +1；没变则保持（同版本号也能覆盖安装）
  const code = (lastName === versionName) ? Math.max(lastCode, 1) : lastCode + 1;

  fs.writeFileSync(codePath, String(code), 'utf8');
  fs.writeFileSync(namePath, versionName, 'utf8');

  if (!fs.existsSync(gradlePath)) {
    console.log('! 找不到 android/app/build.gradle，跳过版本号写入');
    return;
  }
  const text = fs.readFileSync(gradlePath, 'utf8');
  const patched = text
    .replace(/versionCode\s+\d+/, 'versionCode ' + code)
    .replace(/versionName\s+"[^"]*"/, 'versionName "' + versionName + '"');
  if (patched !== text) fs.writeFileSync(gradlePath, patched, 'utf8');
  console.log('   versionName=' + versionName + '  versionCode=' + code);
  return { versionName: versionName, versionCode: code };
}

/* ================= 主流程 ================= */
(async function main() {
  /* 前置检查 */
  if (!fs.existsSync(path.join(JDK, 'bin', 'java.exe'))) {
    die('缺少 JDK：先运行 node _tools\\install-toolchain.js');
  }
  if (!fs.existsSync(path.join(SDK, 'platforms', 'android-35'))) {
    die('缺少 Android SDK：先运行 node _tools\\install-toolchain.js');
  }
  if (!fs.existsSync(path.join(ROOT, 'node_modules', '@capacitor', 'android'))) {
    die('缺少 Capacitor 依赖：先执行 npm.cmd install');
  }

  const env = Object.assign({}, process.env);
  delete env.Path;
  env.JAVA_HOME = JDK;
  env.ANDROID_HOME = SDK;
  env.ANDROID_SDK_ROOT = SDK;
  env.PATH = [
    path.join(JDK, 'bin'),
    path.join(SDK, 'platform-tools'),
    path.join(SDK, 'cmdline-tools', 'latest', 'bin'),
    process.env.PATH || ''
  ].join(path.delimiter);

  /* 1. 图标 */
  log('1/7 生成 App 图标');
  run(process.execPath, [path.join('_tools', 'gen-app-icons.js')], { env: env });

  /* 2. Android 平台 */
  const capBin = path.join(ROOT, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
  if (!fs.existsSync(capBin)) die('找不到 @capacitor/cli，请先 npm.cmd install');
  if (!fs.existsSync(path.join(ANDROID, 'gradlew.bat'))) {
    log('2/7 添加 android 平台（cap add android）');
    run(process.execPath, [capBin, 'add', 'android'], { env: env });
  } else {
    log('2/7 android 平台已存在，跳过 cap add');
  }

  /* 3. local.properties */
  log('3/7 写入 android/local.properties');
  fs.writeFileSync(
    path.join(ANDROID, 'local.properties'),
    'sdk.dir=' + SDK.replace(/\\/g, '\\\\') + '\n',
    'utf8'
  );

  /* 4. 同步 web 资源 */
  log('4/7 cap sync android');
  run(process.execPath, [capBin, 'sync', 'android'], { env: env });

  /* 5. 版本号 + Gradle 镜像 */
  log('5/7 写入版本号、配置 Gradle 下载源');
  const ver = bumpVersion() || { versionName: '0.0.0', versionCode: 0 };
  await configureGradleMirror();

  /* 6. Gradle 构建 */
  log('6/7 gradlew assembleDebug（首次会下载 Gradle 与依赖，比较慢）');
  const gradleArgs = ['assembleDebug', '--no-daemon'];
  if (process.env.WB_MAVEN_MIRROR === '1') {
    writeMavenInitScript();
    gradleArgs.push('--init-script', 'mirror.init.gradle');
    console.log('   已启用阿里云 Maven 镜像（mirror.init.gradle）');
  }
  run('gradlew.bat', gradleArgs, { cwd: ANDROID, env: env, shell: true });

  /* 7. 收集产物 */
  log('7/7 收集 APK');
  const apk = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (!fs.existsSync(apk)) die('构建结束但没找到 APK：' + apk);
  fs.mkdirSync(DIST, { recursive: true });
  const out = path.join(DIST, 'workbench-debug.apk');
  fs.copyFileSync(apk, out);
  const size = (fs.statSync(out).size / 1024 / 1024).toFixed(1);

  /* 生成 dist/version.json：App 内「检查更新」和 /update/ 下载页都读它 */
  const buf = fs.readFileSync(out);
  const meta = {
    version: ver.versionName,
    versionCode: ver.versionCode,
    apk: path.basename(out),
    size: buf.length,
    sha256: require('crypto').createHash('sha256').update(buf).digest('hex'),
    builtAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(DIST, 'version.json'), JSON.stringify(meta, null, 2), 'utf8');
  // 同时写进 www/：App 启动时读它，就知道自己是哪个版本（热更新 bundle 里不含它）
  fs.writeFileSync(path.join(ROOT, 'www', 'version.json'), JSON.stringify({
    version: meta.version,
    versionCode: meta.versionCode,
    builtAt: meta.builtAt
  }, null, 2), 'utf8');
  console.log('   版本信息：www/version.json + dist/version.json  (' + meta.version + ' / code ' + meta.versionCode + ')');

  console.log('\n✅ 打包完成：' + out + '  (' + size + ' MB)');
  console.log('   装到手机：adb install -r "' + out + '"，或把文件传进手机点击安装（需允许“安装未知来源应用”）。');
  console.log('   产物自检：npm.cmd run test:apk');
})().catch((e) => {
  console.error('\n✗ 打包失败：' + (e && e.message));
  console.log('提示：如果卡在依赖下载，可试 WB_MAVEN_MIRROR=1 npm.cmd run apk');
  process.exit(1);
});
