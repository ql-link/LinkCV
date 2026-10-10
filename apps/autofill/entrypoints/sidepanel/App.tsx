import { useEffect, useMemo, useRef, useState } from 'react';

import { summarize, type Profile } from '../../src/profile/profile';
import { getProfile, getSettings, onStorageChange, type Settings } from '../../src/storage';
import {
  activeTab,
  clearMarks,
  focusField,
  initialRunState,
  pageOrigin,
  requestPageAccess,
  runFill,
  type ResultItem,
  type RunState,
  type StageKey,
} from '../../src/run';
import { GROUP_LABELS, type ListGroup } from '../../src/profile/keys';


const STAGES: [StageKey, string][] = [
  ['prepare', '补齐经历条目'],
  ['scan', '扫描页面字段'],
  ['decide', 'Jev 判断字段'],
  ['fill', '填写'],
];

function statusText(item: ResultItem) {
  if (item.status === 'kept') return item.reason!;
  if (item.status !== 'fill') return item.reason ?? '待处理';
  switch (item.fill) {
    case 'filled':
      return '已填写';
    case 'typed':
      return '未识别控件，已按文本写入，请核对';
    case 'failed':
      return '填写失败，请手动处理';
    case 'skipped':
      return '控件不可用';
    default:
      return '未执行';
  }
}

function bucketOf(item: ResultItem): 'pending' | 'filled' | 'none' {
  if (item.status === 'none') return 'none';
  if (item.status === 'kept' || item.fill === 'filled') return 'filled';
  return 'pending';
}

