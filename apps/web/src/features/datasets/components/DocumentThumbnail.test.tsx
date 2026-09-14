import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type DatasetRecord } from "../../../api/client";
import { DocumentThumbnail } from "./DocumentThumbnail";
import { rememberTextThumbnail } from "../datasetThumbnails";

const dataset: DatasetRecord = {
  id: "thumbnail-test", file_name: "example.pdf", file_format: "pdf", file_size: 100,
  created_at: "2026-09-05", upload_status: "succeeded", parse_status: "processing", failure_reason: null,
};
let visible: () => void;
beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
      visible = () => callback([{ isIntersecting: true }]);
    }
    observe() {} disconnect() {}
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps the placeholder until parsing completes and the card becomes visible", async () => {
  const fetch = vi.spyOn(api, "getDatasetContent").mockResolvedValue({ id: dataset.id, file_name: dataset.file_name, file_format: "pdf", markdown: "# Actual heading\n\nReal paragraph" });
  const { rerender } = render(<DocumentThumbnail dataset={dataset} fallback={<span>Placeholder</span>} />);
  expect(fetch).not.toHaveBeenCalled();
  rerender(<DocumentThumbnail dataset={{ ...dataset, parse_status: "succeeded" }} fallback={<span>Placeholder</span>} />);
  expect(fetch).not.toHaveBeenCalled();
  act(() => visible());
  expect(await screen.findByRole("heading", { name: "Actual heading" })).toBeInTheDocument();
  expect(screen.queryByText("Placeholder")).not.toBeInTheDocument();
});

it("does not render executable HTML, external images, or focusable links", async () => {
  vi.spyOn(api, "getDatasetContent").mockResolvedValue({ id: dataset.id, file_name: dataset.file_name, file_format: "pdf", markdown: '<script>alert(1)</script>\n\n[link](https://example.test)\n\n![image](https://example.test/image.png)' });
  const { container } = render(<DocumentThumbnail dataset={{ ...dataset, parse_status: "succeeded" }} fallback="Placeholder" />);
  act(() => visible());
  await screen.findByText("link");
  expect(container.querySelector("script, img, a")).toBeNull();
});

it("retains the placeholder when loading fails", async () => {
  const fetch = vi.spyOn(api, "getDatasetContent").mockRejectedValue(new Error("Unavailable"));
  render(<DocumentThumbnail dataset={{ ...dataset, parse_status: "succeeded" }} fallback="Placeholder" />);
  act(() => visible());
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(screen.getByText("Placeholder")).toBeInTheDocument();
});

it.each(["txt", "md"])("shows local %s content after upload without waiting for parsing", async (format) => {
  const item = { ...dataset, id: `local-${format}`, file_format: format };
  const file = new File(["# Local title"], `example.${format}`);
  vi.spyOn(file, "slice").mockReturnValue({ text: async () => "# Local title" } as Blob);
  await rememberTextThumbnail(item, file);
  const fetch = vi.spyOn(api, "getDatasetContent");
  render(<DocumentThumbnail dataset={item} fallback="Placeholder" />);
  expect(screen.getByText(format === "txt" ? "# Local title" : "Local title")).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it("hides old content while replacing and fetches the new revision afterwards", async()=>{
  const fetch=vi.spyOn(api,"getDatasetContent").mockResolvedValueOnce({id:dataset.id,file_name:dataset.file_name,file_format:"pdf",markdown:"# Old"}).mockResolvedValueOnce({id:dataset.id,file_name:dataset.file_name,file_format:"pdf",markdown:"# New"});
  const current:DatasetRecord={...dataset,parse_status:"succeeded",content_revision:"1"};
  const {rerender}=render(<DocumentThumbnail dataset={current} fallback="Placeholder"/>);act(()=>visible());await screen.findByRole("heading",{name:"Old"});
  rerender(<DocumentThumbnail dataset={{...current,replacement:{id:"1",status:"pending",upload_status:"succeeded",parse_status:"queued",failure_code:null,retryable:false,current_revision:"1"}}} fallback="Placeholder"/>);
  expect(screen.queryByRole("heading",{name:"Old"})).not.toBeInTheDocument();expect(screen.getByText("Placeholder")).toBeInTheDocument();
  rerender(<DocumentThumbnail dataset={{...current,content_revision:"2"}} fallback="Placeholder"/>);act(()=>visible());await screen.findByRole("heading",{name:"New"});expect(fetch).toHaveBeenCalledTimes(2);
});
