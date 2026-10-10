using System.Text.Json.Nodes;
namespace DrawOffer.Core.Models;

public sealed record ScheduledInterview(JsonNode Raw) {
    public string Text(string key)=>Raw[key]?.GetValue<string>()??"";
    public string Id=>Text("id");
    public string ApplicationId=>Text("application_id");
    public string Company=>Text("company_name");
    public string Title=>Text("job_title");
    public string Label=>Text("stage_label");
    public ScheduledInterview? Timed {
        get {
            if(!OpenWindow)return this;
            var from=CareerApplication.Date(Text("answer_plan_start_at"));var to=CareerApplication.Date(Text("answer_plan_end_at"));
            if(from is null||to is null||from>=to)return null;
            var raw=Raw.DeepClone();raw["start_at"]=Raw["answer_plan_start_at"]?.DeepClone();raw["end_at"]=Raw["answer_plan_end_at"]?.DeepClone();return new(raw);
        }
    }
    public string Caption=>Company+" · "+Label;
    public DateTimeOffset Start=>CareerApplication.Date(Text("start_at"))??DateTimeOffset.MinValue;
    public DateTimeOffset End=>CareerApplication.Date(Text("end_at"))??Start;
    public bool OpenWindow=>Text("schedule_kind")=="open_window";
    public bool Editable=>Text("status")=="scheduled";
    public string Status(DateTimeOffset now)=>Text("status") switch {
        "cancelled"=>"已取消","completed"=>"已完成",
        _=>End<=now?OpenWindow?"已截止":"等待结果":Start<=now?OpenWindow?"待完成":"进行中":OpenWindow?"未开始":"已安排"
    };
    public bool Overlaps(DateTimeOffset from,DateTimeOffset to)=>Start<to&&End>from;
}
public static class ScheduleCalendar {
    public static DateOnly WeekStart(DateOnly date)=>date.AddDays(-(((int)date.DayOfWeek+6)%7));
    public static DateOnly[] MonthDays(DateOnly date) {
        var first=new DateOnly(date.Year,date.Month,1);
        var last=first.AddMonths(1).AddDays(-1);
        var from=WeekStart(first);var until=WeekStart(last).AddDays(7);
        return Enumerable.Range(0,until.DayNumber-from.DayNumber).Select(from.AddDays).ToArray();
    }
    public static DateTimeOffset LocalDate(DateOnly date,TimeSpan time=default) {
        var value=date.ToDateTime(TimeOnly.MinValue).Add(time);
        return new DateTimeOffset(value,TimeZoneInfo.Local.GetUtcOffset(value));
    }
    public static ScheduledInterview[] Conflicts(IEnumerable<ScheduledInterview> items,string? excluding,DateTimeOffset start,DateTimeOffset end)=>
        items.Where(x=>x.Id!=excluding&&x.Editable&&!x.OpenWindow&&x.Overlaps(start,end)).ToArray();
    public static ScheduledInterview[] Upcoming(IEnumerable<ScheduledInterview> items,DateTimeOffset now)=>
        items.Where(x=>x.Editable&&x.End>now).OrderBy(x=>x.OpenWindow?x.End:x.Start).Take(3).ToArray();
    public static Dictionary<string,(int Index,int Count)> Lanes(IEnumerable<ScheduledInterview> items) {
        var result=new Dictionary<string,(int,int)>();var group=new List<ScheduledInterview>();var boundary=DateTimeOffset.MinValue;
        void Flush() {
            var ends=new List<DateTimeOffset>();var indices=new Dictionary<string,int>();
            foreach(var item in group) {
                var lane=ends.FindIndex(x=>x<=item.Start);if(lane<0){lane=ends.Count;ends.Add(item.End);}else ends[lane]=item.End;
                indices[item.Id]=lane;
            }
            foreach(var item in group)result[item.Id]=(indices[item.Id],ends.Count);
        }
        foreach(var item in items.OrderBy(x=>x.Start).ThenBy(x=>x.Id)) {
            if(item.Start>=boundary&&group.Count>0){Flush();group.Clear();}
            group.Add(item);boundary=group.Max(x=>x.End);
        }
        if(group.Count>0)Flush();return result;
    }
}
