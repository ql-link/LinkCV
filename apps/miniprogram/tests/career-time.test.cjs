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
test('picker cancel does not confirm and minute 59 is retained',()=>{
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
    picker.close();assert.deepEqual(events,[{name:'close',detail:undefined}]);
    picker.rollStart();picker.confirm();assert.equal(events.length,1);
    picker.changeTime({detail:{value:[0,59]}});picker.rollEnd();picker.confirm();
    assert.deepEqual(events[1],{name:'confirm',detail:{date:'2026-12-31',time:'00:59'}});
  }finally{global.Component=old;}
});
