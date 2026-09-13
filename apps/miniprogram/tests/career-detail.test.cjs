const test = require("node:test"),
  assert = require("node:assert/strict");
const { jobContent, progress } = require("../utils/careerDetail");
test("job snapshot uses backend fields and hides absent data", () => {
  const job = jobContent({
    job_snapshot: {
      work_city: "上海",
      education_requirement: "本科",
      experience_requirement: "3年",
      description: "完整原文\n岗位要求",
      skills: ["React"],
      source_url: "javascript:alert(1)",
    },
  });
  assert.equal(job.city, "上海");
  assert.equal(job.description, "完整原文\n岗位要求");
  assert.deepEqual(
    job.requirements.map((r) => r.label),
    ["学历要求", "经验要求"],
  );
  assert.equal(job.sourceUrl, "");
  assert.deepEqual(job.company, []);
});
test("progress uses actual stage entry dates and keeps current stage distinct", () => {
  const result = progress({
    current_stage: { id: "2" },
    stages: [
      { id: "1", stage_label: "筛选中", entered_at: "2026-08-28T01:00:00Z" },
      { id: "2", stage_label: "技术二面", entered_at: "2026-09-08T01:00:00Z" },
    ],
  }, [{id:"old",application_stage_id:"1",stage_label:"筛选中",start_at:"2026-08-28T01:00:00Z",status:"completed"}]);
  assert.equal(result[1].date, "8月28日");
  assert.equal(result[0].done, true);
  assert.equal(result[2].done, false);
});
async function sessionSheet(session, run) {
  const key = require.resolve("../components/session-sheet/index"),
    apiKey = require.resolve("../services/career"),
    authKey = require.resolve("../services/auth");
  const prev = {
    api: require.cache[apiKey],
    auth: require.cache[authKey],
    Component: global.Component,
    wx: global.wx,
  };
  let def;
  const calls = [];
  global.Component = (d) => (def = d);
  global.wx = {
    showModal: ({ success }) => success({ confirm: true }),
    navigateTo: (x) => calls.push(x.url),
    showToast: () => {},
  };
  require.cache[authKey] = { exports: { hasSession: () => true } };
  require.cache[apiKey] = {
    exports: {
      getSession: async () => ({
        application: { id: "a", lifecycle_status: "active" },
        session,
      }),
      completeSession: async (id, p) => calls.push({ id, p }),
      updateSession: async (id, payload) => { calls.push({id, payload}); Object.assign(session, payload, {lock_version: session.lock_version + 1}); },
    },
  };
  try {
    delete require.cache[key];
    require(key);
    const instance = {
      ...def.methods,
      data: structuredClone(def.data),
      properties: { sessionId: session.id },
      setData(x) {
        Object.assign(this.data, x);
      },
      triggerEvent(...x) {
        calls.push(x);
      },
    };
    await instance.load();
    await run(instance, calls);
  } finally {
    delete require.cache[key];
    for (const [k, v] of [
      [apiKey, prev.api],
      [authKey, prev.auth],
    ]) {
      if (v) require.cache[k] = v;
      else delete require.cache[k];
    }
    global.Component = prev.Component;
    global.wx = prev.wx;
  }
}
test("completed session retains review access but cannot be completed again", async () => {
  await sessionSheet(
    {
      id: "9",
      status: "completed",
      start_at: "2026-09-08T01:00:00Z",
      end_at: "2026-09-08T02:00:00Z",
      review_summary: "复盘",
    },
    async (s, calls) => {
      assert.equal(s.data.editable, false);
      assert.equal(s.data.hasRecord, true);
      await s.complete();
      assert.equal(calls.length, 0);
      s.openForm({ currentTarget: { dataset: { mode: "record" } } });
      assert.equal(s.data.recordEditing, true);
      assert.equal(s.data.recordForm.review, "复盘");
      assert.equal(calls.length, 0, "records open in the existing sheet without navigation");
    },
  );
});
test("marking session ended uses its version and refreshes the source without advancing", async () => {
  await sessionSheet(
    {
      id: "9",
      status: "scheduled",
      lock_version: 7,
      start_at: "2026-09-08T01:00:00Z",
      end_at: "2026-09-08T02:00:00Z",
    },
    async (s, calls) => {
      await s.complete();
      assert.deepEqual(calls[0], { id: "9", p: { base_lock_version: 7 } });
      assert.deepEqual(calls[1], ["changed"]);
    },
  );
});


