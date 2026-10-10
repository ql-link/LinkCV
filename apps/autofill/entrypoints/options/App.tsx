import { useEffect, useState } from 'react';

import { testConnection } from '../../src/decide/jev';
import { GROUP_LABELS, type ListGroup } from '../../src/profile/keys';
import { summarize, validateProfile, type Profile, type ProfileIssue } from '../../src/profile/profile';
import sampleProfile from '../../src/profile/sample-profile.json';
import {
  DEFAULT_SETTINGS,
  clearProfile,
  ensureEndpointPermission,
  getProfile,
  getSettings,
  saveProfile,
  saveSettings,
  type Settings,
} from '../../src/storage';

type Message = { kind: 'ok' | 'error'; text: string } | null;

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function IssueList({ title, issues }: { title: string; issues: ProfileIssue[] }) {
  if (!issues.length) return null;
  return (
    <div className="issues">
      <div className="small">{title}</div>
      <ul className="small muted">
        {issues.slice(0, 20).map((i) => (
          <li key={`${i.path}-${i.message}`}>
            <code>{i.path || '（根）'}</code> {i.message}
          </li>
        ))}
        {issues.length > 20 && <li>还有 {issues.length - 20} 条未显示</li>}
      </ul>
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [showKey, setShowKey] = useState(false);
  const [apiMsg, setApiMsg] = useState<Message>(null);
  const [testing, setTesting] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [pasted, setPasted] = useState('');
  const [profileMsg, setProfileMsg] = useState<Message>(null);
  const [errors, setErrors] = useState<ProfileIssue[]>([]);
  const [warnings, setWarnings] = useState<ProfileIssue[]>([]);

  useEffect(() => {
    getSettings().then(setSettings);
    getProfile().then(setProfile);
  }, []);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((s) => ({ ...s, [key]: value }));

  const save = async () => {
    try {
      if (!(await ensureEndpointPermission(settings.endpoint))) {
        setApiMsg({ kind: 'error', text: '没有获得该接口地址的访问权限' });
        return false;
      }
    } catch {
      setApiMsg({ kind: 'error', text: '接口地址格式不正确' });
      return false;
    }
    await saveSettings({ ...settings, minProb: Math.min(1, Math.max(0, Number(settings.minProb) || 0)) });
    setApiMsg({ kind: 'ok', text: '已保存' });
    return true;
  };

  const test = async () => {
    if (!(await save())) return;
    setTesting(true);
    setApiMsg(null);
    try {
      const r = await testConnection(settings);
      setApiMsg(
        r.ok
          ? { kind: 'ok', text: `连接正常，用时 ${r.ms}ms` }
          : { kind: 'error', text: `接口可用，但测试字段被判为 ${r.choice}，请检查模型设置` },
      );
    } catch (e) {
      setApiMsg({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const importText = async (text: string) => {
    setErrors([]);
    setWarnings([]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setProfileMsg({ kind: 'error', text: `不是合法的 JSON：${e instanceof Error ? e.message : e}` });
      return;
    }
    const result = validateProfile(parsed);
    setErrors(result.errors);
    setWarnings(result.warnings);
    if (!result.profile) {
      setProfileMsg({ kind: 'error', text: '导入失败，请按下面的提示修改' });
      return;
    }
    await saveProfile(result.profile);
    setProfile(result.profile);
    setPasted('');
    setProfileMsg({ kind: 'ok', text: result.warnings.length ? '已导入，有部分字段不会被使用' : '已导入' });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await importText(await file.text());
  };

  const remove = async () => {
    if (!confirm('确定清除本机保存的简历吗？')) return;
    await clearProfile();
    setProfile(null);
    setProfileMsg({ kind: 'ok', text: '已清除' });
  };

  const summary = profile ? summarize(profile) : null;

  return (
    <main className="options">
      <header>
        <h1>LinkAutofill 设置</h1>
        <p className="muted">网申表单自动填写。简历只保存在本机，发给 Jev 的只有页面字段的标签与结构。</p>
      </header>

      <section>
        <h2>决策模型（Jev）</h2>
        <label className="field">
          <span>接口地址</span>
          <input type="text" value={settings.endpoint} onChange={(e) => set('endpoint', e.target.value.trim())} />
        </label>
        <label className="field">
          <span>模型</span>
          <input type="text" value={settings.model} onChange={(e) => set('model', e.target.value.trim())} />
        </label>
        <label className="field">
          <span>API Key</span>
          <div className="inline">
            <input type={showKey ? 'text' : 'password'} value={settings.apiKey} onChange={(e) => set('apiKey', e.target.value.trim())} autoComplete="off" />
            <button className="btn" onClick={() => setShowKey((v) => !v)}>
              {showKey ? '隐藏' : '显示'}
            </button>
          </div>
        </label>
        <div className="inline">
          <button className="btn btn-primary" onClick={save}>
            保存
          </button>
          <button className="btn" onClick={test} disabled={testing || !settings.apiKey}>
            {testing ? '测试中…' : '测试连接'}
          </button>
          {apiMsg && <span className={apiMsg.kind === 'error' ? 'err' : 'muted'}>{apiMsg.text}</span>}
        </div>
        <p className="muted small">
          默认使用 aihubmix 的 Jev 渠道。也可以改成 OpenRouter 等其他提供方，接口需兼容 TypeSafe 的 systemone 请求格式。
        </p>
      </section>

      <hr className="rule" />

      <section>
        <h2>填写偏好</h2>
        <label className="check">
          <input type="checkbox" checked={settings.addRows} onChange={(e) => set('addRows', e.target.checked)} />
          自动点击“添加”补齐经历条目（仅在识别出的站点上执行）
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.keepExisting} onChange={(e) => set('keepExisting', e.target.checked)} />
          不覆盖已经有内容的字段
        </label>
        <label className="field narrow">
          <span>Jev 概率低于该值时只给建议、不自动填写（0～1）</span>
          <input type="number" min={0} max={1} step={0.05} value={settings.minProb} onChange={(e) => set('minProb', Number(e.target.value))} />
        </label>
        <div>
          <button className="btn" onClick={save}>
            保存偏好
          </button>
        </div>
      </section>

      <hr className="rule" />

      <section>
        <h2>JSON 简历</h2>
        {summary ? (
          <p>
            已导入：<strong>{summary.name || '未填写姓名'}</strong>
            <span className="muted small">
              {' '}
              ·{' '}
              {Object.entries(summary.counts)
                .filter(([, n]) => n)
                .map(([g, n]) => `${GROUP_LABELS[g as ListGroup]} ${n}`)
                .join(' · ')}
            </span>
          </p>
        ) : (
          <p className="muted">还没有导入。可以先下载示例，按自己的信息修改后导入。</p>
        )}
        <div className="inline">
          <label className="btn">
            选择 JSON 文件
            <input type="file" accept="application/json,.json" hidden onChange={onFile} />
          </label>
          <button className="btn" onClick={() => download('linkautofill-sample.json', sampleProfile)}>
            下载示例
          </button>
          <button className="btn" disabled={!profile} onClick={() => profile && download('linkautofill-profile.json', profile)}>
            导出当前
          </button>
          <button className="btn" disabled={!profile} onClick={remove}>
            清除
          </button>
        </div>
        <label className="field">
          <span>或直接粘贴 JSON</span>
          <textarea rows={8} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='{ "basics": { "name": "……" } }' />
        </label>
        <div className="inline">
          <button className="btn btn-primary" disabled={!pasted.trim()} onClick={() => importText(pasted)}>
            导入粘贴内容
          </button>
          {profileMsg && <span className={profileMsg.kind === 'error' ? 'err' : 'muted'}>{profileMsg.text}</span>}
        </div>
        <IssueList title="需要修改：" issues={errors} />
        <IssueList title="提示：" issues={warnings} />
        <p className="muted small">
          字段说明见仓库 docs/profile.md。数组分组（教育、实习、工作、项目等）把最近的经历放在最前面；日期写 YYYY-MM 或 YYYY-MM-DD，仍在进行的写“至今”。
        </p>
      </section>
    </main>
  );
}
