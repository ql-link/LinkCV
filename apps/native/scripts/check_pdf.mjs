import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { templates } = JSON.parse(readFileSync(resolve(root, 'apps/native/shared/fixtures/resume-templates.json'), 'utf8'));
const validation = JSON.parse(readFileSync(resolve(root, 'apps/native/shared/fixtures/paper-validation.json'), 'utf8'));
const directory = process.env.LINKRESUME_PDF_ARTIFACTS || mkdtempSync(resolve(tmpdir(), 'linkresume-paper-pdf-'));
mkdirSync(directory, { recursive: true });
try {
  const manifest = [];
  for (const [index, template] of [templates[0], templates[4], validation[0], validation[3]].entries()) {
    const key = template.style.template_key;
    const request = { protocol_version: 1, title: template.name, data: template.data, layout_plan: template.layout_plan, style: { schema_version: 'resume-presentation.v1', portable: { smart_one_page: false }, template_scoped: { [key]: {} }, template_snapshot: template.style } };
    const pdf = execFileSync(process.execPath, [resolve(root, 'apps/web/dist-server/render-resume-pdf.cjs')], { input: JSON.stringify(request), maxBuffer: 20 * 1024 * 1024, timeout: 60000 });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    const path = resolve(directory, `${index + 1}-${key}.pdf`);
    writeFileSync(path, pdf);
    const long = template.name === '长正文滚动边界';
    manifest.push({ path, long, phrases: [template.data.identity.name.value, ...template.data.sections.map(section => section.title.value), ...(long ? ['长正文结束标记'] : [])] });
    console.log(`${template.name}: PDF generated`);
  }
  const manifestPath = resolve(directory, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  if (process.platform === 'darwin') {
    const executable = resolve(directory, 'check-pdf');
    execFileSync('swiftc', [resolve(root, 'apps/native/scripts/check_pdf.swift'), '-o', executable]);
    console.log(execFileSync(executable, [manifestPath], { encoding: 'utf8' }));
  } else console.log('PDF text/page checks require macOS PDFKit; only binary generation verified here.');
} finally { if (!process.env.LINKRESUME_PDF_ARTIFACTS) rmSync(directory, { recursive: true, force: true }); }
