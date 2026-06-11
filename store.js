/**
 * 小红花日历 - 全局状态管理 + 日程引擎
 * EventStore: 统一数据源，localStorage 持久化
 * SchedulingEngine: 冲突检测 + 类型转换 + 拖拽支持
 */

const EventStore = (() => {
  const STORAGE_KEY = 'little-red-flower-calendar-v1';
  const OLD_KEY = 'xiaohonghua_events';

  // 数据迁移：从旧key迁移到新key
  (function migrateData() {
    try {
      const oldData = localStorage.getItem(OLD_KEY);
      const newData = localStorage.getItem(STORAGE_KEY);
      if (oldData && !newData) {
        localStorage.setItem(STORAGE_KEY, oldData);
        localStorage.removeItem(OLD_KEY);
        console.log('数据已从旧版本迁移');
      }
    } catch (e) { /* ignore */ }
  })();

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  function load() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.warn('读取数据失败，使用空数据', e);
      return [];
    }
  }

  function save(events) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    } catch (e) {
      console.warn('保存数据失败', e);
    }
  }

  // ========== CRUD ==========

  function createEvent(eventData) {
    const events = load();
    const newEvent = {
      id: generateId(),
      title: eventData.title || '未命名',
      type: eventData.type || 'todo',
      date: eventData.date || todayStr(),
      startTime: eventData.startTime || null,
      endTime: eventData.endTime || null,
      duration: eventData.duration || null,
      priority: eventData.priority || 'normal',
      notes: eventData.notes || '',
      subtasks: eventData.subtasks || [],
      repeatRule: eventData.repeatRule || 'none',
      completedInstances: eventData.completedInstances || {},
      status: 'pending',
      conflict: false,
      createdAt: new Date().toISOString()
    };
    events.push(newEvent);
    // 如果是schedule，执行冲突检测
    if (newEvent.type === 'schedule' && newEvent.startTime) {
      runConflictDetection(events, newEvent.date);
    }
    save(events);
    return newEvent;
  }

  function getAll() {
    return load();
  }

  function getById(id) {
    return load().find(e => e.id === id) || null;
  }

  function updateEvent(id, updates) {
    const events = load();
    const event = events.find(e => e.id === id);
    if (!event) return null;

    const oldDate = event.date;
    const editableFields = [
      'title', 'type', 'date', 'startTime', 'endTime', 'duration',
      'priority', 'notes', 'subtasks', 'repeatRule', 'completedInstances',
      'status'
    ];

    editableFields.forEach(field => {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        event[field] = updates[field];
      }
    });
    event.updatedAt = new Date().toISOString();

    // 更新类型、日期或时间后，新旧日期都需要重新计算冲突。
    runConflictDetection(events, oldDate);
    if (event.date !== oldDate) {
      runConflictDetection(events, event.date);
    }

    save(events);
    return event;
  }

  function toggleStatus(id) {
    const events = load();
    const event = events.find(e => e.id === id);
    if (!event) return null;
    if (event.status === 'pending') {
      event.status = 'done';
      save(events);
    }
    return event;
  }

  function undoComplete(id) {
    const events = load();
    const event = events.find(e => e.id === id);
    if (!event) return null;
    if (event.status === 'done') {
      event.status = 'pending';
      save(events);
    }
    return event;
  }

  function deleteEvent(id) {
    const events = load();
    const removed = events.find(e => e.id === id);
    const filtered = events.filter(e => e.id !== id);
    // 删除后重新检测冲突
    if (removed && removed.type === 'schedule') {
      runConflictDetection(filtered, removed.date);
    }
    save(filtered);
    return filtered;
  }

  // ========== 子待办管理 ==========

  function addSubtask(eventId, title) {
    const events = load();
    const event = events.find(e => e.id === eventId);
    if (!event) return null;
    if (!event.subtasks) event.subtasks = [];
    event.subtasks.push({
      id: generateId(),
      title: title,
      done: false,
      createdAt: new Date().toISOString()
    });
    save(events);
    return event.subtasks[event.subtasks.length - 1];
  }

  function toggleSubtask(eventId, subtaskId) {
    const events = load();
    const event = events.find(e => e.id === eventId);
    if (!event || !event.subtasks) return null;
    const sub = event.subtasks.find(s => s.id === subtaskId);
    if (!sub) return null;
    sub.done = !sub.done;
    save(events);
    return sub;
  }

  function deleteSubtask(eventId, subtaskId) {
    const events = load();
    const event = events.find(e => e.id === eventId);
    if (!event || !event.subtasks) return null;
    event.subtasks = event.subtasks.filter(s => s.id !== subtaskId);
    save(events);
    return event;
  }

  // ========== 日程引擎：冲突检测 ==========

  /**
   * 检测同一天所有schedule事件的时间冲突
   * 规则：同一天 + 时间重叠 (A.start < B.end && A.end > A.start)
   * 处理：标记conflict=true，不阻止操作
   */
  function runConflictDetection(events, dateStr) {
    // 先清除该天所有事件的conflict标记
    events.forEach(e => {
      if (e.date === dateStr) e.conflict = false;
    });

    // 找出该天所有有时间的schedule
    const daySchedules = events.filter(e =>
      e.date === dateStr &&
      e.type === 'schedule' &&
      e.startTime &&
      e.endTime
    );

    // 两两比较
    for (let i = 0; i < daySchedules.length; i++) {
      for (let j = i + 1; j < daySchedules.length; j++) {
        const a = daySchedules[i];
        const b = daySchedules[j];
        if (a.startTime < b.endTime && a.endTime > b.startTime) {
          a.conflict = true;
          b.conflict = true;
        }
      }
    }
  }

  /**
   * 引擎主入口：执行完整调度流程
   * 1. 更新数据
   * 2. 重新排序
   * 3. 冲突检测
   * 4. 返回更新后的事件列表
   */
  function engineRun(dateStr) {
    const events = load();
    // 冲突检测
    runConflictDetection(events, dateStr);
    save(events);
    return events.filter(e => e.date === dateStr);
  }

  // ========== 日程引擎：类型转换 ==========

  /**
   * todo → schedule：放入时间轴
   * @param {string} id - 事件ID
   * @param {string} startTime - 开始时间 "HH:MM"
   * @param {string} endTime - 结束时间 "HH:MM"
   */
  function convertToSchedule(id, startTime, endTime) {
    const events = load();
    const event = events.find(e => e.id === id);
    if (!event) return null;

    event.type = 'schedule';
    event.startTime = startTime || '09:00';
    event.endTime = endTime || addHour(startTime || '09:00', 1);

    // 执行引擎
    runConflictDetection(events, event.date);
    save(events);
    return event;
  }

  /**
   * schedule → todo：拖出时间轴
   * @param {string} id - 事件ID
   */
  function convertToTodo(id) {
    const events = load();
    const event = events.find(e => e.id === id);
    if (!event) return null;

    const oldDate = event.date;
    event.type = 'todo';
    event.startTime = null;
    event.endTime = null;
    event.conflict = false;

    // 重新检测旧日期的冲突
    runConflictDetection(events, oldDate);
    save(events);
    return event;
  }

  /**
   * 移动schedule到新时间
   * @param {string} id - 事件ID
   * @param {string} newStartTime - 新开始时间
   * @param {string} newEndTime - 新结束时间
   * @param {string} newDate - 新日期（可选，跨天移动）
   */
  function moveSchedule(id, newStartTime, newEndTime, newDate) {
    const events = load();
    const event = events.find(e => e.id === id);
    if (!event) return null;

    const oldDate = event.date;
    event.startTime = newStartTime;
    event.endTime = newEndTime;
    if (newDate) event.date = newDate;

    // 检测新旧日期的冲突
    runConflictDetection(events, event.date);
    if (oldDate !== event.date) {
      runConflictDetection(events, oldDate);
    }
    save(events);
    return event;
  }

  // ========== 重复任务逻辑 ==========

  /**
   * 判断重复任务是否应该在指定日期显示
   */
  function shouldShowOnDate(event, dateStr) {
    if (event.repeatRule === 'none') return event.date === dateStr;
    if (event.repeatRule === 'daily') return event.date <= dateStr;
    if (event.repeatRule === 'weekly') {
      if (event.date > dateStr) return false;
      const startDow = new Date(event.date).getDay();
      const targetDow = new Date(dateStr).getDay();
      return startDow === targetDow;
    }
    return false;
  }

  /**
   * 获取重复任务在指定日期的完成状态
   */
  function isInstanceCompleted(event, dateStr) {
    return !!(event.completedInstances && event.completedInstances[dateStr]);
  }

  /**
   * 切换重复任务在指定日期的完成状态
   */
  function toggleRepeatInstance(id, dateStr) {
    const events = load();
    const event = events.find(e => e.id === id);
    if (!event) return null;
    if (!event.completedInstances) event.completedInstances = {};
    event.completedInstances[dateStr] = !event.completedInstances[dateStr];
    save(events);
    return event;
  }

  // ========== 查询 ==========

  function getByDate(dateStr) {
    const events = load();
    const result = [];
    events.forEach(event => {
      if (event.repeatRule === 'none') {
        if (event.date === dateStr) result.push(event);
      } else {
        // 重复任务：展开到当前日期
        if (shouldShowOnDate(event, dateStr)) {
          // 创建一个虚拟视图，不修改原始数据
          const view = Object.assign({}, event);
          view._viewDate = dateStr;
          view._instanceCompleted = isInstanceCompleted(event, dateStr);
          result.push(view);
        }
      }
    });
    return result;
  }

  function getByMonth(yearMonth) {
    return load().filter(e => e.date.startsWith(yearMonth));
  }

  // 获取某天的schedule（按时间排序）
  function getSchedulesByDate(dateStr) {
    const events = load().filter(e =>
      e.date === dateStr &&
      e.type === 'schedule' &&
      e.startTime
    );
    return events.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  // 获取某天的todo
  function getTodosByDate(dateStr) {
    return load().filter(e =>
      e.date === dateStr &&
      (e.type === 'todo' || e.type === 'idea' || (e.type === 'schedule' && !e.startTime))
    );
  }

  // 获取某天的冲突事件
  function getConflictsByDate(dateStr) {
    return load().filter(e => e.date === dateStr && e.conflict === true);
  }

  // ========== 统计 ==========

  function getDayStats(dateStr) {
    const events = getByDate(dateStr);
    const total = events.length;
    const done = events.filter(e => e.status === 'done').length;
    const pending = total - done;
    const schedules = events.filter(e => e.type === 'schedule');
    const todos = events.filter(e => e.type === 'todo');
    const conflicts = events.filter(e => e.conflict);
    return { total, done, pending, schedules, todos, events, conflicts };
  }

  function getMonthStats(yearMonth) {
    const events = getByMonth(yearMonth);
    const total = events.length;
    const done = events.filter(e => e.status === 'done').length;
    const pending = total - done;
    const flowerCount = done;

    const dayCountMap = {};
    events.forEach(e => {
      dayCountMap[e.date] = (dayCountMap[e.date] || 0) + 1;
    });
    let busiestDay = null;
    let busiestCount = 0;
    Object.entries(dayCountMap).forEach(([date, count]) => {
      if (count > busiestCount) {
        busiestCount = count;
        busiestDay = date;
      }
    });

    let latestEnd = null;
    events.forEach(e => {
      if (e.endTime && e.status === 'done') {
        if (!latestEnd || e.endTime > latestEnd) {
          latestEnd = e.endTime;
        }
      }
    });

    const daysInMonth = new Date(parseInt(yearMonth.split('-')[0]), parseInt(yearMonth.split('-')[1]), 0).getDate();
    const dailyAvg = daysInMonth > 0 ? (done / daysInMonth).toFixed(1) : '0';

    const highlights = events
      .filter(e => e.status === 'done' && e.priority === 'star')
      .map(e => e.title);

    return {
      total, done, pending, flowerCount,
      busiestDay, busiestCount,
      latestEnd,
      dailyAvg,
      highlights,
      daysInMonth
    };
  }

  function getTotalFlowers() {
    const events = load();
    let count = 0;
    events.forEach(e => {
      if (e.repeatRule === 'none') {
        if (e.status === 'done') count++;
      } else {
        // 重复任务：每个完成的instance算一朵花
        if (e.completedInstances) {
          count += Object.values(e.completedInstances).filter(v => v === true).length;
        }
      }
    });
    return count;
  }

  // ========== 工具 ==========

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function currentMonthStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    return `${parseInt(parts[1])}月${parseInt(parts[2])}日`;
  }

  function formatMonth(yearMonth) {
    if (!yearMonth) return '';
    const parts = yearMonth.split('-');
    return `${parseInt(parts[1])}月总结`;
  }

  function getWeekday(dateStr) {
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    const d = new Date(dateStr);
    return `星期${days[d.getDay()]}`;
  }

  function getRecentDays(n) {
    const days = [];
    const today = new Date();
    const half = Math.floor(n / 2);
    for (let i = -half; i <= half; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      days.push({
        dateStr: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        day: d.getDate(),
        month: d.getMonth() + 1,
        weekday: ['一', '二', '三', '四', '五', '六', '日'][d.getDay() === 0 ? 6 : d.getDay() - 1],
        weekdayIndex: d.getDay() === 0 ? 6 : d.getDay() - 1,
        isToday: i === 0,
        isWeekend: d.getDay() === 0 || d.getDay() === 6
      });
    }
    return days;
  }

  /**
   * 时间加减小时
   * @param {string} time - "HH:MM"
   * @param {number} hours - 加几小时
   * @returns {string} "HH:MM"
   */
  function addHour(time, hours) {
    const [h, m] = time.split(':').map(Number);
    const totalMin = (h * 60 + m) + (hours * 60);
    const newH = Math.floor(totalMin / 60) % 24;
    const newM = totalMin % 60;
    return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
  }

  /**
   * 根据像素位置计算时间（用于拖拽drop）
   * @param {number} y - 像素Y坐标（相对于timeline）
   * @param {number} hourHeight - 每小时的高度(px)
   * @param {number} startHour - timeline起始小时
   * @returns {string} "HH:00"
   */
  function pixelToTime(y, hourHeight, startHour) {
    const hour = Math.floor(y / hourHeight) + startHour;
    return `${String(Math.max(0, Math.min(23, hour))).padStart(2, '0')}:00`;
  }

  // ========== 数据管理 ==========

  /**
   * 导出所有数据为JSON文件
   */
  function exportData() {
    const events = load();
    const data = {
      version: 'v1',
      exportedAt: new Date().toISOString(),
      events: events,
      stats: {
        totalEvents: events.length,
        totalFlowers: getTotalFlowers()
      }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `小红花日历备份_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return data;
  }

  /**
   * 从JSON导入数据（合并，不覆盖）
   */
  function importData(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      const imported = data.events || data;
      if (!Array.isArray(imported)) return false;
      const existing = load();
      const existingIds = new Set(existing.map(e => e.id));
      let added = 0;
      imported.forEach(e => {
        if (!existingIds.has(e.id)) {
          existing.push(e);
          added++;
        }
      });
      save(existing);
      return { success: true, added };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * 清空所有数据
   */
  function clearData() {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  }

  // 公开 API
  return {
    createEvent,
    getAll,
    getById,
    updateEvent,
    toggleStatus,
    undoComplete,
    deleteEvent,
    getByDate,
    getByMonth,
    getSchedulesByDate,
    getTodosByDate,
    getConflictsByDate,
    getDayStats,
    getMonthStats,
    getTotalFlowers,
    // 日程引擎
    engineRun,
    convertToSchedule,
    convertToTodo,
    moveSchedule,
    runConflictDetection,
    // 子待办
    addSubtask,
    toggleSubtask,
    deleteSubtask,
    // 重复任务
    shouldShowOnDate,
    isInstanceCompleted,
    toggleRepeatInstance,
    // 数据管理
    exportData,
    importData,
    clearData,
    // 工具
    todayStr,
    currentMonthStr,
    formatDate,
    formatMonth,
    getWeekday,
    getRecentDays,
    addHour,
    pixelToTime
  };
})();
