const test = require("node:test");
const assert = require("node:assert/strict");
const c = require("../utils/career");
const f = require("../utils/careerForm");
const app = {
  id: "1",
  lock_version: 3,
  phase: "applied",
  status: "active",
  lifecycle_status: "active",
  stage_state: "awaiting_schedule",
  current_stage: {
    id: "7",
    stage_type: "interview",
    stage_label: "HR 面",
    interview_round_no: null,
  },
  stages: [],
  job_snapshot: {},
};
test("timeline includes concurrent, fractional, overnight and out-of-hours sessions", () => {
  const make = (id, start_at, end_at) => ({
    id,
    start_at,
    end_at,
    status: "scheduled",
  });
  const grid = c.timeline(
    [
      make("1", "2026-09-06T23:30:00+08:00", "2026-09-07T00:30:00+08:00"),
      make("2", "2026-09-07T14:15:00+08:00", "2026-09-07T15:15:00+08:00"),
      make("3", "2026-09-07T14:30:00+08:00", "2026-09-07T16:00:00+08:00"),
      make("4", "2026-09-07T22:00:00+08:00", "2026-09-07T23:00:00+08:00"),
    ],
    "2026-09-07",
  );
  assert.equal(grid.items.length, 4);
  assert.equal(grid.hours[0], "00:00");
  assert.equal(grid.hours.at(-1), "24:00");
  assert.equal(grid.hasConflict, true);
  assert.equal(grid.items[1].columns, 2);
  assert.notEqual(grid.items[1].column, grid.items[2].column);
  assert.equal(grid.items[3].columns, 1);
  // 非工作时段和跨天的场次也要落在轴里，不能算到看板外面去。
  for (const item of grid.items) {
    const style = Object.fromEntries(
      item.fluidStyle.split(";").filter(Boolean).map((pair) => pair.split(":")),
    );
    assert.ok(parseFloat(style.top) >= 0, item.id);
    assert.ok(
      parseFloat(style.top) + parseFloat(style.height) <= 100.0001,
      item.id,
    );
  }
});
test("timezone conversion is explicitly Beijing and handles UTC day rollover", () => {
  assert.deepEqual(c.dateParts("2026-09-06T18:30:00Z"), {
    date: "2026-09-07",
    time: "02:30",
  });
  assert.equal(c.shiftDate("2026-12-31", 1), "2027-01-01");
});
test("completed, pending, offer and terminated applications have distinct feedback", () => {
  assert.equal(
    c.applicationView({ ...app, current_session_status: "completed" })
      .statusLabel,
    "已完成",
  );
  assert.equal(c.applicationView(app).canSchedule, true);
  assert.equal(
    c.applicationView({ ...app, lifecycle_status: "terminated" }).canSchedule,
    false,
  );
  assert.equal(
    c.applicationView({ ...app, current_stage: { stage_type: "offer" } })
      .statusLabel,
    "已收到 Offer",
  );
  assert.equal(
    c.applicationView({ ...app, phase: "pending", current_stage: null })
      .statusLabel,
    "待投递",
  );
});
test("finished applications keep the Web state words and say why they ended", () => {
  const cases = [
    [{ status: "rejected" }, "未通过"],
    [{ status: "withdrawn" }, "已主动结束"],
    [{ status: "closed" }, "已结束"],
    [{ status: "closed", offer_status: "declined" }, "已主动结束"],
    [{ lifecycle_status: "terminated", termination_reason: "company_rejected" }, "未通过"],
    [{ lifecycle_status: "terminated", termination_reason: "user_withdrew" }, "已主动结束"],
    [{ lifecycle_status: "terminated" }, "已终止"],
    [{ archived_at: "2026-09-01T00:00:00Z" }, "已归档"],
  ];
  for (const [patch, label] of cases) {
    assert.equal(
      c.applicationView({ ...app, ...patch }).statusLabel,
      label,
      JSON.stringify(patch),
    );
  }
  // An accepted Offer outranks the closed status it also carries.
  assert.equal(
    c.applicationView({ ...app, status: "closed", offer_status: "accepted" })
      .statusLabel,
    "已收到 Offer",
  );
  assert.equal(
    c.applicationView({ ...app, stage_state: "awaiting_result" }).statusLabel,
    "等待结果",
  );
  assert.equal(
    c.applicationView({ ...app, current_stage: { stage_type: "interview" } })
      .statusLabel,
    "等待安排",
  );
});

