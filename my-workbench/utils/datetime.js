// 日期时间工具（统一本地时区）
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function toDateStr(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function todayStr() {
  return toDateStr(new Date());
}

function parseDate(str) {
  const parts = (str || '').split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function addMonths(dateStr, n) {
  const d = parseDate(dateStr);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInMonth));
  return toDateStr(d);
}

// 展示用日期：今天 / 明天 / 后天 / M月D日 周X
function dateLabel(dateStr) {
  if (!dateStr) return '';
  const today = todayStr();
  if (dateStr === today) return '今天';
  if (dateStr === addDays(today, 1)) return '明天';
  if (dateStr === addDays(today, 2)) return '后天';
  const d = parseDate(dateStr);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WEEK[d.getDay()];
}

function isOverdue(dateStr) {
  return !!dateStr && dateStr < todayStr();
}

// 完成时间展示：MM-DD HH:mm
function fmtTime(ts) {
  const d = new Date(ts);
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 12) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function fullDateText() {
  const d = new Date();
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 星期' + WEEK[d.getDay()];
}

module.exports = {
  WEEK: WEEK,
  pad: pad,
  toDateStr: toDateStr,
  todayStr: todayStr,
  parseDate: parseDate,
  addDays: addDays,
  addMonths: addMonths,
  dateLabel: dateLabel,
  isOverdue: isOverdue,
  fmtTime: fmtTime,
  greeting: greeting,
  fullDateText: fullDateText
};
