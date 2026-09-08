const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('tab navigation provides immediate selection, prevents duplicate taps and restores on failure', () => {
  let definition, pending;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(require.resolve('../custom-tab-bar/index'), 'utf8'), {
    Component: value => { definition = value; },
    wx: { switchTab: options => { pending = options; calls.push('navigate'); },
      showLoading: () => calls.push('loading'), hideLoading: () => calls.push('hide'),
      showToast: () => calls.push('failure'), },
  });
  const tab = { ...definition.methods, data: { ...definition.data, selected: 0 },
    setData(values) { Object.assign(this.data, values); } };
  const event = { currentTarget: { dataset: { path: '/pages/career/index', index: 1 } } };
  tab.switchTab(event);
  assert.equal(tab.data.selected, 1);
  tab.switchTab(event);
  assert.deepEqual(calls, ['navigate']);
  pending.fail(); pending.complete();
  assert.equal(tab.data.selected, 0);
  assert.deepEqual(calls, ['navigate', 'failure']);
  tab.switchTab(event);
  assert.equal(tab.data.selected, 1);
  pending.complete();
});
