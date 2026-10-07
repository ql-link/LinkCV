import { t, useLocale } from "@/i18n";
// 07.1a 新建模拟面试 · 选择作答方式（二期）：两段式切换「文字 / 语音面试」+ 下方说明。
// 宽度撑满父容器（新建页表单列 560）。语音服务未配置或浏览器不支持录音时，语音选项禁用并说明原因。
import { Icon } from "@/v3/Icon";
import { microphoneSupported } from "./useMicrophone";
import "./voice.css";

export type AnswerMode = "text" | "voice";

const HINTS: Record<AnswerMode, string> = {
  voice: "面试官语音提问，你口头回答；每条回答的录音与识别文字都会保存，识别稿提交后不能修改，可在报告中对照录音修正。文字面试中也可以随时用麦克风输入。",
  get text() { return t("面试官逐题文字提问，你打字作答，发送前可以随时修改。输入框旁的麦克风可以把语音转成文字，不保存录音。"); },
};

export function AnswerModePicker({ value, onChange, speechAvailable }: { value: AnswerMode; onChange: (value: AnswerMode) => void; speechAvailable: boolean }) {
  useLocale();
  const browserOk = microphoneSupported();
  const voiceDisabled = !speechAvailable || !browserOk;
  const unavailableHint = !speechAvailable
    ? t("语音服务暂未开启（管理端未配置语音识别与合成线路），当前只能文字作答。")
    : typeof window !== "undefined" && window.isSecureContext === false
      ? t("当前页面不是 HTTPS 安全连接，浏览器禁止录音。请通过 HTTPS 或 localhost 访问后再选择语音面试。")
      : t("当前浏览器不支持录音，请换用最新版 Chrome、Edge 或 Safari 后再选择语音面试。");
  const hint = voiceDisabled && value === "text" ? unavailableHint : HINTS[value];

  return (
    <div className="vx-mode" role="radiogroup" aria-label={t("作答方式")}>
      <div className="vx-mode-label">{t("作答方式")}</div>
      <div className="vx-mode-seg">
        <button type="button" role="radio" aria-checked={value === "text"} className={value === "text" ? "is-on" : ""} onClick={() => onChange("text")}>{t("文字")}</button>
        <button
          type="button"
          role="radio"
          aria-checked={value === "voice"}
          className={value === "voice" ? "is-on" : ""}
          disabled={voiceDisabled}
          title={voiceDisabled ? unavailableHint : undefined}
          onClick={() => onChange("voice")}
        >
          <Icon name="mic" size={13} />{t("语音面试")}</button>
      </div>
      <p className={`vx-mode-hint${voiceDisabled && value === "text" ? " is-warn" : ""}`}>{hint}</p>
    </div>
  );
}
