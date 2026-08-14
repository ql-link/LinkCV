import { lazy, Suspense } from "react";
import { useResumeStore } from "../../store/resumeStore";
import { navigateTo } from "../../routing";
import { User } from "../../api/client";
import { WechatQrLogin } from "./WechatQrLogin";
import "./auth.css";

const GrainGradient = lazy(() =>
  import("@paper-design/shaders-react").then((module) => ({
    default: module.GrainGradient,
  })),
);

export function AuthPage({
  next = null,
}: {
  initialMode?: "login" | "register";
  next?: string | null;
}) {
  const loginWithWechat = useResumeStore((state) => state.loginWithWechat);

  const handleWechatSuccess = async (user: User) => {
    await loginWithWechat(user);
    navigateTo(next ?? "/resumes", { replace: true });
  };

  return (
    <main className="auth-entry min-h-screen bg-background p-3 text-foreground antialiased [font-synthesis:none]">
      <div className="grid min-h-[calc(100vh-1.5rem)] gap-6 lg:grid-cols-[0.94fr_1.06fr]">
        <section className="flex items-center rounded-md border border-border bg-surface px-6 py-12 sm:px-10 lg:px-14 lg:py-20 xl:px-20">
          <div className="mx-auto w-full max-w-[520px]">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              WeChat sign in
            </span>
            <h1 className="mt-3 text-3xl font-medium tracking-[-0.04em] sm:text-4xl lg:text-[42px] lg:leading-[1.05] xl:text-[48px]">
              微信扫码登录 LinkCV
            </h1>
            <p className="mt-3 text-base leading-snug text-text-secondary sm:text-lg">
              使用微信扫描小程序码，并在小程序中确认本次登录。
            </p>
            <div className="mt-10 rounded-xl border border-border bg-surface-subtle p-6">
              <WechatQrLogin onSuccess={(user) => void handleWechatSuccess(user)} />
            </div>
          </div>
        </section>

        <aside className="auth-entry-visual relative min-h-[420px] overflow-hidden rounded-md bg-black text-white lg:min-h-0">
          <div className="auth-entry-shader absolute inset-0">
            <Suspense fallback={null}>
              <GrainGradient
                className="absolute inset-0 bg-black"
                colorBack="#00000000"
                colors={["#FFFFFF", "#155fd7", "#155fd7", "#FFFFFF"]}
                frame={2854.5}
                intensity={0.5}
                noise={0.25}
                offsetX={0}
                offsetY={0}
                rotation={0}
                scale={1}
                shape="corners"
                softness={0.5}
                speed={1}
              />
            </Suspense>
          </div>
          <div className="relative z-10 flex h-full w-full flex-col justify-between gap-10 p-8 sm:p-12 lg:p-14 xl:p-16">
            <h2 className="max-w-[560px] text-4xl font-medium leading-[0.98] tracking-[-0.05em] sm:text-5xl xl:text-[64px]">
              扫码确认，
              <br />
              安全进入工作台。
            </h2>
            <p className="max-w-[420px] text-base leading-relaxed text-white/70 xl:text-lg">
              普通账号由微信身份自动创建，无需填写注册或登录表单。
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
