const test = require('node:test');
const assert = require('node:assert/strict');
const current = {id:'1',phase:'applied',status:'active',lifecycle_status:'active',archived_at:null,stage_state:'awaiting_result',applied_at:'2026-09-01T01:00:00Z',lock_version:1,current_stage:{id:'s1',stage_type:'interview',stage_label:'技术一面'},company_name_snapshot:'示例科技',job_title_snapshot:'前端工程师',job_snapshot:{}};
async function withSheet(api, run, confirm=true) {
  const key=require.resolve('../components/schedule-sheet/index');
  const apiKey=require.resolve('../services/career'), authKey=require.resolve('../services/auth');
  const old={api:require.cache[apiKey],auth:require.cache[authKey],wx:global.wx,Component:global.Component};
  require.cache[apiKey]={exports:{addStage:async()=>({application:{...current,stage_state:'awaiting_schedule',current_stage:{id:'s2',stage_type:'interview',stage_label:'技术二面'}}}),...api}}; require.cache[authKey]={exports:{hasSession:()=>true}};
  let definition;const events=[];
  global.Component=d=>{definition=d;};
  global.wx={showToast(){},enableAlertBeforeUnload(){},disableAlertBeforeUnload(){},showModal:({success})=>success({confirm}),navigateBack(){throw new Error('The sheet must not navigate away');}};
  try {
    delete require.cache[key];const {scheduleMode}=require(key);
    const sheet={...definition.methods,data:structuredClone(definition.data),properties:{date:'2026-09-08'},setData(data){Object.assign(this.data,data);},triggerEvent(name,detail){events.push({name,detail});}};
    sheet.data.loading = false;
    await run(sheet,events,scheduleMode);
  } finally {
    delete require.cache[key];if(old.api)require.cache[apiKey]=old.api;else delete require.cache[apiKey];if(old.auth)require.cache[authKey]=old.auth;else delete require.cache[authKey];global.wx=old.wx;global.Component=old.Component;
  }
}
function times(sheet){sheet.data.form={...sheet.data.form,stageLabel:'技术二面',startDate:'2026-09-08',startTime:'10:00',endDate:'2026-09-08',endTime:'11:00'};}
test('schedule sheet lists only eligible flows across pagination and filters by company',async()=>{
  let calls=0;
  await withSheet({listApplications:async()=>++calls===1?{items:[current,{...current,id:'2',stage_state:'scheduled'}],next_cursor:'next'}:{items:[{...current,id:'3',stage_state:'awaiting_schedule'},{...current,id:'4',lifecycle_status:'terminated'}]}},async sheet=>{
    await sheet.loadApplications();assert.deepEqual(sheet.data.applications.map(a=>a.id),['1']);
    sheet.search({detail:{value:'不存在'}});assert.equal(sheet.data.filtered.length,0);
    sheet.search({detail:{value:'前端'}});assert.equal(sheet.data.filtered.length,1);
  });
});
test('eligibility excludes pending, archived and Offer flows',async()=>{
  await withSheet({},async(_,__,mode)=>{
    assert.equal(mode(current),'stage');
    assert.equal(mode({...current,stage_state:'awaiting_schedule'}),null);
    assert.equal(mode({...current,stage_state:'scheduled'}),null);
    assert.equal(mode({...current,applied_at:null}),null);
    assert.equal(mode({...current,current_stage:{stage_type:'screening',stage_label:'筛选中'}}),'stage');
    assert.equal(mode({...current,phase:'pending',stage_state:'awaiting_result'}),null);
    assert.equal(mode({...current,archived_at:'2026-01-01'}),null);
    assert.equal(mode({...current,current_stage:{stage_type:'offer'}}),null);
  });
});
test('select rechecks current stage and missing times never write',async()=>{
  let writes=0;
  await withSheet({getApplication:async()=>({application:current}),createSession:async()=>writes++},async sheet=>{
    await sheet.selectApplication({currentTarget:{dataset:{id:'1'}}});
    assert.equal(sheet.data.mode,'stage');assert.equal(sheet.data.form.startDate,'2026-09-08');
    await sheet.save();assert.equal(writes,0);assert.match(sheet.data.error,/完整填写/);assert.equal(sheet.data.submissionStarted,false);
  });
});
test('selection rejects a flow that changed to awaiting schedule and never writes',async()=>{
  let writes=0;
  await withSheet({getApplication:async()=>({application:{...current,stage_state:'awaiting_schedule'}}),addStage:async()=>writes++,createSession:async()=>writes++},async(sheet,events)=>{
    await sheet.selectApplication({currentTarget:{dataset:{id:'1'}}});
    assert.equal(sheet.data.choosing,true);assert.ok(sheet.data.error);
    await sheet.save();assert.equal(writes,0);assert.equal(events.length,0);
  });
});
test('new schedule appends the next stage before creating its session',async()=>{
  const calls=[];
  await withSheet({getApplication:async()=>({application:current}),addStage:async(_,payload)=>{calls.push(['stage',payload]);return {application:{...current,stage_state:'awaiting_schedule',current_stage:{id:'s2',stage_type:'interview',stage_label:'技术二面'}}};},createSession:async(_,payload)=>{calls.push(['session',payload]);return {};}},async(sheet,events)=>{
    await sheet.selectApplication({currentTarget:{dataset:{id:'1'}}});times(sheet);await sheet.save();
    assert.deepEqual(calls.map(c=>c[0]),['stage','session']);assert.equal(calls[0][1].stage_label,'技术二面');
    assert.equal(calls[1][1].application_stage_id,'s2');assert.equal(events[0].name,'saved');
  });
});
test('partial stage success retries only the schedule using stable request IDs',async()=>{
  let stages=0,sessions=0;const ids=[];
  await withSheet({getApplication:async()=>({application:{...current,stage_state:'awaiting_result'}}),addStage:async()=>{stages++;return {application:{...current,lock_version:2,current_stage:{id:'s2',stage_type:'interview',stage_label:'技术二面'}}};},createSession:async(_,p)=>{ids.push(p.client_request_id);if(++sessions===1)throw new Error('NETWORK');return {};}},async(sheet,events)=>{
    await sheet.selectApplication({currentTarget:{dataset:{id:'1'}}});times(sheet);await sheet.save();
    assert.match(sheet.data.partial,/阶段已保存/);assert.equal(events.length,0);
    sheet.input({currentTarget:{dataset:{field:'startTime'}},detail:{value:'12:00'}});assert.equal(sheet.data.form.startTime,'10:00');
    await sheet.save();assert.equal(stages,1);assert.equal(sessions,2);assert.equal(ids[0],ids[1]);assert.equal(events[0].name,'saved');
  });
});
test('rejecting overlap confirmation does not submit allow_conflict',async()=>{
  const payloads=[];
  await withSheet({getApplication:async()=>({application:current}),createSession:async(_,p)=>{payloads.push(p);throw new Error('INTERVIEW_TIME_CONFLICT');}},async sheet=>{
    await sheet.selectApplication({currentTarget:{dataset:{id:'1'}}});times(sheet);await sheet.save();assert.equal(payloads.length,1);assert.equal(payloads[0].allow_conflict,undefined);
  },false);
});
test('rejecting discard keeps the sheet and its draft open',async()=>{
  await withSheet({},async(sheet,events)=>{sheet._dirty=true;sheet.data.choosing=false;await sheet.close();await sheet.changeApplication();assert.equal(events.length,0);assert.equal(sheet.data.choosing,false);},false);
});

