using System.Text.Json.Nodes;
using DrawOffer.Core.Models;
using Xunit;
namespace DrawOffer.Core.Tests;
public class InterviewScheduleTests {
    private static ScheduledInterview Item(string id,string start,string end,string status="scheduled",bool window=false)=>new(new JsonObject{["id"]=id,["start_at"]=start,["end_at"]=end,["status"]=status,["schedule_kind"]=window?"open_window":"fixed_slot"});
    [Theory][InlineData(2021,2,28)][InlineData(2026,10,35)][InlineData(2026,3,42)]
    public void MonthUsesFourFiveOrSixWeeks(int year,int month,int count){
        var days=ScheduleCalendar.MonthDays(new(year,month,15));Assert.Equal(count,days.Length);Assert.Equal(DayOfWeek.Monday,days[0].DayOfWeek);Assert.Equal(count,days.Distinct().Count());Assert.Equal(DateTime.DaysInMonth(year,month),days.Count(x=>x.Month==month));
    }
    [Fact] public void ConflictsAreHalfOpenAndIgnoreCancelledAndWindows(){
        var from=DateTimeOffset.Parse("2030-01-01T10:00:00Z");var until=from.AddHours(1);
        var a=Item("1","2030-01-01T09:00:00Z","2030-01-01T10:00:00Z");var b=Item("2","2030-01-01T10:30:00Z","2030-01-01T11:30:00Z");
        var c=Item("3","2030-01-01T10:00:00Z","2030-01-01T11:00:00Z","cancelled");var d=Item("4","2030-01-01T00:00:00Z","2030-01-02T00:00:00Z",window:true);
        Assert.Equal(new[]{"2"},ScheduleCalendar.Conflicts([a,b,c,d],null,from,until).Select(x=>x.Id));Assert.Empty(ScheduleCalendar.Conflicts([a,b,c,d],"2",from,until));Assert.False(a.Overlaps(from,until));
    }
    [Fact] public void LanesResetAfterOverlapAndWindowsSortByDeadline(){
        var a=Item("1","2030-01-01T09:00:00Z","2030-01-01T10:00:00Z");var b=Item("2","2030-01-01T09:30:00Z","2030-01-01T10:30:00Z");var c=Item("3","2030-01-01T10:30:00Z","2030-01-01T11:30:00Z");
        var lanes=ScheduleCalendar.Lanes([c,b,a]);Assert.Equal(2,lanes["1"].Count);Assert.Equal(1,lanes["2"].Index);Assert.Equal(1,lanes["3"].Count);
        var window=Item("4","2029-12-31T09:00:00Z","2030-01-02T10:00:00Z",window:true);
        Assert.Equal(new[]{"1","2","3"},ScheduleCalendar.Upcoming([window,c,a,b],DateTimeOffset.Parse("2030-01-01T08:00:00Z")).Select(x=>x.Id));
    }
    [Fact] public void EditingDoesNotAllowDeleteOrPatch(){Assert.True(CareerRequest.Allowed("/api/interview-sessions/12","PUT"));Assert.False(CareerRequest.Allowed("/api/interview-sessions/12","DELETE"));Assert.False(CareerRequest.Allowed("/api/interview-sessions/12","PATCH"));}

    [Fact] public void PersonalPlanKeepsOfficialDatesAndIdentity(){
        var official=Item("9","2030-01-01T00:00:00Z","2030-01-05T00:00:00Z",window:true);
        Assert.Null(official.Timed);official.Raw["answer_plan_start_at"]="2030-01-02T10:00:00Z";official.Raw["answer_plan_end_at"]="2030-01-02T11:00:00Z";
        Assert.Equal(DateTimeOffset.Parse("2030-01-02T10:00:00Z"),official.Timed!.Start);Assert.Equal(DateTimeOffset.Parse("2030-01-01T00:00:00Z"),official.Start);Assert.Equal(official.Id,official.Timed.Id);
    }
}
