import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clampAvatarCropDraft,
  createAvatarCropDataUrl,
  getAvatarCropLayout,
  type AvatarCropDraft,
} from "./avatarCrop";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("avatarCrop", () => {
  it("按圆形窗口 cover 图片并限制拖动边界", () => {
    const layout = getAvatarCropLayout({ width: 640, height: 480, zoom: 1 });

    expect(layout).toMatchObject({
      renderedWidth: 352,
      renderedHeight: 264,
      maxOffsetX: 44,
      maxOffsetY: 0,
      scale: 0.55,
    });
    expect(clampAvatarCropDraft({
      dataUrl: "data:image/png;base64,test",
      width: 640,
      height: 480,
      zoom: 1,
      offsetX: 100,
      offsetY: 100,
    })).toMatchObject({ offsetX: 44, offsetY: 0 });
  });

  it("导出与预览中心一致的 512px 方形 PNG", () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,cropped",
    );
    const image = document.createElement("img");
    const draft: AvatarCropDraft = {
      dataUrl: "data:image/png;base64,test",
      width: 640,
      height: 480,
      zoom: 2,
      offsetX: 0,
      offsetY: 0,
    };

    expect(createAvatarCropDataUrl(image, draft)).toBe("data:image/png;base64,cropped");
    expect(drawImage).toHaveBeenCalledOnce();
    const [source, sourceX, sourceY, sourceWidth, sourceHeight, ...destination] =
      drawImage.mock.calls[0];
    expect(source).toBe(image);
    expect(sourceX).toBeCloseTo(200);
    expect(sourceY).toBeCloseTo(120);
    expect(sourceWidth).toBeCloseTo(240);
    expect(sourceHeight).toBeCloseTo(240);
    expect(destination).toEqual([0, 0, 512, 512]);
  });
});
