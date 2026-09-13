const test=require('node:test');
const assert=require('node:assert/strict');
const t=require('../utils/careerTime');
test('calendar starts Monday, includes leap day, and rolls over years',()=>{
  const days=t.monthDays('2028-02','2028-02-29');
  assert.equal(days.length,42);assert.equal(days[0].value,'2028-01-31');
  assert.equal(days.filter(d=>d.selected).length,1);assert.equal(days.find(d=>d.selected).day,29);
  assert.equal(t.shiftMonth('2026-12',1),'2027-01');assert.equal(t.shiftMonth('2026-01',-1),'2025-12');
});
test('duration preserves the draft, handles midnight, and rejects invalid input',()=>{
  const form={startDate:'2026-12-31',startTime:'23:59'};
  assert.deepEqual(t.withDuration(form,1),{...form,endDate:'2027-01-01',endTime:'00:00'});
  assert.equal(form.endDate,undefined);
  for(const value of ['0','-1','1.5','abc',''])assert.throws(()=>t.withDuration(form,value));
});
test('picker cancel does not confirm and minute 59 is retained',async()=>{
  const old=global.Component;let definition;
  try{
    global.Component=d=>definition=d;require('../components/career-time-picker/index');
    const events=[];const picker={...definition.methods,data:structuredClone(definition.data),properties:{date:'2026-12-31',time:'23:59'},setData(d){Object.assign(this.data,d);},triggerEvent(name,detail){events.push({name,detail});}};
    definition.lifetimes.attached.call(picker);assert.deepEqual(picker.data.wheel,[23,59]);
    assert.equal(picker.data.weeks.length,6);
    assert.ok(picker.data.weeks.every(week=>week.days.length===7));
    assert.deepEqual(picker.data.weeks.flatMap(week=>week.days),picker.data.days);
    assert.equal(picker.data.selectedLabel,'12月31日');
    picker.navigate({currentTarget:{dataset:{delta:1}}});
    assert.equal(picker.data.monthLabel,'2027年1月');
    assert.equal(picker.data.selectedLabel,'12月31日');
    picker.rollStart();picker.confirm();assert.equal(events.length,0);
    picker.changeTime({detail:{value:[0,59]}});picker.rollEnd();picker.confirm();
    assert.deepEqual(events[0],{name:'confirm',detail:{date:'2026-12-31',time:'00:59'}});
    picker.close();picker.close();
    assert.equal(picker.data.closing,true);assert.equal(events.length,1);
    await new Promise(resolve=>setTimeout(resolve,270));
    assert.deepEqual(events[1],{name:'close',detail:undefined});
    assert.equal(events.length,2);
  }finally{global.Component=old;}
});

test('time picker edits duration locally and returns it only on confirmation', async () => {
  const previous = global.Component;
  const modulePath = require.resolve('../components/career-time-picker/index');
  let definition;
  try {
    global.Component = value => { definition = value; };
    delete require.cache[modulePath];
    require(modulePath);
    const events=[];
    const picker={...definition.methods,data:structuredClone(definition.data),properties:{showDuration:true,duration:'60',date:'2026-09-10',time:'23:30'},setData(data){Object.assign(this.data,data);},triggerEvent(name,detail){events.push({name,detail});}};
    definition.lifetimes.attached.call(picker);
    picker.selectDuration({currentTarget:{dataset:{minutes:'90'}}});
    assert.equal(events.length,0);
    assert.equal(picker.properties.duration,'60');
    picker.confirm();
    assert.deepEqual(events[0],{name:'confirm',detail:{date:'2026-09-10',time:'23:30',duration:'90'}});
    picker.selectDuration({currentTarget:{dataset:{minutes:'custom'}}});
    picker.pressDurationKey({currentTarget:{dataset:{key:'4'}}});
    picker.pressDurationKey({currentTarget:{dataset:{key:'5'}}});
    picker.confirm();
    assert.equal(events.length,1);
    picker.confirmDuration();
    await new Promise(resolve=>setTimeout(resolve,270));
    assert.equal(picker.data.durationEditorOpen,false);
    picker.confirm();
    assert.equal(events[1].detail.duration,'45');
    picker.selectDuration({currentTarget:{dataset:{minutes:'custom'}}});
    picker.pressDurationKey({currentTarget:{dataset:{key:'清空'}}});
    picker.pressDurationKey({currentTarget:{dataset:{key:'9'}}});
    picker.cancelDuration();
    await new Promise(resolve=>setTimeout(resolve,270));
    assert.equal(picker.data.duration,'45');
    assert.equal(events.length,2);
    picker.changeTime({currentTarget:{dataset:{part:'hour'}},detail:{value:[22]}});
    picker.changeTime({currentTarget:{dataset:{part:'minute'}},detail:{value:[59]}});
    assert.equal(picker.data.timeLabel,'22:59');
    assert.match(picker.data.summary,/23:44/);
    definition.lifetimes.detached.call(picker);
  } finally { global.Component=previous; delete require.cache[modulePath]; }
});