test("timeline cards shorten the stage label and surface overlaps in place", () => {
  const make = (id, start_at, end_at) => ({
    id,
    company_name: "星河科技",
    stage_label: "技术二面",
    mode: "video",
    start_at,
    end_at,
    status: "scheduled",
  });
  const grid = c.timeline(
    [
      make("1", "2026-09-07T10:00:00+08:00", "2026-09-07T11:00:00+08:00"),
      make("2", "2026-09-07T14:00:00+08:00", "2026-09-07T15:00:00+08:00"),
      make("3", "2026-09-07T14:30:00+08:00", "2026-09-07T15:30:00+08:00"),
    ],
    "2026-09-07",
  );
  assert.equal(grid.items[0].compactStage, "技术二面 · 视频");
  assert.equal(grid.items[1].compactStage, "技术二面");
  assert.deepEqual(
    grid.conflicts.map((entry) => entry.label),
    ["两项安排时间重叠，请核对"],
  );
  // The hint sits below the overlapping cluster, inside the day's span.
  const [conflict] = grid.conflicts;
  assert.ok(conflict.top > grid.items[1].to / 1440 && conflict.top < 100);
  assert.equal(c.timeline([], "2026-09-07").conflicts.length, 0);
});

test("the board only spans the day's real hours and never squeezes a block", () => {
  const make = (id, start_at, end_at) => ({
    id,
    company_name: "星河科技",
    stage_label: "技术二面",
    mode: "video",
    start_at,
    end_at,
    status: "scheduled",
  });
  const day = (list) => c.timeline(list, "2026-09-07");
  // 只有下午一场时，轴收到 12:00–17:00（前后各留 1 小时，再补到最小跨度），
  // 而不是从 08:00 铺到 18:00 把一小时场次摊薄。
  const afternoon = day([make("1", "2026-09-07T14:00:00+08:00", "2026-09-07T15:00:00+08:00")]);
  assert.deepEqual([afternoon.hours[0], afternoon.hours.at(-1)], ["12:00", "17:00"]);
  // 晚上还有一场会把轴拉到 13 小时，但每小时仍保底 112rpx（56px），
  // 块不会再被压到 41px 的文字高度以下。
  const evening = day([
    make("1", "2026-09-07T10:00:00+08:00", "2026-09-07T11:00:00+08:00"),
    make("2", "2026-09-07T20:00:00+08:00", "2026-09-07T21:00:00+08:00"),
  ]);
  assert.deepEqual([evening.hours[0], evening.hours.at(-1)], ["09:00", "22:00"]);
  assert.equal(evening.minimumHeight / (evening.hours.length - 1), 112);
  // 55 分钟是画得下两行的最短时长（24px 公司标识把标题行撑到 24px），更短的只留公司·阶段。
  const half = day([make("1", "2026-09-07T10:00:00+08:00", "2026-09-07T10:30:00+08:00")]);
  const threeQuarter = day([make("1", "2026-09-07T10:00:00+08:00", "2026-09-07T10:45:00+08:00")]);
  const fifty = day([make("1", "2026-09-07T10:00:00+08:00", "2026-09-07T10:50:00+08:00")]);
  const boundary = day([make("1", "2026-09-07T10:00:00+08:00", "2026-09-07T10:55:00+08:00")]);
  assert.equal(half.items[0].showTime, false);
  assert.equal(threeQuarter.items[0].showTime, false);
  assert.equal(fifty.items[0].showTime, false);
  assert.equal(boundary.items[0].showTime, true);
  assert.equal(afternoon.items[0].showTime, true);
  // 24px 标识要 30 分钟（28px 块高）才放得下，再短的块会把标识上下切掉。
  const twenty = day([make("1", "2026-09-07T10:00:00+08:00", "2026-09-07T10:20:00+08:00")]);
  assert.equal(twenty.items[0].showLogo, false);
  assert.equal(half.items[0].showLogo, true);
  // 重叠分列后的窄块不渲染标识，宽度全让给公司名和阶段。
  const overlapping = day([
    make("1", "2026-09-07T14:00:00+08:00", "2026-09-07T15:00:00+08:00"),
    make("2", "2026-09-07T14:30:00+08:00", "2026-09-07T15:30:00+08:00"),
  ]);
  assert.equal(overlapping.items[0].columns, 2);
  assert.equal(overlapping.items[0].showLogo, false);
  assert.equal(overlapping.items[0].showTime, true);
  // 当天没有安排时仍给一段固定的白天窗口，不出现零高度坐标轴。
  assert.deepEqual(
    [day([]).hours[0], day([]).hours.at(-1)],
    ["08:00", "18:00"],
  );
  // 跨天的测评在当天是一整块：轴底边要到 24:00，只到 23:00 会让块溢出看板。
  const fullDay = day([
    make("1", "2026-09-06T00:00:00+08:00", "2026-09-08T00:00:00+08:00"),
  ]);
  assert.deepEqual([fullDay.hours[0], fullDay.hours.at(-1)], ["00:00", "24:00"]);
  const style = Object.fromEntries(
    fullDay.items[0].fluidStyle
      .split(";")
      .filter(Boolean)
      .map((pair) => pair.split(":")),
  );
  assert.equal(parseFloat(style.top), 0);
  assert.equal(parseFloat(style.height), 100);
});

