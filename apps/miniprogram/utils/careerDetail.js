const c = require("./career");
const value = (v) => (typeof v === "string" ? v.trim() : "");
function jobContent(app) {
  const j = app.job_snapshot || {};
  const facts = (rows) =>
    rows
      .map(([label, v]) => ({ label, value: value(v) }))
      .filter((r) => r.value);
  const source = value(j.source_url);
  return {
    salary: value(j.salary_text),
    city: value(j.work_city) || value(j.location),
    employment: c.applicationView(app).employmentLabel,
    description: value(j.description),
    skills: Array.isArray(j.skills)
      ? j.skills.filter((v) => value(v))
      : value(j.skills)
        ? [j.skills]
        : [],
    requirements: facts([
      ["学历要求", j.education_requirement],
      ["经验要求", j.experience_requirement],
      [
        "工作方式",
        { onsite: "现场办公", remote: "远程办公", hybrid: "混合办公" }[
          j.work_mode
        ] || j.work_mode,
      ],
      ["工作安排", j.work_schedule],
      ["详细地址", j.work_address],
    ]),
    company: facts([
      ["所属行业", j.company_industry],
      ["公司规模", j.company_size],
      ["融资阶段", j.company_financing_stage],
      [
        "招聘者",
        [j.recruiter_name, j.recruiter_title].filter(Boolean).join(" · "),
      ],
    ]),
    companyDescription: value(j.company_description),
    source: facts([
      ["来源平台", j.source_site],
      [
        "收录方式",
        {
          manual: "手工录入",
          extension: "插件采集",
          text: "文字导入",
          image: "图片导入",
        }[j.source_type] || j.source_type,
      ],
    ]),
    sourceUrl: /^https?:\/\//i.test(source) ? source : "",
  };
}
// Same journey projection as Web CareerDetailViews.buildJourneyStages.
function progress(app, sessions = []) {
  const stage = {...((app.stages || []).find(s => s.id === app.current_stage?.id) || {}), ...(app.current_stage || {})};
  const legacy = app.current_stage_type || stage.stage_type;
  const rawLabel = (stage.stage_label || app.current_stage_label || '').trim();
  const type = stage.stage_type || (legacy === 'hr' ? 'interview' : legacy === 'screening' ? (rawLabel.includes('笔试') ? 'written_test' : rawLabel.includes('测评') || /assessment/i.test(rawLabel) ? 'assessment' : 'screening') : legacy);
  const active = app.lifecycle_status !== 'terminated' && (app.status || 'active') === 'active' && !app.archived_at;
  const pending = active && (app.phase || (app.applied_at || app.current_stage || legacy && legacy !== 'screening' ? 'applied' : 'pending')) === 'pending';
  const waiting = active && app.stage_state === 'awaiting_result' && ['interview','ai_interview'].includes(type);
  const offerLabel = app.offer_status === 'none' ? 'Offer 状态待确认' : app.offer_status === 'declined' ? '已主动结束' : '已收到 Offer';
  const label = type === 'offer' ? offerLabel : stage.stage_label || (legacy === 'screening' && type === 'screening' ? '筛选中' : rawLabel.replace(/^(笔试|测评)中$/, '$1')) || '当前阶段';
  const nodes = [{id:'imported',label:'岗位已导入',date:c.shortDate(app.created_at),state:'done'}];
  if(pending) nodes.push({id:'pending',label:'待投递',date:'等待确认投递',state:'current'});
  else {
    if(app.applied_at) nodes.push({id:'applied',label:'已投递',date:c.shortDate(app.applied_at),state:'done'});
    let hasCurrent = false;
    for(const session of [...sessions].sort((a,b)=>new Date(a.start_at)-new Date(b.start_at))) {
      const isCurrent = stage.id && session.application_stage_id
        ? stage.id === session.application_stage_id
        : legacy === 'screening' && session.stage_type === 'other'
          ? rawLabel === (session.stage_label || '').trim()
          : legacy === session.stage_type && (legacy === 'interview' ? app.current_round_no === session.round_no : rawLabel === (session.stage_label || '').trim());
      if(isCurrent) hasCurrent = true;
      nodes.push({id:'session-'+session.id,label:isCurrent && (type === 'offer' || legacy === 'screening' && session.stage_type === 'other') ? label : session.stage_label,date:c.shortDate(session.start_at),state:session.status === 'cancelled' ? 'cancelled' : session.status === 'completed' || isCurrent && waiting ? 'done' : isCurrent ? 'current' : 'pending'});
    }
    if(!hasCurrent) nodes.push({id:stage.id || 'current',label,date:c.shortDate(app.updated_at || stage.entered_at || stage.created_at),state:waiting?'done':'current'});
    if(type === 'offer' && app.offer_status !== 'none' && app.offer_status !== 'declined') {
      const current=nodes.find(n=>n.state==='current');if(current)current.state='offer';
    }
    if(app.status && app.status !== 'active' && app.offer_status !== 'accepted') {
      for(const state of ['current','offer']) {const node=nodes.find(n=>n.state===state);if(node)node.state='ended';}
    }
  }
  return nodes.map(n=>({...n,done:n.state==='done'}));
}
module.exports = { jobContent, progress };
