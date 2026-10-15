// 任务卡片组件：展示单条任务，向外抛出 toggle / edit / more 事件
const datetime = require('../../utils/datetime');

const REPEAT_LABEL = { daily: '每天', weekly: '每周', monthly: '每月' };
const PRIORITY_CLASS = ['p-low', 'p-mid', 'p-high'];

function withAlpha(hex, a) {
  const h = (hex || '#6B7280').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

Component({
  options: {
    addGlobalClass: true
  },

  properties: {
    task: { type: Object, value: {} },
    cats: { type: Array, value: [] }
  },

  data: {
    view: {} // 由 task + cats 派生的展示字段
  },

  observers: {
    'task, cats': function (task, cats) {
      if (!task || !task.id) {
        this.setData({ view: {} });
        return;
      }
      const cat = (cats || []).find(c => c.id === task.category);
      const dateText = task.done && task.doneAt
        ? '完成于 ' + datetime.fmtTime(task.doneAt)
        : datetime.dateLabel(task.date);
      this.setData({
        view: {
          categoryName: cat ? cat.name : '其他',
          categoryColor: cat ? cat.color : '#6B7280',
          categoryBg: withAlpha(cat ? cat.color : '#6B7280', 0.12),
          dateText: dateText,
          overdue: !task.done && datetime.isOverdue(task.date),
          timeLabel: task.time || '',
          repeatLabel: REPEAT_LABEL[task.repeat] || '',
          priorityClass: PRIORITY_CLASS[task.priority] || 'p-mid'
        }
      });
    }
  },

  methods: {
    onToggle() {
      this.triggerEvent('toggle', { id: this.data.task.id });
    },
    onTap() {
      this.triggerEvent('edit', { id: this.data.task.id });
    },
    onLongPress() {
      this.triggerEvent('more', { id: this.data.task.id });
    }
  }
});
