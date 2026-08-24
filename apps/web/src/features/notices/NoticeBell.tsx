import { useCallback, useEffect, useState } from "react";
import { Bell, ChevronRight } from "lucide-react";

import { api, type ReleaseNoticeItem } from "../../api/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui";
import { renderNoticeMarkdown, splitNoticePreview } from "./noticeMarkdown";
import "./notices.css";

function formatNoticeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function NoticeBell() {
  const [items, setItems] = useState<ReleaseNoticeItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ReleaseNoticeItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getNotices()
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setUnreadCount(data.unread_count);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next) {
      api
        .getNotices()
        .then((data) => {
          setItems(data.items);
          if (data.unread_count === 0) {
            setUnreadCount(0);
            return;
          }
          return api.markNoticesRead().then(() => {
            setUnreadCount(0);
          });
        })
        .catch(() => undefined);
    } else {
      setDetail(null);
    }
  }, []);

  return (
    <>
      <button
        type="button"
        aria-label={unreadCount > 0 ? `查看更新通知，${unreadCount} 条未读` : "查看更新通知"}
        className="notice-bell-button"
        onClick={() => handleOpenChange(true)}
      >
        <Bell aria-hidden size={20} />
        {unreadCount > 0 && <span className="notice-bell-dot" aria-hidden />}
      </button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className={`notice-dialog-content${detail ? " notice-dialog-receded" : ""}`}
        >
          <div className="notice-dialog-frame">
            <DialogHeader>
              <DialogTitle>更新通知</DialogTitle>
            </DialogHeader>
            {items.length === 0 ? (
              <p className="notice-empty">暂无更新通知</p>
            ) : (
              <ol className="notice-list">
                {items.map((notice, index) => {
                  const isLatest = index === 0;
                  return (
                    <li key={notice.id} className="notice-item">
                      <button
                        type="button"
                        className="notice-item-trigger"
                        aria-label={`查看更新详情：${notice.title}`}
                        onClick={() => setDetail(notice)}
                      >
                        <span className="notice-item-heading">
                          <span className="notice-item-title">{notice.title}</span>
                          <time className="notice-item-time" dateTime={notice.published_at}>
                            {formatNoticeTime(notice.published_at)}
                          </time>
                          <ChevronRight className="notice-chevron" aria-hidden size={16} />
                        </span>
                        {isLatest && <NoticePreview content={notice.content} />}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <NoticeDetailDialog notice={detail} onClose={() => setDetail(null)} />
    </>
  );
}

function NoticePreview({ content }: { content: string }) {
  const preview = splitNoticePreview(content);
  return (
    <div className="notice-item-preview">
      <div
        className="notice-markdown"
        dangerouslySetInnerHTML={{ __html: preview.previewHtml }}
      />
      {preview.truncated && <span className="notice-detail-link">点击查看详情</span>}
    </div>
  );
}

function NoticeDetailDialog({
  notice,
  onClose,
}: {
  notice: ReleaseNoticeItem | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={notice !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {notice && (
        <DialogContent className="notice-detail-dialog">
          <div className="notice-dialog-frame">
            <DialogHeader>
              <DialogTitle>{notice.title}</DialogTitle>
              <DialogDescription>{formatNoticeTime(notice.published_at)}</DialogDescription>
            </DialogHeader>
            <div
              className="notice-detail-body notice-markdown"
              dangerouslySetInnerHTML={{ __html: renderNoticeMarkdown(notice.content) }}
            />
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
