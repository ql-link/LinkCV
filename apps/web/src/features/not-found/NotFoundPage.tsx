import { ArrowLeft, Frown } from "lucide-react";
import { buttonVariants } from "@/components/ui";
import "./not-found.css";

export function NotFoundPage() {
  return (
    <main className="not-found-page" data-ui-theme="light">
      <section className="not-found-content" aria-labelledby="not-found-title">
        <Frown className="not-found-face" aria-hidden="true" strokeWidth={1.8} />
        <p className="not-found-code" aria-hidden="true">404</p>
        <h1 id="not-found-title">页面不存在</h1>
        <p className="not-found-description">
          你访问的页面可能已被移除、更名，或暂时无法使用。
        </p>
        <a className={buttonVariants({ className: "not-found-action" })} href="/">
          <ArrowLeft aria-hidden="true" />
          返回首页
        </a>
      </section>
    </main>
  );
}
