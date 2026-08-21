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
});
