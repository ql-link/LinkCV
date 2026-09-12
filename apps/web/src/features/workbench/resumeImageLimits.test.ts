import { describe, expect, it } from "vitest";
import {
  MAX_RESUME_IMAGE_BYTES,
  RESUME_IMAGE_FORMAT_MESSAGE,
  RESUME_IMAGE_TOO_LARGE_MESSAGE,
  validateResumeImageFile,
} from "./resumeImageLimits";

describe("resume image contract", () => {
  it("accepts PNG and JPEG at the shared size limit", () => {
    expect(validateResumeImageFile(
      new File([new Uint8Array(MAX_RESUME_IMAGE_BYTES)], "photo.png", { type: "image/png" }),
    )).toBeNull();
    expect(validateResumeImageFile(
      new File([new Uint8Array(1)], "photo.jpg", { type: "image/jpeg" }),
    )).toBeNull();
  });

  it("rejects unsupported formats and oversized images before upload", () => {
    expect(validateResumeImageFile(
      new File([new Uint8Array(1)], "photo.webp", { type: "image/webp" }),
    )).toBe(RESUME_IMAGE_FORMAT_MESSAGE);
    expect(validateResumeImageFile(
      new File([new Uint8Array(MAX_RESUME_IMAGE_BYTES + 1)], "photo.png", { type: "image/png" }),
    )).toBe(RESUME_IMAGE_TOO_LARGE_MESSAGE);
  });
});
