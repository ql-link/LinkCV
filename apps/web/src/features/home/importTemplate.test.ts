import { describe, expect, it } from "vitest";
import type { ResumeTemplate } from "../../api/client";
import { selectImportTemplate } from "./importTemplate";

function template(id: string, key: string): ResumeTemplate {
  return {
    id,
    key,
    name: key,
    description: null,
    data: {} as never,
    style: {} as never,
    switchable: true,
    incompatibility_reason: null,
  };
}

describe("selectImportTemplate", () => {
  it("优先使用生产保留的经典技术模板并忽略空白模板", () => {
    expect(selectImportTemplate([
      template("1", "blank-cn"),
      template("2", "campus-professional-cn"),
      template("3", "classic-technical-cn"),
    ])?.id).toBe("3");
  });

  it("默认模板不可用时回退到第一套非空白模板", () => {
    expect(selectImportTemplate([
      template("1", "blank-cn"),
      template("2", "civic-service-cn"),
    ])?.id).toBe("2");
  });

  it("只有退役空白模板时拒绝继续导入", () => {
    expect(selectImportTemplate([template("1", "blank-cn")])).toBeNull();
  });
});
