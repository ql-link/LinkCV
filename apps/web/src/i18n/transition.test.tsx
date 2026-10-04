import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getLocale, setLocale, t, useLocale } from "./index";
import { setLocaleWithTransition } from "./transition";

function Example() {
  useLocale();
  return <div role="region" aria-label="workspace" data-locale-scroll><button><span data-locale-motion>{t("我的简历")}</span></button><input aria-label="draft" defaultValue="未保存的内容" /></div>;
}

beforeEach(() => { vi.useFakeTimers(); setLocale("zh-CN"); });
afterEach(async () => {
  await act(async () => {
    const reset = setLocaleWithTransition("zh-CN");
    await vi.runAllTimersAsync();
    await reset;
  });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("旧文案淡出后才切换，保留草稿、焦点与滚动容器", async () => {
  render(<Example />);
  const input = screen.getByRole("textbox", { name: "draft" });
  const container = screen.getByRole("region", { name: "workspace" });
  fireEvent.change(input, { target: { value: "继续编辑的内容" } });
  input.focus();
  container.scrollTop = 80;
  let change!: Promise<void>;
  await act(async () => {
    change = setLocaleWithTransition("en-US");
    await vi.advanceTimersByTimeAsync(79);
  });
  expect(screen.getByRole("button", { name: "我的简历" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "My resumes" })).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); await change; });
  expect(screen.getByRole("button", { name: "My resumes" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "我的简历" })).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "draft" })).toBe(input);
  expect(input).toHaveValue("继续编辑的内容");
  expect(input).toHaveFocus();
  expect(container.scrollTop).toBe(80);
  expect(document.documentElement.lang).toBe("en-US");
  expect(localStorage.getItem("linkresume.interface-locale")).toBe("en-US");
});

it("新的语言选择会取消尚未完成的切换，不被旧定时器覆盖", async () => {
  render(<Example />);
  await act(async () => {
    const first = setLocaleWithTransition("en-US");
    await vi.advanceTimersByTimeAsync(40);
    await setLocaleWithTransition("zh-CN");
    await vi.runAllTimersAsync();
    await first;
  });
  expect(getLocale()).toBe("zh-CN");
  expect(screen.getByRole("button", { name: "我的简历" })).toBeInTheDocument();
  expect(localStorage.getItem("linkresume.interface-locale")).toBe("zh-CN");
});

it("可以在淡入期间回切，不重建当前表单", async () => {
  render(<Example />);
  const input = screen.getByRole("textbox", { name: "draft" });
  await act(async () => {
    const first = setLocaleWithTransition("en-US");
    await vi.advanceTimersByTimeAsync(80);
    await first;
    const second = setLocaleWithTransition("zh-CN");
    await vi.advanceTimersByTimeAsync(80);
    await second;
    await vi.runAllTimersAsync();
  });
  expect(screen.getByRole("button", { name: "我的简历" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "draft" })).toBe(input);
  expect(getLocale()).toBe("zh-CN");
});

it("减少动态效果时直接更新，不等待淡出", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  render(<Example />);
  await act(() => setLocaleWithTransition("en-US"));
  expect(screen.getByRole("button", { name: "My resumes" })).toBeInTheDocument();
  expect(getLocale()).toBe("en-US");
});
