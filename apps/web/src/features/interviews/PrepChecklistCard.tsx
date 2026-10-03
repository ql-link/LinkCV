import { useEffect, useRef, useState } from "react";
import { Check, Plus, Sparkles, Trash2 } from "lucide-react";
import { t, useLocale } from "@/i18n";
import { Button } from "@/components/ui";
import {
  ApiRequestError,
  api,
  type InterviewPrepCategory,
  type InterviewPrepItem,
  type InterviewSessionDetail,
} from "@/api/client";

const MAX_ITEMS = 12;
const MAX_TITLE = 80;

const CATEGORY_LABELS: Record<InterviewPrepCategory, () => string> = {
  intro: () => t("自我介绍"),
  project: () => t("项目深挖"),
  technical: () => t("技术知识"),
  system_design: () => t("系统设计"),
  behavior: () => t("行为与动机"),
  company: () => t("公司调研"),
  other: () => t("其他"),
};

function generateErrorMessage(error: unknown): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  const messages: Record<string, string> = {
    INTERVIEW_PREP_ALREADY_GENERATED: t("这场面试已经生成过准备清单。"),
    LLM_MODEL_NOT_CONFIGURED: t("AI 生成暂不可用，请稍后再试。"),
    LLM_RESPONSE_INVALID: t("AI 这次没有生成有效的清单，可以再试一次。"),
    INTERVIEW_INVALID_TRANSITION: t("只有待进行的面试可以生成准备清单。"),
  };
  return messages[error.message] ?? (error.status >= 500 ? t("AI 暂时没能生成清单，请稍后重试。") : null);
}

export function PrepChecklistCard({
  detail,
  onChanged,
  onNotice,
  fallbackError,
}: {
  detail: InterviewSessionDetail;
  onChanged: () => void;
  onNotice: (notice: string) => void;
  fallbackError: (error: unknown) => string;
}) {
  useLocale();
  const { session } = detail;
  const [items, setItems] = useState<InterviewPrepItem[]>(session.prep_items);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"save" | "generate" | null>(null);
  const lockVersion = useRef(session.lock_version);

  useEffect(() => {
    setItems(session.prep_items);
    lockVersion.current = session.lock_version;
  }, [session.id, session.lock_version, session.prep_items]);

  const generated = session.prep_generated_at !== null;
  const canGenerate = session.status === "scheduled" && !generated;
  const done = items.filter((item) => item.done).length;

  const save = async (next: InterviewPrepItem[]) => {
    const previous = items;
    setItems(next);
    setBusy("save");
    try {
      const response = await api.updateInterviewSession(session.id, {
        prep_items: next,
        base_lock_version: lockVersion.current,
      });
      lockVersion.current = response.session.lock_version;
      setItems(response.session.prep_items);
      onChanged();
    } catch (error) {
      setItems(previous);
      onNotice(fallbackError(error));
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    setBusy("generate");
    try {
      const response = await api.generateInterviewPrepItems(session.id);
      lockVersion.current = response.session.lock_version;
      setItems(response.session.prep_items);
      onChanged();
    } catch (error) {
      onNotice(generateErrorMessage(error) ?? fallbackError(error));
      if (error instanceof ApiRequestError && error.message === "INTERVIEW_PREP_ALREADY_GENERATED") onChanged();
    } finally {
      setBusy(null);
    }
  };

  const add = () => {
    const title = draft.trim().slice(0, MAX_TITLE);
    if (!title || items.length >= MAX_ITEMS) return;
    setDraft("");
    void save([...items, { title, category: "other", reason: null, done: false }]);
  };

  return (
    <section className="interview-surface prep-card" aria-label={t("面试准备清单")}>
      <header>
        <h3>{t("面试准备清单")}</h3>
        {items.length > 0 && <span>{t("{value0} / {value1} 已完成", { value0: done, value1: items.length })}</span>}
      </header>
      {busy === "generate" ? (
        <p className="prep-status" role="status">{t("AI 正在根据岗位、简历和历史复盘生成清单…")}</p>
      ) : items.length === 0 ? (
        <p className="prep-status">
          {canGenerate
            ? t("还没有准备清单。让 AI 按这场面试的岗位和简历生成一份，每场面试只能生成一次。")
            : generated
              ? t("清单已清空。")
              : t("这场面试已经结束，不再生成准备清单。")}
        </p>
      ) : (
        <ul>
          {items.map((item, index) => (
            <li key={item.id ?? `${index}-${item.title}`} className={item.done ? "is-done" : undefined}>
              <button
                type="button"
                role="checkbox"
                aria-checked={item.done}
                aria-label={item.title}
                disabled={busy !== null}
                onClick={() => void save(items.map((entry, entryIndex) => (entryIndex === index ? { ...entry, done: !entry.done } : entry)))}
              >
                {item.done && <Check />}
              </button>
              <div>
                <strong>{item.title}</strong>
                <small>
                  {CATEGORY_LABELS[item.category]()}
                  {item.reason ? ` · ${item.reason}` : ""}
                </small>
              </div>
              <button
                type="button"
                className="prep-remove"
                aria-label={t("删除 {value0}", { value0: item.title })}
                disabled={busy !== null}
                onClick={() => void save(items.filter((_, entryIndex) => entryIndex !== index))}
              >
                <Trash2 />
              </button>
            </li>
          ))}
        </ul>
      )}
      {canGenerate && (
        <Button variant="outline" icon={<Sparkles />} disabled={busy !== null} onClick={() => void generate()}>
          {busy === "generate" ? t("生成中…") : t("AI 生成准备清单")}
        </Button>
      )}
      <form
        className="prep-add"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <input
          value={draft}
          maxLength={MAX_TITLE}
          disabled={busy !== null || items.length >= MAX_ITEMS}
          placeholder={items.length >= MAX_ITEMS ? t("最多 12 条") : t("手动添加一条准备事项")}
          aria-label={t("手动添加准备事项")}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" aria-label={t("添加准备事项")} disabled={busy !== null || !draft.trim() || items.length >= MAX_ITEMS}>
          <Plus />
        </button>
      </form>
    </section>
  );
}
