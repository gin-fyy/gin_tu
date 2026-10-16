/**
 * 界面冒烟测试：node tests/ui-smoke.js
 * 用 jsdom 真的加载 index.html 并跑 core.js + app.js，模拟点击验证界面层没写错。
 * 需要 jsdom：npm.cmd install --save-dev jsdom
 */
const fs = require('fs');
const path = require('path');

let JSDOM;
let VirtualConsole;
try {
  const jsdom = require('jsdom');
  JSDOM = jsdom.JSDOM;
  VirtualConsole = jsdom.VirtualConsole;
} catch (e) {
  console.log('! 未安装 jsdom，跳过界面冒烟测试（npm.cmd install --save-dev jsdom）');
  process.exit(0);
}

const WWW = path.resolve(__dirname, '..', 'www');
const coreSrc = fs.readFileSync(path.join(WWW, 'js', 'core.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(WWW, 'js', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8')
  .replace(/<script src="[^"]+"><\/script>/g, '');

let pass = 0;
const failures = [];

/* jsdom 的 "Not implemented"（scrollTo / 导航等）不算错误，别刷屏；真实报错照样打印 */
function makeConsole() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    if (!/Not implemented/.test(e.message)) console.error('  [jsdom] ' + e.message);
  });
  return vc;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function test(name, fn, pre) {
  let dom = null;
  try {
    dom = new JSDOM(htmlSrc, {
      url: 'http://localhost/',
      pretendToBeVisual: true,
      runScripts: 'outside-only',
      virtualConsole: makeConsole()
    });
    const { window } = dom;
    window.confirm = () => true;
    window.alert = () => {};
    if (!window.URL.createObjectURL) window.URL.createObjectURL = () => 'blob:stub';
    if (!window.URL.revokeObjectURL) window.URL.revokeObjectURL = () => {};
    if (pre) pre(window); // 需要在 app.js 求值前注入的东西（例如假装运行在 App 里）

    window.eval(coreSrc);
    window.eval(appSrc);
    // app.js 在 DOMContentLoaded 后 boot()，jsdom 的事件是异步派发的，等它跑完
    await sleep(30);

    if (!window.WB) throw new Error('core.js 未挂载 window.WB');
    if (!window.document.querySelector('#homeGroups')) throw new Error('DOM 未就绪');
    await fn(window);
    pass++;
    console.log('✓ ' + name);
  } catch (e) {
    failures.push(name + ' → ' + (e && e.message));
    console.log('✗ ' + name + ' → ' + (e && e.message));
  } finally {
    if (dom) dom.window.close();
  }
}

const $ = (w, sel) => w.document.querySelector(sel);
const $$ = (w, sel) => Array.prototype.slice.call(w.document.querySelectorAll(sel));
const click = (w, el) => {
  if (!el) throw new Error('要点击的元素不存在');
  el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
};

function type(w, el, value, eventName) {
  if (!el) throw new Error('要输入的元素不存在');
  el.value = value;
  el.dispatchEvent(new w.Event(eventName || 'input', { bubbles: true }));
}

function addQuick(w, title) {
  const input = $(w, '#quickInput');
  input.value = title;
  click(w, $(w, '#quickAdd'));
}

/* 假装运行在 App 里：在 app.js 求值前注入原生 ApkInstaller 插件（调用记录放在 w.__calls） */
function injectApkInstaller(w) {
  const calls = [];
  w.__calls = calls;
  w.Capacitor = {
    Plugins: {
      ApkInstaller: {
        canInstall: () => { calls.push('canInstall'); return Promise.resolve({ allowed: true, sdk: 34 }); },
        openInstallSettings: () => { calls.push('openInstallSettings'); return Promise.resolve(); },
        download: (o) => { calls.push('download:' + o.url); return Promise.resolve({ path: '/tmp/workbench-9.9.9.apk', size: 5901145 }); },
        install: (o) => { calls.push('install:' + o.path); return Promise.resolve({ started: true }); },
        addListener: (ev, cb) => { w.__progressCb = cb; return { remove: () => {} }; }
      }
    }
  };
}

