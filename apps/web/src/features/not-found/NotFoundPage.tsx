import { t, useLocale } from "@/i18n";
import brandWordmark from "@/assets/drawoffer-wordmark.png";
import { navigateTo } from "../../routing";
import { MiniResume } from "../../v3/art";
import { Icon, type V3IconName } from "../../v3/Icon";
import "../../v3/v3.css";
import "./not-found.css";

// 09.2 404 · 网页端（Figma 142:2）与 10.4 404 · 应用内（Figma 144:2）。
// 两者主卡一致（插图 + 衬线标题 + 说明 + 唯一的黑色主按钮），只换说明文案和卡片下方的出口。

function goBack() {
  if (window.history.length > 1) window.history.back();
  else window.location.assign("/");
}

// 插图舞台 424×220：淡简历（10°、70% 透明）+ 主简历（-6°）+ 橙色「不存在」印章（-12°）+ 左上角 404。
// Figma 的 rotation 逆时针、绕左上角，CSS 里取反并设 transform-origin: 0 0。
function NotFoundArt() {
  useLocale();
  return (
    <div className="v3-stage has-dots not-found-stage" aria-hidden="true">
      <span className="not-found-art">
        <MiniResume x={172} y={42} w={96} h={128} accent="var(--v3-fnt2)" rotate={-10} style={{ opacity: 0.7, boxShadow: "none", transformOrigin: "0 0" }} />
        <MiniResume x={156} y={36} w={104} h={140} accent="var(--v3-fnt)" rotate={6} style={{ transformOrigin: "0 0" }} />
        <span className="not-found-stamp">{t("不存在")}</span>
        <span className="not-found-code">404</span>
      </span>
    </div>
  );
}

function NotFoundCard({ description, homeHref }: { description: string; homeHref: string }) {
  useLocale();
  return (
    <section className="not-found-card" aria-labelledby="not-found-title">
      <NotFoundArt />
      <h1 id="not-found-title">{t("页面不存在")}</h1>
      <p>{description}</p>
      <div className="not-found-actions">
        <a
          className="v3-btn v3-btn-dark is-lg not-found-home"
          href={homeHref}
          onClick={(event) => {
            if (homeHref === "/") return;
            event.preventDefault();
            navigateTo(homeHref);
          }}
        >{t("回到首页")}<Icon name="arrow" size={12} />
        </a>
        <button type="button" className="v3-link" onClick={goBack}>{t("返回上一页")}<Icon name="arrow" size={12} />
        </button>
      </div>
    </section>
  );
}

/** 09.2 网页端：访客或未登录用户打开不存在的地址。无侧栏整窗，顶部品牌栏 + 右上「登录」。 */
export function NotFoundPage() {
  useLocale();
  return (
    <main className="v3 not-found-page" data-ui-theme="light">
      <div className="not-found-window-card">
        <header className="not-found-head">
          <a className="not-found-brand" href="/" aria-label={t("DrawOffer 首页")}>
            <img src={brandWordmark} alt="" aria-hidden="true" />
          </a>
          <a className="not-found-login" href="/login">{t("登录")}</a>
        </header>
        <div className="not-found-body">
          {/* 首页指公开落地页 / */}
          <NotFoundCard
            homeHref="/"
            description={t("链接可能已失效，或者分享者已经关闭了这个页面。可以联系分享者要一个新链接。")}
          />
          <p className="not-found-extra">
            <span>{t("第一次来？")}</span>
            <a href="/">{t("了解 DrawOffer")}</a>
          </p>
        </div>
        <footer className="not-found-foot">{t("© 2026 DrawOffer · 让每一份简历都被认真对待")}</footer>
      </div>
    </main>
  );
}

const IN_APP_LINKS: Array<{ icon: V3IconName; label: string; href: string }> = [
  { icon: "doc", get label() { return t("我的简历"); }, href: "/resumes" },
  { icon: "brief", get label() { return t("岗位看板"); }, href: "/career/applications" },
  { icon: "cal", get label() { return t("面试日程"); }, href: "/career/schedule" },
];

/**
 * 10.4 应用内：已登录用户在工作台里打开不存在的地址。只渲染内容卡里的内容，
 * 外壳由调用方提供：`<V3Shell active="none"><InAppNotFound /></V3Shell>`。
 */
export function InAppNotFound() {
  useLocale();
  return (
    <div className="not-found-inapp">
      {/* 首页指侧栏第一项 /assistant */}
      <NotFoundCard
        homeHref="/assistant"
        description={t("要找的内容可能已被删除，或者链接地址有误。回到首页，继续上次的进度。")}
      />
      <nav className="not-found-extra" aria-label={t("常用入口")}>
        <span>{t("或者去")}</span>
        {IN_APP_LINKS.map((item) => (
          <a
            key={item.href}
            href={item.href}
            onClick={(event) => {
              event.preventDefault();
              navigateTo(item.href);
            }}
          >
            <Icon name={item.icon} size={13} />
            {item.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
