import { useEffect, useState } from 'react';
import { getSettings, saveSettings, type Settings } from '../../src/autofill/storage';
export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => { void getSettings().then(setSettings); }, []);
  if (!settings) return <main>正在读取设置…</main>;
  return <main className="panel">
    <h1>LinkResume 填写偏好</h1>
    <p>资料来自你在 LinkResume 选择的简历，字段识别由 LinkResume 提供。</p>
    <label><input type="checkbox" checked={settings.keepExisting} onChange={(event) => setSettings({ ...settings, keepExisting: event.target.checked })} />保留页面已有内容</label>
    <label><input type="checkbox" checked={settings.addRows} onChange={(event) => setSettings({ ...settings, addRows: event.target.checked })} />在已支持的网站补齐经历条目</label>
    <label>最低识别概率 <input type="number" min="0.5" max="1" step="0.05" value={settings.minProb} onChange={(event) => setSettings({ ...settings, minProb: Number(event.target.value) })} /></label>
    <button className="btn btn-primary" onClick={() => {
      if (!Number.isFinite(settings.minProb) || settings.minProb < 0.5 || settings.minProb > 1) { setNotice('概率应在 0.5 到 1 之间'); return; }
      void saveSettings(settings).then(() => setNotice('已保存'), () => setNotice('保存失败，请重试'));
    }}>保存</button>
    <p role="status">{notice}</p>
  </main>;
}
