const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../services/tabResources'), 'utf8');
function load(wx) {
  const context = { wx, module: { exports: {} } };
  vm.runInNewContext(source, context);
  return context.module.exports;
}
test('prepares the next WebView and both tab icon states before navigation', () => {
  let views = 0, assets = [];
  const service = load({ preloadWebview: () => views++, preloadAssets: options => assets.push(options.data) });
  service.prepare();
  assert.equal(views, 1);
  assert.equal(assets[0].length, 7);
  for (const name of ['resume', 'career', 'profile']) {
    for (const suffix of ['', '-active']) assert.ok(assets[0].some(item => item.src === `/assets/career/tab-${name}${suffix}.svg`));
  }
  service.prepare();
  assert.equal(views, 2);
  assert.equal(assets.length, 1);
});
test('unsupported or failed native preloading never blocks entry and assets can retry', () => {
  assert.doesNotThrow(() => load({}).prepare());
  let attempts = 0;
  const service = load({ preloadWebview: () => { throw Error('unavailable'); },
    preloadAssets: options => { attempts++; options.fail(); } });
  assert.doesNotThrow(() => service.prepare());
  service.prepare();
  assert.equal(attempts, 2);
});
