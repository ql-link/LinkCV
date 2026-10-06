using System.Text.Json.Nodes;
namespace LinkResume.Core.Models;
public static class CareerRequest {
    public static bool Allowed(string path, string method) {
        if(DatasetRequest.Allowed(path,method))return true;
        if(MockInterviewRequest.Allowed(path,method))return true;
        if(!path.StartsWith("/api/") || path.Contains("//") || path.EndsWith("/") || path.Contains('?') || path.Contains('#') || path.Contains("..")) return false;
        if(method == "GET" && new[] { "/api/resumes", "/api/job-applications", "/api/interview-overview", "/api/interview-sessions", "/api/job-descriptions" }.Contains(path)) return true;
        if(method == "POST" && new[] { "/api/job-descriptions", "/api/job-descriptions/parse-draft", "/api/job-applications" }.Contains(path)) return true;
        var p = path.TrimStart('/').Split('/');
        if(p.Length < 3 || p[0] != "api" || p[2].Length == 0 || !p[2].All(char.IsAsciiDigit)) return false;
        if(p.Length == 3) return new[] { "job-applications", "job-descriptions" }.Contains(p[1]) ? new[] { "GET", "PUT", "DELETE" }.Contains(method) : p[1] == "interview-sessions" && (method is "GET" or "PUT");
        if(p.Length != 4) return false;
        if(p[1] == "job-descriptions" && p[3] == "logo")return method=="GET";
        if(p[1] == "interview-sessions" && p[3] == "answer-plan") return method == "PUT";
        if(method != "POST") return false;
        return p[1] == "job-applications" ? new[] { "stages", "terminate", "offer", "close", "archive", "restore", "interview-sessions" }.Contains(p[3]) : p[1] == "interview-sessions" && new[] { "complete", "cancel", "reschedule" }.Contains(p[3]);
    }
}
public sealed record CareerApplication(JsonNode Raw, DateTimeOffset? CompletedSchedule=null) {
    public CareerApplication IncludingSessions(IEnumerable<JsonNode> sessions) {
        var stageId=Raw["current_stage"]?["id"]?.GetValue<string>();
        if(string.IsNullOrEmpty(stageId))return this;
        var latest=sessions.Where(x=>x["application_id"]?.GetValue<string>()==Id && x["application_stage_id"]?.GetValue<string>()==stageId && x["status"]?.GetValue<string>()!="cancelled")
            .OrderByDescending(x=>Date(x["start_at"]?.GetValue<string>()??"")).FirstOrDefault();
        return this with {CompletedSchedule=latest?["status"]?.GetValue<string>()=="completed"?Date(latest["start_at"]?.GetValue<string>()??""):null};
    }
    public string Text(string key) => Raw[key]?.GetValue<string>() ?? "";
    public string Id => Text("id"); public string Company => Text("company_name_snapshot"); public string Title => Text("job_title_snapshot");
    public int LockVersion => Raw["lock_version"]?.GetValue<int>() ?? 0;
    public bool Ended => Text("lifecycle_status") == "terminated" || !new[] { "", "active" }.Contains(Text("status")) || Text("archived_at") != "";
    public (string Path,string Revision)? LogoRequest {
        get {
            var value=Text("company_logo_url");var parts=value.Split('?');
            if(parts.Length!=2 || !CareerRequest.Allowed(parts[0],"GET") || !parts[0].EndsWith("/logo") || !parts[1].StartsWith("v="))return null;
            var revision=parts[1][2..];
            if(revision.Length!=64 || !revision.All(c=>char.IsAsciiDigit(c)||c is >= 'a' and <= 'f'))return null;
            return (parts[0],revision);
        }
    }
    public string Category => Raw["job_snapshot"]?["employment_type"]?.GetValue<string>() ?? "";
    public string CategoryLabel => Category switch { "internship" => "实习", "campus" => "校招", "full_time" => "正式", _ => "未分类" };
    public string Stage { get {
        if(Ended) return "ended";
        if(Text("phase") == "pending" || Text("phase") == "" && Text("applied_at") == "" && Raw["current_stage"] is null && Text("current_stage_type") == "screening") return "pending";
        var value = Raw["current_stage"]?["stage_type"]?.GetValue<string>() ?? Text("current_stage_type");
        if(value == "hr") return "interview";
        if(value == "screening") { if(Text("current_stage_label").Contains("笔试")) return "written_test"; if(Text("current_stage_label").Contains("测评")) return "assessment"; }
        return CareerStage.Keys.Contains(value) ? value : "screening";
    } }
    public string StageLabel => (Stage is "interview" or "ai_interview") ? (Raw["current_stage"]?["stage_label"]?.GetValue<string>() ?? Text("current_stage_label")) is { Length: > 0 } value ? value : CareerStage.Label(Stage) : CareerStage.Label(Stage);
    public string Column => (Stage is "interview" or "ai_interview") ? "interview:" + StageLabel : Stage;
    public string StatusLabel => Text("offer_status")=="accepted"?"已接受 Offer":Text("offer_status")=="declined"?"已婉拒 Offer":Stage=="pending"?"等待确认投递":Ended ? "结束阶段：" + (Text("current_stage_label")==""?CareerStage.Label(Text("current_stage_type")):Text("current_stage_label")) : (Text("stage_state") == "completed" || CompletedSchedule is not null) ? "已完成" : Stage == "offer" ? Text("offer_status")=="none"?"OC 口头意向":"已收到 Offer" : Text("stage_state")=="awaiting_schedule"?"等待安排":Text("stage_state")=="awaiting_result"?"等待结果":Text("stage_state")=="scheduled"?"已安排":StageLabel;
    public bool Movable => !Ended && Stage != "offer";
    public DateTimeOffset? Schedule => new[] { "assessment", "written_test", "ai_interview", "interview" }.Contains(Stage) ? Date(Text("next_session_start_at")) : null;
    public static DateTimeOffset? Date(string value) => DateTimeOffset.TryParse(value, out var date) ? date : null;
}
public static class CareerStage {
    public static readonly string[] Keys = ["pending", "screening", "assessment", "written_test", "ai_interview", "interview", "offer", "ended"];
    public static string[] NextStages(CareerApplication? item) {
        var rank=item is null?0:Array.IndexOf(Keys,item.Stage);
        return Keys.Where(k=>k is not ("pending" or "ended") && (k=="interview"?rank<=Array.IndexOf(Keys,k):rank<Array.IndexOf(Keys,k))).ToArray();
    }
    public static bool CanAdvance(CareerApplication item, string column,string? stage=null) {
        var target=stage??(column.StartsWith("interview:")?"interview":column);
        return item.Movable && item.Column!=column && target!="pending" && (target=="ended" || Array.IndexOf(Keys,target)>=Array.IndexOf(Keys,item.Stage));
    }
    public static string Label(string key) => key.StartsWith("interview:") ? key[10..] : key switch { "pending" => "待投递", "screening" => "筛选中", "assessment" => "测评", "written_test" => "笔试", "ai_interview" => "AI 面试", "interview" => "面试中", "offer" => "Offer", "ended" => "已结束", _ => key };
    public static string[] Columns(IEnumerable<CareerApplication> items) {
        var rounds = items.Where(x => x.Stage is "interview" or "ai_interview").GroupBy(x => x.Column).OrderBy(g => g.Select(x => x.Raw["current_round_no"]?.GetValue<int>() ?? int.MaxValue).Min()).ThenBy(g => g.Key).Select(g => g.Key).ToArray();
        return Keys.Where(k=>k!="ai_interview").SelectMany(k => k == "interview" ? rounds.Length == 0 ? new[] { "interview:面试中" } : rounds : new[] { k }).ToArray();
    }
    public static IEnumerable<CareerApplication> Sorted(IEnumerable<CareerApplication> items, bool earliest) => items.OrderBy(x => earliest ? 0 : x.Schedule is null ? 1 : 0).ThenBy(x => earliest ? DateTimeOffset.MinValue : x.Schedule ?? DateTimeOffset.MaxValue).ThenBy(x=>earliest?0:x.CompletedSchedule is null?1:0).ThenByDescending(x=>earliest?DateTimeOffset.MinValue:x.CompletedSchedule??DateTimeOffset.MinValue).ThenBy(x => CareerApplication.Date(x.Text("created_at")) ?? DateTimeOffset.MaxValue).ThenBy(x => x.Id.Length).ThenBy(x => x.Id, StringComparer.Ordinal);
}

