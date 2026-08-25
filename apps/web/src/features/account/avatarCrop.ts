export const AVATAR_CROP_OUTPUT_SIZE = 512;
export const AVATAR_CROP_VIEWPORT_SIZE = 320;
export const AVATAR_CROP_WINDOW_SIZE = 264;
export const AVATAR_CROP_MIN_ZOOM = 1;
export const AVATAR_CROP_MAX_ZOOM = 3;

export type AvatarImageData = {
  dataUrl: string;
  width: number;
  height: number;
};

export type AvatarCropDraft = AvatarImageData & {
  zoom: number;
  offsetX: number;
  offsetY: number;
};

export type AvatarCropLayout = {
  renderedWidth: number;
  renderedHeight: number;
  maxOffsetX: number;
  maxOffsetY: number;
  scale: number;
};

export function readAvatarImage(file: File): Promise<AvatarImageData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("INVALID_IMAGE"));
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        reject(new Error("INVALID_IMAGE"));
        return;
      }

      const image = new Image();
      image.onload = () => {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (!width || !height) {
          reject(new Error("INVALID_IMAGE"));
          return;
        }
        resolve({ dataUrl, width, height });
      };
      image.onerror = () => reject(new Error("INVALID_IMAGE"));
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function getAvatarCropLayout(draft: Pick<AvatarCropDraft, "width" | "height" | "zoom">): AvatarCropLayout {
  const baseScale = Math.max(
    AVATAR_CROP_WINDOW_SIZE / draft.width,
    AVATAR_CROP_WINDOW_SIZE / draft.height,
  );
  const scale = baseScale * clampZoom(draft.zoom);
  const renderedWidth = draft.width * scale;
  const renderedHeight = draft.height * scale;
  return {
    renderedWidth,
    renderedHeight,
    maxOffsetX: Math.max(0, (renderedWidth - AVATAR_CROP_WINDOW_SIZE) / 2),
    maxOffsetY: Math.max(0, (renderedHeight - AVATAR_CROP_WINDOW_SIZE) / 2),
    scale,
  };
}

export function clampAvatarCropDraft(draft: AvatarCropDraft): AvatarCropDraft {
  const layout = getAvatarCropLayout(draft);
  return {
    ...draft,
    zoom: clampZoom(draft.zoom),
    offsetX: clamp(draft.offsetX, -layout.maxOffsetX, layout.maxOffsetX),
    offsetY: clamp(draft.offsetY, -layout.maxOffsetY, layout.maxOffsetY),
  };
}

export function createAvatarCropDataUrl(image: HTMLImageElement, draft: AvatarCropDraft): string {
  const normalizedDraft = clampAvatarCropDraft(draft);
  const layout = getAvatarCropLayout(normalizedDraft);
  const cropLeft = (AVATAR_CROP_VIEWPORT_SIZE - AVATAR_CROP_WINDOW_SIZE) / 2;
  const cropTop = cropLeft;
  const imageLeft = AVATAR_CROP_VIEWPORT_SIZE / 2 - layout.renderedWidth / 2 + normalizedDraft.offsetX;
  const imageTop = AVATAR_CROP_VIEWPORT_SIZE / 2 - layout.renderedHeight / 2 + normalizedDraft.offsetY;
  const sourceSize = AVATAR_CROP_WINDOW_SIZE / layout.scale;
  const sourceX = clamp((cropLeft - imageLeft) / layout.scale, 0, normalizedDraft.width - sourceSize);
  const sourceY = clamp((cropTop - imageTop) / layout.scale, 0, normalizedDraft.height - sourceSize);

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_CROP_OUTPUT_SIZE;
  canvas.height = AVATAR_CROP_OUTPUT_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("CANVAS_UNAVAILABLE");

  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    AVATAR_CROP_OUTPUT_SIZE,
    AVATAR_CROP_OUTPUT_SIZE,
  );
  return canvas.toDataURL("image/png");
}

function clampZoom(value: number) {
  return clamp(value, AVATAR_CROP_MIN_ZOOM, AVATAR_CROP_MAX_ZOOM);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