(async function main() {
  await test('启动：四个页签 + 首页空状态渲染', (w) => {
    if ($$(w, '.tab').length !== 4) throw new Error('页签数量应为 4');
    if ($(w, '#view-home').hidden) throw new Error('默认应显示工作台');
    if ($$(w, '#homeGroups .tcard').length !== 0) throw new Error('初始不应有任务卡片');
    if (!$(w, '#homeGroups').textContent.includes('还没有任务')) throw new Error('缺少空状态');
    if (!$(w, '#topSub').textContent.includes('月')) throw new Error('顶栏日期未渲染');
  });

  await test('快速添加：卡片出现且写入存储', (w) => {
    addQuick(w, '写周报');
    const cards = $$(w, '#homeGroups .tcard');
    if (cards.length !== 1) throw new Error('工作台应有 1 张卡片，实际 ' + cards.length);
    if (!cards[0].textContent.includes('写周报')) throw new Error('卡片标题不对');
    if (w.WB.store.getTasks().length !== 1) throw new Error('数据未写入');
    if ($(w, '#homeTodo').textContent !== '1') throw new Error('今日待办应为 1');
    if ($(w, '#quickInput').value !== '') throw new Error('添加后输入框未清空');
  });

  await test('勾选完成 + 撤销完成', (w) => {
    addQuick(w, '买牛奶');
    click(w, $(w, '#homeGroups .tcard .check'));
    if (w.WB.store.getCompletions().length !== 1) throw new Error('完成记录未写入');
    if (w.WB.store.getTasks()[0].done !== true) throw new Error('任务未置为完成');
    if ($(w, '#homeDone').textContent !== '1') throw new Error('今日完成应为 1');
    // 完成后会从「工作台」的活动列表消失，去任务页「全部」里验证完成态
    click(w, $(w, '.tab[data-view="tasks"]'));
    click(w, $$(w, '#statusSeg .seg-item')[2]);
    const doneCard = $(w, '#taskGroups .tcard.is-done');
    if (!doneCard) throw new Error('任务页“全部”里应能看到已完成的删除线样式');
    click(w, doneCard.querySelector('.check'));
    if (w.WB.store.getCompletions().length !== 0) throw new Error('撤销后完成记录应清零');
    if (w.WB.store.getTasks()[0].done !== false) throw new Error('撤销后任务应恢复未完成');
  });

  await test('完成二次确认：取消则不完成，开关可关闭', (w) => {
    addQuick(w, '别误触');

    // 默认开启：确认框返回「取消」→ 不完成、不记完成记录
    let asked = 0;
    w.confirm = () => { asked++; return false; };
    click(w, $(w, '#homeGroups .tcard .check'));
    if (asked !== 1) throw new Error('未弹出二次确认（asked=' + asked + '）');
    if (w.WB.store.getTasks()[0].done !== false) throw new Error('取消后不应标记完成');
    if (w.WB.store.getCompletions().length !== 0) throw new Error('取消后不应有完成记录');

    // 点「确定」才真的完成
    w.confirm = () => true;
    click(w, $(w, '#homeGroups .tcard .check'));
    if (w.WB.store.getTasks()[0].done !== true) throw new Error('确认后应完成');
    if (w.WB.store.getCompletions().length !== 1) throw new Error('确认后应记一条完成记录');

    // 撤销完成属于恢复操作，不该再弹确认（完成后会从「工作台」消失，去任务页「全部」点）
    click(w, $(w, '.tab[data-view="tasks"]'));
    click(w, $$(w, '#statusSeg .seg-item')[2]);
    const doneCard = $(w, '#taskGroups .tcard.is-done');
    if (!doneCard) throw new Error('任务页“全部”里应能看到已完成任务');
    let askedUndo = 0;
    w.confirm = () => { askedUndo++; return true; };
    click(w, doneCard.querySelector('.check'));
    if (askedUndo !== 0) throw new Error('取消完成不应弹确认');
    if (w.WB.store.getTasks()[0].done !== false) throw new Error('撤销未生效');

    // 开关：默认开、可关闭、关闭后不再确认
    click(w, $(w, '.tab[data-view="mine"]'));
    const sw = $(w, '#confirmDoneSwitch');
    if (sw.checked !== true) throw new Error('开关默认应为开启');
    sw.checked = false;
    sw.dispatchEvent(new w.Event('change', { bubbles: true }));
    if (w.WB.store.getSettings().confirmDone !== false) throw new Error('关闭开关未保存');

    let askedOff = 0;
    w.confirm = () => { askedOff++; return true; };
    click(w, $(w, '.tab[data-view="home"]'));
    addQuick(w, '第二件事');
    click(w, $(w, '#homeGroups .tcard .check'));
    if (askedOff !== 0) throw new Error('关闭二次确认后不应再弹确认');
    const second = w.WB.store.getTasks().filter((t) => t.title === '第二件事')[0];
    if (!second || second.done !== true) throw new Error('关闭确认后应直接完成');
  });

  await test('新建任务弹层：填表保存', (w) => {
    click(w, $(w, '#fabNew'));
    if ($(w, '#sheetTask').hidden) throw new Error('弹层未打开');
    if ($(w, '#sheetTitle').textContent !== '新建任务') throw new Error('标题应为“新建任务”');
    type(w, $(w, '#fTitle'), '看论文');
    type(w, $(w, '#fNote'), '第三章');
    $(w, '#fDate').value = '2030-01-01';
    $(w, '#fRepeat').value = 'weekly';
    click(w, $(w, '#fPriorities').children[0]); // 选“🔥 高”
    click(w, $(w, '#fSave'));
    const tasks = w.WB.store.getTasks();
    if (tasks.length !== 1) throw new Error('任务未创建');
    if (tasks[0].title !== '看论文' || tasks[0].repeat !== 'weekly') throw new Error('字段保存不正确');
    if (tasks[0].priority !== 2) throw new Error('优先级未按点击保存（应为 2）');
    if (tasks[0].note !== '第三章') throw new Error('备注未保存');
    if (!$(w, '#sheetTask').hidden) throw new Error('保存后弹层应关闭');
  });

  await test('编辑任务：改标题 + 删除', (w) => {
    addQuick(w, '旧标题');
    click(w, $(w, '#homeGroups .tcard .main'));
    if ($(w, '#sheetTask').hidden) throw new Error('点卡片应打开编辑');
    if ($(w, '#fTitle').value !== '旧标题') throw new Error('未回填标题');
    type(w, $(w, '#fTitle'), '新标题');
    click(w, $(w, '#fSave'));
    if (w.WB.store.getTasks()[0].title !== '新标题') throw new Error('修改未保存');
    click(w, $(w, '#homeGroups .tcard .main'));
    click(w, $(w, '#fDelete'));
    if (w.WB.store.getTasks().length !== 0) throw new Error('删除未生效');
  });

  await test('重复任务：勾选滚动 + 撤销回滚', (w) => {
    const today = w.WB.datetime.todayStr();
    click(w, $(w, '#fabNew'));
    type(w, $(w, '#fTitle'), '每日复盘');
    $(w, '#fDate').value = today;
    $(w, '#fRepeat').value = 'daily';
    click(w, $(w, '#fSave'));
    click(w, $(w, '#homeGroups .tcard .check'));
    const t1 = w.WB.store.getTasks()[0];
    if (t1.date !== w.WB.datetime.addDays(today, 1)) throw new Error('日期未滚动到下一周期');
    if (t1.done) throw new Error('重复任务勾选后应保持未完成');
    if (w.WB.store.getCompletions().length !== 1) throw new Error('完成记录应为 1 条');
    click(w, $(w, '#homeGroups .tcard .check'));
    if (w.WB.store.getTasks()[0].date !== today) throw new Error('撤销后日期未回滚');
    if (w.WB.store.getCompletions().length !== 0) throw new Error('撤销后记录未删除');
  });

  await test('任务页：搜索与分类筛选', (w) => {
    addQuick(w, '写周报');
    addQuick(w, '买牛奶');
    click(w, $(w, '.tab[data-view="tasks"]'));
    if ($(w, '#view-tasks').hidden) throw new Error('未切到任务页');
    if ($$(w, '#taskGroups .tcard').length !== 2) throw new Error('任务页应显示 2 条');
    type(w, $(w, '#searchInput'), '牛奶');
    const cards = $$(w, '#taskGroups .tcard');
    if (cards.length !== 1 || !cards[0].textContent.includes('买牛奶')) throw new Error('搜索过滤不正确');
    if ($(w, '#searchClear').hidden) throw new Error('有搜索词时应显示清除按钮');
    click(w, $(w, '#searchClear'));
    if ($$(w, '#taskGroups .tcard').length !== 2) throw new Error('清除搜索后应恢复');
    if ($(w, '#view-home').hidden !== true) throw new Error('切页后首页应隐藏');
  });

  await test('统计页：六张卡片 + 柱状图 + 分类分布', (w) => {
    addQuick(w, '任务A');
    click(w, $(w, '#homeGroups .tcard .check'));
    click(w, $(w, '.tab[data-view="stats"]'));
    if ($(w, '#view-stats').hidden) throw new Error('未切到统计页');
    if ($$(w, '#statCards .stat-card').length !== 6) throw new Error('应有 6 张卡片');
    if ($$(w, '#bars .bar-col').length !== 7) throw new Error('柱状图应有 7 列');
    if (!$(w, '#catStats').textContent.includes('其他')) throw new Error('分类分布应显示“其他”');
    if ($(w, '#fabNew').hidden !== true) throw new Error('统计页应隐藏悬浮按钮');
  });

  await test('我的页：新增/删除分类、昵称头像', (w) => {
    click(w, $(w, '.tab[data-view="mine"]'));
    type(w, $(w, '#newCatInput'), '健身');
    click(w, $(w, '#addCatBtn'));
    if (!$(w, '#catList').textContent.includes('健身')) throw new Error('分类未新增');
    if (w.WB.store.getCategories().length !== 5) throw new Error('分类数量不对');
    const del = $$(w, '#catList .cat-del').pop();
    click(w, del);
    if ($(w, '#catList').textContent.includes('健身')) throw new Error('分类未删除');
    w.WB.store.saveSettings({ nickname: '小明' });
    w.document.dispatchEvent(new w.Event('visibilitychange'));
    if ($(w, '#mineName').textContent !== '小明') throw new Error('昵称未刷新');
    if ($(w, '#mineAvatar').textContent !== '小') throw new Error('头像首字不对');
  });

  await test('更新：默认地址 / 多源容灾 / 检查更新', async (w) => {
    click(w, $(w, '.tab[data-view="mine"]'));
    if ($(w, '#versionLine').textContent.indexOf(w.WB.APP_VERSION) < 0) {
      throw new Error('未显示当前版本：' + $(w, '#versionLine').textContent);
    }
    // 内置默认更新地址：装完就能直接点，不用手填
    if ($(w, '#updateBaseInput').value.indexOf('cdn.jsdelivr.net') < 0) {
      throw new Error('未预填默认更新地址：' + $(w, '#updateBaseInput').value);
    }

    // 保存多行地址（一行一个；整串结尾斜杠会被去掉）
    type(w, $(w, '#updateBaseInput'), 'http://127.0.0.1:5173/\nhttps://cdn.example.com/base/');
    click(w, $(w, '#updateBaseSave'));
    const saved = w.WB.store.getSettings().updateBase;
    if (saved.indexOf('http://127.0.0.1:5173') < 0 || saved.indexOf('https://cdn.example.com/base') < 0) {
      throw new Error('多行更新地址未保存：' + saved);
    }
    const bases = w.WB.update.parseBases(saved);
    if (bases.length !== 2 || bases[0] !== 'http://127.0.0.1:5173' || bases[1] !== 'https://cdn.example.com/base') {
      throw new Error('地址解析不对：' + JSON.stringify(bases));
    }

    // 第一个源失败 → 自动落到第二个源，并在状态里标出实际使用的源
    const asked = [];
    w.fetch = (url) => {
      asked.push(String(url));
      if (String(url).indexOf('127.0.0.1') >= 0) return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ version: w.WB.APP_VERSION, versionCode: 1 }) });
    };
    click(w, $(w, '#checkUpdateBtn'));
    await sleep(80);
    if (asked.length < 2) throw new Error('没有尝试第二个源：' + JSON.stringify(asked));
    if ($(w, '#updateState').textContent.indexOf('cdn.example.com') < 0) {
      throw new Error('未标出实际使用的源：' + $(w, '#updateState').textContent);
    }
    if ($(w, '#updateState').textContent.indexOf('最新') < 0) {
      throw new Error('应提示已是最新：' + $(w, '#updateState').textContent);
    }

    // 发现新版本 → 弹更新弹窗（含更新日志），而不是直接开浏览器
    w.fetch = (url) => {
      if (String(url).indexOf('127.0.0.1') >= 0) return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          version: '9.9.9',
          versionCode: 99,
          apk: 'workbench-debug.apk',
          size: 5901145,
          builtAt: '2026-10-15T13:54:56.142Z',
          notes: ['换了新界面', '修复了提醒没响的问题']
        })
      });
    };
    click(w, $(w, '#checkUpdateBtn'));
    await sleep(80);
    if ($(w, '#updateModal').hidden) throw new Error('未弹出更新弹窗');
    if ($(w, '#updVersion').textContent.indexOf('9.9.9') < 0) throw new Error('弹窗里的版本号不对：' + $(w, '#updVersion').textContent);
    if ($(w, '#updNotes').textContent.indexOf('换了新界面') < 0) throw new Error('更新日志第一条没显示');
    if ($(w, '#updNotes').textContent.indexOf('修复了提醒没响的问题') < 0) throw new Error('更新日志不完整');
    if ($(w, '#updMeta').textContent.indexOf('MB') < 0) throw new Error('没显示安装包大小');
    click(w, $(w, '#updLater'));
    if (!$(w, '#updateModal').hidden) throw new Error('「稍后」没有关掉弹窗');

    // 所有源都连不上 → 明确报错
    w.fetch = () => Promise.reject(new Error('network down'));
    click(w, $(w, '#checkUpdateBtn'));
    await sleep(80);
    if ($(w, '#updateState').textContent.indexOf('检查失败') < 0) {
      throw new Error('未提示失败：' + $(w, '#updateState').textContent);
    }

    // 热更新：网页版没有原生插件 → 说明只在 App 内可用
    click(w, $(w, '#checkOtaBtn'));
    if ($(w, '#updateState').textContent.indexOf('APK') < 0) {
      throw new Error('未说明热更新仅在 App 内可用：' + $(w, '#updateState').textContent);
    }

    // 关键：两个源都答得上，但靠前的源（更快）还缓存着旧版 → 必须取版本更新的那个
    const both = [];
    w.fetch = (url) => {
      both.push(String(url));
      if (String(url).indexOf('127.0.0.1') >= 0) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ version: '1.1.3', versionCode: 3 }) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ version: '9.9.9', versionCode: 99, apk: 'workbench-debug.apk', notes: ['取最新源'] })
      });
    };
    click(w, $(w, '#checkUpdateBtn'));
    await sleep(80);
    if (both.length < 2) throw new Error('没有同时询问所有源：' + JSON.stringify(both));
    if ($(w, '#updateModal').hidden) throw new Error('应弹出更新弹窗');
    if ($(w, '#updVersion').textContent.indexOf('9.9.9') < 0) {
      throw new Error('没有采用版本更新的那个源：' + $(w, '#updVersion').textContent);
    }
    if ($(w, '#updateState').textContent.indexOf('个源中最新') < 0) {
      throw new Error('没有标出「多个源中最新」：' + $(w, '#updateState').textContent);
    }
    click(w, $(w, '#updLater'));
  });

  await test('更新下载：第一个源超时 → 自动换下一个源，并带 sha256 校验', async (w) => {
    const calls = w.__calls;
    let attempts = 0;
    let lastOpts = null;

    // 第一个下载源模拟「超时」，第二个成功（真实场景：jsDelivr 太慢 → 换国内镜像）
    w.Capacitor.Plugins.ApkInstaller.download = (o) => {
      lastOpts = o;
      attempts++;
      calls.push('download' + attempts + ':' + o.url);
      if (attempts === 1) return Promise.reject(new Error('timeout'));
      return Promise.resolve({ path: '/tmp/workbench-9.9.9.apk', size: 5901145, attempts: 1 });
    };

    w.fetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        version: '9.9.9', versionCode: 99, apk: 'workbench-debug.apk',
        sha256: 'b'.repeat(64), notes: ['下载更稳了']
      })
    });

    // 配两个源，确保失败后还有下一个可用
    type(w, $(w, '#updateBaseInput'), 'https://cdn.example.com/base\nhttps://mirror.example.com/m');
    click(w, $(w, '#updateBaseSave'));

    click(w, $(w, '.tab[data-view="mine"]'));
    click(w, $(w, '#checkUpdateBtn'));
    await sleep(60);
    if ($(w, '#updateModal').hidden) throw new Error('未弹出更新弹窗');

    click(w, $(w, '#updInstall'));
    await sleep(120);
    if (attempts < 2) throw new Error('第一个源失败后没有换源重试：' + JSON.stringify(calls));
    if (!calls.some((c) => c.indexOf('install:') === 0)) throw new Error('换源成功后没有拉起安装：' + JSON.stringify(calls));
    if (!lastOpts || lastOpts.sha256 !== 'b'.repeat(64)) {
      throw new Error('下载时没有把 sha256 交给原生端校验：' + JSON.stringify(lastOpts));
    }
    if ($(w, '#updHint').textContent.indexOf('安装') < 0) throw new Error('没有提示去系统安装界面');
  }, injectApkInstaller);

  await test('更新：地址被填成旧地址时仍会回退到内置源（不漏更新）', async (w) => {
    click(w, $(w, '.tab[data-view="mine"]'));
    type(w, $(w, '#updateBaseInput'), 'https://stale.example.com/old');
    click(w, $(w, '#updateBaseSave'));

    const asked = [];
    w.fetch = (url) => {
      const u = String(url);
      asked.push(u);
      // 用户填的源：只会返回一个旧版本（真实场景：某个 commit 固定地址）
      if (u.indexOf('stale.example.com') >= 0) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ version: '1.1.0', versionCode: 1 }) });
      }
      // 内置默认源里有一个能给出新版本
      if (u.indexOf('ghfast.top') >= 0) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ version: '9.9.9', versionCode: 99, apk: 'workbench-debug.apk', notes: ['内置源兜底'] })
        });
      }
      return Promise.resolve({ ok: false, status: 500 });
    };

    click(w, $(w, '#checkUpdateBtn'));
    await sleep(120);
    if (asked.filter((u) => u.indexOf('stale.example.com') >= 0).length !== 1) {
      throw new Error('没有先问用户填的源：' + JSON.stringify(asked));
    }
    if (!asked.some((u) => u.indexOf('ghfast.top') >= 0)) {
      throw new Error('没有回退检查内置源：' + JSON.stringify(asked));
    }
    if ($(w, '#updateModal').hidden) throw new Error('内置源发现了新版本却没弹窗（漏更新）');
    if ($(w, '#updVersion').textContent.indexOf('9.9.9') < 0) {
      throw new Error('没有采用内置源的版本：' + $(w, '#updVersion').textContent);
    }
  });

  await test('我的页：更新地址可一键恢复默认', async (w) => {
    click(w, $(w, '.tab[data-view="mine"]'));
    type(w, $(w, '#updateBaseInput'), 'https://whatever.example.com/x');
    click(w, $(w, '#updateBaseSave'));
    if (w.WB.store.getSettings().updateBase.indexOf('whatever.example.com') < 0) {
      throw new Error('保存自定义地址失败');
    }
    click(w, $(w, '#updateBaseReset'));
    const s = w.WB.store.getSettings().updateBase;
    if (s.indexOf('cdn.jsdelivr.net') < 0 || s.indexOf('ghfast.top') < 0) {
      throw new Error('没有恢复内置的多个源：' + s);
    }
    if ($(w, '#updateBaseInput').value.indexOf('ghfast.top') < 0) {
      throw new Error('输入框没跟着刷新：' + $(w, '#updateBaseInput').value);
    }
  });

  await test('更新弹窗：App 内下载安装（含进度与忽略）', async (w) => {
    const calls = w.__calls;
    w.fetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        version: '9.9.9', versionCode: 99, apk: 'workbench-debug.apk', size: 5901145,
        notes: ['应用内更新']
      })
    });
    // 手动触发一次检查，弹出弹窗
    click(w, $(w, '.tab[data-view="mine"]'));
    click(w, $(w, '#checkUpdateBtn'));
    await sleep(60);
    if ($(w, '#updateModal').hidden) throw new Error('未弹出更新弹窗');

    // 点「立即更新」→ 依次调用 canInstall / download / install
    click(w, $(w, '#updInstall'));
    await sleep(60);
    if (calls[0] !== 'canInstall') throw new Error('没有先检查安装权限：' + JSON.stringify(calls));
    if (!calls.some((c) => c.indexOf('download:') === 0)) throw new Error('没有在应用内下载：' + JSON.stringify(calls));
    if (!calls.some((c) => c.indexOf('download:') === 0 && c.indexOf('workbench-debug.apk') > 0)) {
      throw new Error('下载地址不对：' + JSON.stringify(calls));
    }
    if (!calls.some((c) => c.indexOf('install:') === 0)) throw new Error('没有拉起安装：' + JSON.stringify(calls));
    if ($(w, '#updHint').textContent.indexOf('安装') < 0) throw new Error('没有提示接下来要做什么：' + $(w, '#updHint').textContent);

    // 原生进度事件 → 进度条
    if (w.__progressCb) {
      w.__progressCb({ progress: 42, received: 42, total: 100 });
      if ($(w, '#updProgressFill').style.width.indexOf('42') !== 0) {
        throw new Error('进度条没更新：' + $(w, '#updProgressFill').style.width);
      }
    }

    // 「忽略此版本」→ 记进设置，下次不再打扰
    click(w, $(w, '#updIgnore'));
    if (w.WB.store.getSettings().ignoredVersion !== '9.9.9') {
      throw new Error('忽略的版本没记下来：' + w.WB.store.getSettings().ignoredVersion);
    }
    if (!$(w, '#updateModal').hidden) throw new Error('忽略后弹窗没关');

    // 需要授权的情况：canInstall 返回 false → 打开系统设置并提示
    w.Capacitor.Plugins.ApkInstaller.canInstall = () => { calls.push('canInstall:denied'); return Promise.resolve({ allowed: false, sdk: 34 }); };
    click(w, $(w, '#checkUpdateBtn'));
    await sleep(60);
    click(w, $(w, '#updInstall'));
    await sleep(60);
    if (!calls.includes('canInstall:denied')) throw new Error('没有重新检查权限');
    if (!calls.includes('openInstallSettings')) throw new Error('没有打开系统授权页');
    if ($(w, '#updHint').textContent.indexOf('允许') < 0) throw new Error('没有提示需要授权：' + $(w, '#updHint').textContent);
  }, injectApkInstaller);

  await test('数据：导出不报错、导入覆盖生效', (w) => {
    addQuick(w, '原始任务');
    click(w, $(w, '.tab[data-view="mine"]'));
    click(w, $(w, '#exportBtn')); // Blob + a.click 路径，只验证不抛异常
    const json = w.WB.store.exportData();
    w.WB.store.clearAll();
    if (w.WB.store.getTasks().length !== 0) throw new Error('清空失败');
    click(w, $(w, '#importBtn'));
    if ($(w, '#sheetImport').hidden) throw new Error('导入弹层未打开');
    type(w, $(w, '#importText'), json, 'input');
    click(w, $(w, '#importDo'));
    if (w.WB.store.getTasks().length !== 1) throw new Error('导入未恢复数据');
    if ($(w, '#sheetImport').hidden !== true) throw new Error('导入后弹层应关闭');
  });

  await test('弹层：返回键/Esc 关闭', (w) => {
    click(w, $(w, '#fabNew'));
    if ($(w, '#sheetTask').hidden) throw new Error('弹层未打开');
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (!$(w, '#sheetTask').hidden) throw new Error('Esc 未关闭弹层');
    click(w, $(w, '#fabNew'));
    click(w, $(w, '#sheetMask'));
    if (!$(w, '#sheetTask').hidden) throw new Error('点遮罩未关闭弹层');
  });

  await test('提醒：窗口内的任务触发页面提示', (w) => {
    const d = w.WB.datetime;
    const today = d.todayStr();
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(Math.max(0, now.getMinutes() - 30)).padStart(2, '0'); // 30 分钟前到期
    w.WB.store.addTask({ title: '该开会了', date: today, time: hh + ':' + mm, remind: true });
    w.document.dispatchEvent(new w.Event('visibilitychange'));
    if ($(w, '#toast').hidden) throw new Error('提醒未触发页面提示');
    if (!$(w, '#toast').textContent.includes('该开会了')) throw new Error('提示内容不对');
    if (w.WB.store.getNotifiedKeys().length !== 1) throw new Error('提醒标记未记录');
  });

  console.log('\n通过 ' + pass + ' 项，失败 ' + failures.length + ' 项');
  if (failures.length) {
    failures.forEach((f) => console.log('  ✗ ' + f));
    process.exit(1);
  }
})();