public sealed record CareerFlow(string Kind,string Button,string Headline,string Explanation) {
    public static CareerFlow For(CareerApplication item) {
        if(item.Ended)return new("history","查看阶段记录",item.Text("offer_status")=="accepted"?"已接受 Offer":item.Text("offer_status")=="declined"?"已婉拒 Offer":"本次求职已结束","保留每个阶段的记录，回顾这次求职经历。");
        if(item.Stage=="pending")return new("apply","记录投递","准备好了，就记录一次投递。","记录投递日期、渠道和使用的简历，开始跟进这个岗位。");
        if(item.Stage=="offer")return item.Text("offer_status")=="received"?new("accept","接受 Offer","正式 Offer 已收到，做出你的选择。","核对薪酬、工作地点和入职信息，再确认是否接受。"):new("offer","记录正式 Offer","口头意向已沟通，等待正式 Offer。","收到正式 Offer 后，记录条件并决定接受或婉拒。");
        if(new[]{"assessment","written_test","ai_interview","interview"}.Contains(item.Stage)&&item.Text("stage_state")=="awaiting_schedule")return new("schedule-current","安排时间","先把时间安排好。","记录时间、方式和链接，排期会同步到面试日程。");
        if(item.Text("stage_state")=="scheduled"&&item.CompletedSchedule is null)return new("records","记录与复盘","已安排，准备好迎接这次机会。","查看排期、记录面试情况；结束后标记完成。");
        return new("stage",item.Stage=="screening"?"进入下一阶段":"通过，添加下一轮","等待结果，有进展再记录。","收到通过通知后，添加下一阶段；多轮面试会分别保留记录。");
    }
}

