import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, type InterviewSessionDetail } from "@/api/client";
import { PrepChecklistCard } from "./PrepChecklistCard";

const mocks = vi.hoisted(() => ({ updateInterviewSession: vi.fn(), generateInterviewPrepItems: vi.fn() }));
vi.mock("@/api/client", async (original) => ({ ...await original<typeof import("@/api/client")>(), api: mocks }));

function detailWith(session: Record<string, unknown> = {}): InterviewSessionDetail {
  return {
    application: {} as InterviewSessionDetail["application"],
    assets: [],
    session: {
      id: "s1", status: "scheduled", lock_version: 3, prep_items: [], prep_generated_at: null, prep_total: 0, prep_done: 0,
      ...session,
    } as unknown as InterviewSessionDetail["session"],
  };
}

const items = [
  { id: "a", title: "讲清分片方案", category: "project", reason: "岗位要求高并发", done: false },
  { id: "b", title: "准备自我介绍", category: "intro", reason: null, done: true },
];

afterEach(() => vi.clearAllMocks());

describe("PrepChecklistCard", () => {
  it("generates once and shows the returned items", async () => {
    const generated = detailWith({ prep_items: items, prep_generated_at: "2026-10-03T00:00:00Z", lock_version: 4 });
    mocks.generateInterviewPrepItems.mockResolvedValue(generated);
    const onChanged = vi.fn();
    const { rerender } = render(<PrepChecklistCard detail={detailWith()} onChanged={onChanged} onNotice={vi.fn()} fallbackError={() => "x"} />);
    fireEvent.click(screen.getByRole("button", { name: "AI 生成准备清单" }));
    expect(await screen.findByText("讲清分片方案")).toBeInTheDocument();
    expect(screen.getByText("1 / 2 已完成")).toBeInTheDocument();
    expect(mocks.generateInterviewPrepItems).toHaveBeenCalledWith("s1");
    expect(onChanged).toHaveBeenCalled();
    rerender(<PrepChecklistCard detail={generated} onChanged={onChanged} onNotice={vi.fn()} fallbackError={() => "x"} />);
    expect(screen.queryByRole("button", { name: "AI 生成准备清单" })).not.toBeInTheDocument();
  });

  it("explains a failed generation and keeps the button for a retry", async () => {
    mocks.generateInterviewPrepItems.mockRejectedValue(new ApiRequestError(502, "LLM_RESPONSE_INVALID"));
    const onNotice = vi.fn();
    render(<PrepChecklistCard detail={detailWith()} onChanged={vi.fn()} onNotice={onNotice} fallbackError={() => "x"} />);
    fireEvent.click(screen.getByRole("button", { name: "AI 生成准备清单" }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("AI 这次没有生成有效的清单，可以再试一次。"));
    expect(screen.getByRole("button", { name: "AI 生成准备清单" })).toBeEnabled();
  });

  it("toggles, adds and removes items with the current lock version", async () => {
    const detail = detailWith({ prep_items: items, prep_generated_at: "2026-10-03T00:00:00Z" });
    mocks.updateInterviewSession.mockImplementation(async (_id, payload) => detailWith({
      prep_items: payload.prep_items, prep_generated_at: "2026-10-03T00:00:00Z", lock_version: payload.base_lock_version + 1,
    }));
    render(<PrepChecklistCard detail={detail} onChanged={vi.fn()} onNotice={vi.fn()} fallbackError={() => "x"} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "讲清分片方案" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "讲清分片方案" })).toHaveAttribute("aria-checked", "true"));
    expect(mocks.updateInterviewSession.mock.calls[0][1]).toMatchObject({ base_lock_version: 3 });

    fireEvent.change(screen.getByLabelText("手动添加准备事项"), { target: { value: "复习 Kafka" } });
    fireEvent.click(screen.getByRole("button", { name: "添加准备事项" }));
    await waitFor(() => expect(screen.getByText("复习 Kafka")).toBeInTheDocument());
    expect(mocks.updateInterviewSession.mock.calls[1][1]).toMatchObject({ base_lock_version: 4 });

    fireEvent.click(screen.getByRole("button", { name: "删除 准备自我介绍" }));
    await waitFor(() => expect(screen.queryByText("准备自我介绍")).not.toBeInTheDocument());
    expect(mocks.updateInterviewSession.mock.calls[2][1].prep_items.map((item: { title: string }) => item.title)).toEqual(["讲清分片方案", "复习 Kafka"]);
  });

  it("does not offer generation for a finished interview", () => {
    render(<PrepChecklistCard detail={detailWith({ status: "completed" })} onChanged={vi.fn()} onNotice={vi.fn()} fallbackError={() => "x"} />);
    expect(screen.queryByRole("button", { name: "AI 生成准备清单" })).not.toBeInTheDocument();
    expect(screen.getByText("这场面试已经结束，不再生成准备清单。")).toBeInTheDocument();
  });

  it("keeps historical preparation visible without mutation controls in read-only mode", () => {
    render(<PrepChecklistCard readOnly detail={detailWith({ prep_items: items })} onChanged={vi.fn()} onNotice={vi.fn()} fallbackError={() => "x"} />);
    expect(screen.getByText("1 / 2 已完成")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "讲清分片方案" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "准备自我介绍" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("button", { name: /删除|生成/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("手动添加准备事项")).not.toBeInTheDocument();
    expect(mocks.updateInterviewSession).not.toHaveBeenCalled();
  });
});
