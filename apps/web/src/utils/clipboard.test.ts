import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

function mockSelectionCopy(copy: () => boolean) {
  const execCommand = vi.fn(copy);
  Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
  return execCommand;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as Partial<Document>).execCommand;
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

describe("copyText", () => {
  it("uses the native clipboard without changing focus or selection", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const execCommand = mockSelectionCopy(() => true);
    const input = document.createElement("input");
    input.value = "original text";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(2, 5);

    await copyText("复制内容\n第二行");

    expect(writeText).toHaveBeenCalledWith("复制内容\n第二行");
    expect(execCommand).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
  });

  it("copies synchronously without the Clipboard API and restores input focus and selection", async () => {
    vi.stubGlobal("navigator", {});
    const input = document.createElement("textarea");
    input.value = "original text";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(2, 5, "backward");
    const execCommand = mockSelectionCopy(() => {
      const temporary = document.activeElement as HTMLTextAreaElement;
      expect(temporary).not.toBe(input);
      expect(temporary.value).toBe("复制内容\n第二行");
      expect(temporary.value.slice(temporary.selectionStart, temporary.selectionEnd)).toBe(temporary.value);
      return true;
    });

    const result = copyText("复制内容\n第二行");
    expect(execCommand).toHaveBeenCalledWith("copy");
    await expect(result).resolves.toBeUndefined();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([2, 5, "backward"]);
    expect(document.querySelectorAll("textarea")).toHaveLength(1);
  });

  it("falls back after the native clipboard denies permission", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError")) },
    });
    mockSelectionCopy(() => {
      expect((document.activeElement as HTMLTextAreaElement).value).toBe("fallback text");
      return true;
    });

    await expect(copyText("fallback text")).resolves.toBeUndefined();
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("keeps copying inside a modal and restores the original document selection", async () => {
    vi.stubGlobal("navigator", {});
    const modal = document.createElement("section");
    modal.setAttribute("role", "dialog");
    const button = document.createElement("button");
    const paragraph = document.createElement("p");
    paragraph.textContent = "selected original text";
    modal.append(button, paragraph);
    document.body.append(modal);
    button.focus();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(window.getSelection()?.toString()).toBe("selected original text");
    mockSelectionCopy(() => {
      expect(modal.contains(document.activeElement)).toBe(true);
      return true;
    });

    await copyText("copied text");

    expect(document.activeElement).toBe(button);
    expect(window.getSelection()?.toString()).toBe("selected original text");
    expect(modal.querySelector("textarea")).toBeNull();
  });

  it.each(["denied", "throws", "missing"])("rejects and cleans up when selection copy is %s", async (failure) => {
    vi.stubGlobal("navigator", {});
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    if (failure !== "missing") {
      mockSelectionCopy(() => {
        if (failure === "throws") throw new Error("Copy denied");
        return false;
      });
    }

    await expect(copyText("text")).rejects.toThrow();
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
