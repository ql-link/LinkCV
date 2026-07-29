import { describe, expect, it } from "vitest";

import { extractBossJob, isBossJobUrl } from "./boss";

function page(body: string): Document {
  document.body.innerHTML = body;
  return document;
}

describe("BOSS detail extraction", () => {
  it("extracts the detail card instead of a recommendation card", () => {
    const result = extractBossJob(
      page(`
        <section class="job-banner">
          <div class="job-primary">
            <div class="name"><h1>高级 Python 工程师</h1><span class="salary">20-35K·14薪</span></div>
            <p><a>上海</a><em class="vline"></em>3-5年<em class="vline"></em>本科</p>
          </div>
        </section>
        <aside class="sider-company">
          <div class="company-info">
            <h3><a title="示例科技">示例科技</a></h3>
            <ul class="company-tag-list"><li>B轮</li><li>100-499人</li><li>企业服务</li></ul>
          </div>
        </aside>
        <div class="job-detail">
          <div class="job-tags"><span>Python</span><span>FastAPI</span><span>双休</span></div>
          <div class="job-sec-text">职位描述\n负责服务端接口开发。\n任职要求\n熟悉 Python。</div>
          <div class="location-address">上海市浦东新区示例路 1 号</div>
        </div>
        <div class="recommend-list"><div class="job-card"><div class="job-sec-text">推荐列表里很长但不属于当前岗位的描述文本。</div></div></div>
        <div class="boss-info-attr"><span class="name">王女士</span> · 招聘经理</div>
      `),
      "https://www.zhipin.com/job_detail/abc_123.html?ka=detail",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture).toMatchObject({
      job_title: "高级 Python 工程师",
      company_name: "示例科技",
      description_text: "职位描述\n负责服务端接口开发。\n任职要求\n熟悉 Python。",
      salary_text: "20-35K·14薪",
      work_city: "上海",
      experience_text: "3-5年",
      education_text: "本科",
      work_address: "上海市浦东新区示例路 1 号",
      company_size: "100-499人",
      company_financing_stage: "B轮",
      company_industry: "企业服务",
      recruiter_name: "王女士",
      recruiter_title: "招聘经理",
    });
    expect(result.capture.skills).toEqual(["Python", "FastAPI"]);
    expect(result.capture.company_tags).toEqual(["B轮", "100-499人", "企业服务"]);
  });

  it("returns an actionable incomplete result when required detail is absent", () => {
    const result = extractBossJob(
      page(`<h1>后端工程师</h1><div class="company-info"><h3><a title="示例公司">示例公司</a></h3></div>`),
      "https://www.zhipin.com/job_detail/abc.html",
    );

    expect(result).toMatchObject({ ok: false, error: "CAPTURE_INCOMPLETE" });
  });

  it("separates internship schedule and benefits from experience and skills", () => {
    const result = extractBossJob(
      page(`
        <section class="job-banner">
          <div class="job-primary">
            <div class="name"><h1>Java实习岗</h1><span class="salary">200-300元/天</span></div>
            <p><a>杭州</a><em class="vline"></em><span class="job-experience">5天/周 6个月</span><em class="vline"></em><span class="text-degree">本科</span></p>
          </div>
        </section>
        <aside class="sider-company"><div class="company-info"><h3><a title="示例机器人">示例机器人</a></h3></div></aside>
        <div class="job-detail">
          <div class="job-tags">
            <span>生日福利</span><span>高温补贴</span><span>员工旅游</span><span>全勤奖</span>
            <span>Java</span><span>Hibernate</span><span>团队管理</span>
          </div>
          <div class="job-sec-text">职位描述\n负责 Java 服务端开发、接口维护、数据库设计并参与团队协作和代码评审。</div>
        </div>
      `),
      "https://www.zhipin.com/job_detail/intern42.html",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.experience_text).toBeUndefined();
    expect(result.capture.work_schedule_text).toBe("5天/周 6个月");
    expect(result.capture.employment_type_text).toBe("Java实习岗");
    expect(result.capture.skills).toEqual(["Java", "Hibernate", "团队管理"]);
  });

  it("extracts the selected job from the list page detail pane", () => {
    const result = extractBossJob(
      page(`
        <main class="job-list-wrapper">
          <section class="job-list-box">
            <article class="job-card-box active">
              <a href="/job_detail/java-nanjing-001.html">
                <strong class="job-name">Java</strong><span class="salary">10-11K</span>
                <span class="company-name">北京轩格科技有限公司</span>
                <span class="job-area">南京·鼓楼区</span>
              </a>
            </article>
            <article class="job-card-box">
              <a href="/job_detail/java-other-002.html">
                <strong class="job-name">Java 高级开发工程师</strong>
                <span class="company-name">其他公司</span>
                <div class="job-sec-text">推荐岗位的描述不应进入当前岗位。</div>
              </a>
            </article>
          </section>
          <section class="job-detail-container">
            <header class="job-detail-header">
              <h2 class="job-title">Java</h2><span class="salary">10-11K</span>
              <div class="job-info"><span>南京</span><span>5-10年</span><span>本科</span></div>
            </header>
            <div class="job-tags"><span>JVM</span><span>Java</span><span>MySQL</span></div>
            <div class="job-detail">
              <div class="job-sec-text">职位描述\n岗位职责：负责业务系统设计与开发。\n任职要求：熟悉 Java 和 MySQL。</div>
            </div>
            <div class="recommend-list">
              <a class="job-card" href="/job_detail/recommended-003.html"><span class="job-name">推荐 Java 岗位</span></a>
            </div>
          </section>
        </main>
      `),
      "https://www.zhipin.com/web/geek/jobs?ka=header-jobs",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceUrl).toBe("https://www.zhipin.com/job_detail/java-nanjing-001.html");
    expect(result.capture).toMatchObject({
      job_title: "Java",
      company_name: "北京轩格科技有限公司",
      description_text: "职位描述\n岗位职责：负责业务系统设计与开发。\n任职要求：熟悉 Java 和 MySQL。",
      salary_text: "10-11K",
      work_city: "南京",
      experience_text: "5-10年",
      education_text: "本科",
    });
    expect(result.capture.skills).toEqual(["JVM", "Java", "MySQL"]);
    expect(result.capture.description_text).not.toContain("推荐岗位");
  });

  it("rejects a list page when the selected job source cannot be identified", () => {
    const result = extractBossJob(
      page(`
        <section class="job-detail-container">
          <header class="job-detail-header"><h2 class="job-title">Java</h2><span class="salary">10-11K</span></header>
          <div class="company-name">示例公司</div>
          <div class="job-sec-text">职位描述\n负责业务系统设计与开发，并完成代码评审和单元测试。</div>
        </section>
      `),
      "https://www.zhipin.com/web/geek/jobs?ka=header-jobs",
    );

    expect(result).toMatchObject({
      ok: false,
      error: "CAPTURE_INCOMPLETE",
      message: expect.stringContaining("来源 ID"),
    });
  });

  it("uses the selected card data job id when the list does not expose a detail link", () => {
    const result = extractBossJob(
      page(`
        <section class="job-list-box">
          <article class="job-card-box selected" data-jobid="selected_data_123">
            <strong class="job-name">数据工程师</strong><span class="company-name">示例数据公司</span>
          </article>
        </section>
        <section class="job-detail-container">
          <header class="job-detail-header"><h2 class="job-title">数据工程师</h2></header>
          <div class="job-sec-text">职位描述\n负责数据平台研发、任务调度、数据质量建设以及生产环境问题排查。</div>
        </section>
      `),
      "https://www.zhipin.com/web/geek/jobs",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceUrl).toBe("https://www.zhipin.com/job_detail/selected_data_123.html");
    expect(result.capture.company_name).toBe("示例数据公司");
  });

  it("does not bind the visible detail to a stale selected card id", () => {
    const result = extractBossJob(
      page(`
        <section class="job-list-box">
          <article class="job-card-box selected" data-jobid="stale-python-id">
            <strong class="job-name">Python 工程师</strong><span class="company-name">示例甲公司</span>
          </article>
          <article class="job-card-box">
            <a href="/job_detail/current-java-id.html">
              <strong class="job-name">Java 工程师</strong><span class="company-name">示例乙公司</span>
            </a>
          </article>
        </section>
        <section class="job-detail-container">
          <header class="job-detail-header"><h2 class="job-title">Java 工程师</h2></header>
          <div class="company-name">示例乙公司</div>
          <div class="job-sec-text">职位描述\n负责 Java 服务端开发、单元测试、代码评审以及线上问题排查。</div>
        </section>
      `),
      "https://www.zhipin.com/web/geek/jobs",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceUrl).toBe("https://www.zhipin.com/job_detail/current-java-id.html");
  });

  it("uses semantic anchors for the current BOSS list layout", () => {
    const result = extractBossJob(
      page(`
        <main class="search-layout">
          <ul class="job-list">
            <li>
              <a href="/job_detail/current-java-001.html">Java</a>
              <a href="/gongsi/example-company.html">南京示例科技有限公司</a>
            </li>
            <li>
              <a href="/job_detail/another-java-002.html">Java</a>
              <a href="/gongsi/another-company.html">其他公司</a>
            </li>
          </ul>
          <aside class="user-center-job-detail-box">
            <header class="job-detail-header">
              <div class="job-detail-info"><span class="job-name">Java</span><span class="job-salary">\uE032\uE031-\uE032\uE032K</span></div>
              <ul class="tag-list"><li>南京</li><li>5-10年</li><li>本科</li></ul>
            </header>
            <div class="job-detail-body">
              <h3 class="title">职位描述</h3>
              <ul class="job-label-list"><li>JVM</li><li>Java</li><li>MySQL</li></ul>
              <div class="desc">岗位职责：参与业务系统的需求分析和设计；负责系统功能开发、调试和单元测试。\n任职要求：统招本科及以上学历，具有五年 Java 开发经验。</div>
              <section class="job-boss-info">
                <h2 class="name">白女士 在线</h2>
                <p class="boss-info-attr">南京示例科技有限公司 · HR</p>
              </section>
              <section class="job-address"><p class="job-address-desc">南京鼓楼区示例路 1 号</p></section>
              <a class="more-job-btn" href="/job_detail/current-java-001.html?securityId=test">查看更多信息</a>
            </div>
          </aside>
        </main>
      `),
      "https://www.zhipin.com/web/geek/jobs?ka=header-jobs",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceUrl).toBe("https://www.zhipin.com/job_detail/current-java-001.html");
    expect(result.capture).toMatchObject({
      job_title: "Java",
      company_name: "南京示例科技有限公司",
      description_text: "岗位职责：参与业务系统的需求分析和设计；负责系统功能开发、调试和单元测试。\n任职要求：统招本科及以上学历，具有五年 Java 开发经验。",
      salary_text: "10-11K",
      work_city: "南京",
      experience_text: "5-10年",
      education_text: "本科",
      work_address: "南京鼓楼区示例路 1 号",
    });
    expect(result.capture.skills).toEqual(["JVM", "Java", "MySQL"]);
  });

  it("finds the description from a non-heading title when BOSS changes wrapper classes", () => {
    const result = extractBossJob(
      page(`
        <main>
          <ul class="job-list">
            <li>
              <a href="/job_detail/semantic-fallback-001.html">Java</a>
              <span class="company-name">语义兜底科技有限公司</span>
            </li>
          </ul>
          <aside class="unknown-detail-pane">
            <header class="job-detail-box"><div class="job-name">Java</div></header>
            <div class="title">职位描述</div>
            <div class="unknown-description">岗位职责：负责业务系统设计和开发。\n任职要求：熟悉 Java、数据库及代码评审流程。</div>
            <a href="/job_detail/semantic-fallback-001.html">查看更多信息</a>
          </aside>
        </main>
      `),
      "https://www.zhipin.com/web/geek/jobs",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.company_name).toBe("语义兜底科技有限公司");
    expect(result.capture.description_text).toContain("任职要求：熟悉 Java");
  });

  it("only accepts BOSS detail URLs and the job list detail view", () => {
    expect(isBossJobUrl("https://www.zhipin.com/job_detail/abc.html?ka=detail")).toBe(true);
    expect(isBossJobUrl("https://m.zhipin.com/job_detail/abc.html")).toBe(true);
    expect(isBossJobUrl("https://www.zhipin.com/web/geek/jobs?ka=header-jobs")).toBe(true);
    expect(isBossJobUrl("https://www.zhipin.com/jobs/abc.html")).toBe(false);
    expect(isBossJobUrl("https://www.zhipin.com/web/geek/job")).toBe(false);
    expect(isBossJobUrl("https://example.test/job_detail/abc.html")).toBe(false);
  });
});
