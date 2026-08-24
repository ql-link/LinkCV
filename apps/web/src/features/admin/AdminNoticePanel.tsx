import { useCallback, useEffect, useState } from "react";

import {
  api,
  ApiRequestError,
  type AdminReleaseNotice,
} from "../../api/client";

const TITLE_LIMIT = 128;
const CONTENT_LIMIT = 10_000;

function formatNoticeTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function AdminNoticePanel() {
  const [items, setItems] = useState<AdminReleaseNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.adminListNotices();
      setItems(data.items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const canSubmit =
    !submitting &&
    title.trim().length > 0 &&
    title.trim().length <= TITLE_LIMIT &&
    content.trim().length > 0 &&
    content.trim().length <= CONTENT_LIMIT;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await api.adminCreateNotice(title.trim(), content.trim());
      setTitle("");
      setContent("");
      setError(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : "发布失败");
    } finally {
      setSubmitting(false);
    }
  };

  const mutate = async (notice: AdminReleaseNotice, action: "revoke" | "restore") => {
    setMutatingId(notice.id);
    try {
      const response =
        action === "revoke"
          ? await api.adminRevokeNotice(notice.id)
          : await api.adminRestoreNotice(notice.id);
      setItems((current) =>
        current.map((item) => (item.id === response.notice.id ? response.notice : item)),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : "操作失败");
    } finally {
      setMutatingId(null);
    }
  };

  return (
    <section className="admin-surface table-surface" aria-label="更新通知管理">
      <div className="table-tools">
        <div className="notice-publish-form">
          <label className="notice-publish-field">
            <span>标题</span>
            <input
              type="text"
              value={title}
              maxLength={TITLE_LIMIT}
              placeholder="例如：v1.2 更新"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="notice-publish-field notice-publish-field-wide">
            <span>内容（支持 Markdown：标题、列表、链接；图片仅显示占位）</span>
            <textarea
              value={content}
              rows={6}
              maxLength={CONTENT_LIMIT}
              placeholder={"## 新功能\n\n- 面试中心新增排期提醒\n- 修复若干问题"}
              onChange={(event) => setContent(event.target.value)}
            />
          </label>
          <div className="notice-publish-actions">
            <button
              type="button"
              className="notice-action-button primary"
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              {submitting ? "发布中…" : "发布通知"}
            </button>
          </div>
        </div>
      </div>
      {error && <div className="table-status-row notice-error">{error}</div>}
      <div className="admin-table-wrap">
        {loading && <div className="table-status-row">加载中...</div>}
        {!loading && items.length === 0 && (
          <div className="table-status-row">暂无更新通知</div>
        )}
        {!loading && items.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>标题</th>
                <th>内容摘要</th>
                <th>发布时间</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((notice) => (
                <tr key={notice.id}>
                  <td>{notice.title}</td>
                  <td className="notice-summary-cell">
                    {notice.content.length > 80
                      ? `${notice.content.slice(0, 80)}…`
                      : notice.content}
                  </td>
                  <td>{formatNoticeTime(notice.published_at)}</td>
                  <td>
                    {notice.revoked_at ? (
                      <span className="notice-badge notice-badge-revoked">已下架</span>
                    ) : (
                      <span className="notice-badge notice-badge-active">已发布</span>
                    )}
                  </td>
                  <td>
                    {notice.revoked_at ? (
                      <button
                        type="button"
                        className="notice-action-button"
                        disabled={mutatingId === notice.id}
                        onClick={() => void mutate(notice, "restore")}
                      >
                        重新上架
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="notice-action-button"
                        disabled={mutatingId === notice.id}
                        onClick={() => void mutate(notice, "revoke")}
                      >
                        下架
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
