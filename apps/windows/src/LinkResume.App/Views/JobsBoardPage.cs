using System.Text.Json.Nodes;
using System.Net;
using LinkResume.Core.Api;
using LinkResume.Core.Models;
using LinkResume.Core.Session;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;
using Windows.ApplicationModel.DataTransfer;

namespace LinkResume.App.Views;

public sealed class JobsBoardPage : Page
{
    private readonly CancellationTokenSource _life = new();
    private readonly Grid _root = new() { Padding = new Thickness(32,52,32,20), RowSpacing = 24, MaxWidth=924, HorizontalAlignment=HorizontalAlignment.Stretch };
    private readonly Grid _body = new();
    private readonly TextBlock _subtitle = Text("0 个进行中 · 0 场面试",13,true);
    private readonly TextBlock[] _stats = Enumerable.Range(0,4).Select(_ => Text("—",22)).ToArray();
    private readonly HashSet<string> _hidden = [];
    private readonly List<string> _order = [];
    private List<CareerApplication> _items = [];
    private readonly Dictionary<string,Microsoft.UI.Xaml.Media.Imaging.BitmapImage> _logos=[];
    private readonly HashSet<string> _pendingLogos=[];
    private string _query = "";
    private bool _earliest, _grouped, _list;
    private int _generation;
    private ContentDialog? _dialog;
    private string? _pending;
    private static SolidColorBrush Brush(int color) => new(Windows.UI.Color.FromArgb(255,(byte)(color >> 16),(byte)(color >> 8),(byte)color));
    private static TextBlock Text(string text,double size=13,bool muted=false) => new() { Text=text, FontFamily=new FontFamily("ms-appx:///Assets/Library/LibrarySans-Regular.otf#LinkResume Library Sans"), FontSize=size, Foreground=Brush(muted ? 0x96968F : 0x17191C), TextWrapping=TextWrapping.Wrap };
    private static Button Button(string title,Action action,bool dark=false) {
        var button=new Button { Content=title, FontSize=13, Padding=new Thickness(14,9,14,9), CornerRadius=new CornerRadius(8), Background=Brush(dark ? 0x17191C : 0xFFFFFF), Foreground=Brush(dark ? 0xFFFFFF : 0x17191C), BorderThickness=new Thickness(dark ? 0 : 1) }; button.Click+=(_,_)=>action(); return button;
    }
    public JobsBoardPage() {
        for(var i=0;i<4;i++) _root.RowDefinitions.Add(new RowDefinition { Height=i==3 ? new GridLength(1,GridUnitType.Star) : GridLength.Auto });
        var head=new Grid(); head.ColumnDefinitions.Add(new ColumnDefinition()); head.ColumnDefinitions.Add(new ColumnDefinition { Width=GridLength.Auto });
        var copy=new StackPanel { Spacing=8 }; var today=DateTime.Today; var start=today.AddDays(-(((int)today.DayOfWeek+6)%7));
        copy.Children.Add(Text($"CAREER · 本周 {start:M.d} 至 {start.AddDays(6):M.d}",11,true));
        copy.Children.Add(new TextBlock { Text="岗位看板", FontFamily=new FontFamily("ms-appx:///Assets/Library/LibrarySerif-SemiBold.ttf#LinkResume Library Serif"),FontSize=28 }); copy.Children.Add(_subtitle); head.Children.Add(copy);
        var actions=new StackPanel { Orientation=Orientation.Horizontal,Spacing=10,Margin=new Thickness(0,24,0,0) };
        actions.Children.Add(Button("已有面试安排",()=>Open("arranged"))); actions.Children.Add(Button("导入岗位",()=>Open("import"),true)); Grid.SetColumn(actions,1); head.Children.Add(actions); _root.Children.Add(head);
        var stats=new Grid { ColumnSpacing=24, BorderBrush=Brush(0xE4E4E0),BorderThickness=new Thickness(0,0,0,1),Padding=new Thickness(0,0,0,16) };
        string[] labels=["投递总数","本周面试","面试转化率","Offer"];
        for(var i=0;i<4;i++) { stats.ColumnDefinitions.Add(new ColumnDefinition()); var cell=new StackPanel { Spacing=5 }; cell.Children.Add(_stats[i]); cell.Children.Add(Text(labels[i],11,true)); Grid.SetColumn(cell,i); stats.Children.Add(cell); }
        Grid.SetRow(stats,1);_root.Children.Add(stats); Grid.SetRow(_body,3);_root.Children.Add(_body); Content=_root;
        _body.SizeChanged+=(_,_)=>{if(_body.Children.OfType<ScrollViewer>().Any())RenderBody();};
        Loaded+=async(_,_)=>{ App.Session.PropertyChanged+=OnSession; await LoadAsync(); };
        Unloaded+=(_,_)=>{ ++_generation;_life.Cancel();_dialog?.Hide();App.Session.PropertyChanged-=OnSession; };
    }
    private async void OnSession(object? sender,System.ComponentModel.PropertyChangedEventArgs e) {
        if(e.PropertyName!=nameof(SessionViewModel.Phase))return;
        ++_generation;_items=[];_logos.Clear();_pendingLogos.Clear();_order.Clear();_hidden.Clear();_query="";_dialog?.Hide();
        await LoadAsync();
        if(App.Session.Phase==SessionViewModel.SessionPhase.SignedIn && _pending is {} pending) { _pending=null; Open(pending); }
        else if(App.Session.Phase!=SessionViewModel.SessionPhase.SignedIn) _pending=null;
    }
    private async Task LoadAsync() {
        var generation=++_generation; _body.Children.Clear();_logos.Clear();_pendingLogos.Clear();
        if(App.Session.Phase!=SessionViewModel.SessionPhase.SignedIn) { Content=_root;_subtitle.Text="0 个进行中 · 0 场面试";foreach(var stat in _stats)stat.Text="—";Render();return; }
        _body.Children.Add(new ProgressRing { IsActive=true,HorizontalAlignment=HorizontalAlignment.Center });
        try {
            List<CareerApplication> items=[];var cursor="";HashSet<string> seen=[];
            do { var query=new Dictionary<string,string>{{"scope","all"},{"limit","200"}};if(cursor!="")query["cursor"]=cursor;
                var page=await App.Session.Api.CareerRequestAsync("/api/job-applications",query:query,ct:_life.Token);
                items.AddRange((page["items"]?.AsArray() ?? []).Select(x=>new CareerApplication(x!)));cursor=page["next_cursor"]?.GetValue<string>() ?? "";
                if(cursor!=""&&!seen.Add(cursor))throw new InvalidDataException();
            } while(cursor!="");
            var overview=await App.Session.Api.CareerRequestAsync("/api/interview-overview",query:new(){{"timezone","Asia/Shanghai"}},ct:_life.Token);
            var arrangements=new List<JsonNode>();cursor="";seen.Clear();
            do {
                var query=new Dictionary<string,string>{{"limit","500"},{"include_archived","true"}};if(cursor!="")query["cursor"]=cursor;
                var page=await App.Session.Api.CareerRequestAsync("/api/interview-sessions",query:query,ct:_life.Token);
                arrangements.AddRange((page["items"]?.AsArray()??[]).Where(x=>x is not null).Select(x=>x!));
                cursor=page["next_cursor"]?.GetValue<string>()??"";
                if(cursor!=""&&!seen.Add(cursor))throw new InvalidDataException();
            }while(cursor!="");
            if(generation!=_generation || _life.IsCancellationRequested)return; items=items.Select(x=>x.IncludingSessions(arrangements)).ToList();_items=items;
            var applied=items.Count(x=>x.Text("applied_at")!=""&&x.Text("phase")!="pending");var interviewing=items.Count(x=>new[]{"interview","hr","ai_interview","offer"}.Contains(x.Text("current_stage_type"))||(x.Raw["stages"]?.AsArray()??[]).Any(stage=>new[]{"interview","ai_interview","offer"}.Contains(stage?["stage_type"]?.GetValue<string>())));
            _stats[0].Text=applied.ToString();_stats[1].Text=(overview["metrics"]?["weekly_interviews"]?.GetValue<int>() ?? 0).ToString();_stats[2].Text=applied==0?"—":$"{interviewing*100/applied}%";_stats[3].Text=(overview["metrics"]?["offers_received"]?.GetValue<int>() ?? 0).ToString();
            _subtitle.Text=$"{items.Count(x=>!x.Ended)} 个进行中 · {_stats[1].Text} 场面试";Render();
        } catch(OperationCanceledException) {} catch(Exception error) { if(generation!=_generation)return;_body.Children.Clear();var message=new StackPanel{Spacing=16};message.Children.Add(Text(Explain(error)));message.Children.Add(Button("重试",()=>_=LoadAsync()));_body.Children.Add(message); }
    }
    private IEnumerable<CareerApplication> Visible => CareerStage.Sorted(_items.Where(x=>_query=="" || (x.Company+x.Title+x.StageLabel).Contains(_query,StringComparison.OrdinalIgnoreCase)),_earliest);
    private string[] Columns {get {var available=CareerStage.Columns(_items);return _order.Where(available.Contains).Concat(available.Where(x=>!_order.Contains(x))).ToArray();}}
    private void Render() {
        _body.Children.Clear();var old=_root.Children.FirstOrDefault(x=>x is FrameworkElement element && Grid.GetRow(element)==2);if(old is not null)_root.Children.Remove(old);
        var toolbar=new Grid { ColumnSpacing=12 };toolbar.ColumnDefinitions.Add(new ColumnDefinition { Width=GridLength.Auto });toolbar.ColumnDefinitions.Add(new ColumnDefinition());toolbar.ColumnDefinitions.Add(new ColumnDefinition { Width=GridLength.Auto });
        var modes=new StackPanel { Orientation=Orientation.Horizontal,Spacing=2,Padding=new Thickness(2),Background=Brush(0xF4F4F2),CornerRadius=new CornerRadius(8) };
        foreach(var pair in new[]{("看板",false),("列表",true)}){var mode=new Button{Content=pair.Item1,Width=61,Height=28,FontSize=12,Padding=new Thickness(0),CornerRadius=new CornerRadius(6),BorderThickness=new Thickness(0),Background=Brush(_list==pair.Item2?0xFFFFFF:0xF4F4F2)};mode.Click+=(_,_)=>{_list=pair.Item2;Render();};modes.Children.Add(mode);}toolbar.Children.Add(modes);
        var settings=new StackPanel { Orientation=Orientation.Horizontal,Spacing=8 };var sortMenu=new MenuFlyout();
        foreach(var pair in new[]{("最近排期",false),("最先添加",true)}){var choice=new ToggleMenuFlyoutItem{Text=pair.Item1,IsChecked=_earliest==pair.Item2};choice.Click+=(_,_)=>{_earliest=pair.Item2;Render();};sortMenu.Items.Add(choice);}
        settings.Children.Add(new Button{Content="☷  排序",FontSize=12,Background=Brush(0xFFFFFF),BorderThickness=new Thickness(0),Flyout=sortMenu});
        var filters=new StackPanel { Spacing=12 };var search=new TextBox{Text=_query,PlaceholderText="搜索公司、岗位或阶段",Width=240};search.TextChanged+=(_,_)=>{_query=search.Text;RenderBody();};filters.Children.Add(search);var group=new CheckBox { Content="按求职分类分组",IsChecked=_grouped };group.Click+=(_,_)=>{_grouped=group.IsChecked==true;RenderBody();};filters.Children.Add(group);
        foreach(var key in Columns){var check=new CheckBox { Content=CareerStage.Label(key),IsChecked=!_hidden.Contains(key) };check.Click+=(_,_)=>{if(check.IsChecked==true)_hidden.Remove(key);else _hidden.Add(key);RenderBody();};filters.Children.Add(check);}
        settings.Children.Add(new Button {Content="筛选",FontSize=12,Background=Brush(0xFFFFFF),BorderThickness=new Thickness(0),Flyout=new Flyout {Content=filters}});Grid.SetColumn(settings,2);toolbar.Children.Add(settings);Grid.SetRow(toolbar,2);_root.Children.Add(toolbar);RenderBody();
    }
    private void RenderBody() {
        _body.Children.Clear();var items=Visible.ToArray();
        var content=new StackPanel {Spacing=24};
        foreach(var category in _grouped&&_items.Count>0?new[]{"实习","校招","正式","未分类"}:new[]{""}) {
            var group=items.Where(x=>category=="" || x.CategoryLabel==category).ToArray();if(_grouped&&group.Length==0)continue;
            if(category!="")content.Children.Add(Text($"{category} · {group.Length}"));
            if(_list) {
                content.Children.Add(ListRow(["公司 / 岗位","分类","当前进度","最近安排","投递日期","更新时间"],true));
                foreach(var item in group) {
                    var button=Button("",()=>Open("detail",item));
                    button.Content=ListRow([item.Company+" · "+item.Title,item.CategoryLabel,item.StageLabel,Time(item),ShortDate(item.Text("applied_at")),ShortDate(item.Text("updated_at"))],false);
                    button.HorizontalAlignment=HorizontalAlignment.Stretch;button.HorizontalContentAlignment=HorizontalAlignment.Stretch;
                    content.Children.Add(button);
                }
                continue;
            }
            var columns=new StackPanel {Orientation=Orientation.Horizontal,Spacing=10};
            foreach(var column in Columns.Where(x=>!_hidden.Contains(x))) {
                var panel=new StackPanel {Width=164,Spacing=8,Padding=new Thickness(6),MinHeight=Math.Max(320,_body.ActualHeight-24),AllowDrop=true};
                var header=Text($"● {CareerStage.Label(column)}  {group.Count(x=>x.Column==column)}",12);header.Margin=new Thickness(0,12,0,12);header.CanDrag=true;
                header.DragStarting+=(_,e)=>e.Data.SetText("column:"+column);header.ContextFlyout=new MenuFlyout();
                foreach(var delta in new[]{-1,1}){var move=new MenuFlyoutItem {Text=delta<0?"向左移动":"向右移动"};move.Click+=(_,_)=>{var order=Columns.ToList();var i=order.IndexOf(column);if(i+delta>=0&&i+delta<order.Count){(order[i],order[i+delta])=(order[i+delta],order[i]);_order.Clear();_order.AddRange(order);Render();}};((MenuFlyout)header.ContextFlyout).Items.Add(move);}
                panel.Children.Add(header);
                panel.DragOver+=(_,e)=>{e.AcceptedOperation=DataPackageOperation.Move;};
                panel.Drop+=async(_,e)=>{if(!e.DataView.Contains(StandardDataFormats.Text))return;var value=await e.DataView.GetTextAsync();if(value.StartsWith("column:")){var order=Columns.ToList();var from=order.IndexOf(value[7..]);var to=order.IndexOf(column);if(from>=0&&to>=0){var source=order[from];order.RemoveAt(from);order.Insert(to,source);_order.Clear();_order.AddRange(order);Render();}return;}var item=_items.FirstOrDefault(x=>"job:"+x.Id==value);if(item is null||!CareerStage.CanAdvance(item,column,_items.FirstOrDefault(x=>x.Column==column)?.Stage))return;Open(column=="ended"?"terminate":"stage",item,_items.FirstOrDefault(x=>x.Column==column)?.Stage??(column.StartsWith("interview:")?"interview":column),CareerStage.Label(column),_items.FirstOrDefault(x=>x.Column==column)?.Raw["current_round_no"]?.GetValue<int>());};
                var matches=group.Where(x=>x.Column==column).ToArray();if(matches.Length==0)panel.Children.Add(Text("暂无进程",11,true));foreach(var item in matches)panel.Children.Add(Card(item));columns.Children.Add(new Border{Child=panel,Background=Brush(0xF7F7F5),CornerRadius=new CornerRadius(10)});
            }
            content.Children.Add(columns);
        }
        _body.Children.Add(new ScrollViewer { Content=content,HorizontalScrollBarVisibility=ScrollBarVisibility.Auto,VerticalScrollBarVisibility=ScrollBarVisibility.Auto,HorizontalScrollMode=ScrollMode.Enabled });
    }
    private static string ShortDate(string value)=>CareerApplication.Date(value)?.ToLocalTime().ToString("yyyy-MM-dd")??"—";
    private static Grid ListRow(string[] values,bool heading) {
        var row=new Grid{MinWidth=840,ColumnSpacing=16};
        double[] widths=[280,60,100,130,100,100];
        for(var i=0;i<values.Length;i++) {
            row.ColumnDefinitions.Add(new ColumnDefinition{Width=i==0?new GridLength(1,GridUnitType.Star):new GridLength(widths[i])});
            var cell=Text(values[i],heading?11:12,heading);Grid.SetColumn(cell,i);row.Children.Add(cell);
        }
        return row;
    }
    private FrameworkElement Card(CareerApplication item) {
        var copy=new Grid{Height=64,RowSpacing=4};copy.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});copy.RowDefinitions.Add(new RowDefinition());copy.RowDefinitions.Add(new RowDefinition{Height=new GridLength(20)});
        var logo=new Image{Width=20,Height=20,HorizontalAlignment=HorizontalAlignment.Right};
        var fallback=Text(item.Company.Length>0?item.Company[..1]:"",12);fallback.HorizontalAlignment=HorizontalAlignment.Center;fallback.VerticalAlignment=VerticalAlignment.Center;
        var brand=new Grid{Width=20,Height=20,HorizontalAlignment=HorizontalAlignment.Right,Background=Brush(0xF4F4F2)};brand.Children.Add(fallback);brand.Children.Add(logo);
        if(_logos.TryGetValue(item.Id,out var cached)){logo.Source=cached;fallback.Visibility=Visibility.Collapsed;}
        else if(item.LogoRequest is {} source)_=LoadLogoAsync(item.Id,source,logo,fallback);
        Grid.SetRow(brand,2);copy.Children.Add(brand);var title=Text(item.Company+" · "+item.Title,12);title.TextWrapping=TextWrapping.NoWrap;title.TextTrimming=TextTrimming.CharacterEllipsis;copy.Children.Add(title);if(item.Category!=""){var category=Text(item.CategoryLabel,10,true);Grid.SetRow(category,1);copy.Children.Add(category);}var status=Text("● "+item.StatusLabel,10.5,true);status.Margin=new Thickness(0,0,24,0);status.TextWrapping=TextWrapping.NoWrap;status.TextTrimming=TextTrimming.CharacterEllipsis;Grid.SetRow(status,2);copy.Children.Add(status);
        var button=new Button {Content=copy,HorizontalAlignment=HorizontalAlignment.Stretch,HorizontalContentAlignment=HorizontalAlignment.Stretch,Padding=new Thickness(12),Background=Brush(0xFFFFFF),CornerRadius=new CornerRadius(10),CanDrag=item.Movable};button.Click+=(_,_)=>Open("detail",item);button.DragStarting+=(_,e)=>e.Data.SetText("job:"+item.Id);
        var menu=new MenuFlyout();
        if(item.Stage=="offer"&&!item.Ended){var offer=new MenuFlyoutItem{Text="编辑 Offer"};offer.Click+=(_,_)=>Open("offer",item);menu.Items.Add(offer);}
        foreach(var pair in item.Ended?new[]{("查看详情","detail"),("删除岗位","delete")}:new[]{("查看详情","detail"),("修改分类","category"),("推进流程","stage"),("终止求职","terminate")}){var entry=new MenuFlyoutItem {Text=pair.Item1,IsEnabled=pair.Item2!="stage"||item.Movable};entry.Click+=(_,_)=>Open(pair.Item2,item);menu.Items.Add(entry);}button.ContextFlyout=menu;return button;
    }
    private async Task LoadLogoAsync(string id,(string Path,string Revision) source,Image view,TextBlock fallback) {
        if(_logos.Count+_pendingLogos.Count>=128 || !_pendingLogos.Add(id))return;
        var generation=_generation;
        try {
            var result=await App.Session.Api.CareerRequestAsync(source.Path,query:new(){{"v",source.Revision}},ct:_life.Token);
            var bytes=Convert.FromBase64String(result["image_base64"]!.GetValue<string>());
            using var stream=new Windows.Storage.Streams.InMemoryRandomAccessStream();
            using(var writer=new Windows.Storage.Streams.DataWriter(stream.GetOutputStreamAt(0))){writer.WriteBytes(bytes);await writer.StoreAsync();writer.DetachStream();}
            stream.Seek(0);var image=new Microsoft.UI.Xaml.Media.Imaging.BitmapImage();await image.SetSourceAsync(stream);
            if(generation==_generation&&!_life.IsCancellationRequested){_logos[id]=image;view.Source=image;fallback.Visibility=Visibility.Collapsed;}
        }catch(Exception){/* Named company remains visible when its logo cannot load. */}
        finally {if(generation==_generation)_pendingLogos.Remove(id);}
    }
    private static string Time(CareerApplication item) {var key=item.Ended?"terminated_at":item.Stage=="pending"?"created_at":item.Stage=="screening"?"applied_at":item.Stage=="offer"?"updated_at":"next_session_start_at";return CareerApplication.Date(item.Text(key))?.ToLocalTime().ToString("M月d日 HH:mm") ?? "尚未安排";}
    private async void Open(string kind,CareerApplication? application=null,string stage="interview",string label="一面",int? round=null) {
        if(_dialog is not null)return;
        if(kind=="detail" && application is not null) { Content=new CareerApplicationDetailPage(application, ()=>{Content=_root;_=LoadAsync();}, (action,item)=>Open(action,item,action=="apply"?"screening":action=="schedule-current"?item.Stage:CareerStage.NextStages(item).FirstOrDefault(x=>x=="interview")??CareerStage.NextStages(item).FirstOrDefault()??"screening",item.StageLabel)); return; }
        if(kind=="plugin") {var notice=new ContentDialog {XamlRoot=XamlRoot,Title="安装 LinkResume 岗位采集插件",Content="1. 从 LinkResume Web 下载并解压插件 ZIP。\n2. 打开 Chrome / Edge 扩展管理，启用开发者模式。\n3. 加载已解压的扩展，在招聘网站收藏岗位。",CloseButtonText="完成"};_dialog=notice;try{await notice.ShowAsync();}finally{_dialog=null;}return;}
        if(App.Session.Phase!=SessionViewModel.SessionPhase.SignedIn){_pending=kind;await WorkspacePage.Current.RequestLoginAsync(reason:"登录后管理岗位和求职进度。");return;}
        var form=new CareerDialogForm(kind,application,stage,label,App.Session.Api,_life.Token,_items,round);
        var dialog=new ContentDialog {XamlRoot=XamlRoot,Title=form.Title,Content=new ScrollViewer {Content=form.View,MaxHeight=580},PrimaryButtonText=kind=="detail"?"保存备注":kind=="delete"?"确认删除":"保存",CloseButtonText="取消",DefaultButton=kind is "delete" or "accept" or "decline"?ContentDialogButton.Close:ContentDialogButton.Primary};
        dialog.Resources["ContentDialogMaxWidth"]=880d;dialog.FontFamily=new FontFamily("ms-appx:///Assets/Library/LibrarySans-Regular.otf#LinkResume Library Sans");
        var saving=false;dialog.Closing+=(_,args)=>{if(saving)args.Cancel=true;};
        dialog.PrimaryButtonClick+=async(_,args)=>{var deferral=args.GetDeferral();saving=true;dialog.IsPrimaryButtonEnabled=false;dialog.IsSecondaryButtonEnabled=false;try {if(!await form.SaveAsync())args.Cancel=true;}finally{saving=false;dialog.IsPrimaryButtonEnabled=!form.Unknown;deferral.Complete();}};
        _dialog=dialog;try {var result=await dialog.ShowAsync();if(result==ContentDialogResult.Primary){if(Content is CareerApplicationDetailPage detail)await detail.RefreshAsync();else await LoadAsync();}}finally{_dialog=null;}
    }
    internal static string Explain(Exception error) => error is ApiException api ? api.Status==HttpStatusCode.Unauthorized?"登录已失效，请重新登录。":api.Status==HttpStatusCode.Conflict?$"记录已变化或存在冲突（{api.Code}），请刷新确认。":$"操作失败（{api.Code}），输入已保留。":"连接失败，输入已保留。请检查服务连接后重试。";
}