test("company logo projection only keeps public HTTPS sources", () => {
  assert.equal(
    c.logoSource("https://cdn.example.test/logo.png"),
    "https://cdn.example.test/logo.png",
  );
  for (const value of ["http://cdn.example.test/logo.png", "javascript:alert(1)", "", null, 7]) {
    assert.equal(c.logoSource(value), "");
  }
  assert.equal(c.logoInitial("  星河科技"), "星");
  assert.equal(c.logoInitial(""), "企");
  assert.equal(c.logoBackground("blue"), "#145ed6");
  assert.equal(c.logoBackground("unknown"), "#5f6b7d");
});

test("stage and scheduling payloads preserve custom stage identity without inventing a round", () => {
  const draft = { ...f.defaults(), stageLabel: "HR 面" };
  const payload = f.stagePayload(app, draft, c.uuid(), []);
  assert.equal(payload.stage_label, "HR 面");
  assert.equal(payload.interview_round_no, null);
  assert.equal(f.schedulePayload(app, draft, c.uuid(), false), null);
  Object.assign(draft, {
    startDate: "2026-09-10",
    startTime: "14:15",
    endDate: "2026-09-10",
    endTime: "15:15",
  });
  const schedule = f.schedulePayload(app, draft, c.uuid(), true);
  assert.equal(schedule.application_stage_id, "7");
  assert.equal(schedule.stage_type, "interview");
  assert.equal(schedule.round_no, 1);
  assert.equal(schedule.start_at, "2026-09-10T14:15:00+08:00");
});
test("forms reject partial times, reversed ranges and invalid round or salary before writing", () => {
  assert.throws(
    () => f.timeRange({ ...f.defaults(), startDate: "2026-09-10" }),
    /完整填写/,
  );
  assert.throws(
    () =>
      f.timeRange({
        ...f.defaults(),
        startDate: "2026-09-10",
        endDate: "2026-09-10",
        startTime: "15:00",
        endTime: "14:00",
      }),
    /晚于/,
  );
  assert.throws(
    () =>
      f.stagePayload(
        app,
        { ...f.defaults(), stageLabel: "HR", round: "-1" },
        "id",
        [],
      ),
    /轮次/,
  );
  assert.throws(
    () => f.offerPayload(app, { ...f.defaults(), salary: "-100" }),
    /有效薪资/,
  );
  assert.equal(f.timeRange(f.defaults("assessment")), null);
  assert.throws(
    () => f.timeRange({ ...f.defaults("assessment"), startDate: "" }),
    /测评开始/,
  );
});
async function formPage(api, run) {
  const mocks = {
    "../services/auth": { hasSession: () => true },
    "../services/career": api,
  };
  const previous = Object.entries(mocks).map(([name, exports]) => {
    const key = require.resolve(name);
    const old = require.cache[key];
    require.cache[key] = { exports };
    return [key, old];
  });
  const oldPage = global.Page,
    oldWx = global.wx;
  let definition;
  global.Page = (value) => {
    definition = value;
  };
  global.wx = {
    setNavigationBarTitle() {},
    showToast() {},
    navigateBack() {},
    showModal: ({ success }) => success({ confirm: true }),
  };
  const key = require.resolve("../pages/career/form");
  try {
    delete require.cache[key];
    require(key);
    const page = {
      ...definition,
      data: structuredClone(definition.data),
      setData(value) {
        Object.assign(this.data, value);
      },
    };
    await run(page);
  } finally {
    delete require.cache[key];
    for (const [key, old] of previous) {
      if (old) require.cache[key] = old;
      else delete require.cache[key];
    }
    global.Page = oldPage;
    global.wx = oldWx;
  }
}
test("retrying a failed schedule never appends the already saved stage again", async () => {
  let stageCalls = 0,
    scheduleCalls = 0;
  const ids = [];
  await formPage(
    {
      getApplication: async () => ({ application: app }),
      addStage: async () => {
        stageCalls++;
        return { application: { ...app, lock_version: 4 } };
      },
      createSession: async (_, payload) => {
        scheduleCalls++;
        ids.push(payload.client_request_id);
        if (scheduleCalls === 1) throw Error("network");
        return {};
      },
    },
    async (page) => {
      await page.onLoad({ applicationId: "1", mode: "stage" });
      page.setData({
        form: {
          ...f.defaults(),
          stageLabel: "HR 面",
          startDate: "2026-09-10",
          startTime: "14:00",
          endDate: "2026-09-10",
          endTime: "15:00",
        },
      });
      await page.save();
      assert.match(page.data.partial, /阶段已保存/);
      assert.equal(page.data.buttonLabel, "重试添加安排");
      await page.save();
    },
  );
  assert.equal(stageCalls, 1);
  assert.equal(scheduleCalls, 2);
  assert.equal(ids[0], ids[1]);
});
test("saving interview notes updates only notes and uses session optimistic lock", async () => {
  const writes = [];
  await formPage(
    {
      getSession: async () => ({
        application: app,
        session: {
          id: "5",
          lock_version: 12,
          start_at: "2026-09-10T14:00:00+08:00",
          end_at: "2026-09-10T15:00:00+08:00",
          mode: "video",
          questions_markdown: "原记录", review_summary:"原复盘", improvement_markdown:"原计划",
        },
      }),
      updateSession: async (id, payload) => {
        writes.push({ id, payload });
      },
    },
    async (page) => {
      await page.onLoad({ applicationId: "1", sessionId: "5", mode: "record" });
      page.setData({ form: { ...page.data.form, record: "新记录" } });
      await page.save();
    },
  );
  assert.deepEqual(writes, [
    {
      id: "5",
      payload: { base_lock_version: 12, questions_markdown: "新记录", review_summary:"原复盘", improvement_markdown:"原计划" },
    },
  ]);
});

 test("fluid timeline keeps simultaneous events aligned as the board stretches", () => {
  const grid = c.timeline([
    {id: "a", start_at: "2026-09-07T10:00:00+08:00", end_at: "2026-09-07T11:00:00+08:00", status: "scheduled"},
    {id: "b", start_at: "2026-09-07T10:30:00+08:00", end_at: "2026-09-07T11:30:00+08:00", status: "scheduled"},
  ], "2026-09-07");
  const values = grid.items.map(item => Object.fromEntries(item.fluidStyle.split(";").filter(Boolean).map(pair => pair.split(":"))));
  assert.equal(values[0].width, "50%");
  assert.equal(values[1].left, "50%");
  for (const boardHeight of [420, 800, 1200]) {
    const firstTop = parseFloat(values[0].top) / 100 * boardHeight;
    const secondTop = parseFloat(values[1].top) / 100 * boardHeight;
    const eventHeight = parseFloat(values[0].height) / 100 * boardHeight;
    assert.ok(Math.abs(secondTop - firstTop - eventHeight / 2) < 0.001);
    assert.ok(secondTop + eventHeight <= boardHeight);
  }
});
