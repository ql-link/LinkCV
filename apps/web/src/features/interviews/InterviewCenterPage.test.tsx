import { createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InterviewCenterPage } from "./InterviewCenterPage";

afterEach(() => {
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("InterviewCenterPage", () => {
  it("展示三个可用视图并将素材标记为后续范围", () => {
    window.history.replaceState(null, "", "/interviews");
    render(<InterviewCenterPage view="overview" />);

    const tabs = screen.getByRole("tablist", { name: "面试中心视图" });
    expect(within(tabs).getByRole("tab", { name: "总览" })).toHaveAttribute("aria-selected", "true");
    expect(within(tabs).getByRole("tab", { name: "排期" })).toBeEnabled();
    expect(within(tabs).getByRole("tab", { name: "记录复盘" })).toBeEnabled();
    expect(within(tabs).getByRole("tab", { name: /素材/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("heading", { name: "面试流程总览" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByText("待面试")).toBeInTheDocument();
    expect(screen.getByText("已完成面试")).toBeInTheDocument();
    expect(screen.queryByText("待跟进")).not.toBeInTheDocument();
    const tencentPipelineCard = screen.getByRole("article", { name: "腾讯 产品经理" });
    expect(tencentPipelineCard.querySelector(".pipeline-card-company")).toHaveTextContent("腾讯");
    expect(tencentPipelineCard.querySelector(".pipeline-card-role")).toHaveTextContent("产品经理");
    expect(tencentPipelineCard.closest(".interview-pipeline-column")).toHaveTextContent("二面");
    expect(tencentPipelineCard.querySelector(".pipeline-card-meta")).toHaveTextContent("待安排暂未排期");
    expect(screen.queryByText(/下一场/)).not.toBeInTheDocument();
    const meituanPipelineCard = screen.getByRole("article", { name: "美团 产品经理" });
    expect(meituanPipelineCard.querySelector(".pipeline-card-meta")).toHaveTextContent("视频面试08/20 14:00");

    const weekTimeline = screen.getByRole("region", { name: "本周面试时间表，可上下滚动查看 00:00 至 21:00" });
    expect(within(weekTimeline).getByText("00:00")).toBeInTheDocument();
    expect(within(weekTimeline).getByText("21:00")).toBeInTheDocument();
    expect(weekTimeline).toHaveProperty("scrollTop", 360);

    fireEvent.click(screen.getByRole("button", { name: "搜索面试" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索面试" }), { target: { value: "阿里云" } });
    expect(screen.getByRole("heading", { name: "搜索结果 · 1" })).toBeInTheDocument();

    fireEvent.click(within(tabs).getByRole("tab", { name: "排期" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/interviews?view=schedule");
  });

  it("在排期视图选择日历事件并同步右侧详情", () => {
    render(<InterviewCenterPage view="schedule" />);

    fireEvent.click(screen.getByRole("button", { name: /字节跳动 · 一面/ }));
    const scheduleContext = screen.getByRole("complementary", { name: "字节跳动面试上下文" });
    expect(within(scheduleContext).getByRole("heading", { name: "一面（技术面试）" })).toBeInTheDocument();
    expect(within(scheduleContext).getByText("张同学（后端开发工程师）")).toBeInTheDocument();
    expect(within(scheduleContext).getByText("2026年8月18日（周二） 10:00 – 11:00")).toBeInTheDocument();
  });

  it("按半小时时间槽拖动面试并同步日期、时间和右侧详情", () => {
    render(<InterviewCenterPage view="schedule" />);
    const calendar = screen.getByRole("grid", { name: "面试周排期，可拖动并按 30 分钟调整" });
    vi.spyOn(calendar, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 758, height: 590, right: 758, bottom: 590, x: 0, y: 0, toJSON: () => ({}) });
    const transfer = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "none",
      dropEffect: "none",
      setData: (type: string, value: string) => transfer.set(type, value),
      getData: (type: string) => transfer.get(type) ?? "",
    } as unknown as DataTransfer;
    const aliyun = screen.getByRole("button", { name: /10:00 – 11:30.*阿里云 · 二面/ });

    fireEvent.dragStart(aliyun, { dataTransfer });
    const dragOver = createEvent.dragOver(calendar, { dataTransfer });
    Object.defineProperties(dragOver, { clientX: { value: 508 }, clientY: { value: 80 } });
    fireEvent(calendar, dragOver);
    const drop = createEvent.drop(calendar, { dataTransfer });
    Object.defineProperties(drop, { clientX: { value: 508 }, clientY: { value: 80 } });
    fireEvent(calendar, drop);

    const movedAliyun = screen.getByRole("button", { name: /10:30 – 12:00.*阿里云 · 二面/ });
    const context = screen.getByRole("complementary", { name: "阿里云面试上下文" });
    expect(within(context).getByText("2026年8月21日（周五） 10:30 – 12:00")).toBeInTheDocument();

    fireEvent.keyDown(movedAliyun, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: /11:00 – 12:30.*阿里云 · 二面/ })).toBeInTheDocument();
  });

  it("在记录复盘视图切换记录并同步右侧面试上下文", () => {
    render(<InterviewCenterPage view="records" />);

    fireEvent.click(screen.getByRole("button", { name: /阿里云.*后端开发工程师.*二面/ }));
    expect(screen.getByRole("heading", { name: "阿里云 · 后端开发工程师" })).toBeInTheDocument();
    expect(screen.getByText(/面试时间：2026年8月20日 10:00/)).toBeInTheDocument();
    const recordContext = screen.getByRole("complementary", { name: "阿里云面试上下文" });
    expect(within(recordContext).getByRole("heading", { name: "二面（技术面试）" })).toBeInTheDocument();
    expect(within(recordContext).getByText("阿里云后端开发 JD")).toBeInTheDocument();
  });

  it("为公司随机初始化日历颜色并将用户选择同步到排期", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { unmount } = render(<InterviewCenterPage view="records" />);

    expect(screen.getByRole("group", { name: "字节跳动日历颜色，当前红色" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "将字节跳动的日历颜色设为紫色" }));
    expect(screen.getByRole("button", { name: "将字节跳动的日历颜色设为紫色" })).toHaveAttribute("aria-pressed", "true");

    unmount();
    render(<InterviewCenterPage view="schedule" />);
    expect(screen.getByRole("button", { name: /字节跳动 · 一面/ })).toHaveClass("calendar-purple");
  });
});
