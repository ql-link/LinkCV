using System.ComponentModel;
using System.Text.Json.Nodes;
using LinkResume.Core.Models;
using LinkResume.Core.Session;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.ApplicationModel.DataTransfer;

namespace LinkResume.App.Views;

/// Native calendar. Guest navigation is public; only mutations require an account.
public sealed class InterviewSchedulePage : Page {
    private readonly Grid _root=new(){MaxWidth=1264,Padding=new Thickness(32,52,32,20),RowSpacing=18};
    private readonly Grid _calendar=new();
    private readonly StackPanel _next=new(){Spacing=10};
    private readonly TextBlock _title=Text("",28),_subtitle=Text("",13,true),_error=Text("",12,true);
    private readonly CancellationTokenSource _life=new();
    private readonly CalendarDatePicker _date=new(){Date=DateTimeOffset.Now};
    private DateOnly _anchor=DateOnly.FromDateTime(DateTime.Today);
    private string _mode="month",_query="";
    private bool _cancelled;
    private int _generation;
    private List<ScheduledInterview> _items=[];
    private List<CareerApplication> _applications=[];
    private ContentDialog? _dialog;
    private DateTimeOffset? _pending;
    private static SolidColorBrush Brush(int color)=>new(Windows.UI.Color.FromArgb(255,(byte)(color>>16),(byte)(color>>8),(byte)color));
    internal static TextBlock Text(string value,double size=13,bool muted=false)=>new(){Text=value,FontSize=size,TextWrapping=TextWrapping.Wrap,Foreground=Brush(muted?0x96968F:0x17191C)};
    internal static Button Button(string title,Action action,bool dark=false) {
        var value=new Button{Content=title,Padding=new Thickness(12,7,12,7),CornerRadius=new CornerRadius(8),Background=Brush(dark?0x17191C:0xFFFFFF),Foreground=Brush(dark?0xFFFFFF:0x17191C)};
        value.Click+=(_,_)=>action();return value;
    }
    private IEnumerable<ScheduledInterview> Visible=>_items.Where(x=>(_cancelled||x.Text("status")!="cancelled")&&(_query==""||(x.Company+x.Title+x.Label).Contains(_query,StringComparison.OrdinalIgnoreCase)));
    private DateOnly Week=>ScheduleCalendar.WeekStart(_anchor);
    private DateOnly Month=>new(_anchor.Year,_anchor.Month,1);
    private IEnumerable<ScheduledInterview> Day(DateOnly date)=>Visible.Where(x=>x.Overlaps(ScheduleCalendar.LocalDate(date),ScheduleCalendar.LocalDate(date.AddDays(1)))).OrderBy(x=>x.Start);
    public InterviewSchedulePage() {
        foreach(var height in new[]{GridLength.Auto,GridLength.Auto,new GridLength(1,GridUnitType.Star),GridLength.Auto})_root.RowDefinitions.Add(new(){Height=height});
        var head=new Grid();head.ColumnDefinitions.Add(new());head.ColumnDefinitions.Add(new(){Width=GridLength.Auto});
        var copy=new StackPanel{Spacing=8};copy.Children.Add(Text("SCHEDULE · 面试排期",11,true));_title.FontFamily=new FontFamily("SimSun");copy.Children.Add(_title);copy.Children.Add(_subtitle);head.Children.Add(copy);
        var nav=new StackPanel{Orientation=Orientation.Horizontal,Spacing=8,VerticalAlignment=VerticalAlignment.Center};
        foreach(var mode in new[]{("month","月"),("week","周"),("list","列表")})nav.Children.Add(Button(mode.Item2,()=>{_mode=mode.Item1;Render();}));
        nav.Children.Add(Button("‹",()=>Shift(-1)));nav.Children.Add(Button("今天",()=>{_anchor=DateOnly.FromDateTime(DateTime.Today);Render();}));nav.Children.Add(Button("›",()=>Shift(1)));
        _date.DateChanged+=(_,_)=>{if(_date.Date is {} date){_anchor=DateOnly.FromDateTime(date.Date);Render();}};_date.Width=130;nav.Children.Add(_date);
        Grid.SetColumn(nav,1);head.Children.Add(nav);_root.Children.Add(head);
        var toolbar=new Grid();toolbar.ColumnDefinitions.Add(new());toolbar.ColumnDefinitions.Add(new(){Width=GridLength.Auto});
        var tools=new StackPanel{Orientation=Orientation.Horizontal,Spacing=10};
        var search=new TextBox{PlaceholderText="搜索公司、岗位或面试",Width=250};search.TextChanged+=(_,_)=>{_query=search.Text;Render();};tools.Children.Add(search);
        var cancelled=new CheckBox{Content="显示已取消安排"};cancelled.Click+=(_,_)=>{_cancelled=cancelled.IsChecked==true;Render();};tools.Children.Add(cancelled);
        tools.Children.Add(Button("刷新",()=>_=LoadAsync()));toolbar.Children.Add(tools);
        var create=Button("新建面试",()=>_=CreateAsync(ScheduleCalendar.LocalDate(_anchor,TimeSpan.FromHours(9))),true);Grid.SetColumn(create,1);toolbar.Children.Add(create);Grid.SetRow(toolbar,1);_root.Children.Add(toolbar);
        Grid.SetRow(_calendar,2);_root.Children.Add(_calendar);Grid.SetRow(_next,3);_root.Children.Add(_next);Content=_root;
        Loaded+=async(_,_)=>{App.Session.PropertyChanged+=OnSession;Render();await LoadAsync();};
        Unloaded+=(_,_)=>{++_generation;_life.Cancel();_dialog?.Hide();App.Session.PropertyChanged-=OnSession;};
    }
    private async void OnSession(object? sender,PropertyChangedEventArgs e) {
        if(e.PropertyName!=nameof(SessionViewModel.Phase))return;
        ++_generation;_items=[];_applications=[];_dialog?.Hide();_query="";Render();await LoadAsync();
        if(App.Session.Phase!=SessionViewModel.SessionPhase.SignedIn)_pending=null;
    }
    private void Shift(int amount){_anchor=_mode=="month"?_anchor.AddMonths(amount):_anchor.AddDays(amount*7);Render();}
    private async Task LoadAsync() {
        var generation=++_generation;_error.Text="";
        if(App.Session.Phase!=SessionViewModel.SessionPhase.SignedIn){Render();return;}
        try {
            async Task<List<JsonNode>> Pages(string path,Dictionary<string,string> query) {
                List<JsonNode> items=[];HashSet<string> seen=[];var cursor="";
                do {
                    if(cursor!="")query["cursor"]=cursor;
                    var result=await App.Session.Api.CareerRequestAsync(path,query:query,ct:_life.Token);
                    _life.Token.ThrowIfCancellationRequested();items.AddRange((result["items"]?.AsArray()??[]).Where(x=>x is not null).Select(x=>x!));
                    cursor=result["next_cursor"]?.GetValue<string>()??"";if(cursor!=""&&!seen.Add(cursor))throw new InvalidDataException();
                }while(cursor!="");return items;
            }
            var sessions=await Pages("/api/interview-sessions",new(){{"limit","500"}});
            var apps=await Pages("/api/job-applications",new(){{"scope","all"},{"limit","200"}});
            if(generation!=_generation||_life.IsCancellationRequested)return;
            _items=sessions.Select(x=>new ScheduledInterview(x)).ToList();_applications=apps.Select(x=>new CareerApplication(x)).ToList();Render();
        }catch(OperationCanceledException){}catch(Exception e){if(generation==_generation){_error.Text=JobsBoardPage.Explain(e);Render();}}
    }
    private void Render() {
        _title.Text=_mode=="month"?$"{_anchor.Year}年 {_anchor.Month}月":$"{Week:MM月dd日} — {Week.AddDays(6):MM月dd日}";
        _subtitle.Text=App.Session.Phase==SessionViewModel.SessionPhase.SignedIn?"点击安排查看详情，双击空白时间新增":"游客模式 · 登录后管理面试安排";
        _calendar.Children.Clear();_calendar.RowDefinitions.Clear();_calendar.ColumnDefinitions.Clear();
        if(_mode=="month")MonthView();else if(_mode=="week")WeekView();else ListView();
        _next.Children.Clear();if(_error.Text!="")_next.Children.Add(_error);_next.Children.Add(Text("接下来",11,true));
        var next=ScheduleCalendar.Upcoming(Visible,DateTimeOffset.Now);
        if(next.Length==0)_next.Children.Add(Text("接下来没有安排的面试或笔试",12,true));
        foreach(var item in next)_next.Children.Add(Button($"{(item.OpenWindow?item.End:item.Start).ToLocalTime():M/d HH:mm}  {item.Company} · {item.Title} · {item.Label}  {item.Status(DateTimeOffset.Now)}",()=>_=OpenAsync(item)));
    }
    private void MonthView() {
        var days=ScheduleCalendar.MonthDays(_anchor);
        for(var col=0;col<7;col++)_calendar.ColumnDefinitions.Add(new());
        _calendar.RowDefinitions.Add(new(){Height=new GridLength(30)});
        for(var row=0;row<days.Length/7;row++)_calendar.RowDefinitions.Add(new());
        for(var col=0;col<7;col++){var label=Text(new[]{"周一","周二","周三","周四","周五","周六","周日"}[col],11,true);label.HorizontalAlignment=HorizontalAlignment.Center;Grid.SetColumn(label,col);_calendar.Children.Add(label);}
        for(var i=0;i<days.Length;i++) {
            var date=days[i];var content=new StackPanel{Spacing=4,Padding=new Thickness(7)};
            var number=Button(date.Day.ToString(),()=>{_anchor=date;_mode="week";Render();},date==DateOnly.FromDateTime(DateTime.Today));number.FontSize=12;number.Padding=new Thickness(4);number.HorizontalAlignment=HorizontalAlignment.Left;number.Opacity=date.Month==_anchor.Month?1:0.4;content.Children.Add(number);
            var events=Day(date).ToArray();foreach(var item in events.Take(3))content.Children.Add(Chip(item));
            if(events.Length>3){var overflow=new StackPanel{Spacing=6};foreach(var item in events.Skip(3))overflow.Children.Add(Chip(item));content.Children.Add(new Button{Content=$"另有 {events.Length-3} 项",FontSize=10,Flyout=new Flyout{Content=new ScrollViewer{Content=overflow,MaxHeight=400}}});}
            var cell=new Border{Child=content,BorderBrush=Brush(0xE8E8E4),BorderThickness=new Thickness(0.5),Background=Brush(date==DateOnly.FromDateTime(DateTime.Today)?0xF8F8F5:0xFFFFFF),AllowDrop=true};
            cell.DoubleTapped+=(_,e)=>{if(e.OriginalSource is not Microsoft.UI.Xaml.Controls.Button)_=CreateAsync(ScheduleCalendar.LocalDate(date,TimeSpan.FromHours(9)));};
            ConfigureDrop(cell,date,false);Grid.SetColumn(cell,i%7);Grid.SetRow(cell,1+i/7);_calendar.Children.Add(cell);
        }
    }
    private Button Chip(ScheduledInterview item) {
        var value=Button($"{item.Start.ToLocalTime():HH:mm}  {item.Caption}",()=>_=OpenAsync(item));
        value.Content=new TextBlock{Text=$"{item.Start.ToLocalTime():HH:mm}  {item.Caption}",FontSize=10,TextTrimming=TextTrimming.CharacterEllipsis};
        value.Padding=new Thickness(5,4,5,4);value.HorizontalAlignment=HorizontalAlignment.Stretch;value.HorizontalContentAlignment=HorizontalAlignment.Left;value.Background=Brush(EventColor(item));value.BorderThickness=new Thickness(0);value.CanDrag=item.Editable&&!item.OpenWindow;
        value.DragStarting+=(_,e)=>e.Data.SetText(item.Id);return value;
    }
    private static int EventColor(ScheduledInterview item)=>item.Text("calendar_color") switch{"green"=>0xEAF4EB,"purple"=>0xF1EAF8,"red"=>0xF8EAEA,"orange"=>0xFAEFE2,"gray"=>0xF0F0ED,_=>0xEAF0F9};
    private void ConfigureDrop(FrameworkElement view,DateOnly day,bool timed) {
        view.AllowDrop=true;view.DragOver+=(_,e)=>e.AcceptedOperation=DataPackageOperation.Move;
        view.Drop+=async(_,e)=>{
            if(!e.DataView.Contains(StandardDataFormats.Text))return;
            var id=await e.DataView.GetTextAsync();var original=_items.FirstOrDefault(x=>x.Id==id);var item=timed?original?.Timed:original;if(item is null||!item.Editable||item.OpenWindow&&!timed)return;
            var minute=timed?Math.Clamp((int)Math.Round(e.GetPosition(view).Y/56*60/15)*15,0,1425):(int)item.Start.ToLocalTime().TimeOfDay.TotalMinutes;
            var from=ScheduleCalendar.LocalDate(day,TimeSpan.FromMinutes(minute));await OpenAsync(original!,item.OpenWindow?"answer-plan":"reschedule",from,from+(item.End-item.Start));
        };
    }
    private void WeekView() {
        var wrap=new Grid();wrap.RowDefinitions.Add(new(){Height=GridLength.Auto});wrap.RowDefinitions.Add(new());
        var headings=new Grid{Margin=new Thickness(45,0,0,8)};for(var i=0;i<7;i++){headings.ColumnDefinitions.Add(new());var label=Text($"{Week.AddDays(i):ddd d}",12);Grid.SetColumn(label,i);headings.Children.Add(label);}wrap.Children.Add(headings);
        var canvas=new Grid{Height=1344,MinWidth=700};canvas.ColumnDefinitions.Add(new(){Width=new GridLength(45)});for(var i=0;i<7;i++)canvas.ColumnDefinitions.Add(new());
        var hours=new StackPanel();for(var hour=0;hour<24;hour++)hours.Children.Add(new Border{Height=56,BorderBrush=Brush(0xE8E8E4),BorderThickness=new Thickness(0,0.5,0,0),Child=Text($"{hour:00}:00",10,true)});canvas.Children.Add(hours);
        for(var index=0;index<7;index++){
            var day=Week.AddDays(index);var column=new Grid{BorderBrush=Brush(0xE8E8E4),BorderThickness=new Thickness(0.5,0,0,0),Background=Brush(0xFFFFFF)};
            for(var hour=0;hour<24;hour++)column.Children.Add(new Border{VerticalAlignment=VerticalAlignment.Top,Margin=new Thickness(0,hour*56,0,0),Height=0.5,Background=Brush(0xE8E8E4)});
            Windows.Foundation.Point? selectionStart=null;
            column.PointerPressed+=(_,e)=>{if(e.OriginalSource is Microsoft.UI.Xaml.Controls.Grid or Microsoft.UI.Xaml.Controls.Border)selectionStart=e.GetCurrentPoint(column).Position;};
            column.PointerReleased+=(_,e)=>{
                if(selectionStart is {} origin){selectionStart=null;var point=e.GetCurrentPoint(column).Position;if(Math.Abs(point.Y-origin.Y)>8){var a=Math.Clamp((int)Math.Round(Math.Min(origin.Y,point.Y)/56*60/15)*15,0,1425);var b=Math.Clamp((int)Math.Round(Math.Max(origin.Y,point.Y)/56*60/15)*15,15,1439);if(b>a)_=CreateAsync(ScheduleCalendar.LocalDate(day,TimeSpan.FromMinutes(a)),ScheduleCalendar.LocalDate(day,TimeSpan.FromMinutes(b)));}}
            };
            column.DoubleTapped+=(_,e)=>{var minutes=Math.Clamp((int)Math.Round(e.GetPosition(column).Y/56*60/15)*15,0,1425);_=CreateAsync(ScheduleCalendar.LocalDate(day,TimeSpan.FromMinutes(minutes)));};ConfigureDrop(column,day,true);
            var events=Visible.Select(x=>x.Timed).Where(x=>x is not null&&x.Overlaps(ScheduleCalendar.LocalDate(day),ScheduleCalendar.LocalDate(day.AddDays(1)))).Select(x=>x!).ToArray();var lanes=ScheduleCalendar.Lanes(events);
            column.SizeChanged+=(_,_)=>PositionEvents();
            void PositionEvents(){
                foreach(var previous in column.Children.OfType<Button>().ToArray())column.Children.Remove(previous);
                foreach(var item in events){
                    var lane=lanes[item.Id];var from=item.Start<ScheduleCalendar.LocalDate(day)?ScheduleCalendar.LocalDate(day):item.Start;var until=item.End>ScheduleCalendar.LocalDate(day.AddDays(1))?ScheduleCalendar.LocalDate(day.AddDays(1)):item.End;
                    var chip=Chip(item);chip.CanDrag=item.Editable;chip.VerticalAlignment=VerticalAlignment.Top;chip.HorizontalAlignment=HorizontalAlignment.Left;chip.Width=Math.Max(20,column.ActualWidth/lane.Count-4);chip.Height=Math.Max(26,(until-from).TotalHours*56);chip.Margin=new Thickness(lane.Index*column.ActualWidth/lane.Count+2,from.ToLocalTime().TimeOfDay.TotalHours*56,0,0);column.Children.Add(chip);
                    if(item.Editable){
                        var face=new Grid();face.Children.Add(Text(item.Caption+"\n"+item.Start.ToLocalTime().ToString("HH:mm"),10));
                        foreach(var top in new[]{true,false}){
                            var grip=new Microsoft.UI.Xaml.Controls.Primitives.Thumb{Height=5,HorizontalAlignment=HorizontalAlignment.Stretch,VerticalAlignment=top?VerticalAlignment.Top:VerticalAlignment.Bottom,Opacity=0.4};double change=0;
                            grip.DragStarted+=(_,_)=>change=0;grip.DragDelta+=(_,e)=>change+=e.VerticalChange;
                            grip.DragCompleted+=(_,_)=>{var minutes=(int)Math.Round(change/56*60/15)*15;var from=top?item.Start.AddMinutes(minutes):item.Start;var until=top?item.End:item.End.AddMinutes(minutes);if(until-from>=TimeSpan.FromMinutes(15))_=OpenAsync(_items.First(x=>x.Id==item.Id),item.OpenWindow?"answer-plan":"reschedule",from,until);};face.Children.Add(grip);
                        }
                        chip.Content=face;
                    }
                    var menu=new MenuFlyout();foreach(var delta in new[]{-15,15}){var resize=new MenuFlyoutItem{Text=delta<0?"缩短 15 分钟":"延长 15 分钟"};resize.Click+=(_,_)=>{if(item.Editable&&item.End.AddMinutes(delta)>item.Start)_=OpenAsync(_items.First(x=>x.Id==item.Id),item.OpenWindow?"answer-plan":"reschedule",item.Start,item.End.AddMinutes(delta));};menu.Items.Add(resize);}chip.ContextFlyout=menu;
                }
            }
            Grid.SetColumn(column,index+1);canvas.Children.Add(column);
        }
        var scroll=new ScrollViewer{Content=canvas,VerticalScrollBarVisibility=ScrollBarVisibility.Auto,HorizontalScrollBarVisibility=ScrollBarVisibility.Auto,HorizontalScrollMode=ScrollMode.Enabled};scroll.Loaded+=(_,_)=>scroll.ChangeView(null,8*56,null);Grid.SetRow(scroll,1);wrap.Children.Add(scroll);
        var windows=Visible.Where(x=>x.OpenWindow&&x.Overlaps(ScheduleCalendar.LocalDate(Week),ScheduleCalendar.LocalDate(Week.AddDays(7)))).ToArray();
        if(windows.Length>0){wrap.RowDefinitions.Insert(1,new(){Height=GridLength.Auto});Grid.SetRow(scroll,2);var strip=new StackPanel{Orientation=Orientation.Horizontal,Spacing=8};strip.Children.Add(Text("作答窗口",11,true));foreach(var item in windows)strip.Children.Add(Chip(item));Grid.SetRow(strip,1);wrap.Children.Add(new ScrollViewer{Content=strip,HorizontalScrollMode=ScrollMode.Enabled,HorizontalScrollBarVisibility=ScrollBarVisibility.Auto});Grid.SetRow((FrameworkElement)wrap.Children.Last(),1);}
        _calendar.Children.Add(wrap);
    }
    private void ListView(){
        var panel=new StackPanel{Spacing=10};panel.Children.Add(Text("时间 · 公司 / 岗位 · 阶段与状态",11,true));
        foreach(var item in Visible.Where(x=>x.Overlaps(ScheduleCalendar.LocalDate(Week),ScheduleCalendar.LocalDate(Week.AddDays(7)))).OrderBy(x=>x.Start))panel.Children.Add(Button($"{item.Start.ToLocalTime():M/d HH:mm}  {item.Company} · {item.Title}  {item.Label} · {item.Status(DateTimeOffset.Now)}",()=>_=OpenAsync(item)));
        _calendar.Children.Add(new ScrollViewer{Content=panel});
    }
    private async Task CreateAsync(DateTimeOffset start,DateTimeOffset? end=null){
        if(_dialog is not null)return;
        if(App.Session.Phase!=SessionViewModel.SessionPhase.SignedIn){_pending=start;await WorkspacePage.Current.RequestLoginAsync(reason:"登录后管理面试安排");if(App.Session.Phase!=SessionViewModel.SessionPhase.SignedIn){_pending=null;return;}await LoadAsync();start=_pending??start;_pending=null;}
        var form=new CareerDialogForm("schedule",null,"interview","一面",App.Session.Api,_life.Token,_applications,start:start,end:end??start.AddHours(1));
        var dialog=new ContentDialog{XamlRoot=XamlRoot,Title=form.Title,Content=new ScrollViewer{Content=form.View,MaxHeight=600},PrimaryButtonText="保存",CloseButtonText="取消"};_dialog=dialog;
        dialog.CloseButtonClick+=(_,e)=>e.Cancel=form.Busy;
        dialog.PrimaryButtonClick+=async(_,e)=>{var defer=e.GetDeferral();dialog.IsPrimaryButtonEnabled=dialog.IsSecondaryButtonEnabled=false;try{e.Cancel=!await form.SaveAsync();}finally{dialog.IsPrimaryButtonEnabled=!form.Unknown;dialog.IsSecondaryButtonEnabled=true;defer.Complete();}};
        try{await dialog.ShowAsync();}finally{_dialog=null;}await LoadAsync();
    }
    private async Task OpenAsync(ScheduledInterview item,string kind="detail",DateTimeOffset? start=null,DateTimeOffset? end=null){
        if(_dialog is not null||App.Session.Phase!=SessionViewModel.SessionPhase.SignedIn)return;
        var form=new ScheduleSessionForm(item,kind,start??item.Start,end??item.End,_items,App.Session.Api,_life.Token);
        var dialog=new ContentDialog{XamlRoot=XamlRoot,Title="面试安排",Content=new ScrollViewer{Content=form.View,MaxHeight=600},CloseButtonText="关闭"};_dialog=dialog;
        dialog.CloseButtonClick+=(_,e)=>e.Cancel=form.Busy;form.Saved+=()=>dialog.Hide();var generation=_generation;try{await form.LoadAsync();if(generation!=_generation||_life.IsCancellationRequested||App.Session.Phase!=SessionViewModel.SessionPhase.SignedIn)return;await dialog.ShowAsync();}finally{_dialog=null;}await LoadAsync();
    }
}