test("one interview stage retains imported and applied milestones", () => {
  const nodes = progress({ created_at: "2026-09-01T01:00:00Z", applied_at: "2026-09-04T01:00:00Z", current_stage: {id: "s1"}, stages: [{id: "s1",stage_label: "技术一面", entered_at: "2026-09-08T01:00:00Z"}] });
  assert.deepEqual(nodes.map(n=>n.label), ["岗位已导入", "已投递", "技术一面"]);
  assert.deepEqual(nodes.map(n=>n.done), [true, true, false]);
  assert.deepEqual(nodes.map(n=>n.date), ["9月1日", "9月4日", "9月8日"]);
});
test("pending application shows imported milestone and pending action", () => {
  const nodes = progress({created_at: "2026-09-08T01:00:00Z", stages: []});
  assert.deepEqual(nodes.map(n=>n.label), ["岗位已导入", "待投递"]);
  assert.deepEqual(nodes.map(n=>n.done), [true, false]);
});

for(const [status,legacyStatus,label,state] of [
  ['received','active','已收到 Offer','offer'],
  ['accepted','closed','已收到 Offer','offer'],
  ['none','active','Offer 状态待确认','current'],
  ['declined','closed','已主动结束','ended'],
]) {
  test(`journey follows Web for Offer ${status}`,()=>{
    const app={status:legacyStatus,offer_status:status,current_stage_type:'offer',current_stage:{id:'offer',stage_type:'offer',stage_label:'Offer'},applied_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-08T00:00:00Z'};
    const nodes=progress(app,[{id:'old',application_stage_id:'interview',stage_type:'interview',stage_label:'技术终面',status:'completed',start_at:'2026-09-06T00:00:00Z'}]);
    assert.equal(nodes.at(-1).label,label);
    assert.equal(nodes.at(-1).state,state);
    assert.equal(nodes.at(-2).state,'done');
    assert.deepEqual(nodes.map(n=>n.label),['岗位已导入','已投递','技术终面',label]);
  });
}
test('journey distinguishes completed and cancelled sessions and uses scheduled date',()=>{
  const nodes=progress({status:'active',stage_state:'awaiting_result',current_stage_type:'interview',current_stage:{id:'s2',stage_type:'interview',stage_label:'二面'},applied_at:'2026-09-01T00:00:00Z'},[
    {id:'2',application_stage_id:'s2',stage_label:'二面',status:'completed',start_at:'2026-09-08T00:00:00Z'},
    {id:'1',application_stage_id:'s1',stage_label:'一面',status:'cancelled',start_at:'2026-09-02T00:00:00Z'},
  ]);
  assert.deepEqual(nodes.slice(2).map(n=>n.state),['cancelled','done']);
  assert.equal(nodes.at(-1).date,'9月8日');
});


test('inline records save three fields with the session version and remain on the current page', async () => {
  await sessionSheet({id:'9',status:'completed',lock_version:4,start_at:'2026-09-08T01:00:00Z',end_at:'2026-09-08T02:00:00Z'}, async (s,calls) => {
    s.openForm();
    s.inputRecord({currentTarget:{dataset:{field:'record'}},detail:{value:' 问题与回答 '}});
    assert.equal(s.data.recordDirty,true);
    await s.saveRecord();
    assert.deepEqual(calls[0],{id:'9',payload:{base_lock_version:4,questions_markdown:'问题与回答',review_summary:null,improvement_markdown:null}});
    assert.equal(s.data.recordEditing,false);
    assert.equal(s.data.session.lock_version,5);
    assert.equal(s.data.session.status,'completed');
    assert.deepEqual(calls[1],['changed']);
  });
});

test('inline record save failure preserves the draft and cancelling can keep editing', async () => {
  await sessionSheet({id:'9',status:'scheduled',lock_version:4,start_at:'2026-09-08T01:00:00Z',end_at:'2026-09-08T02:00:00Z'}, async s => {
    s.openForm();
    s.inputRecord({currentTarget:{dataset:{field:'review'}},detail:{value:'保留草稿'}});
    require('../services/career').updateSession = async () => { throw new Error('network failed'); };
    await s.saveRecord();
    assert.equal(s.data.recordForm.review,'保留草稿');
    assert.equal(s.data.recordEditing,true);
    assert.equal(s.data.saving,false);
    global.wx.showModal = ({success}) => success({confirm:false});
    await s.cancelRecord();
    assert.equal(s.data.recordEditing,true);
    await s.close();
    assert.notEqual(s._closing,true);
  });
});
