import { afterEach, describe, expect, it, vi } from "vitest";
import { syncResumeSheetColumns } from "./resumeSheetDecoration";

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON() {} };
}

function fixture(reversed = false) {
  document.body.innerHTML = `<article class="resume-paper"><div class="resume-content"><div class="resume-columns"><section class="resume-column-sidebar" style="background:#b4cdce;padding:20px"><p>侧栏正文</p></section><section class="resume-column-main" style="border:1px solid #c4cee2;padding:24px"><p>履历正文</p></section></div></div></article>`;
  const paper = document.querySelector<HTMLElement>("article")!;
  const rails = Array.from(paper.querySelectorAll<HTMLElement>("section"));
  // Half-scale preview with asymmetric physical gutters: 12/18/24/8 px.
  vi.spyOn(paper, "getBoundingClientRect").mockReturnValue(rect(100, 50, 400, 560));
  Object.defineProperty(paper, "offsetWidth", { configurable: true, value: 800 });
  vi.spyOn(rails[0], "getBoundingClientRect").mockReturnValue(rect(reversed ? 350 : 104, 56, reversed ? 141 : 146, 542));
  vi.spyOn(rails[1], "getBoundingClientRect").mockReturnValue(rect(reversed ? 104 : 260, 56, reversed ? 236 : 231, 542));
  return { paper, rails, content: paper.querySelector<HTMLElement>(".resume-content")! };
}

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });

