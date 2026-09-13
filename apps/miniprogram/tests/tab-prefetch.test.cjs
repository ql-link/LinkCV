const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup() {
  let owner = 'test-session-a', now = 0;
  const timers = [];
  const context = { module: { exports: {} }, Map, Promise,
    Date: { now: () => now },
    setTimeout: fn => { timers.push(fn); return timers.length; },
    require: name => {
      assert.equal(name, './auth');
      return { getAccessToken: () => owner };
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../services/tabPrefetch'), 'utf8'), context);
  return { api: context.module.exports, owner: value => { owner = value; }, advance: () => { now = 16000; } };
}
test('prefetch shares an in-flight response once; later refreshes fetch again', async () => {
  const { api } = setup();
  let resolve, calls = 0;
  const pending = new Promise(done => { resolve = done; });
  api.preload('profile', () => { calls++; return pending; });
  const first = api.take('profile', () => { throw Error('duplicate request'); });
  resolve({ nickname: '测试用户' });
  assert.deepEqual(await first, { nickname: '测试用户' });
  assert.equal(calls, 1);
  assert.equal(await api.take('profile', async () => 'fresh'), 'fresh');
});
test('expired responses and responses belonging to a different session are discarded', async () => {
  const state = setup();
  state.api.preload('profile', async () => 'old account');
  state.owner('test-session-b');
  assert.equal(await state.api.take('profile', async () => 'new account'), 'new account');
  state.api.preload('profile', async () => 'old data');
  state.advance();
  assert.equal(await state.api.take('profile', async () => 'fresh'), 'fresh');
});
test('guest prefetch does no work; failed prefetch permits a normal retry', async () => {
  const state = setup();
  state.owner('');
  state.api.preload('profile', () => { throw Error('guest request'); });
  await Promise.resolve();
  state.owner('test-session-a');
  state.api.preload('profile', async () => { throw Error('network failure'); });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await state.api.take('profile', async () => 'retry succeeded'), 'retry succeeded');
});

test('startup prefetch starts without waiting for homepage data and runs only once per session', async () => {
  const calls = [];
  const context = { module: { exports: {} }, Map, Promise, Date,
    setTimeout: () => 1,
    require: name => ({
      './auth': { getAccessToken: () => 'test-session' },
      './account': { getProfile: async () => { calls.push('profile'); return {}; } },
      './career': {
        listApplications: async () => { calls.push('applications'); return { items: [] }; },
        listSessions: async () => { calls.push('sessions'); return { items: [] }; },
      },
      '../utils/career': { dateParts: () => ({ date: '2026-09-08' }), iso: day => day, shiftDate: () => '2026-09-09' },
    })[name],
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../services/tabPrefetch'), 'utf8'), context);
  context.module.exports.schedule();
  context.module.exports.schedule();
  await Promise.resolve();
  assert.deepEqual(calls, ['profile', 'applications', 'sessions']);
});
