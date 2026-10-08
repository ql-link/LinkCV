import { describe, expect, it } from "vitest";
import { museThemes } from "./museThemes";
import { defaultCanonicalPresentation, styleToEditorSettings } from "./resumeContract";

describe("Muse theme compatibility", () => {
  it.each(museThemes)("%s resolves to its registered style instead of classic", (theme) => {
    const style = structuredClone(defaultCanonicalPresentation);
    style.template_snapshot.template_key = `${theme}-cn`;
    expect(styleToEditorSettings(style).theme).toBe(theme);
  });
});