describe("whole-sheet decoration", () => {
  function masthead() {
    const { paper, content } = fixture();
    content.classList.add("ProseMirror");
    content.insertAdjacentHTML("afterbegin", '<h1 style="background:#2a2a2a">张三</h1><p style="background:#2a2a2a">产品经理</p><p style="background:#2a2a2a">虚构联系方式</p>');
    const blocks = Array.from(content.children).slice(0, 3) as HTMLElement[];
    blocks.forEach((block, index) => vi.spyOn(block, "getBoundingClientRect").mockReturnValue(rect(120, 75 + index * 20.25, 350, 20.25)));
    return { paper, content, blocks };
  }

  it("paints a scaled masthead once without touching editable identity blocks", () => {
    const { paper, content } = masthead();
    const before = content.outerHTML;
    syncResumeSheetColumns({ paper });
    syncResumeSheetColumns({ paper });
    const paint = paper.querySelector<HTMLElement>("[data-resume-identity-fill-paint]")!;
    expect(paper.querySelectorAll("[data-resume-identity-fill-paint]")).toHaveLength(1);
    expect(paper.dataset.resumeIdentityFill).toBe("3");
    expect(paint.style.left).toBe("40px");
    expect(paint.style.top).toBe("50px");
    expect(paint.style.width).toBe("700px");
    expect(paint.style.height).toBe("121.5px");
    expect(paint.style.backgroundColor).toBe("rgb(42, 42, 42)");
    expect(content.outerHTML).toBe(before);
  });

  it("keeps a differently coloured contact strip independent and removes obsolete masthead paint", () => {
    const { paper, blocks } = masthead();
    blocks[2].style.background = "#123456";
    syncResumeSheetColumns({ paper });
    expect(paper.dataset.resumeIdentityFill).toBe("2");
    expect(paper.querySelector<HTMLElement>("[data-resume-identity-fill-paint]")!.style.height).toBe("81px");
    blocks[1].style.background = "transparent";
    syncResumeSheetColumns({ paper });
    expect(paper.dataset.resumeIdentityFill).toBeUndefined();
    expect(paper.querySelector("[data-resume-identity-fill-paint]")).toBeNull();
  });

  it("does not connect masthead bands separated by intentional whitespace", () => {
    const { paper, blocks } = masthead();
    vi.mocked(blocks[1].getBoundingClientRect).mockReturnValue(rect(120, 100, 350, 20.25));
    syncResumeSheetColumns({ paper });
    expect(paper.querySelector("[data-resume-identity-fill-paint]")).toBeNull();
  });

  it("uses vertical masthead measurements in a horizontal editor without changing its measurement state", () => {
    const { paper: measurementPaper } = masthead();
    syncResumeSheetColumns({ paper: measurementPaper });
    const paper = measurementPaper.cloneNode(true) as HTMLElement;
    paper.classList.add("pages-horizontal");
    document.body.append(paper);
    syncResumeSheetColumns({ paper, measurementPaper });
    const paint = paper.querySelector<HTMLElement>("[data-resume-identity-fill-paint]")!;
    expect(paint.style.left).toBe("40px");
    expect(paint.style.height).toBe("121.5px");
    expect(paper.dataset.resumeIdentityFill).toBe("3");
    expect(measurementPaper.dataset.resumeIdentityFill).toBe("3");
  });

  it("fills asymmetric paper gutters at preview scale while preserving the text layout", () => {
    const { paper, rails } = fixture();
    syncResumeSheetColumns({ paper });
    expect(rails[0].style.getPropertyValue("--resume-column-fill-left")).toBe("-8px");
    expect(rails[1].style.getPropertyValue("--resume-column-fill-right")).toBe("-18px");
    expect(rails[0].style.getPropertyValue("--resume-column-fill-top")).toBe("-12px");
    expect(rails[0].style.getPropertyValue("--resume-column-fill-bottom")).toBe("-24px");
    expect(rails[0].style.padding).toBe("20px");
    expect(rails[1].style.padding).toBe("24px");
    expect(paper.textContent).toBe("侧栏正文履历正文");
  });

  it("uses physical column order for a right-hand sidebar", () => {
    const { paper, rails } = fixture(true);
    rails[0].style.borderTopLeftRadius = "60px";
    rails[0].style.borderTopRightRadius = "60px";
    rails[0].style.borderBottomRightRadius = "18px";
    rails[0].style.borderBottomLeftRadius = "18px";
    syncResumeSheetColumns({ paper });
    expect(rails[0].style.getPropertyValue("--resume-column-fill-left")).toBe("0px");
    expect(rails[0].style.getPropertyValue("--resume-column-fill-right")).toBe("-18px");
    expect(rails[1].style.getPropertyValue("--resume-column-fill-left")).toBe("-8px");
    expect(rails[0].style.getPropertyValue("--resume-column-fill-radius")).toBe("60px 0px 0px 18px");
  });

  it("refreshes paint after a theme change without duplicating the sheet outline", () => {
    const { paper, rails, content } = fixture();
    content.style.border = "4px double #bdb2a8";
    content.style.backgroundImage = "linear-gradient(#fff,#eee)";
    syncResumeSheetColumns({ paper });
    rails[0].style.background = "#123456";
    syncResumeSheetColumns({ paper });
    expect(rails[0].style.getPropertyValue("--resume-column-fill-background")).toContain("18, 52, 86");
    expect(paper.querySelectorAll(":scope > [data-resume-sheet-outline-paint]")).toHaveLength(1);
    expect(content.dataset.resumeSheetOutline).toBe("true");
    expect(content.style.borderWidth).toBe("4px");
    content.style.border = "none";
    content.style.backgroundImage = "none";
    syncResumeSheetColumns({ paper });
    expect(paper.querySelector("[data-resume-sheet-outline-paint]")).toBeNull();
  });

  it("retains an independent masthead layout instead of treating its cards as page rails", () => {
    const { paper, content } = fixture();
    content.prepend(document.createElement("h1"));
    syncResumeSheetColumns({ paper });
    expect(paper.querySelector("[data-resume-column-fill]")).toBeNull();
  });

  it("paints PDF rails from the physical page origin without adding flow height", () => {
    const { paper, rails } = fixture();
    syncResumeSheetColumns({ paper, printMargins: { top: 0, right: 0, bottom: 0, left: 0 } });
    expect(rails[0].style.getPropertyValue("--resume-column-fill-left")).toBe("0px");
    expect(rails[0].style.getPropertyValue("--resume-column-fill-top")).toBe("0px");
    expect(rails[1].style.getPropertyValue("--resume-column-fill-width")).toBe("240px");
    expect(paper.style.height).toBe("");
    expect(rails[0].style.minHeight).toBe("");
  });

  it("repeats sidebars on each horizontal sheet using the vertical measurement geometry", () => {
    const { paper: measurementPaper } = fixture(true);
    const paper = measurementPaper.cloneNode(true) as HTMLElement;
    paper.classList.add("pages-horizontal");
    paper.style.setProperty("--resume-page-count", "2");
    document.body.append(paper);
    syncResumeSheetColumns({ paper, measurementPaper });
    const faces = paper.querySelectorAll<HTMLElement>("[data-resume-sheet-column-strip] > div");
    expect(faces).toHaveLength(4);
    expect(faces[0].style.height).toBe("297mm");
    expect(faces[1].style.getPropertyValue("--resume-sheet-page-index")).toBe("1");
    expect(Number.parseFloat(faces[1].style.top)).toBeCloseTo(297 * 96 / 25.4 + 24);
    expect(faces[0].style.background).toContain("180, 205, 206");
    expect(paper.textContent).toBe("侧栏正文履历正文");
  });

  it("places a separate paper outline on every page while keeping the page gap unpainted", () => {
    const { paper, content } = fixture();
    content.style.border = "4px double #bdb2a8";
    paper.style.setProperty("--resume-page-count", "2");
    syncResumeSheetColumns({ paper });
    const faces = paper.querySelectorAll<HTMLElement>("[data-resume-sheet-outline-paint] > div");
    expect(faces).toHaveLength(2);
    expect(faces[0].style.height).toBe("297mm");
    expect(Number.parseFloat(faces[1].style.top)).toBeCloseTo(297 * 96 / 25.4 + 24);
    expect(faces[1].style.borderTopWidth).toBe("4px");
  });

  it("does not mutate ProseMirror nodes while painting an editable multi-page document", () => {
    const { paper, content } = fixture();
    content.classList.add("ProseMirror");
    content.style.borderLeft = "2px solid #123456";
    paper.style.setProperty("--resume-page-count", "2");
    const before = content.outerHTML;
    syncResumeSheetColumns({ paper });
    syncResumeSheetColumns({ paper });
    expect(content.outerHTML).toBe(before);
    expect(paper.dataset.resumeSheetColumns).toBe("true");
    expect(paper.dataset.resumeSheetOutline).toBe("true");
    expect(paper.querySelectorAll("[data-resume-sheet-column-strip] > div")).toHaveLength(4);
    expect(content.querySelector("[data-resume-column-fill]")).toBeNull();
  });
});
