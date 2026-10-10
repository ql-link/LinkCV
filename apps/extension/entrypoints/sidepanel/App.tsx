import { useEffect, useMemo, useRef, useState } from 'react';

import { summarize } from '../../src/autofill/profile/profile';
import { getSettings, onStorageChange, type Settings } from '../../src/autofill/storage';
import {
  activeTab,
  clearMarks,
  clearPageValues,
  focusField,
  initialRunState,
  pageOrigin,
  requestPageAccess,
  runFill,
  type ResultItem,
  type RunState,
  type StageKey,
} from '../../src/autofill/run';
import CapturePanel from '../../src/features/job-capture/App';
import { connectToLinkResume, apiRequest, linkResumeUrl, candidateOrigins, type LinkResumeConnection } from '../../src/api/linkresume';
import { loadResumeList, loadSnapshot, selectedSnapshot, saveSnapshot, clearSnapshot, type AutofillSnapshot, type ExtensionResume } from '../../src/api/autofill';
import { KEYS, GROUP_LABELS, type ListGroup } from '../../src/autofill/profile/keys';


const STAGES: [StageKey, string][] = [
  ['prepare', '补齐经历条目'],
  ['scan', '扫描页面字段'],
  ['decide', '识别字段'],
  ['fill', '填写'],
];

function statusText(item: ResultItem) {
  if (item.status === 'kept') return item.reason!;
  if (item.status !== 'fill') return item.reason ?? '待处理';
  switch (item.fill) {
    case 'kept':
      return '保留已有内容';
    case 'filled':
      return '已填写';
    case 'typed':
      return '未识别控件，已按文本写入，请核对';
    case 'failed':
      return '填写失败，请手动处理';
    case 'skipped':
      return '控件不可用或无法确认，未自动填写';
    default:
      return '未执行';
  }
}

function bucketOf(item: ResultItem): 'pending' | 'filled' | 'kept' | 'none' {
  if (item.status === 'none') return 'none';
  if (item.status === 'kept' || item.fill === 'kept') return 'kept';
  if (item.fill === 'filled') return 'filled';
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
  const [feature, setFeature] = useState<'capture' | 'autofill'>('autofill');
  return <><nav className="feature-tabs" aria-label="插件功能">
    <button aria-pressed={feature === 'capture'} onClick={() => setFeature('capture')}>岗位采集</button>
    <button aria-pressed={feature === 'autofill'} onClick={() => setFeature('autofill')}>网申填写</button>
  </nav>{feature === 'capture' ? <CapturePanel /> : <AutofillPanel />}</>;
}

function AutofillPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [snapshot, setSnapshot] = useState<AutofillSnapshot | null>(null);
  const profile = snapshot?.profile ?? null;
  const [connection, setConnection] = useState<LinkResumeConnection | null>(null);
  const [resumes, setResumes] = useState<ExtensionResume[]>([]);
  const [resumeId, setResumeId] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const starting = useRef(false);
  const runTab = useRef<number | null>(null);
  const resultTab = useRef<number | null>(null);
  const [tab, setTab] = useState<{ id?: number; origin: string | null }>({ origin: null });
  const [run, setRun] = useState<RunState | null>(null);
  const [running, setRunning] = useState(false);
  const [clearing, setClearing] = useState(false);
  const clearingRef = useRef(false);
  const [clearTarget, setClearTarget] = useState<{ id: number; origin: string } | null>(null);
  const [clearNotice, setClearNotice] = useState('');
  const [showNone, setShowNone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let generation = 0;
    let disposed = false;
    const load = async () => {
      const revision = ++generation;
      try {
        const [prefs, nextConnection, selected] = await Promise.all([getSettings(), connectToLinkResume(), selectedSnapshot()]);
        const list = nextConnection?.user ? await loadResumeList(nextConnection) : [];
        if (disposed || revision !== generation) return;
        setSettings(prefs);
        setConnection(nextConnection);
        setResumes(list);
        const matches = selected && selected.origin === nextConnection?.origin && selected.snapshot.user_id === nextConnection.user?.id
          && list.some((item) => item.id === selected.snapshot.resume_id);
        if (matches) {
          setSnapshot(selected.snapshot);
          setResumeId(selected.snapshot.resume_id);
        } else {
          if (!clearingRef.current) abortRef.current?.abort();
          setSnapshot(null);
          setRun(null);
          if (selected) await clearSnapshot();
        }
        setNotice('');
      } catch (error) {
        if (disposed || revision !== generation) return;
        if (!clearingRef.current) abortRef.current?.abort();
        setSnapshot(null);
        setRun(null);
        setNotice(error instanceof Error ? error.message : '连接失败，请重试');
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    const unsubscribe = onStorageChange(() => void load());
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => { disposed = true; generation++; unsubscribe(); window.removeEventListener('focus', onFocus); abortRef.current?.abort(); };

  }, []);

  useEffect(() => {
    let revision = 0;
    let disposed = false;
    const refresh = async () => {
      const current = ++revision;
      const t = await activeTab();
      if (disposed || current !== revision) return;
      setTab({ id: t?.id, origin: pageOrigin(t?.url) });
    };
    refresh();
    const onUpdated = (id: number, info: { status?: string; url?: string }) => {
      if (id === runTab.current && (info.url || info.status === 'loading')) abortRef.current?.abort();
      if (info.url || info.status === 'loading') setClearTarget(null);
      if (info.url || info.status === 'complete') void refresh();
    };
    const onActivated = () => { abortRef.current?.abort(); setClearTarget(null); void refresh(); };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      disposed = true;
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  const summary = useMemo(() => (profile ? summarize(profile) : null), [profile]);
  const missing = !connection ? '无法连接 LinkResume' : !connection.user ? '请先在 LinkResume 登录' : !profile ? '请选择并导入一份简历' : null;

  const start = async () => {
    if (starting.current || clearTarget || !tab.origin || tab.id == null || !settings || !snapshot || !connection?.user) return;
    starting.current = true;
    const targetTab = tab.id;
    const expectedUser = connection.user.id;
    const controller = new AbortController();
    abortRef.current = controller;
    runTab.current = targetTab;
    resultTab.current = targetTab;
    setRunning(true);
    setShowNone(false);
    setClearNotice('');
    setRun(initialRunState());
    try {
      // 申请权限必须是点击后的第一个异步操作；等待授权时也要取消页面切换。
      let granted: boolean;
      try { granted = await requestPageAccess(tab.origin); }
      catch { throw new Error('无法申请网站权限，请重新打开插件'); }
      if (controller.signal.aborted) throw new Error('页面已刷新或切换，请重新开始');
      if (!granted) throw new Error('没有获得当前网站的访问权限');
      const fresh = await loadSnapshot(connection, snapshot.resume_id, controller.signal);
      if (controller.signal.aborted) return;
      setSnapshot(fresh);
      const verifyAccount = async () => {
        const result = await apiRequest<{ user: { id: string } | null }>(connection.origin, '/api/auth/me', { signal: controller.signal });
        if (result.user?.id !== expectedUser) { await clearSnapshot(); throw new Error('账户已切换或登录失效，请重新连接'); }
      };
      await runFill(targetTab, settings, fresh.profile, connection.origin, verifyAccount,
        (patch) => setRun((current) => patch(current ?? initialRunState())), controller.signal);
    } catch (error) {
      setRun({ ...initialRunState(), error: error instanceof Error ? error.message : '读取资料失败' });
    } finally {
      starting.current = false;
      setRunning(false);
      runTab.current = null;
      if (abortRef.current === controller) abortRef.current = null;
    }

  };

  const stop = () => abortRef.current?.abort();

  const reset = async () => {
    if (resultTab.current != null) await clearMarks(resultTab.current);
    setRun(null);
  };

  const clearAll = async () => {
    if (starting.current || !clearTarget || tab.id !== clearTarget.id || tab.origin !== clearTarget.origin) return;
    const target = clearTarget;
    starting.current = true;
    clearingRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    runTab.current = target.id;
    setClearing(true);
    setClearNotice('');
    setClearTarget(null);
    try {
      const granted = await requestPageAccess(target.origin);
      if (controller.signal.aborted) throw new Error('页面已刷新或切换，清除已停止');
      if (!granted) throw new Error('没有获得当前网站的访问权限，未清除内容');
      const report = await clearPageValues(target.id, target.origin, controller.signal);
      if (controller.signal.aborted) throw new Error('页面已刷新或切换，清除已停止');
      setRun(null);
      setClearNotice(`已清除 ${report.cleared} 个字段，${report.empty} 个原本为空。${report.failed.length ? `还有 ${report.failed.length} 个控件未能清空，请手动处理：${report.failed.join('、')}。` : ''}禁用、只读字段及附件保留。`);
    } catch (error) {
      setClearNotice(error instanceof Error ? error.message : '清除失败，请重试');
    } finally {
      starting.current = false;
      clearingRef.current = false;
      runTab.current = null;
      setClearing(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const items = run?.items ?? [];
  const pending = items.filter((i) => bucketOf(i) === 'pending');
  const filled = items.filter((i) => bucketOf(i) === 'filled');
  const kept = items.filter((i) => bucketOf(i) === 'kept');
  const none = items.filter((i) => bucketOf(i) === 'none');
  const rowNotes = (run?.rows ?? []).filter((r) => r.note || r.added < r.wanted - r.had);
  const focus = (uid: string) => (runTab.current ?? resultTab.current) != null && focusField((runTab.current ?? resultTab.current)!, uid);

  return (
    <main className="panel">
      <header className="panel-head">
        <h1>LinkResume 网申填写</h1>
        <button className="btn-link small" onClick={() => browser.runtime.openOptionsPage()}>
          设置
        </button>
      </header>

      <section className="block">
        <div className="muted small">{loading ? '正在连接…' : connection?.user ? (connection.user.nickname || connection.user.email || '已登录') : '尚未登录'}{connection && <span> · {connection.origin}</span>}</div>
        <div className="resume-picker">
          <select aria-label="选择简历" value={resumeId} disabled={running || clearing || !connection?.user} onChange={(event) => setResumeId(event.target.value)}>
            <option value="">选择一份简历</option>
            {resumes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
          <button className="btn" disabled={running || clearing || !resumeId || !connection?.user} onClick={async () => {
            if (!connection) return;
            try { const imported = await loadSnapshot(connection, resumeId); await saveSnapshot(connection.origin, imported); setSnapshot(imported); setRun(null); }
            catch (error) { setNotice(error instanceof Error ? error.message : '导入失败'); }
          }}>导入简历</button>
        </div>
        {notice && <div role="alert" className="notice error">{notice}</div>}
        {snapshot && <><div className="small">已导入「{snapshot.title}」· 版本 {snapshot.lock_version}</div>
          {snapshot.warnings.map((warning) => <div className="notice small" key={warning}>{warning}</div>)}
          {snapshot.missing.length > 0 && <div className="muted small">待补充：{snapshot.missing.map((key) => KEYS[key as keyof typeof KEYS]?.split(/[；;]/)[0] ?? key).join('、')}。经历按简历中的顺序填写。</div>}
        </>}
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
            <button className="btn-link" disabled={!candidateOrigins().length} onClick={() => browser.tabs.create({ url: linkResumeUrl(connection?.origin ?? candidateOrigins()[0]!, '/resumes') })}>
              打开 LinkResume
            </button>
          </div>
        )}
        {!tab.origin && <div className="notice muted">当前页面不支持自动填写，请切换到网申表单页面。</div>}
      </section>

      <div className="actions">
        <button className="btn btn-primary" disabled={!!missing || !tab.origin || running || clearing || !!clearTarget || loading} onClick={start}>
          {running ? '填写中…' : run ? '重新填写' : '开始填写'}
        </button>
        {(running || clearing) && (
          <button className="btn" onClick={stop}>
            停止
          </button>
        )}
        {!running && !clearing && run && (
          <button className="btn" onClick={reset}>
            清除标记
          </button>
        )}
        <button className="btn" disabled={!tab.origin || tab.id == null || running || clearing || !!clearTarget} onClick={() => {
          if (tab.id != null && tab.origin) setClearTarget({ id: tab.id, origin: tab.origin });
        }}>{clearing ? '清除中…' : '全部清除'}</button>
      </div>

      {clearTarget && <section className="notice" role="alertdialog" aria-label="确认全部清除">
        <div>清空 {clearTarget.origin} 当前页面可编辑的表单内容？包括手动输入及之前各轮填写的内容，清除后无法从插件撤销。附件和只读字段保留，不删除经历条目，不提交表单。</div>
        <div className="actions">
          <button className="btn" onClick={() => setClearTarget(null)}>取消</button>
          <button className="btn" onClick={clearAll}>确认全部清除</button>
        </div>
      </section>}
      {clearNotice && <div role="status" className="notice small">{clearNotice}</div>}

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
                <span className="dot filled" /> 本轮已填 {filled.length}
              </span>
              <span>保留已有 {kept.length}</span>
              <span>
                <span className="dot pending" /> 待处理 {pending.length}
              </span>
              <span>
                <span className="dot" /> 跳过 {none.length}
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
            {kept.length > 0 && <>
              <h2>保留已有内容</h2>
              <ul className="rows">{kept.map((i) => <ResultRow key={i.uid} item={i} onFocus={() => focus(i.uid)} />)}</ul>
            </>}
            {none.length > 0 && (
              <button className="btn-link small" onClick={() => setShowNone((v) => !v)}>
                {showNone ? '收起' : `查看 ${none.length} 个跳过字段`}
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
