using System.Text.Json.Nodes;
using System.Net;
using LinkResume.Core.Api;
using LinkResume.Core.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace LinkResume.App.Views;

internal sealed class CareerDialogForm
{
    private readonly string _kind;
    private CareerApplication? _application;
    private readonly IApiClient _api;
    private readonly CancellationToken _ct;
    private readonly TextBox _company=Field("公司"),_role=Field("岗位名称"),_description=Field("岗位描述 / JD",true),_city=Field("工作城市"),_label=Field("面试名称"),_meeting=Field("会议或作答链接（可选）"),_location=Field("地点（可选）"),_base=Field("Offer Base（可选）"),_salary=Field("薪资（可选）"),_benefits=Field("福利待遇（可选）"),_notes=Field("备注",true);
    private readonly ComboBox _category=Choice("求职分类",["未分类","实习","校招","正式"]),_stage=Choice("下一阶段",CareerStage.Keys.Where(x=>x is not ("pending" or "ended")).Select(CareerStage.Label).ToArray()),_reason=Choice("结束原因",["主动结束","公司拒绝","已完成","其他原因"]),_currency=Choice("币种",["CNY","USD"]),_period=Choice("计薪周期",["月","年"]);
    private readonly NumberBox _round=new() {Header="面试轮次",Value=1,Minimum=1,Maximum=100,SpinButtonPlacementMode=NumberBoxSpinButtonPlacementMode.Compact};
    private readonly CheckBox _reuse=new(){Content="为当前阶段添加排期"},_allowConflict=new(){Content="确认仍保存有时间冲突的安排"};
    private readonly ComboBox _mode=Choice("面试方式",["视频","现场","电话","其他"]);
    private readonly CheckBox _scheduled=new() {Content="同时添加排期"},_window=new() {Content="开放作答窗口"};
    private readonly CalendarDatePicker _startDate=new() {Header="开始日期",Date=DateTimeOffset.Now},_endDate=new() {Header="结束日期",Date=DateTimeOffset.Now};
    private readonly TimePicker _startTime=new() {Header="开始时间",Time=DateTime.Now.TimeOfDay},_endTime=new() {Header="结束时间",Time=DateTime.Now.AddHours(1).TimeOfDay};
    private readonly TextBlock _error=new() {TextWrapping=TextWrapping.Wrap};
    private readonly StackPanel _stageFields=new() {Spacing=16},_scheduleFields=new() {Spacing=12},_interviewFields=new() {Spacing=12},_offerFields=new() {Spacing=12};
    private JsonNode? _stagePayload,_sessionPayload,_offerPayload;
    private string? _createdId;
    private bool _staged,_sessionSaved,_busy;
    private readonly TextBox _channel=Field("投递渠道（可选）"),_oral=Field("口头薪酬（可选）"),_payText=Field("薪酬说明（如 35K × 16 薪）"),_deadline=Field("回复截止（可选）"),_join=Field("预计入职（可选）"),_trial=Field("试用期（可选）"),_materials=Field("Offer 材料（资料库文件名或备注，可选）");
    private readonly CalendarDatePicker _received=new(){Header="收到日期",Date=DateTimeOffset.Now};
    private readonly Grid _tiles=new(){ColumnSpacing=8,RowSpacing=8};
    private readonly ComboBox _offerIntent=Choice("Offer 阶段",["OC · 口头意向","正式 Offer"]);
    private readonly ComboBox _resume=Choice("投递简历（可选）",["不关联简历"]);
    private string[] _resumeIds=[];
    private readonly ComboBox _existing=Choice("岗位",["创建新岗位"]);
    private readonly CalendarDatePicker _appliedDate=new(){Header="投递日期",Date=DateTimeOffset.Now};
    private readonly CareerApplication[] _existingItems;
    private readonly StackPanel _creationFields=new(){Spacing=16};
    private string[] _stageKeys=CareerStage.Keys.Where(x=>x is not ("pending" or "ended")).ToArray();
    public bool Unknown {get;private set;}
    public bool Busy=>_busy;
    public string Title => _kind switch {"import"=>"导入岗位","arranged"=>"已有面试安排","schedule"=>"新建面试","stage"=>"添加下一阶段","category"=>"修改求职分类","terminate"=>"终止求职","delete"=>"删除岗位","offer"=>"记录正式 Offer","apply"=>"记录投递","schedule-current"=>"安排时间","accept"=>"接受 Offer","decline"=>"婉拒 Offer","archive"=>"归档岗位","restore"=>"恢复岗位","notes"=>"编辑备注",_=>"求职详情"};
    private readonly StackPanel _form=new(){Spacing=20};
    public Grid View {get;}=new(){ColumnSpacing=22,MinWidth=816};
    private string Stage => _stageKeys[Math.Max(0,_stage.SelectedIndex)];
    private bool NeedsStage => _kind is "stage" or "apply" or "schedule-current" or "arranged" or "schedule";
    private bool Creation => _kind=="import" || (_kind is "arranged" or "schedule") && _existing.SelectedIndex==0;
    private static TextBox Field(string label,bool multiline=false)=>new(){Header=label,PlaceholderText=label,AcceptsReturn=multiline,TextWrapping=TextWrapping.Wrap,MinHeight=multiline?100:0};
    private static ComboBox Choice(string label,string[] items)=>new(){Header=label,ItemsSource=items,SelectedIndex=0,HorizontalAlignment=HorizontalAlignment.Stretch};
    private static TextBlock Text(string value)=>new(){Text=value,TextWrapping=TextWrapping.Wrap};
    public CareerDialogForm(string kind,CareerApplication? application,string stage,string label,IApiClient api,CancellationToken ct,IEnumerable<CareerApplication> applications,int? round=null,DateTimeOffset? start=null,DateTimeOffset? end=null) {
        if(start is {} from){_startDate.Date=from;_startTime.Time=from.TimeOfDay;}if(end is {} to){_endDate.Date=to;_endTime.Time=to.TimeOfDay;}
        _round.Value=round??Math.Max(1,(application?.Raw["current_round_no"]?.GetValue<int>()??0)+(kind=="schedule-current"?0:1));
        _existingItems=applications.Where(x=>x.Movable).ToArray();
        _kind=kind;_application=application;_api=api;_ct=ct;_label.Text=kind=="stage"&&stage=="interview"?$"第 {(int)_round.Value} 轮面试":label;_stageKeys=NeedsStage?CareerStage.NextStages(application):CareerStage.Keys.Where(x=>x is not ("pending" or "ended")).ToArray();_stageKeys=kind=="schedule"?_stageKeys.Where(x=>new[]{"assessment","written_test","ai_interview","interview"}.Contains(x)).ToArray():_stageKeys;_stage.ItemsSource=_stageKeys.Select(CareerStage.Label).ToArray();_stage.SelectedIndex=Math.Max(0,Array.IndexOf(_stageKeys,stage));_scheduled.IsChecked=kind is "arranged" or "schedule";_scheduled.IsEnabled=kind!="schedule";
        _category.SelectedIndex=application?.Category switch {"internship"=>1,"campus"=>2,"full_time"=>3,_=>0};
        if(application is not null){_form.Children.Add(Text(application.Company+" · "+application.Title+" · 现在："+application.StatusLabel));var notes=application.Text("notes");_channel.Text=CareerNotes.Value("投递渠道",notes);_oral.Text=CareerNotes.Value("口头薪酬",notes);_payText.Text=CareerNotes.Value("薪酬说明",notes);_deadline.Text=CareerNotes.Value("回复截止",notes);_join.Text=CareerNotes.Value("预计入职",notes);_trial.Text=CareerNotes.Value("试用期",notes);_materials.Text=CareerNotes.Value("Offer 材料",notes);if(DateTimeOffset.TryParse(CareerNotes.Value("收到日期",notes),out var received))_received.Date=received;}
        if(kind is "arranged" or "schedule") {
            _existing.ItemsSource=new[]{"创建新岗位"}.Concat(_existingItems.Select(x=>x.Company+" · "+x.Title)).ToArray();
            _existing.SelectionChanged+=(_,_)=>{
                _creationFields.Visibility=_existing.SelectedIndex==0?Visibility.Visible:Visibility.Collapsed;
                var selected=_existing.SelectedIndex>0?_existingItems[_existing.SelectedIndex-1]:null;
                _reuse.Visibility=kind=="schedule"&&selected is not null&&selected.Raw["current_stage"]?["id"] is not null&&selected.Text("stage_state")=="awaiting_schedule"&&new[]{"assessment","written_test","ai_interview","interview"}.Contains(selected.Stage)?Visibility.Visible:Visibility.Collapsed;
                _reuse.IsChecked=_reuse.Visibility==Visibility.Visible;
                ConfigureStage(selected);
            };
            _form.Children.Add(_existing);_reuse.Visibility=Visibility.Collapsed;_form.Children.Add(_reuse);_reuse.Click+=(_,_)=>ConfigureStage(_existing.SelectedIndex>0?_existingItems[_existing.SelectedIndex-1]:null);
        }
        if(Creation) {
            foreach(var field in new FrameworkElement[]{_company,_role,_category,_city,_description})_creationFields.Children.Add(field);
            var parse=new Button{Content="智能提取岗位信息"};parse.Click+=async(_,_)=>await ParseAsync();_creationFields.Children.Add(parse);_form.Children.Add(_creationFields);
            var image=new Button{Content="选择岗位截图"};image.Click+=async(_,_)=>await ParseImageAsync();_creationFields.Children.Add(image);
        }
        if(kind=="category")_form.Children.Add(_category);
        if(kind=="notes"){_notes.Text=application?.Text("notes")??"";_form.Children.Add(_notes);}
        if(kind is "accept" or "decline" or "archive" or "restore")_form.Children.Add(Text(kind=="accept"?"确认接受这份正式 Offer？本次求职流程将结束，阶段记录会保留。":kind=="decline"?"确认婉拒这份正式 Offer？本次求职流程将结束，阶段记录会保留。":kind=="archive"?"归档后仍可查看和恢复。":"恢复显示该岗位，已结束的流程不会重新开始。"));
        if(kind=="schedule-current" && application is not null){_stageKeys=[application.Stage];_stage.ItemsSource=_stageKeys.Select(CareerStage.Label).ToArray();_stage.SelectedIndex=0;_reuse.IsChecked=true;_scheduled.IsChecked=true;_scheduled.IsEnabled=false;_stage.IsEnabled=false;}
        if(NeedsStage) {
            if(application is null || application.Stage=="pending"){_stageFields.Children.Add(_appliedDate);_stageFields.Children.Add(_channel);_stageFields.Children.Add(_resume);_=LoadResumesAsync();}
            _stageFields.Children.Add(_tiles);BuildTiles();_interviewFields.Children.Add(_label);_interviewFields.Children.Add(_round);_stageFields.Children.Add(_interviewFields);_stageFields.Children.Add(_scheduled);
            foreach(var field in new FrameworkElement[]{_window,_startDate,_startTime,_endDate,_endTime,_mode,_meeting,_location,_allowConflict})_scheduleFields.Children.Add(field);_stageFields.Children.Add(_scheduleFields);
            foreach(var field in new FrameworkElement[]{_offerIntent,_oral,_received,_deadline,_payText,_base,_join,_trial,_materials,_salary,_currency,_period,_benefits})_offerFields.Children.Add(field);_stageFields.Children.Add(_offerFields);_form.Children.Add(_stageFields);
            _offerIntent.SelectionChanged+=(_,_)=>UpdateFields();_stage.SelectionChanged+=(_,_)=>UpdateFields();_scheduled.Click+=(_,_)=>UpdateFields();UpdateFields();
        }
        if(kind=="offer") {
            _base.Text=application?.Text("offer_base_location")??"";_salary.Text=application?.Text("offer_salary")??"";_benefits.Text=application?.Text("offer_benefits_description")??"";
            _currency.SelectedIndex=application?.Text("offer_salary_currency")=="USD"?1:0;_period.SelectedIndex=application?.Text("offer_salary_period")=="year"?1:0;
            _offerIntent.SelectedIndex=1;_stageKeys=["offer"];_stage.ItemsSource=new[]{"Offer"};_stage.SelectedIndex=0;_form.Children.Add(_tiles);BuildTiles();foreach(var field in new FrameworkElement[]{_received,_deadline,_payText,_base,_join,_trial,_materials,_salary,_currency,_period,_benefits})_form.Children.Add(field);
        }
        if(kind=="terminate"){_form.Children.Add(Text("终止后保留岗位、阶段与排期历史。"));_form.Children.Add(_reason);}
        if(kind=="delete")_form.Children.Add(Text("确定永久删除岗位及其求职进程、阶段、排期和复盘？关联资料保留在资料库。此操作不能撤销。"));
        if(kind=="detail") {_notes.Text=application?.Text("notes")??"";_form.Children.Add(Text(application?.StatusLabel??""));_form.Children.Add(_notes);_=LoadDetailAsync();}
        _form.Children.Add(_error);
        View.ColumnDefinitions.Add(new ColumnDefinition{Width=new GridLength(272)});View.ColumnDefinitions.Add(new ColumnDefinition());
        var summary=new Grid{MinHeight=500};summary.Children.Add(new Image{Source=new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri("ms-appx:///Assets/Career/dot-grid.png")),Stretch=Stretch.Fill,Opacity=0.8});var copy=new StackPanel{Spacing=20,Padding=new Thickness(20)};
        void UpdateSummary(){copy.Children.Clear();copy.Children.Add(new TextBlock{Text="这一场怎么安排",FontSize=11});foreach(var previous in (application?.Raw["stages"]?.AsArray()??[]).TakeLast(3)){if(previous is null)continue;copy.Children.Add(new TextBlock{Text="● "+(previous["stage_label"]?.GetValue<string>()??""),FontSize=12});}copy.Children.Add(new TextBlock{Text="● "+(_kind=="offer"?"Offer · 正式录用":Stage=="interview"?_label.Text:CareerStage.Label(Stage))+"  · 本次",FontSize=12});copy.Children.Add(new Border{Height=1,Background=new SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(255,228,228,224))});copy.Children.Add(new TextBlock{Text="确认后会保存",FontSize=11});copy.Children.Add(new TextBlock{Text="阶段\n"+(_kind=="offer"?"进入「Offer · 待确认」":CareerStage.Label(Stage)),FontSize=12});if(_kind is "accept" or "decline" or "archive" or "restore" or "terminate"){copy.Children.Add(Text("记录\n保留已有阶段与面试记录"));copy.Children.Add(Text("确认\n更新该岗位的求职状态"));}else {copy.Children.Add(new TextBlock{Text=_kind=="offer"?"回复截止\n"+(_deadline.Text==""?"可选，稍后完善":_deadline.Text):"时间\n稍后安排",FontSize=12});copy.Children.Add(new TextBlock{Text=_kind=="offer"?"薪酬与地点\n"+_payText.Text+" · "+_base.Text:"方式\n视频",FontSize=12});}}
        UpdateSummary();_stage.SelectionChanged+=(_,_)=>UpdateSummary();_offerIntent.SelectionChanged+=(_,_)=>UpdateSummary();foreach(var field in new[]{_label,_deadline,_payText,_base})field.TextChanged+=(_,_)=>UpdateSummary();
        summary.Children.Add(copy);View.Children.Add(new Border{Child=summary,Background=new SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(255,247,247,245)),CornerRadius=new CornerRadius(14)});Grid.SetColumn(_form,1);View.Children.Add(_form);
    }
    private string OfferNotes=>CareerNotes.Merge(new(){["收到日期"]=(_received.Date??DateTimeOffset.Now).ToString("O"),["回复截止"]=_deadline.Text,["薪酬说明"]=_payText.Text,["预计入职"]=_join.Text,["试用期"]=_trial.Text,["Offer 材料"]=_materials.Text},_application?.Text("notes")??"");
    private void BuildTiles(){
        _tiles.Children.Clear();_tiles.ColumnDefinitions.Clear();_tiles.RowDefinitions.Clear();for(var i=0;i<4;i++)_tiles.ColumnDefinitions.Add(new ColumnDefinition());for(var i=0;i<2;i++)_tiles.RowDefinitions.Add(new RowDefinition());
        var options=new[]{("screening","筛选中","filter"),("assessment","测评","text"),("written_test","笔试","edit"),("ai_interview","AI 面试","spark"),("interview","面试","user"),("interview","HR 面","brief"),("offer","OC","phone"),("offer","Offer","mail")};
        for(var i=0;i<options.Length;i++){var (key,name,icon)=options[i];var chosen=Stage==key&&(key!="offer"||(_offerIntent.SelectedIndex==1)==(name=="Offer"))&&(key!="interview"||(_label.Text=="HR 面")==(name=="HR 面"));var copy=new StackPanel{Spacing=4};copy.Children.Add(new Image{Source=new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri("ms-appx:///Assets/Career/"+icon+".png")),Width=20,Height=20});copy.Children.Add(new TextBlock{Text=name,FontSize=12,HorizontalAlignment=HorizontalAlignment.Center});var button=new Button{Content=copy,Height=58,HorizontalAlignment=HorizontalAlignment.Stretch,HorizontalContentAlignment=HorizontalAlignment.Center,Background=new SolidColorBrush(Microsoft.UI.Colors.White),CornerRadius=new CornerRadius(10),BorderThickness=new Thickness(chosen?1.5:1),BorderBrush=new SolidColorBrush(chosen?Microsoft.UI.ColorHelper.FromArgb(255,29,29,27):Microsoft.UI.ColorHelper.FromArgb(255,228,228,224)),IsEnabled=_stageKeys.Contains(key)&&!_staged&&_stagePayload is null&&_kind!="offer"&&_kind!="schedule-current",Opacity=_stageKeys.Contains(key)?1:0.38};button.Click+=(_,_)=>{_stage.SelectedIndex=Array.IndexOf(_stageKeys,key);if(name=="HR 面")_label.Text="HR 面";else if(key=="interview"&&_label.Text=="HR 面")_label.Text="面试";if(key=="offer")_offerIntent.SelectedIndex=name=="Offer"?1:0;BuildTiles();};Grid.SetColumn(button,i%4);Grid.SetRow(button,i/4);_tiles.Children.Add(button);}
    }
    private void ConfigureStage(CareerApplication? selected) {
        var reuse=_reuse.IsChecked==true;
        _stageKeys=reuse?[selected!.Stage]:CareerStage.NextStages(selected).Where(x=>_kind!="schedule"||new[]{"assessment","written_test","ai_interview","interview"}.Contains(x)).ToArray();
        _stage.ItemsSource=_stageKeys.Select(CareerStage.Label).ToArray();_stage.SelectedIndex=Math.Max(0,Array.IndexOf(_stageKeys,"interview"));
        _label.Text=reuse?selected!.StageLabel:"一面";_round.Value=reuse?Math.Max(1,selected!.Raw["current_round_no"]?.GetValue<int>()??1):Math.Max(1,(selected?.Raw["current_round_no"]?.GetValue<int>()??0)+1);
        _stage.IsEnabled=_label.IsEnabled=_round.IsEnabled=!reuse;UpdateFields();
    }
    private void UpdateFields(){_offerIntent.Visibility=Visibility.Collapsed;_oral.Visibility=_offerIntent.SelectedIndex==0?Visibility.Visible:Visibility.Collapsed;foreach(var field in new FrameworkElement[]{_received,_deadline,_payText,_base,_join,_trial,_materials,_salary,_currency,_period,_benefits})field.Visibility=_offerIntent.SelectedIndex==1?Visibility.Visible:Visibility.Collapsed;_mode.Visibility=Stage=="interview"?Visibility.Visible:Visibility.Collapsed;_interviewFields.Visibility=Stage=="interview"?Visibility.Visible:Visibility.Collapsed;var schedule=new[]{"assessment","written_test","ai_interview","interview"}.Contains(Stage);_scheduled.Visibility=schedule?Visibility.Visible:Visibility.Collapsed;_scheduleFields.Visibility=schedule&&_scheduled.IsChecked==true?Visibility.Visible:Visibility.Collapsed;_window.Visibility=Stage is "assessment" or "written_test"?Visibility.Visible:Visibility.Collapsed;_offerFields.Visibility=Stage=="offer"?Visibility.Visible:Visibility.Collapsed;}
    private Task<JsonNode> Request(string path,string method="GET",JsonNode? body=null,Dictionary<string,string>? query=null)=>_api.CareerRequestAsync(path,method,query,body,_ct);
    private async Task LoadDetailAsync(){try {var data=await Request("/api/job-applications/"+_application!.Id);_ct.ThrowIfCancellationRequested();_application=new(data["application"]!);_notes.Text=_application.Text("notes");var history=new StackPanel{Spacing=10};history.Children.Add(Text("求职阶段"));foreach(var item in _application.Raw["stages"]?.AsArray()??[])history.Children.Add(Text($"● {item?["stage_label"]} · {item?["entered_at"]}"));_form.Children.Insert(2,history);
        if(_application.Text("job_description_id") is {Length:>0} jobId){var job=await Request("/api/job-descriptions/"+jobId);_ct.ThrowIfCancellationRequested();_form.Children.Insert(2,Text(job["job_description"]?["description"]?.GetValue<string>()??""));}
        var sessions=await Request("/api/interview-sessions",query:new(){{"application_id",_application.Id},{"limit","500"},{"include_archived","true"}});_ct.ThrowIfCancellationRequested();foreach(var item in sessions["items"]?.AsArray()??[]) {
            if(item is null)continue;
            var section=new StackPanel{Spacing=10};
            section.Children.Add(Text($"{item["stage_label"]} · {item["start_at"]} — {item["end_at"]}"));
            if(item["status"]?.GetValue<string>()=="scheduled") {
                var actions=new StackPanel{Orientation=Orientation.Horizontal,Spacing=10};
                foreach(var command in new[]{"reschedule","answer-plan","complete","cancel"}) {
                    var button=new Button{Content=command switch{"reschedule"=>"改期","answer-plan"=>"个人作答计划","complete"=>"标记完成",_=>"取消安排"}};
                    button.Click+=(_,_)=>EditSession(section,item,command);
                    actions.Children.Add(button);
                }
                section.Children.Add(actions);
            }
            _form.Children.Insert(_form.Children.Count-1,section);
        }
    }catch(OperationCanceledException){}catch(Exception e){_error.Text=JobsBoardPage.Explain(e);}}
    private void EditSession(StackPanel section,JsonNode item,string command) {
        if(_busy)return;
        if(section.Children.Count>2)section.Children.RemoveAt(2);
        var editor=new StackPanel{Spacing=10};editor.Children.Add(Text("确认"+(command switch{"reschedule"=>"改期","answer-plan"=>"个人作答计划","complete"=>"标记完成",_=>"取消安排"})));
        var from=CareerApplication.Date(item["start_at"]?.GetValue<string>()??"")?.ToLocalTime()??DateTimeOffset.Now;
        var to=CareerApplication.Date(item["end_at"]?.GetValue<string>()??"")?.ToLocalTime()??from.AddHours(1);
        var fromDate=new CalendarDatePicker{Header="开始日期",Date=from};var toDate=new CalendarDatePicker{Header="结束日期",Date=to};
        var fromTime=new TimePicker{Header="开始时间",Time=from.TimeOfDay};var toTime=new TimePicker{Header="结束时间",Time=to.TimeOfDay};
        if(command is "reschedule" or "answer-plan")foreach(var field in new FrameworkElement[]{fromDate,fromTime,toDate,toTime})editor.Children.Add(field);
        var confirm=new Button{Content="确认"};JsonObject? payload=null;
        confirm.Click+=async(_,_)=>{
            if(_busy)return;
            var begin=new DateTimeOffset((fromDate.Date??from).Date+fromTime.Time);
            var finish=new DateTimeOffset((toDate.Date??to).Date+toTime.Time);
            if((command is "reschedule" or "answer-plan") && finish<=begin){_error.Text="结束时间须晚于开始时间。";return;}
            payload??=new JsonObject{["base_lock_version"]=item["lock_version"]?.GetValue<int>()??1};
            if(command=="reschedule"){payload["start_at"]=begin.ToUniversalTime().ToString("O");payload["end_at"]=finish.ToUniversalTime().ToString("O");payload["timezone"]="Asia/Shanghai";}
            if(command=="answer-plan"){payload["answer_plan_start_at"]=begin.ToUniversalTime().ToString("O");payload["answer_plan_end_at"]=finish.ToUniversalTime().ToString("O");}
            _busy=true;confirm.IsEnabled=false;fromDate.IsEnabled=toDate.IsEnabled=fromTime.IsEnabled=toTime.IsEnabled=false;
            try {
                var result=await Request("/api/interview-sessions/"+item["id"]!.GetValue<string>()+"/"+command,command=="answer-plan"?"PUT":"POST",payload);
                _ct.ThrowIfCancellationRequested();item["lock_version"]=result["session"]?["lock_version"]?.DeepClone();
                editor.Children.Clear();editor.Children.Add(Text("已保存。关闭详情并刷新即可查看最新排期。"));
            }catch(Exception e){_error.Text=JobsBoardPage.Explain(e);}finally{_busy=false;confirm.IsEnabled=true;}
        };
        editor.Children.Add(confirm);section.Children.Add(editor);
    }
    private async Task LoadResumesAsync() {
        try {
            var result=await Request("/api/resumes");_ct.ThrowIfCancellationRequested();
            var values=result["resumes"]?.AsArray()??[];_resumeIds=values.Select(x=>x!["id"]!.GetValue<string>()).ToArray();
            _resume.ItemsSource=new[]{"不关联简历"}.Concat(values.Select(x=>x!["title"]!.GetValue<string>())).ToArray();
        }catch(OperationCanceledException){}catch(Exception e){_error.Text="简历列表暂不可用，可不关联简历继续。 "+JobsBoardPage.Explain(e);}
    }
    private async Task ParseImageAsync() {
        if(_busy || _application is not null)return;
        var picker=new Windows.Storage.Pickers.FileOpenPicker();
        picker.FileTypeFilter.Add(".png");picker.FileTypeFilter.Add(".jpg");picker.FileTypeFilter.Add(".jpeg");
        if(App.NativeWindow is not {} window)return;
        WinRT.Interop.InitializeWithWindow.Initialize(picker,WinRT.Interop.WindowNative.GetWindowHandle(window));
        var file=await picker.PickSingleFileAsync();if(file is null)return;
        var properties=await file.GetBasicPropertiesAsync();if(properties.Size>10*1024*1024){_error.Text="截图须为 10 MiB 以内的 PNG/JPEG。";return;}
        var buffer=await Windows.Storage.FileIO.ReadBufferAsync(file);
        using var reader=Windows.Storage.Streams.DataReader.FromBuffer(buffer);var data=new byte[checked((int)buffer.Length)];reader.ReadBytes(data);
        await ParseAsync(new JsonObject{["image_base64"]=Convert.ToBase64String(data),["content_type"]=file.FileType.ToLowerInvariant()==".png"?"image/png":"image/jpeg"});
    }
    private async Task ParseAsync(JsonNode? input=null){if(_busy||input is null&&string.IsNullOrWhiteSpace(_description.Text))return;_busy=true;try{var result=await Request("/api/job-descriptions/parse-draft","POST",input??new JsonObject{["text"]=_description.Text});_ct.ThrowIfCancellationRequested();var draft=result["draft"]!;_company.Text=draft["company_name"]?.GetValue<string>()??"";_role.Text=draft["job_title"]?.GetValue<string>()??"";_city.Text=draft["work_city"]?.GetValue<string>()??"";_description.Text=draft["description"]?.GetValue<string>()??_description.Text;_category.SelectedIndex=draft["employment_type"]?.GetValue<string>() switch{"internship"=>1,"campus"=>2,"full_time"=>3,_=>0};}catch(Exception e){_error.Text=JobsBoardPage.Explain(e);}finally{_busy=false;}}
    private string? Category=>_category.SelectedIndex switch{1=>"internship",2=>"campus",3=>"full_time",_=>null};
    private DateTimeOffset Start=>( _startDate.Date??DateTimeOffset.Now).Date+_startTime.Time;
    private DateTimeOffset End=>(_endDate.Date??DateTimeOffset.Now).Date+_endTime.Time;
    private async Task SaveOfferAsync(string prefix,CareerApplication app){
        _offerPayload??=new JsonObject{["base_lock_version"]=app.LockVersion,["base_location"]=_base.Text==""?null:_base.Text,["salary"]=_salary.Text==""?null:decimal.Parse(_salary.Text),["salary_currency"]=_salary.Text==""?null:_currency.SelectedItem.ToString(),["salary_period"]=_salary.Text==""?null:_period.SelectedIndex==0?"month":"year",["benefits_description"]=_benefits.Text==""?null:_benefits.Text,["notes"]=OfferNotes};
        View.IsHitTestVisible=false;
        await Request(prefix+"/offer","POST",_offerPayload);
    }
    public async Task<bool> SaveAsync(){if(_busy)return false;_error.Text="";
        if(Creation&&_application is null&&(string.IsNullOrWhiteSpace(_company.Text)||string.IsNullOrWhiteSpace(_role.Text))){_error.Text="请填写公司和岗位名称。";return false;}
        if(NeedsStage&&_scheduled.IsChecked==true&&End<=Start){_error.Text="结束时间须晚于开始时间。";return false;}
        if(NeedsStage&&Stage=="interview"&&(!double.IsFinite(_round.Value)||_round.Value!=Math.Truncate(_round.Value)||_round.Value<1)){_error.Text="请填写有效面试轮次。";return false;}
        if(NeedsStage&&Stage=="interview"&&string.IsNullOrWhiteSpace(_label.Text)){_error.Text="请填写面试名称。";return false;}
        if(_salary.Text!=""&&(!decimal.TryParse(_salary.Text,out var amount)||amount<0)){_error.Text="薪资无效。";return false;}
        _busy=true;var creating=false;
        try {
            if((_kind is "arranged" or "schedule")&&_existing.SelectedIndex>0&&_application is null){
                var detail=await Request("/api/job-applications/"+_existingItems[_existing.SelectedIndex-1].Id);
                _application=new(detail["application"]!);
            }
            if(Creation&&_application is null){if(_createdId is null){creating=true;var result=await Request("/api/job-descriptions","POST",new JsonObject{["company_name"]=_company.Text.Trim(),["job_title"]=_role.Text.Trim(),["description"]=_description.Text,["employment_type"]=Category,["work_city"]=string.IsNullOrWhiteSpace(_city.Text)?null:_city.Text.Trim(),["source_type"]="manual"});_createdId=result["application"]?["id"]?.GetValue<string>()??throw new InvalidDataException();creating=false;}
                var detail=await Request("/api/job-applications/"+_createdId);_application=new(detail["application"]!);
            }
            var app=_application??throw new InvalidDataException();var prefix="/api/job-applications/"+app.Id;
            if(_kind=="offer")await SaveOfferAsync(prefix,app);
            else if(_kind is "accept" or "decline")await Request(prefix+"/close","POST",new JsonObject{["base_lock_version"]=app.LockVersion,["status"]="closed",["offer_status"]=_kind=="accept"?"accepted":"declined"});
            else if(_kind is "archive" or "restore")await Request(prefix+"/"+_kind,"POST",new JsonObject{["base_lock_version"]=app.LockVersion});
            else if(_kind=="notes")await Request(prefix,"PUT",new JsonObject{["base_lock_version"]=app.LockVersion,["notes"]=_notes.Text});
            else if(_kind=="delete")await Request(prefix,"DELETE");
            else if(_kind=="category")await Request(prefix,"PUT",new JsonObject{["base_lock_version"]=app.LockVersion,["employment_type"]=Category});
            else if(_kind=="detail")await Request(prefix,"PUT",new JsonObject{["base_lock_version"]=app.LockVersion,["notes"]=_notes.Text});
            else if(_kind=="terminate"){_stagePayload??=new JsonObject{["client_request_id"]=Guid.NewGuid().ToString(),["base_lock_version"]=app.LockVersion,["reason"]=_reason.SelectedIndex switch{1=>"company_rejected",2=>"completed",3=>"other",_=>"user_withdrew"}};await Request(prefix+"/terminate","POST",_stagePayload);}
            else if(NeedsStage){
                if(_reuse.IsChecked==true&&!_staged){_staged=true;_existing.IsEnabled=_reuse.IsEnabled=false;}
                if(!_staged){_stagePayload??=new JsonObject{["client_request_id"]=Guid.NewGuid().ToString(),["base_lock_version"]=app.LockVersion,["stage_type"]=Stage,["stage_label"]=Stage=="interview"?_label.Text.Trim():Stage=="offer"&&_offerIntent.SelectedIndex==0?"OC":CareerStage.Label(Stage),["interview_round_no"]=Stage=="interview"?(int)_round.Value:null,["applied_at"]=app.Stage=="pending"?(_appliedDate.Date??DateTimeOffset.Now).ToUniversalTime().ToString("O"):null,["resume_id"]=_resume.SelectedIndex>0?_resumeIds[_resume.SelectedIndex-1]:null,["notes"]=CareerNotes.Merge(new(){["投递渠道"]=_channel.Text,["口头薪酬"]=_oral.Text},app.Text("notes"))};var result=await Request(prefix+"/stages","POST",_stagePayload);_application=new(result["application"]!);_staged=true;BuildTiles();_stage.IsEnabled=false;_existing.IsEnabled=false;_label.IsEnabled=false;_round.IsEnabled=false;_scheduled.IsEnabled=false;}
                if(_scheduled.IsChecked==true&&new[]{"assessment","written_test","ai_interview","interview"}.Contains(Stage)&&!_sessionSaved){_sessionPayload??=new JsonObject{["client_request_id"]=Guid.NewGuid().ToString(),["application_stage_id"]=_application.Raw["current_stage"]?["id"]?.GetValue<string>(),["stage_type"]=Stage=="interview"?"interview":"other",["stage_label"]=_reuse.IsChecked==true?_application.Raw["current_stage"]?["stage_label"]?.GetValue<string>():Stage=="interview"?_label.Text.Trim():CareerStage.Label(Stage),["round_no"]=Stage=="interview"?(int)_round.Value:null,["start_at"]=Start.ToUniversalTime().ToString("O"),["end_at"]=End.ToUniversalTime().ToString("O"),["schedule_kind"]=_window.IsChecked==true&&(Stage is "assessment" or "written_test")?"open_window":"fixed_slot",["timezone"]="Asia/Shanghai",["mode"]=Stage=="interview"?new[]{"video","onsite","phone","other"}[_mode.SelectedIndex]:"other",["allow_conflict"]=_allowConflict.IsChecked==true,["meeting_url"]=_meeting.Text==""?null:_meeting.Text,["location"]=_location.Text==""?null:_location.Text};await Request(prefix+"/interview-sessions","POST",_sessionPayload);_sessionSaved=true;}
                if(Stage=="offer"&&_offerIntent.SelectedIndex==1)await SaveOfferAsync(prefix,_application);
            }
            return true;
        }catch(Exception e){if(creating&&!(e is ApiException known&&(int)known.Status>=400&&(int)known.Status<500))Unknown=true;
            if(e is ApiException api&&(api.Status is HttpStatusCode.BadRequest or HttpStatusCode.UnprocessableEntity or HttpStatusCode.Conflict)&&api.Code!="INTERVIEW_EDIT_CONFLICT"){if(!_staged)_stagePayload=null;if(!_sessionSaved)_sessionPayload=null;_offerPayload=null;View.IsHitTestVisible=true;}
            _error.Text=Unknown?"创建结果尚未确认，请关闭后刷新列表确认，避免重复创建。":JobsBoardPage.Explain(e)+(_staged?" 阶段已保存，重试仅处理剩余步骤。":"");return false;
        }finally{_busy=false;}
    }
}
