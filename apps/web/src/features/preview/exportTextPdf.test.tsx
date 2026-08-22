import { describe, expect, it } from "vitest";
import { defaultSettings, resumeSerifFontStack } from "../../store/resumeStore";
import {
  PDF_A4_HEIGHT,
  PDF_A4_WIDTH,
  PDF_LIST_TEXT_LAYOUT_STYLE,
  PDF_SERIF_FONT_FAMILY,
  PDF_WENKAI_FONT_FAMILY,
  contentHeightFromLayout,
  countPdfPagesFromSource,
  pdfPageStyle,
  pdfTextAlignment,
  resolvePdfFontFamily,
  resumePdfHyphenationCallback,
  smartPdfMeasurementSize,
  smartPdfPageSize,
} from "./exportTextPdf";

describe("文字版 PDF 页面设置", () => {
  it("允许连续中文和超长英文换行，同时不拆散普通英文单词", () => {
    expect(resumePdfHyphenationCallback("中文")).toEqual(["中", "", "文", ""]);
    expect(resumePdfHyphenationCallback("LinkCV")).toEqual(["LinkCV"]);
    expect(resumePdfHyphenationCallback("a".repeat(33))).toHaveLength(66);
  });

  it("把列表正文约束在项目符号后的剩余宽度内", () => {
    expect(PDF_LIST_TEXT_LAYOUT_STYLE).toEqual({
      width: "100%",
      paddingLeft: 15,
    });
  });

  it("没有显式对齐时沿用模板姓名区的默认居中规则", () => {
    const name = { type: "heading", attrs: { level: 1, textAlign: null } };
    const contact = { type: "paragraph", attrs: { textAlign: null } };

    expect(pdfTextAlignment(name)).toBe("center");
    expect(pdfTextAlignment(contact, name)).toBe("center");
    expect(pdfTextAlignment({ ...contact, attrs: { textAlign: "left" } }, name)).toBe("left");
    expect(pdfTextAlignment({ type: "heading", attrs: { level: 2, textAlign: null } })).toBe("left");
  });

  it("把编辑器的三种字体映射为对应的嵌入字体", () => {
    expect(resolvePdfFontFamily(resumeSerifFontStack)).toBe(PDF_SERIF_FONT_FAMILY);
    expect(resolvePdfFontFamily('"LXGW WenKai", serif')).toBe(PDF_WENKAI_FONT_FAMILY);
    expect(resolvePdfFontFamily('"PingFang SC", sans-serif')).toBe("LinkCV Noto Sans Hans");
  });

  it("普通模式完整保留字号、行距和页边距", () => {
    const style = pdfPageStyle({
      ...defaultSettings,
      fontSize: 12,
      lineHeight: 1.55,
      pageMargin: 22,
      verticalPageMargin: 18,
      smartOnePage: false,
    });

    expect(style).toMatchObject({
      fontFamily: PDF_SERIF_FONT_FAMILY,
      fontSize: 12,
      lineHeight: 1.55,
      paddingTop: "18mm",
      paddingBottom: "18mm",
      paddingLeft: "22mm",
      paddingRight: "22mm",
    });
  });

  it("智能一页保持普通主题的字号与行距不变", () => {
    expect(pdfPageStyle({
      ...defaultSettings,
      fontSize: 12,
      lineHeight: 1.55,
      smartOnePage: true,
    })).toMatchObject({ fontSize: 12, lineHeight: 1.55 });
  });

  it("用标准页数提供测量上限，再按内容实际高度生成等宽长页面", () => {
    expect(smartPdfMeasurementSize(2)).toEqual([PDF_A4_WIDTH, PDF_A4_HEIGHT * 2]);
    expect(smartPdfPageSize(PDF_A4_HEIGHT + 123.456)).toEqual([PDF_A4_WIDTH, PDF_A4_HEIGHT + 123.46]);
    expect(smartPdfPageSize(500)).toEqual([PDF_A4_WIDTH, PDF_A4_HEIGHT]);
  });

  it("从连续排版结果计算内容底部并保留底边距", () => {
    expect(contentHeightFromLayout({
      children: [{
        children: [
          { box: { top: 50, height: 300 } },
          { box: { top: 360, height: 600 } },
        ],
      }],
    }, 50)).toBe(1014);
    expect(() => contentHeightFromLayout({ children: [{}, {}] }, 50)).toThrow("SMART_PDF_LAYOUT_MEASUREMENT_FAILED");
  });

  it("从 React-pdf 输出结构读取实际页数", () => {
    expect(countPdfPagesFromSource("/Type /Pages /Count 2 /Kids [1 0 R 2 0 R] /Type /Page /Type /Page")).toBe(2);
    expect(countPdfPagesFromSource("invalid pdf source")).toBe(1);
  });

  it("紧凑主题沿用编辑器固定的排版密度", () => {
    expect(pdfPageStyle({
      ...defaultSettings,
      theme: "compact",
      fontSize: 12,
      lineHeight: 1.55,
      smartOnePage: false,
    })).toMatchObject({ fontSize: 9.5, lineHeight: 1.22 });
  });
});