function ResultRow({ item, onFocus }: { item: ResultItem; onFocus: () => void }) {
  const [copied, setCopied] = useState(false);
  const bucket = bucketOf(item);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(item.value ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <li className="row" onClick={onFocus} title="在页面中定位">
      <span className={`dot ${bucket === 'filled' ? 'filled' : bucket === 'pending' ? 'pending' : ''}`} />
      <div className="row-body">
        <div className="row-head">
          <span className="row-label">{item.label || '（无标签）'}</span>
          {item.section && <span className="muted small row-section">{item.section}</span>}
        </div>
        <div className="muted small">{statusText(item)}</div>
        {bucket === 'pending' && item.value && (
          <div className="row-value">
            <span>{item.value}</span>
            <button className="btn-link small" onClick={copy}>
              {copied ? '已复制' : '复制'}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<{ id?: number; origin: string | null }>({ origin: null });
  const [run, setRun] = useState<RunState | null>(null);
  const [running, setRunning] = useState(false);
  const [showNone, setShowNone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const load = async () => {
      setSettings(await getSettings());
      setProfile(await getProfile());
    };
    load();
    return onStorageChange(load);
  }, []);

  useEffect(() => {
    const refresh = async () => {
      const t = await activeTab();
      setTab({ id: t?.id, origin: pageOrigin(t?.url) });
    };
    refresh();
    const onUpdated = (_: number, info: { status?: string; url?: string }) => {
      if (info.url || info.status === 'complete') refresh();
    };
    browser.tabs.onActivated.addListener(refresh);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  const summary = useMemo(() => (profile ? summarize(profile) : null), [profile]);
  const missing = !settings?.apiKey ? '还没有配置 Jev 的 API Key' : !profile ? '还没有导入 JSON 简历' : null;

  const start = async () => {
    if (!tab.origin || tab.id == null || !settings || !profile) return;
    // 授权请求必须是点击后的第一个异步操作
    const granted = await requestPageAccess(tab.origin);
    if (!granted) {
      setRun({ ...initialRunState(), error: '没有获得当前网站的访问权限' });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setShowNone(false);
    setRun(initialRunState());
    await runFill(tab.id, settings, profile, (patch) => setRun((s) => patch(s ?? initialRunState())), controller.signal);
    setRunning(false);
  };

  const stop = () => abortRef.current?.abort();

  const reset = async () => {
    if (tab.id != null) await clearMarks(tab.id);
    setRun(null);
  };

  const items = run?.items ?? [];
  const pending = items.filter((i) => bucketOf(i) === 'pending');
  const filled = items.filter((i) => bucketOf(i) === 'filled');
  const none = items.filter((i) => bucketOf(i) === 'none');
  const rowNotes = (run?.rows ?? []).filter((r) => r.note || r.added < r.wanted - r.had);
  const focus = (uid: string) => tab.id != null && focusField(tab.id, uid);

  return (
    <main className="panel">
      <header className="panel-head">
        <h1>LinkAutofill</h1>
        <button className="btn-link small" onClick={() => browser.runtime.openOptionsPage()}>
          设置
        </button>
      </header>

      <section className="block">
        {summary ? (
          <div>
            <div>
              简历：<strong>{summary.name || '未填写姓名'}</strong>
            </div>
            <div className="muted small">
              {(Object.keys(GROUP_LABELS) as ListGroup[])
                .filter((g) => summary.counts[g])
                .map((g) => `${GROUP_LABELS[g]} ${summary.counts[g]}`)
                .join(' · ') || '没有经历条目'}
            </div>
          </div>
        ) : null}
        {missing && (
          <div className="notice">
            {missing}，
            <button className="btn-link" onClick={() => browser.runtime.openOptionsPage()}>
              去设置
            </button>
          </div>
        )}
        {!tab.origin && <div className="notice muted">当前页面不支持自动填写，请切换到网申表单页面。</div>}
      </section>

      <div className="actions">
        <button className="btn btn-primary" disabled={!!missing || !tab.origin || running} onClick={start}>
          {running ? '填写中…' : run ? '重新填写' : '开始填写'}
        </button>
        {running && (
          <button className="btn" onClick={stop}>
            停止
          </button>
        )}
        {!running && run && (
          <button className="btn" onClick={reset}>
            清除标记
          </button>
        )}
      </div>

      {run && (
        <section className="block">
          <ol className="stages">
            {STAGES.map(([key, name]) => {
              const s = run.stages[key];
              return (
                <li key={key}>
                  <span className={`dot ${s.status === 'running' ? 'running' : s.status === 'done' ? 'filled' : s.status === 'error' ? 'error' : ''}`} />
                  <span>{name}</span>
                  {s.detail && <span className="muted small">{s.detail}</span>}
                </li>
              );
            })}
          </ol>
          {run.error && <div className="notice error">{run.error}</div>}
          {rowNotes.map((r) => (
            <div key={r.group} className="notice small">
              {GROUP_LABELS[r.group]}经历：简历 {r.wanted} 段，页面原有 {r.had} 段，已新增 {r.added} 段。{r.note ?? ''}
            </div>
          ))}
        </section>
      )}

      {items.length > 0 && (
        <>
          <hr className="rule" />
          <section className="block">
            <div className="tally">
              <span>
                <span className="dot filled" /> 已填 {filled.length}
              </span>
              <span>
                <span className="dot pending" /> 待处理 {pending.length}
              </span>
              <span>
                <span className="dot" /> 无对应 {none.length}
              </span>
            </div>
            {pending.length > 0 && (
              <>
                <h2>待处理</h2>
                <ul className="rows">
                  {pending.map((i) => (
                    <ResultRow key={i.uid} item={i} onFocus={() => focus(i.uid)} />
                  ))}
                </ul>
              </>
            )}
            {filled.length > 0 && (
              <>
                <h2>已填写</h2>
                <ul className="rows">
                  {filled.map((i) => (
                    <ResultRow key={i.uid} item={i} onFocus={() => focus(i.uid)} />
                  ))}
                </ul>
              </>
            )}
            {none.length > 0 && (
              <button className="btn-link small" onClick={() => setShowNone((v) => !v)}>
                {showNone ? '收起' : `查看 ${none.length} 个无对应字段`}
              </button>
            )}
            {showNone && (
              <ul className="rows">
                {none.map((i) => (
                  <ResultRow key={i.uid} item={i} onFocus={() => focus(i.uid)} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <footer className="muted small foot">插件不会提交表单。填写后请逐项核对，再由你自己提交。</footer>
    </main>
  );
}