public static class CareerNotes {
    public static readonly string[] Fields=["投递渠道","口头薪酬","收到日期","回复截止","薪酬说明","预计入职","试用期","Offer 材料"];
    public static string Value(string key,string notes)=>notes.Split('\n').FirstOrDefault(x=>x.StartsWith(key+"：")) is {} line?line[(key.Length+1)..]:"";
    public static string Merge(Dictionary<string,string> values,string notes){var keys=values.Keys.Where(Fields.Contains).ToHashSet();var lines=notes.Split('\n').Where(line=>!keys.Any(key=>line.StartsWith(key+"："))).ToList();foreach(var key in Fields.Where(keys.Contains))if(values[key]!="")lines.Add(key+"："+values[key].Replace('\n',' '));return string.Join('\n',lines).Trim('\n');}
}

public sealed record CareerProgressStep(string Id,string Label,string Date,string State);
public static class CareerProgress {
    public static CareerProgressStep[] Steps(CareerApplication item){
        var stages=item.Raw["stages"]?.AsArray()??[];
        if(stages.Count==0){var type=item.Ended?item.Text("current_stage_type"):item.Stage;var rank=type=="pending"?0:type=="screening"?1:type is "assessment" or "written_test"?2:type=="offer"?4:3;return new[]{"待投递","筛选中","笔试 / 测评","面试","Offer"}.Select((label,index)=>new CareerProgressStep(index.ToString(),label,index==0?item.Text("created_at"):"",index==rank&&!item.Ended?"current":"future")).ToArray();}
        var currentId=item.Raw["current_stage"]?["id"]?.GetValue<string>()??"";var result=new List<CareerProgressStep>{new("applied","已投递",item.Text("applied_at"),"completed")};
        foreach(var stage in stages){if(stage is null)continue;string Text(string key)=>stage[key]?.GetValue<string>()??"";var current=Text("id")==currentId||currentId==""&&ReferenceEquals(stage,stages.Last());var state=!item.Ended&&current?"current":"completed";var oral=Text("stage_type")=="offer"&&(Text("stage_label")=="OC"||item.Text("offer_status")=="none");var formal=Text("stage_type")=="offer"&&new[]{"received","accepted","declined"}.Contains(item.Text("offer_status"));result.Add(new(Text("id"),oral?"OC":Text("stage_label"),Text("entered_at"),oral&&formal?"completed":state));if(oral&&formal)result.Add(new("formal","Offer",CareerNotes.Value("收到日期",item.Text("notes")),state));}
        if(!item.Ended){var future=item.Stage=="screening"?new[]{"笔试 / 测评","面试","Offer"}:item.Stage is "assessment" or "written_test"?new[]{"面试","Offer"}:item.Stage is "interview" or "ai_interview"?new[]{"Offer"}:[];foreach(var label in future)result.Add(new("future:"+label,label,"","future"));}return result.ToArray();
    }
}
