import { useState, type FormEvent } from "react";
import { Icon } from "../../v3/Icon";
import { Dialog } from "../../v3/primitives";
import { RenameArt } from "./homeArt";
import { useStableCallback } from "./useStableCallback";
import "./home-v3.css";

// 02.1e 重命名简历（480 宽）；copying 模式复用同一弹窗做「复制为新简历」的命名
export function RenameResumeDialog({
  initialTitle,
  busy,
  onCancel,
  onSubmit,
  copying = false,
  onCopy,
  copyDisabled = false,
}: {
  initialTitle: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (title: string) => void | Promise<void>;
  copying?: boolean;
  onCopy?: () => void;
  copyDisabled?: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  const close = useStableCallback(onCancel);
  const normalizedTitle = title.trim();
  const invalid = !normalizedTitle || normalizedTitle.length > 255;
  const heading = copying ? "复制为新简历" : "重命名简历";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (invalid || busy) return;
    void onSubmit(normalizedTitle);
  };

  return (
    <Dialog width={480} label={heading} onClose={close} closable={!busy} className="hv3-rename">
      <form onSubmit={submit}>
        <div className="v3-dialog-body">
          <h2 className="v3-dialog-title">{heading}</h2>
          <p className="v3-dialog-sub">{copying ? "复制后得到独立简历，两份内容互不影响。" : "名称只给自己看，方便在列表里区分。"}</p>
          <div className="v3-stage has-dots hv3-rename-stage"><RenameArt title={normalizedTitle || initialTitle} /></div>
          <label className="v3-field hv3-rename-field">
            <span className="v3-field-label">简历名称</span>
            <input
              className="v3-input is-filled"
              data-autofocus
              autoComplete="off"
              maxLength={255}
              value={title}
              disabled={busy}
              aria-label="简历名称"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {!copying && onCopy && (
            <div className="v3-gcard hv3-rename-copy">
              <div className="v3-grow">
                <div className="v3-grow-copy">
                  <strong>想按另一个岗位改？</strong>
                  <small>复制后得到独立简历，两份内容互不影响。</small>
                </div>
                <div className="v3-grow-right">
                  <button type="button" className="v3-link hv3-rename-copy-btn" disabled={busy || copyDisabled} onClick={onCopy}>
                    复制为新简历<Icon name="arrow" size={12} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="v3-dialog-foot hv3-foot">
          <div className="v3-dialog-foot-left" />
          <button type="button" className="v3-btn v3-btn-ghost hv3-foot-cancel" disabled={busy} onClick={onCancel}>取消</button>
          <button type="submit" className="v3-btn v3-btn-dark" disabled={invalid || busy}>
            {busy ? "正在保存…" : copying ? "创建副本" : "保存名称"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
