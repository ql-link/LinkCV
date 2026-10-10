using System.Net;
using System.Text.Json.Nodes;
using DrawOffer.Core.Api;
using DrawOffer.Core.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
namespace DrawOffer.App.Views;

internal sealed class ScheduleSessionForm {
    private ScheduledInterview _item;
    private string _kind;
    private readonly IApiClient _api;
    private readonly CancellationToken _ct;
    private readonly IReadOnlyList<ScheduledInterview> _items;
    private DateTimeOffset _start,_end;
    private JsonObject? _frozen;
    private bool _busy,_loaded;
    private readonly TextBlock _error=InterviewSchedulePage.Text("",12);
    public StackPanel View {get;}=new(){Spacing=16,MinWidth=520};
    public event Action? Saved;
    public bool Busy=>_busy;
    private CalendarDatePicker _startDate=new(),_endDate=new();
    private TimePicker _startTime=new(),_endTime=new();
    private CheckBox _remove=new(),_conflict=new();
    private ComboBox _mode=new();
    private readonly Dictionary<string,TextBox> _fields=[];
    public ScheduleSessionForm(ScheduledInterview item,string kind,DateTimeOffset start,DateTimeOffset end,IReadOnlyList<ScheduledInterview> items,IApiClient api,CancellationToken ct){_item=item;_kind=kind;_start=start;_end=end;_items=items;_api=api;_ct=ct;}
    public async Task LoadAsync(){
        try{var result=await _api.CareerRequestAsync("/api/interview-sessions/"+_item.Id,ct:_ct);_ct.ThrowIfCancellationRequested();_item=new(result["session"]??throw new InvalidDataException());_loaded=true;Render();}
        catch(OperationCanceledException){}catch(Exception e){View.Children.Clear();View.Children.Add(InterviewSchedulePage.Text(JobsBoardPage.Explain(e)));View.Children.Add(InterviewSchedulePage.Button("重试",()=>_=LoadAsync()));}
    }
    private void Begin(string kind){
        _kind=kind;_frozen=null;_error.Text="";
        _start=kind=="answer-plan"?CareerApplication.Date(_item.Text("answer_plan_start_at"))??_item.Start:_item.Start;
        _end=kind=="answer-plan"?CareerApplication.Date(_item.Text("answer_plan_end_at"))??_item.End:_item.End;Render();
    }
    private void Field(string key,string label,bool multiline=false){
        var value=new TextBox{Header=label,Text=_item.Text(key),AcceptsReturn=multiline,TextWrapping=TextWrapping.Wrap,MinHeight=multiline?80:0};_fields[key]=value;View.Children.Add(value);
    }
    private void Render(){
        View.Children.Clear();_fields.Clear();
        View.Children.Add(InterviewSchedulePage.Text(_item.Company+" · "+_item.Title,18));View.Children.Add(InterviewSchedulePage.Text(_item.Label+" · "+_item.Status(DateTimeOffset.Now),13,true));
        if(_kind=="detail"){
            View.Children.Add(InterviewSchedulePage.Text($"{_item.Start.ToLocalTime():yyyy-MM-dd HH:mm} — {_item.End.ToLocalTime():yyyy-MM-dd HH:mm}"));
            View.Children.Add(InterviewSchedulePage.Text(_item.OpenWindow?"开放作答窗口":"固定面试场次"));
            var labels=new Dictionary<string,string>{{"mode","方式"},{"meeting_url","会议 / 作答链接"},{"location","地点"},{"interviewer_name","面试官"},{"interviewer_title","面试官职位"},{"preparation_note","准备备注"},{"answer_plan_start_at","个人计划开始"},{"answer_plan_end_at","个人计划结束"},{"questions_markdown","面试问题"},{"review_summary","复盘总结"},{"improvement_markdown","改进计划"}};
            foreach(var pair in labels)if(_item.Text(pair.Key)!="")View.Children.Add(new TextBlock{Text=pair.Value+"："+_item.Text(pair.Key),TextWrapping=TextWrapping.Wrap,IsTextSelectionEnabled=true});
            if(_item.Editable){
                var actions=new StackPanel{Orientation=Orientation.Horizontal,Spacing=8};actions.Children.Add(InterviewSchedulePage.Button("编辑信息",()=>Begin("edit")));
                if(!_item.OpenWindow)actions.Children.Add(InterviewSchedulePage.Button("改期",()=>Begin("reschedule")));
                if(_item.OpenWindow)actions.Children.Add(InterviewSchedulePage.Button("作答计划",()=>Begin("answer-plan")));
                actions.Children.Add(InterviewSchedulePage.Button("完成",()=>Begin("complete")));actions.Children.Add(InterviewSchedulePage.Button("取消安排",()=>Begin("cancel")));View.Children.Add(actions);
            }
        }else{
            if(_kind is "reschedule" or "answer-plan"){
                if(_kind=="answer-plan"){_remove=new CheckBox{Content="清除个人作答计划"};View.Children.Add(_remove);}
                _startDate=new(){Header="开始日期",Date=_start.ToLocalTime()};_endDate=new(){Header="结束日期",Date=_end.ToLocalTime()};_startTime=new(){Header="开始时间",Time=_start.ToLocalTime().TimeOfDay};_endTime=new(){Header="结束时间",Time=_end.ToLocalTime().TimeOfDay};
                foreach(var field in new FrameworkElement[]{_startDate,_startTime,_endDate,_endTime})View.Children.Add(field);
                if(_kind=="reschedule"){_conflict=new(){Content="确认仍保存有时间冲突的安排"};View.Children.Add(_conflict);}
            }else if(_kind=="edit"){
                _mode=new(){Header="面试方式",ItemsSource=new[]{"视频","现场","电话","其他"},SelectedIndex=_item.Text("mode") switch{"onsite"=>1,"phone"=>2,"other"=>3,_=>0}};View.Children.Add(_mode);
                Field("meeting_url","会议或作答链接");Field("location","地点");Field("interviewer_name","面试官姓名");Field("interviewer_title","面试官职位");Field("preparation_note","准备备注",true);
            }else if(_kind=="complete"){View.Children.Add(InterviewSchedulePage.Text("确认标记完成，可同时记录问题和复盘。"));Field("questions_markdown","面试问题",true);Field("review_summary","复盘总结",true);Field("improvement_markdown","改进计划",true);}
            else if(_kind=="cancel"){View.Children.Add(InterviewSchedulePage.Text("取消后保留历史记录。"));Field("reason","取消原因（可选）",true);}
            var actions=new StackPanel{Orientation=Orientation.Horizontal,Spacing=10};
            actions.Children.Add(InterviewSchedulePage.Button("确认保存",()=>_=SaveAsync(),true));actions.Children.Add(InterviewSchedulePage.Button("返回详情",()=>Begin("detail")));View.Children.Add(actions);
        }
        View.Children.Add(_error);
    }
    private DateTimeOffset ReadDate(CalendarDatePicker date,TimePicker time)=>ScheduleCalendar.LocalDate(DateOnly.FromDateTime((date.Date??DateTimeOffset.Now).Date),time.Time);
    private async Task SaveAsync(){
        if(_busy||!_loaded||!_item.Editable)return;
        var from=ReadDate(_startDate,_startTime);var to=ReadDate(_endDate,_endTime);var remove=_kind=="answer-plan"&&_remove.IsChecked==true;
        if((_kind is "reschedule" or "answer-plan")&&!remove&&to<=from){_error.Text="结束时间须晚于开始时间。";return;}
        if(_kind=="answer-plan"&&!remove&&(from<_item.Start||to>_item.End)){_error.Text="个人作答计划必须位于开放窗口内。";return;}
        if(_kind=="reschedule"&&_conflict.IsChecked!=true&&ScheduleCalendar.Conflicts(_items,_item.Id,from,to) is {Length:>0} conflicts){_error.Text="与现有安排重叠："+string.Join("、",conflicts.Select(x=>x.Caption));return;}
        _busy=true;_error.Text="";
        try{
            if(_frozen is null){
                _frozen=new(){["base_lock_version"]=_item.Raw["lock_version"]?.GetValue<int>()??1};
                if(_kind=="reschedule"){_frozen["start_at"]=from.ToUniversalTime().ToString("O");_frozen["end_at"]=to.ToUniversalTime().ToString("O");_frozen["timezone"]=WindowsTimezone();_frozen["allow_conflict"]=_conflict.IsChecked==true;}
                if(_kind=="answer-plan"){_frozen["answer_plan_start_at"]=remove?null:from.ToUniversalTime().ToString("O");_frozen["answer_plan_end_at"]=remove?null:to.ToUniversalTime().ToString("O");}
                if(_kind=="edit")_frozen["mode"]=new[]{"video","onsite","phone","other"}[_mode.SelectedIndex];
                foreach(var pair in _fields)_frozen[pair.Key]=string.IsNullOrWhiteSpace(pair.Value.Text)?null:pair.Value.Text;
            }
            foreach(var element in View.Children.OfType<Control>())element.IsEnabled=false;
            foreach(var button in View.Children.OfType<StackPanel>().SelectMany(x=>x.Children.OfType<Button>()))button.IsEnabled=false;
            await _api.CareerRequestAsync("/api/interview-sessions/"+_item.Id+(_kind=="edit"?"":"/"+_kind),_kind is "edit" or "answer-plan"?"PUT":"POST",body:_frozen,ct:_ct);_ct.ThrowIfCancellationRequested();Saved?.Invoke();
        }catch(OperationCanceledException){}catch(Exception e){
            if(e is ApiException api&&(api.Status is HttpStatusCode.BadRequest or HttpStatusCode.UnprocessableEntity or HttpStatusCode.Conflict)&&api.Code!="INTERVIEW_EDIT_CONFLICT")_frozen=null;
            _error.Text=JobsBoardPage.Explain(e)+" 输入已保留；版本冲突请关闭并刷新后再修改。";
        }finally{
            _busy=false;foreach(var element in View.Children.OfType<Control>())element.IsEnabled=_frozen is null;
            foreach(var button in View.Children.OfType<StackPanel>().SelectMany(x=>x.Children.OfType<Button>()))button.IsEnabled=true;
        }
    }
    private static string WindowsTimezone()=>TimeZoneInfo.TryConvertWindowsIdToIanaId(TimeZoneInfo.Local.Id,out var iana)?iana:TimeZoneInfo.Local.Id;
}
