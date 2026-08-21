const test = require("node:test");
const assert = require("node:assert/strict");
const { toDisplayResume } = require("../utils/resume");

test("resume service uses the dedicated mini-program read-only API", async () => {
  const requests = [];
  require.cache[require.resolve("../utils/request")] = {
    exports: {
      request: async (path) => {
        requests.push(path);
        return path.endsWith("/42") ? { resume: { id: "42" } } : { resumes: [] };
      },
    },
  };
  delete require.cache[require.resolve("../services/resumes")];
  const resumes = require("../services/resumes");

  await resumes.listResumes();
  await resumes.getResume("42");

  assert.deepEqual(requests, [
    "/api/miniprogram/resumes",
    "/api/miniprogram/resumes/42",
  ]);
});

test("maps semantic resume to read-only display sections", () => {
  const result = toDisplayResume({
    title: "后端简历",
    data: {
      basics: {
        name: "张三",
        headline: "后端工程师",
        email: "zhangsan@example.test",
        phone: null,
        location: "合肥",
        summary: { format: "markdown", content: "专注可靠系统。" },
      },
      sections: {
        work_experiences: [{
          id: "work-1",
          organization: "示例科技",
          position: "工程师",
          start_date: "2024-01",
          current: true,
          summary: { format: "markdown", content: "负责服务开发。" },
        }],
        projects: [],
        educations: [],
        skills: [{ id: "skill-1", name: "Python", level: null, keywords: ["FastAPI"] }],
        custom_sections: [],
      },
    },
  });

  assert.equal(result.name, "张三");
  assert.deepEqual(result.contacts, ["zhangsan@example.test", "合肥"]);
  assert.equal(result.sections[0].items[0].meta, "2024-01 - 至今");
  assert.equal(result.sections[1].items[0].content, "FastAPI");
});

test("ignores photo and unknown fields instead of exposing private assets", () => {
  const result = toDisplayResume({
    title: "最小简历",
    data: {
      basics: { name: "张三", photo: "/api/assets/private", secret: "hidden" },
      sections: {},
    },
  });
  assert.equal(result.photo, undefined);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(result).includes("hidden"), false);
});
