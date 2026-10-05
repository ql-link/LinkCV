import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockInterviewApi, resetMockInterviewStore, type MockInterviewDetail } from "../mockInterviewApi";
import { DeviceCheck } from "./DeviceCheck";
import type { Microphone } from "./useMicrophone";

vi.mock("@/routing", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/routing")>()), navigateTo: vi.fn() }));

const mic = {
  permission: "granted",
  level: 0,
  metering: false,
  start: vi.fn(),
  devices: [],
  deviceId: "default",
  selectDevice: vi.fn(),
} as unknown as Microphone;

async function voiceInterview(): Promise<MockInterviewDetail> {
  const { items } = await mockInterviewApi.list();
  const voice = items.find((item) => item.answer_mode === "voice")!;
  return (await mockInterviewApi.get(voice.id)).mock_interview;
}

function renderCheck(interview: MockInterviewDetail) {
  return render(<DeviceCheck interview={interview} mic={mic} onStart={vi.fn()} onBack={vi.fn()} onSwitchToText={vi.fn()} busy={null} />);
}

beforeEach(() => resetMockInterviewStore());
afterEach(() => vi.restoreAllMocks());

describe("DeviceCheck 面试官声音试听", () => {
  it("试听调用后端设备试音（不带题号），完成后显示可以听到，且不再带「需后端」标签", async () => {
    const interview = await voiceInterview();
    const playback = vi.spyOn(mockInterviewApi, "speechPlayback");
    renderCheck(interview);
    expect(screen.queryByText("需后端")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /试听/ }));
    await waitFor(() => expect(screen.getByText("可以听到")).toBeInTheDocument());
    expect(playback).toHaveBeenCalledWith(interview.id, undefined, expect.any(AbortSignal));
  });

  it("语音合成失败时提示无法试听，仍可继续面试", async () => {
    const interview = await voiceInterview();
    vi.spyOn(mockInterviewApi, "speechPlayback").mockRejectedValue(new Error("tts down"));
    renderCheck(interview);

    fireEvent.click(screen.getByRole("button", { name: /试听/ }));
    await waitFor(() => expect(screen.getByText("无法试听")).toBeInTheDocument());
    expect(screen.getByText(/语音合成或播放失败/)).toBeInTheDocument();
  });
});
