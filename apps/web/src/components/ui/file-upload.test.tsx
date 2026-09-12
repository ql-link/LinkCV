import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileUpload } from "./file-upload";

describe("FileUpload", () => {
  it("通过文件选择器和拖放返回单个文件", () => {
    const onFileSelect = vi.fn();
    render(
      <FileUpload
        accept=".pdf"
        inputLabel="选择 PDF 文件"
        supportingText="支持 PDF，最大 10 MB"
        onFileSelect={onFileSelect}
      />,
    );

    const input = screen.getByLabelText("选择 PDF 文件");
    expect(input).not.toHaveAttribute("tabindex", "-1");
    const selected = new File(["pdf"], "resume.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [selected] } });
    expect(onFileSelect).toHaveBeenLastCalledWith(selected);

    const dropped = new File(["pdf"], "dropped.pdf", { type: "application/pdf" });
    fireEvent.drop(input, {
      dataTransfer: { files: [dropped] },
    });
    expect(onFileSelect).toHaveBeenLastCalledWith(dropped);
  });

  it("禁用时不接收拖放文件", () => {
    const onFileSelect = vi.fn();
    render(
      <FileUpload
        accept=".json"
        inputLabel="选择 JSON 文件"
        supportingText="支持 JSON"
        disabled
        onFileSelect={onFileSelect}
      />,
    );

    fireEvent.drop(screen.getByLabelText("选择 JSON 文件"), {
      dataTransfer: { files: [new File(["{}"], "template.json")] },
    });
    expect(onFileSelect).not.toHaveBeenCalled();
  });

  it("多选和拖放模式返回全部文件，并保留 multiple 输入属性", () => {
    const onFilesSelect = vi.fn();
    render(
      <FileUpload
        accept=".md"
        inputLabel="选择多个资料文件"
        supportingText="最多 10 个文件"
        multiple
        onFilesSelect={onFilesSelect}
      />,
    );

    const input = screen.getByLabelText("选择多个资料文件");
    expect(input).toHaveAttribute("multiple");
    const first = new File(["1"], "one.md");
    const second = new File(["2"], "two.md");
    fireEvent.change(input, { target: { files: [first, second] } });
    expect(onFilesSelect).toHaveBeenLastCalledWith([first, second]);

    const dropped = new File(["3"], "three.md");
    fireEvent.drop(input, {
      dataTransfer: { files: [dropped] },
    });
    expect(onFilesSelect).toHaveBeenLastCalledWith([dropped]);
  });

  it("兼容只触发 input 的文件选择器，并对随后触发的 change 去重", () => {
    const onFilesSelect = vi.fn();
    render(
      <FileUpload
        accept=".md"
        inputLabel="选择兼容模式资料"
        supportingText="最多 10 个文件"
        multiple
        onFilesSelect={onFilesSelect}
      />,
    );

    const input = screen.getByLabelText("选择兼容模式资料");
    const selected = new File(["# 资料"], "兼容.md", { type: "text/markdown" });
    fireEvent.input(input, { target: { files: [selected] } });
    fireEvent.change(input, { target: { files: [selected] } });

    expect(onFilesSelect).toHaveBeenCalledTimes(1);
    expect(onFilesSelect).toHaveBeenCalledWith([selected]);
  });

  it("在 onChange 回调执行时及执行后保留本次选择的文件", () => {
    const first = new File(["1"], "one.md");
    const second = new File(["2"], "two.md");
    let input!: HTMLInputElement;
    const filesDuringCallback: File[][] = [];
    const valuesDuringCallback: string[] = [];
    const onFilesSelect = vi.fn((files: File[]) => {
      filesDuringCallback.push(Array.from(input.files ?? []));
      valuesDuringCallback.push(input.value);
      expect(files).toEqual([first, second]);
    });
    render(
      <FileUpload
        accept=".md"
        inputLabel="选择待解析资料"
        supportingText="最多 10 个文件"
        multiple
        onFilesSelect={onFilesSelect}
      />,
    );

    input = screen.getByLabelText("选择待解析资料") as HTMLInputElement;
    const liveFiles = [first, second];
    const inputValue = "C:\\fakepath\\one.md";
    let currentValue = inputValue;
    Object.defineProperty(input, "files", {
      configurable: true,
      get: () => liveFiles,
    });
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => currentValue,
      set: (value: string) => {
        currentValue = value;
      },
    });

    fireEvent.change(input);

    expect(onFilesSelect).toHaveBeenCalledWith([first, second]);
    expect(filesDuringCallback).toEqual([[first, second]]);
    expect(valuesDuringCallback).toEqual([inputValue]);
    expect(input.files).toEqual([first, second]);
    expect(input.value).toBe(inputValue);
  });

  it("再次点击原生文件输入时先清空旧 value", () => {
    render(
      <FileUpload
        accept=".md"
        inputLabel="选择待解析资料"
        supportingText="最多 10 个文件"
        onFileSelect={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("选择待解析资料") as HTMLInputElement;
    let currentValue = "C:\\fakepath\\one.md";
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => currentValue,
      set: (value: string) => {
        currentValue = value;
      },
    });

    fireEvent.click(input);

    expect(input.value).toBe("");
  });

  it("原生文件选择器只覆盖 dropzone，不遮挡同一外框中的内容", () => {
    const onChildClick = vi.fn();
    render(
      <FileUpload
        accept=".md"
        inputLabel="选择资料"
        supportingText="最多 10 个文件"
        onFilesSelect={vi.fn()}
      >
        <button type="button" onClick={onChildClick}>候选操作</button>
      </FileUpload>,
    );

    const input = screen.getByLabelText("选择资料");
    expect(input.parentElement).toHaveClass("file-upload-picker");
    expect(input.parentElement?.parentElement).toHaveClass("file-upload");

    fireEvent.click(screen.getByRole("button", { name: "候选操作" }));
    expect(onChildClick).toHaveBeenCalledTimes(1);
  });
});
