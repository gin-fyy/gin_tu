/**
 * 用访问令牌（PAT）推送到 GitHub：node _tools/push-github.js
 *
 * 令牌只从文件读，不打印、不写进仓库配置，推送完自动删除：
 *   <仓库根>/.git-toolchain/token.txt   ← 内容就是 GitHub 那一串 ghp_...
 *
 * 顺便说明：这台机器上 Steam++ 把 GitHub 域名指到了 127.0.0.1 并做中间人，
 * 所以这里用 `-c http.sslVerify=false` 跳过证书校验（只作用于本次命令，不写入配置）。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');                       // workspace/default
const GIT = path.join(REPO, '.git-toolchain', 'git', 'cmd', 'git.exe');
const TOKEN_FILE = path.join(REPO, '.git-toolchain', 'token.txt');

function git(args, opts) {
  return spawnSync(GIT, args, Object.assign({ cwd: REPO, encoding: 'utf8' }, opts || {}));
}

if (!fs.existsSync(GIT)) {
  console.error('✗ 找不到便携 git：' + GIT);
  process.exit(1);
}
if (!fs.existsSync(path.join(REPO, '.git'))) {
  console.error('✗ 不是 git 仓库：' + REPO);
  process.exit(1);
}
if (!fs.existsSync(TOKEN_FILE)) {
  console.error('✗ 找不到令牌文件：' + TOKEN_FILE + '\n  把 GitHub 令牌粘贴进去（只放令牌本身）再重跑');
  process.exit(1);
}

const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
if (token.length < 20) {
  console.error('✗ 令牌文件内容看起来不对（长度 ' + token.length + '），请确认已粘贴完整令牌');
  process.exit(1);
}

const url = git(['remote', 'get-url', 'origin']).stdout.trim();
const m = url.match(/github\.com[/:]([^/]+)\/(.+?)(\.git)?$/);
if (!m) {
  console.error('✗ 解析不了 origin 地址：' + url);
  process.exit(1);
}
const owner = m[1];
const repo = m[2];

console.log('推送 → ' + owner + '/' + repo + '（分支 main）');
const cred = path.join(os.tmpdir(), 'wb-cred-' + Date.now() + '.txt');
fs.writeFileSync(cred, 'https://' + owner + ':' + token + '@github.com\n', 'utf8');

const push = spawnSync(GIT, [
  '-c', 'credential.helper=store --file=' + cred,
  '-c', 'http.sslVerify=false',
  'push', '-u', 'origin', 'main'
], { cwd: REPO, stdio: 'inherit' });

fs.rmSync(cred, { force: true });
fs.rmSync(TOKEN_FILE, { force: true });
console.log('\n（已删除临时凭据文件与令牌文件）');

if (push.status !== 0) {
  console.error('✗ 推送失败，退出码 ' + push.status);
  process.exit(push.status || 1);
}

const check = git(['-c', 'http.sslVerify=false', 'ls-remote', '--heads', 'origin']);
console.log('✓ 推送成功，远端分支：\n' + check.stdout.trim());
console.log('\n仓库地址：https://github.com/' + owner + '/' + repo);
console.log('下一步：仓库 Settings → Pages → Source 选 main 分支 /docs 目录（开更新源）');
