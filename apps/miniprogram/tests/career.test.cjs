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
  assert.equal(grid.hours.at(-1), "23:00");
  assert.equal(grid.hasConflict, true);
  assert.equal(grid.items[1].columns, 2);
  assert.notEqual(grid.items[1].column, grid.items[2].column);
  assert.equal(grid.items[3].columns, 1);
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
    "本阶段已结束",
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
