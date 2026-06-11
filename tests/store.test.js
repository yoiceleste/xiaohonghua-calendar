const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function createStore() {
  const values = new Map();
  const localStorage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
  const context = vm.createContext({ console, localStorage, Date, Math });
  const source = fs.readFileSync(path.join(__dirname, '..', 'store.js'), 'utf8');
  vm.runInContext(`${source}\nthis.store = EventStore;`, context);
  return { store: context.store, localStorage };
}

test('updateEvent persists a corrected todo title in the active storage key', () => {
  const { store, localStorage } = createStore();
  const todo = store.createEvent({ title: '写错的待办', date: '2026-06-11' });

  const updated = store.updateEvent(todo.id, { title: '修改后的待办' });

  assert.equal(updated.title, '修改后的待办');
  assert.equal(store.getById(todo.id).title, '修改后的待办');
  assert.equal(localStorage.getItem('xiaohonghua_events'), null);
  assert.equal(
    JSON.parse(localStorage.getItem('little-red-flower-calendar-v1'))[0].title,
    '修改后的待办'
  );
});

test('updateEvent recalculates conflicts for both old and new dates', () => {
  const { store } = createStore();
  const first = store.createEvent({
    title: '日程一', type: 'schedule', date: '2026-06-11',
    startTime: '09:00', endTime: '10:00'
  });
  const second = store.createEvent({
    title: '日程二', type: 'schedule', date: '2026-06-11',
    startTime: '09:30', endTime: '10:30'
  });
  assert.equal(store.getById(first.id).conflict, true);
  assert.equal(store.getById(second.id).conflict, true);

  store.updateEvent(second.id, { date: '2026-06-12' });

  assert.equal(store.getById(first.id).conflict, false);
  assert.equal(store.getById(second.id).conflict, false);
});
