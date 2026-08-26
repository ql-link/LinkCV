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
    expect(input).toHaveAttribute("tabindex", "-1");
    const selected = new File(["pdf"], "resume.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [selected] } });
    expect(onFileSelect).toHaveBeenLastCalledWith(selected);

    const dropped = new File(["pdf"], "dropped.pdf", { type: "application/pdf" });
    fireEvent.drop(screen.getByRole("button", { name: /点击上传或拖放文件/ }), {
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

    fireEvent.drop(screen.getByRole("button", { name: /点击上传或拖放文件/ }), {
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
    fireEvent.drop(screen.getByRole("button", { name: /点击上传或拖放多个文件/ }), {
      dataTransfer: { files: [dropped] },
    });
    expect(onFilesSelect).toHaveBeenLastCalledWith([dropped]);
  });

  it("在清空原生文件输入前复制 FileList，避免真实浏览器丢失选择结果", () => {
    const onFilesSelect = vi.fn();
    render(
      <FileUpload
        accept=".md"
        inputLabel="选择待解析资料"
        supportingText="最多 10 个文件"
        multiple
        onFilesSelect={onFilesSelect}
      />,
    );

    const input = screen.getByLabelText("选择待解析资料") as HTMLInputElement;
    const first = new File(["1"], "one.md");
    const second = new File(["2"], "two.md");
    const liveFiles = [first, second];
    Object.defineProperty(input, "files", {
      configurable: true,
      get: () => liveFiles,
    });
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => "C:\\fakepath\\one.md",
      set: (value: string) => {
        if (value === "") liveFiles.splice(0);
      },
    });

    fireEvent.change(input);

    expect(onFilesSelect).toHaveBeenCalledWith([first, second]);
    expect(liveFiles).toHaveLength(0);
  });
});
