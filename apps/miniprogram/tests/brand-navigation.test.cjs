const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function withNavigation(properties, run) {
  const key = require.resolve('../components/brand-navigation/index');
  const previous = { wx: global.wx, Component: global.Component };
  const actions = [];
  let definition;
  global.wx = {
    getWindowInfo: () => ({ statusBarHeight: 37 }),
    navigateBack: options => { actions.push('back'); options.fail(); },
    switchTab: options => actions.push(options.url),
  };
  global.Component = value => { definition = value; };
  try {
    delete require.cache[key];
    require(key);
    const instance = {
      ...definition.methods,
      properties: { disabled: false, managedBack: false, fallback: '/pages/resumes/index', ...properties },
      data: { ...definition.data },
      setData(update) { Object.assign(this.data, update); },
      triggerEvent(event) { actions.push(event); },
    };
    definition.lifetimes.attached.call(instance);
    run(instance, actions);
  } finally {
    delete require.cache[key];
    global.wx = previous.wx;
    global.Component = previous.Component;
  }
}

test('brand navigation uses the real status bar and falls back to its module home', () => {
  withNavigation({ fallback: '/pages/career/index' }, (nav, actions) => {
    assert.equal(nav.data.statusBarHeight, 37);
    nav.goBack();
    assert.deepEqual(actions, ['back', '/pages/career/index']);
  });
});

test('managed form navigation delegates without bypassing form guards', () => {
  withNavigation({ managedBack: true }, (nav, actions) => {
    nav.goBack();
    assert.deepEqual(actions, ['back']);
    nav.properties.disabled = true;
    nav.goBack();
    assert.equal(actions.length, 1);
  });
});

test('all page entries use the shared custom brand navigation and login has no dismiss UI', () => {
  const root = path.join(__dirname, '..');
  const app = require('../app.json');
  assert.equal(app.usingComponents['brand-navigation'], '/components/brand-navigation/index');
  for (const page of app.pages) {
    const config = JSON.parse(fs.readFileSync(path.join(root, page + '.json')));
    assert.equal(config.navigationStyle, 'custom', page);
    assert.match(fs.readFileSync(path.join(root, page + '.wxml'), 'utf8'), /<brand-navigation\b/, page);
  }
  for (const page of ['login', 'confirm']) {
    const template = fs.readFileSync(path.join(root, 'pages', page, 'index.wxml'), 'utf8');
    assert.doesNotMatch(template, /class="close-button"|<brand-navigation[^>]+\bback\b/);
    assert.match(template, /handlePrivacyAuthorization/);
  }
});
