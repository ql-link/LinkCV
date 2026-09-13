const test = require('node:test');
const assert = require('node:assert/strict');
const motion = require('../utils/career').sheetMotion;

test('a remounted sheet clears exit state and stale close callbacks', async () => {
  const events = [];
  const sheet = {
    data: {},
    setData(data) { Object.assign(this.data, data); },
    triggerEvent(name) { events.push(name); },
  };
  motion.reset(sheet);
  assert.equal(sheet.data.closing, false);
  motion.dismiss(sheet);
  assert.equal(sheet.data.closing, true);
  assert.match(sheet.data.sheetExitStyle, /translateY\(100%\)/);
  motion.dispose(sheet);
  motion.reset(sheet);
  await new Promise(resolve => setTimeout(resolve, 270));
  assert.equal(sheet.data.closing, false);
  assert.deepEqual(events, []);
  motion.dismiss(sheet);
  motion.dismiss(sheet);
  await new Promise(resolve => setTimeout(resolve, 270));
  assert.deepEqual(events, ['close']);
});
