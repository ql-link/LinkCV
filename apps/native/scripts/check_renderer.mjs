// Contract and Chromium layout checks for the offline paper artifact.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(resolve(root, 'apps/web/package.json'));
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
const html = readFileSync(resolve(root, 'apps/native/renderer/dist/paper.html'), 'utf8');
for (const path of ['apps/mac/Sources/LinkResumeRender/Resources/paper.html', 'apps/windows/src/LinkResume.App/Assets/Renderer/paper.html']) {
  assert.equal(readFileSync(resolve(root, path), 'utf8'), html, `stale artifact: ${path}`);
}
for (const path of ['apps/mac/Sources/LinkResumeApp/Resources/Branding/wordmark.png', 'apps/windows/src/LinkResume.App/Assets/Branding/wordmark.png']) {
  assert.deepEqual(readFileSync(resolve(root, path)), readFileSync(resolve(root, 'apps/web/src/assets/linkresume-wordmark.png')), `stale brand: ${path}`);
}
const fixtures = readFileSync(resolve(root, 'apps/native/shared/fixtures/resume-templates.json'), 'utf8');
for (const path of ['apps/mac/Sources/LinkResumeCore/Resources/resume-templates.json', 'apps/windows/src/LinkResume.Core/Resources/resume-templates.json']) {
  assert.equal(readFileSync(resolve(root, path), 'utf8'), fixtures, `stale fixture: ${path}`);
}
const { templates } = JSON.parse(fixtures);
assert.equal(templates.length, 9);
assert.equal(templates.filter(t => t.key.startsWith('muse-')).length, 6);
const shared = await build({ stdin: { contents: `export {renderResumePrintDocument} from './apps/web/src/features/preview/print/resumePrintDocument';`, resolveDir: root }, bundle: true, write: false, format: 'iife', globalName: 'SharedPaper' });
const css = ['styles.css', 'app.css', 'features/preview/print/resume-print.css', 'muse-templates.css'].map(path => readFileSync(resolve(root, 'apps/web/src', path), 'utf8')).join('\n');
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || [
  chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
  process.env.PROGRAMFILES && resolve(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
].find(path => path && existsSync(path));
assert.ok(executablePath, 'Set CHROMIUM_EXECUTABLE_PATH to an installed Chromium browser');
const browser = await chromium.launch({ executablePath, headless: true });
const cases = [];
try {
  const native = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  await native.addInitScript(() => { window.__messages = []; window.chrome = { webview: { postMessage: message => window.__messages.push(message) } }; });
  await native.goto(`file://${resolve(root, 'apps/native/renderer/dist/paper.html')}`);
  const reference = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  await reference.setContent('<div id="paper-root"></div>');
  await reference.addStyleTag({ content: css });
  await reference.addScriptTag({ content: shared.outputFiles[0].text });
  const snapshot = () => {
    const root = document.querySelector('[data-resume-print-document]');
    const copy = root.cloneNode(true);
    for (const img of copy.querySelectorAll('img')) img.setAttribute('src', '[asset]');
    for (const el of copy.querySelectorAll('[data-src]')) el.setAttribute('data-src', '[asset]');
    return { html: copy.outerHTML, colors: Array.from(root.querySelectorAll('h1,h2,.resume-print-content'), el => {
      const style = getComputedStyle(el); return [style.color, style.backgroundColor, style.display];
    }), text: root.textContent };
  };
  const validation = JSON.parse(readFileSync(resolve(root, 'apps/native/shared/fixtures/paper-validation.json'), 'utf8'));
  for (const template of [...templates, ...validation]) {
    const key = template.style.template_key;
    const request = { protocol_version: 1, title: template.name, ...(template.assets ? { assets: template.assets } : {}), data: template.data, layout_plan: template.layout_plan, style: { schema_version: 'resume-presentation.v1', portable: { smart_one_page: false }, template_scoped: { [key]: {} }, template_snapshot: template.style } };
    await native.evaluate(request => { window.__messages = []; window.linkresume.render(request); }, request);
    await native.waitForFunction(() => window.__messages.some(m => ['rendered','error'].includes(m.type)));
    assert.equal(await native.evaluate(() => window.__messages.at(-1).type), 'rendered', template.key);
    await reference.evaluate(request => { document.getElementById('paper-root').innerHTML = SharedPaper.renderResumePrintDocument(request); }, request);
    const actual = await native.evaluate(snapshot);
    cases.push({ request, expected: {
      text: actual.text, colors: actual.colors,
      ...await native.evaluate(() => {
        const root = document.querySelector('[data-resume-print-document]');
        return { theme: root.className, headings: Array.from(root.querySelectorAll('h1,h2,h3'), el => el.textContent), anchors: Array.from(root.querySelectorAll('[data-resume-block-id]'), el => el.dataset.resumeBlockId) };
      }),
    }});
    if (template.name === '长正文滚动边界') {
      assert.ok(await native.evaluate(() => window.__messages.at(-1).heightPx > 1123), 'long content height');
      assert.ok(actual.text.endsWith('长正文结束标记') || actual.text.includes('长正文结束标记'), 'long content preserved');
    }
    const expected = await reference.evaluate(snapshot);
    assert.equal(actual.html, expected.html, `${template.key}: structure/content/order`);
    assert.deepEqual(actual.colors, expected.colors, `${template.key}: template styles`);
    const nativeSources = await native.locator('img').evaluateAll(images => images.map(image => image.getAttribute('src')));
    const referenceSources = await reference.locator('img').evaluateAll(images => images.map(image => image.getAttribute('src')));
    for (const [index, src] of referenceSources.entries()) {
      if (src?.startsWith('/templates/')) {
        const raster = src.replace(/\.svg$/, '.png');
        const encoded = nativeSources[index].split(',')[1];
        assert.deepEqual(Buffer.from(encoded, 'base64'), readFileSync(resolve(root, 'apps/web/public', raster.slice(1))), `${template.key}: avatar bytes`);
      } else assert.equal(nativeSources[index], src, `${template.key}: image identity`);
    }
    assert.ok(!await native.locator('img').evaluateAll(images => images.some(image => !image.complete || image.naturalWidth === 0)), `${template.key}: missing image`);
    console.log(`${template.key}: structure, colors, images passed`);
  }
  if (process.env.LINKRESUME_RENDER_CASES) writeFileSync(process.env.LINKRESUME_RENDER_CASES, JSON.stringify(cases));
  const base = cases[0].request;
  await native.evaluate(request => { window.__messages = []; window.linkresume.render({ ...request, layout_plan: null }); }, base);
  await native.waitForFunction(() => window.__messages.some(m => m.type === 'error'));
  assert.ok(!await native.evaluate(() => window.__messages.some(m => m.type === 'rendered')), 'invalid layout must fail');
  await native.evaluate(request => { window.__messages = []; window.linkresume.render({ ...request, assets: { '/templates/avatar-cat.jpg': 'data:image/png;base64,YQ==' } }); }, base);
  await native.waitForFunction(() => window.__messages.some(m => m.type === 'error'));
  assert.ok(await native.evaluate(() => window.__messages.some(m => m.type === 'rendered')), 'image failure must preserve paper height');
  assert.ok(await native.locator('img').evaluateAll(images => images.every(image => image.getAttribute('alt') === '图片不可用')), 'visible image fallback');
  assert.ok((await native.evaluate(() => document.getElementById('paper-root').textContent)).length > 100, 'body preserved');
  await native.evaluate(() => { window.linkresume.clear(); });
  assert.equal(await native.locator('#paper-root').textContent(), '');
  await native.evaluate(request => {
    window.__messages = [];
    window.linkresume.render({ ...request, title: 'superseded' });
    window.linkresume.render({ ...request, title: 'latest' });
  }, base);
  await native.waitForFunction(() => window.__messages.some(m => m.type === 'rendered'));
  assert.equal(await native.evaluate(() => window.__messages.filter(m => m.type === 'rendered').length), 1);
  assert.equal(await native.locator('[data-resume-print-document]').getAttribute('data-resume-title'), 'latest');
  console.log('bad layout, broken image, rapid switching: passed');
  // Bad plan and unsupported version must surface errors rather than successful previews.
  await native.evaluate(() => { window.__messages = []; window.linkresume.render({ protocol_version: 99 }); });
  await native.waitForFunction(() => window.__messages.some(m => m.type === 'error'));
  console.log('unsupported protocol: failed visibly');
} finally { await browser.close(); }
