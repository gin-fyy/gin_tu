// 统计逻辑（纯函数，不依赖 wx，可被 node 测试直接调用）
const dt = require('./datetime');

// 当前状态计数：进行中 / 已逾期 / 今天要做的
function countsOf(tasks, today) {
  const list = tasks || [];
  const active = list.filter(t => !t.done);
  return {
    open: active.length,
    overdue: active.filter(t => t.date && t.date < today).length,
    today: active.filter(t => t.date === today).length,
    done: list.filter(t => t.done).length
  };
}

// 连续打卡天数：从今天往回数；今天还没完成不算断
function streakOf(comps, today) {
  const days = {};
  (comps || []).forEach(c => { days[dt.toDateStr(new Date(c.at))] = true; });
  let cursor = days[today] ? today : dt.addDays(today, -1);
  let streak = 0;
  while (days[cursor]) {
    streak++;
    cursor = dt.addDays(cursor, -1);
  }
  return streak;
}

// 近 7 天（含今天）完成数，柱高按最大值归一化
function last7(comps, today) {
  const out = [];
  let max = 1;
  for (let i = 6; i >= 0; i--) {
    const ds = dt.addDays(today, -i);
    const d = dt.parseDate(ds);
    const count = (comps || []).filter(c => dt.toDateStr(new Date(c.at)) === ds).length;
    if (count > max) max = count;
    out.push({
      ds: ds,
      count: count,
      label: i === 0 ? '今天' : (i === 1 ? '昨天' : (d.getMonth() + 1) + '/' + d.getDate())
    });
  }
  out.forEach(o => {
    o.h = o.count ? Math.max(10, Math.round(o.count * 100 / max)) : 4;
  });
  return out;
}

// 分类完成分布（只保留有完成记录的分类，按数量倒序）
function byCategory(cats, comps) {
  const total = (comps || []).length;
  return (cats || [])
    .map(c => {
      const count = comps.filter(x => x.category === c.id).length;
      return {
        name: c.name,
        color: c.color,
        count: count,
        pct: total ? Math.round(count * 100 / total) : 0
      };
    })
    .filter(c => c.count > 0)
    .sort((a, b) => b.count - a.count);
}

// 完成率 = 历史完成数 / (历史完成数 + 当前未完成数)
function rateOf(comps, openCount) {
  const total = (comps || []).length;
  const denom = total + openCount;
  return denom ? Math.round(total * 100 / denom) : 0;
}

function weekCountOf(comps, today) {
  const start7 = dt.parseDate(dt.addDays(today, -6)).getTime();
  return (comps || []).filter(c => c.at >= start7).length;
}

// 统计页一次性需要的全部数据
function overview(tasks, comps, cats, today) {
  const counts = countsOf(tasks, today);
  const weekCount = weekCountOf(comps, today);
  const streak = streakOf(comps, today);
  const rate = rateOf(comps, counts.open);
  return {
    counts: counts,
    weekCount: weekCount,
    streak: streak,
    rate: rate,
    cards: [
      { label: '累计完成', value: (comps || []).length },
      { label: '近7天完成', value: weekCount },
      { label: '连续打卡', value: streak + ' 天' },
      { label: '完成率', value: rate + '%' },
      { label: '进行中', value: counts.open },
      { label: '已逾期', value: counts.overdue }
    ],
    days: last7(comps, today),
    catStats: byCategory(cats, comps)
  };
}

module.exports = {
  countsOf: countsOf,
  streakOf: streakOf,
  last7: last7,
  byCategory: byCategory,
  rateOf: rateOf,
  weekCountOf: weekCountOf,
  overview: overview
};