test('time selection keeps cancelled edits out of the schedule payload',async()=>{
  let payload;
  await withSheet({getApplication:async()=>({application:current}),createSession:async(_,data)=>{payload=data;return {};}},async sheet=>{
    await sheet.selectApplication({currentTarget:{dataset:{id:'1'}}});times(sheet);
    sheet.openTimeEditor({currentTarget:{dataset:{target:'range'}}});
    sheet.editTimeDraft({currentTarget:{dataset:{field:'startDate'}},detail:{value:'2026-09-10'}});
    sheet.cancelTimeEditor();await sheet.save();
    assert.equal(new Date(payload.start_at).toISOString(),'2026-09-08T02:00:00.000Z');
  });
});
test('combined time range rejects reversed times and saves a cross-day range',async()=>{
  let payload;
  await withSheet({getApplication:async()=>({application:current}),createSession:async(_,data)=>{payload=data;return {};}},async sheet=>{
    await sheet.selectApplication({currentTarget:{dataset:{id:'1'}}});
    sheet.input({currentTarget:{dataset:{field:'stageLabel'}},detail:{value:'技术二面'}});
    sheet.openTimeEditor({currentTarget:{dataset:{target:'range'}}});
    const edit=(field,value)=>sheet.editTimeDraft({currentTarget:{dataset:{field}},detail:{value}});
    edit('startTime','23:30');edit('endTime','00:30');sheet.confirmTimeEditor();
    assert.match(sheet.data.timeError,/结束时间必须晚于/);
    edit('endDate','2026-09-09');sheet.confirmTimeEditor();await sheet.save();
    assert.equal(new Date(payload.start_at).toISOString(),'2026-09-08T15:30:00.000Z');
    assert.equal(new Date(payload.end_at).toISOString(),'2026-09-08T16:30:00.000Z');
  });
});

test('calendar confirmation and duration buttons submit a cross-midnight schedule',async()=>{
  let payload;
  await withSheet({getApplication:async()=>({application:current}),createSession:async(_,data)=>{payload=data;return {};}},async sheet=>{
    await sheet.selectApplication({currentTarget:{dataset:{id:'1'}}});
    sheet.input({currentTarget:{dataset:{field:'stageLabel'}},detail:{value:'技术二面'}});
    sheet.chooseDateTime({currentTarget:{dataset:{target:'start'}}});
    sheet.acceptDateTime({detail:{date:'2026-12-31',time:'23:45'}});
    assert.equal(sheet.data.form.endDate,'2027-01-01');
    assert.equal(sheet.data.form.endTime,'00:45');
    sheet.selectDuration({currentTarget:{dataset:{minutes:30}}});
    assert.equal(sheet.data.form.endTime,'00:15');
    sheet.inputDuration({detail:{value:'45'}});
    await sheet.save();assert.equal(new Date(payload.end_at)-new Date(payload.start_at),45*60000);
  });
});
test('invalid custom duration prevents writes and switching stage restores derived end time',async()=>{
  let writes=0;
  await withSheet({getApplication:async()=>({application:current}),addStage:async()=>writes++},async sheet=>{
    await sheet.selectApplication({currentTarget:{dataset:{id:'1'}}});times(sheet);
    sheet.inputDuration({detail:{value:'0'}});await sheet.save();assert.equal(writes,0);assert.match(sheet.data.error,/整数分钟/);
    sheet.selectDuration({currentTarget:{dataset:{minutes:90}}});
    sheet.selectType({currentTarget:{dataset:{type:'assessment'}}});assert.equal(sheet.data.form.endDate,'2026-09-11');
    sheet.selectType({currentTarget:{dataset:{type:'interview'}}});assert.equal(sheet.data.form.endTime,'11:30');assert.equal(sheet.data.form.endDate,'2026-09-08');
  });
});
