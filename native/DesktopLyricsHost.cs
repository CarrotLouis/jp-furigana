// MIT. Optional on-demand WPF desktop lyric view. No WebView, dictionary or media player.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace FuriganaPlusDesktop {
    static class Data {
        [ThreadStatic] static JavaScriptSerializer json;
        public static JavaScriptSerializer Json { get { return json ?? (json = new JavaScriptSerializer { MaxJsonLength = 524288, RecursionLimit = 24 }); } }
        public static object Get(IDictionary<string, object> o, string key, object fallback = null) { object v; return o != null && o.TryGetValue(key, out v) ? v : fallback; }
        public static string Text(IDictionary<string, object> o, string key, string fallback = "") { return Convert.ToString(Get(o, key, fallback), CultureInfo.InvariantCulture); }
        public static double Number(IDictionary<string, object> o, string key, double fallback = 0) { double n; return double.TryParse(Text(o,key), NumberStyles.Float, CultureInfo.InvariantCulture,out n) && !double.IsInfinity(n) && !double.IsNaN(n) ? n : fallback; }
        public static bool Bool(IDictionary<string, object> o, string key, bool fallback = false) { object v=Get(o,key); return v is bool ? (bool)v : fallback; }
        public static IDictionary<string, object> Object(IDictionary<string, object> o,string key) { return Get(o,key) as IDictionary<string,object> ?? new Dictionary<string,object>(); }
        public static double Clamp(double n,double min,double max) { return Math.Max(min, Math.Min(max,n)); }
        public static Color Color(string text,string fallback) {
            try { if (text.Length == 6 || text.Length == 8) text="#"+text; return (Color)ColorConverter.ConvertFromString(text); }
            catch { return (Color)ColorConverter.ConvertFromString(fallback); }
        }
    }

    sealed class LyricCanvas : FrameworkElement {
        sealed class Unit { public string Text,Reading; public double Width;public int From,To; }
        IDictionary<string, object> frame = new Dictionary<string,object>();
        readonly Dictionary<string,FormattedText> formats=new Dictionary<string,FormattedText>();Typeface face;string faceKey;
        public LyricCanvas() { TextOptions.SetTextFormattingMode(this,TextFormattingMode.Display);TextOptions.SetTextRenderingMode(this,TextRenderingMode.Grayscale); }
        public void SetFrame(IDictionary<string,object> value) { frame=value; formats.Clear();InvalidateMeasure(); InvalidateVisual(); }
        public double FontSize { get { return Data.Clamp(Data.Number(frame,"fontSize",36),8,144); } }
        Typeface Face { get { var s=Data.Object(frame,"style");string key=Data.Text(s,"fontFamily","Microsoft YaHei")+"|"+Data.Bool(s,"bold");if(face==null||faceKey!=key){faceKey=key;face=new Typeface(new FontFamily(Data.Text(s,"fontFamily","Microsoft YaHei")),FontStyles.Normal,Data.Bool(s,"bold")?FontWeights.Bold:FontWeights.Normal,FontStretches.Normal);}return face; } }
        FormattedText Format(string text,double size,bool cache=true) { string key=size.ToString(CultureInfo.InvariantCulture)+"|"+(text??"");FormattedText value;if(cache&&formats.TryGetValue(key,out value))return value;value=new FormattedText(text ?? "",CultureInfo.GetCultureInfo("ja-JP"),FlowDirection.LeftToRight,Face,size,Brushes.White,VisualTreeHelper.GetDpi(this).PixelsPerDip);if(cache)formats[key]=value;return value; }
        List<Unit> Units(object source) {
            var units=new List<Unit>(); var array=source as IEnumerable;
            if(array==null || source is string)return units;
            int limit=0,offset=0;
            foreach(object item in array) {
                if(++limit>1000)break;
                var s=item as IDictionary<string,object>; if(s==null)continue;
                string text=Data.Text(s,"text"),reading=Data.Text(s,"rt"); if(text.Length>2000)text=text.Substring(0,2000);
                if(Data.Bool(s,"hidden")){offset+=text.Length;continue;}
                if(reading.Length>200)reading=reading.Substring(0,200);
                if(reading.Length>0){units.Add(new Unit {Text=text,Reading=reading,From=offset,To=offset+text.Length});offset+=text.Length;}
                else { var e=StringInfo.GetTextElementEnumerator(text); while(e.MoveNext()){string part=e.GetTextElement();units.Add(new Unit {Text=part,Reading="",From=offset,To=offset+part.Length});offset+=part.Length;} }
            }
            double rt=FontSize*Data.Clamp(Data.Number(frame,"rtSize",60),20,100)/100;
            foreach(var u in units)u.Width=Math.Max(Format(u.Text,FontSize).WidthIncludingTrailingWhitespace,Format(u.Reading,rt).WidthIncludingTrailingWhitespace)+(u.Reading.Length>0?FontSize*.12:0);
            return units;
        }
        List<List<Unit>> Wrap(List<Unit> units,double width) {
            var rows=new List<List<Unit>>(); var row=new List<Unit>(); double used=0;
            foreach(var u in units) { if(row.Count>0 && (used+u.Width>width || u.Text=="\n")) {rows.Add(row);row=new List<Unit>();used=0;}
                if(u.Text!="\n"){row.Add(u);used+=u.Width;}
            }
            if(row.Count>0)rows.Add(row);return rows;
        }
        Brush Fill(bool played) {
            var s=Data.Object(frame,"style");return new LinearGradientBrush(Data.Color(Data.Text(s,played?"colorTop":"unplayedColorTop",played?"#ffdede":"#eeeeee"),"#ffdede"),Data.Color(Data.Text(s,played?"colorBottom":"unplayedColorBottom",played?"#ffb0b0":"#eeeeee"),"#ffb0b0"),90);
        }
        Pen Outline(bool played) {
            var s=Data.Object(frame,"style");return Data.Bool(s,"outline")?new Pen(new SolidColorBrush(Data.Color(Data.Text(s,played?"outlineColor":"unplayedOutlineColor",played?"#cb7474":"#999999"),"#cb7474")),2){LineJoin=PenLineJoin.Round}:null;
        }
        void DrawText(DrawingContext dc,FormattedText text,Point origin,bool outline,bool played=true) {
            // The native preview keeps the glyph fill intact and adds the
            // outline outside it. Stroking over the fill made thin fonts hollow.
            var pen=outline?Outline(played):null;if(pen!=null)dc.DrawGeometry(null,pen,text.BuildGeometry(origin));
            text.SetForegroundBrush(Fill(played));dc.DrawText(text,origin);
        }
        void DrawUnitText(DrawingContext dc,FormattedText text,Point origin,bool outline,bool secondary,double fraction) {
            if(secondary||fraction<=0){DrawText(dc,text,origin,outline,false);return;}
            if(fraction>=1){DrawText(dc,text,origin,outline);return;}
            DrawText(dc,text,origin,outline,false);dc.PushClip(new RectangleGeometry(new Rect(origin.X-1,origin.Y-2,text.WidthIncludingTrailingWhitespace*fraction+1,text.Height+4)));DrawText(dc,text,origin,outline);dc.Pop();
        }
        double DrawLines(DrawingContext dc,object source,string translation,double y,double width,bool secondary) {
            double size=FontSize,rt=size*Data.Clamp(Data.Number(frame,"rtSize",60),20,100)/100;
            var rows=Wrap(Units(source),width);var style=Data.Object(frame,"style");string align=Data.Text(style,"align","center");
            foreach(var row in rows) {
                double total=0;bool hasReading=false;foreach(var u in row){total+=u.Width;hasReading|=u.Reading.Length>0;}
                double readingHeight=hasReading?rt*1.25:0,rowHeight=readingHeight+Format("国",size).Height;
                double x=align=="left"?0:align=="right"?Math.Max(0,width-total):Math.Max(0,(width-total)/2);
                foreach(var u in row) {
                    if(dc!=null) {
                        var b=Format(u.Text,size);double fraction=1;
                        if(Data.Bool(frame,"karaoke")){int count=(int)Data.Clamp(Data.Number(frame,"highlightTo")-u.From,0,u.Text.Length);fraction=b.WidthIncludingTrailingWhitespace>0?Format(u.Text.Substring(0,count),size).WidthIncludingTrailingWhitespace/b.WidthIncludingTrailingWhitespace:0;}
                        DrawUnitText(dc,b,new Point(x+(u.Width-b.WidthIncludingTrailingWhitespace)/2,y+readingHeight),true,secondary,fraction);
                        if(u.Reading.Length>0) {var r=Format(u.Reading,rt);dc.PushOpacity(Data.Clamp(Data.Number(frame,"rtOpacity",80),20,100)/100);DrawUnitText(dc,r,new Point(x+(u.Width-r.WidthIncludingTrailingWhitespace)/2,y),false,secondary,fraction);dc.Pop();}
                    }
                    x+=u.Width;
                }
                y+=rowHeight;
            }
            if(!string.IsNullOrEmpty(translation)) {
                // The native desktop view uses its selected font for both
                // languages; a separate 72% scale made translations too small.
                var tr=Format(translation,size,false);tr.MaxTextWidth=Math.Max(20,width);tr.TextAlignment=align=="left"?TextAlignment.Left:align=="right"?TextAlignment.Right:TextAlignment.Center;
                if(dc!=null)DrawText(dc,tr,new Point(0,y+2),true,!secondary);y+=tr.Height+4;
            }
            return y;
        }
        double Layout(DrawingContext dc,double width) {
            double y=DrawLines(dc,Data.Get(frame,"segments"),Data.Text(frame,"translation"),0,width,false);
            var next=Data.Object(frame,"next");if(next.Count>0)y=DrawLines(dc,Data.Get(next,"segments"),Data.Text(next,"translation"),y+6,width,true);
            string message=Data.Text(frame,"message");
            if(y==0 && message.Length>0) { var f=Format(message,Math.Min(FontSize,24));f.MaxTextWidth=Math.Max(20,width);f.TextAlignment=TextAlignment.Center;if(dc!=null)dc.DrawText(f,new Point(0,6));y=f.Height+16; }
            return Math.Max(24,y+5);
        }
        protected override Size MeasureOverride(Size available) { double width=double.IsInfinity(available.Width)?860:Math.Max(80,available.Width);return new Size(width,Layout(null,width)); }
        protected override void OnRender(DrawingContext dc) { Layout(dc,Math.Max(80,ActualWidth)); }
    }

    // Original vector controls, using the client's native action names. No
    // copyrighted CloudMusic skin, font or bitmap is copied into this plugin.
    sealed class ToolbarGlyph : FrameworkElement {
        string kind;public string Kind {get{return kind;}set{if(kind!=value){kind=value;InvalidateVisual();}}}
        public ToolbarGlyph(string value){Kind=value;Width=20;Height=20;}
        protected override void OnRender(DrawingContext dc){
            if(Kind=="unlock"){
                dc.PushTransform(new ScaleTransform(ActualWidth/24,ActualHeight/30));
                var shackle=new Pen(Brushes.White,3.2){StartLineCap=PenLineCap.Round,EndLineCap=PenLineCap.Round};dc.DrawGeometry(null,shackle,Geometry.Parse("M5 12V7C5 0 17 0 17 7"));
                var hole=Geometry.Parse("M12 16C9 16 9 20 10.8 20.7L10.3 24H13.7L13.2 20.7C15 20 15 16 12 16Z");
                dc.DrawGeometry(Brushes.White,null,new CombinedGeometry(GeometryCombineMode.Exclude,new RectangleGeometry(new Rect(1,12,22,17),2.5,2.5),hole));dc.Pop();return;
            }
            dc.PushTransform(new ScaleTransform(ActualWidth/24,ActualHeight/24));var pen=new Pen(Brushes.White,1.9){StartLineCap=PenLineCap.Round,EndLineCap=PenLineCap.Round,LineJoin=PenLineJoin.Round};string path=null;
            switch(Kind){
                case "detail":path="M9 18V6L20 4V16 M9 9L20 7";dc.DrawEllipse(Brushes.White,null,new Point(6,18),3,2.5);dc.DrawEllipse(Brushes.White,null,new Point(17,16),3,2.5);break;
                case "playprev":dc.DrawRectangle(Brushes.White,null,new Rect(3,5,2,14));dc.DrawGeometry(Brushes.White,null,Geometry.Parse("M19 4L7 12 19 20Z"));break;
                case "playnext":dc.DrawRectangle(Brushes.White,null,new Rect(19,5,2,14));dc.DrawGeometry(Brushes.White,null,Geometry.Parse("M5 4L17 12 5 20Z"));break;
                case "play_pause":dc.DrawGeometry(Brushes.White,null,Geometry.Parse("M7 3L20 12 7 21Z"));break;
                case "pause":dc.DrawRectangle(Brushes.White,null,new Rect(6,4,4,16));dc.DrawRectangle(Brushes.White,null,new Rect(14,4,4,16));break;
                case "setting":path="M10 2H14L15 5 17 6 20 5 22 9 20 11V13L22 15 20 19 17 18 15 19 14 22H10L9 19 7 18 4 19 2 15 4 13V11L2 9 4 5 7 6 9 5Z";dc.DrawEllipse(null,pen,new Point(12,12),3.5,3.5);break;
                case "lock":dc.DrawRoundedRectangle(null,pen,new Rect(5,10,14,11),1,1);path="M8 10V7A4 4 0 0 1 16 7V10 M12 14V17";break;
                case "close":path="M5 5L19 19 M19 5L5 19";break;
                case "offset_back":case "offset_forward":var text=new FormattedText(Kind=="offset_back"?"+0.5s":"-0.5s",CultureInfo.InvariantCulture,FlowDirection.LeftToRight,new Typeface(new FontFamily("Arial"),FontStyles.Normal,FontWeights.Bold,FontStretches.Condensed),14,Brushes.White,VisualTreeHelper.GetDpi(this).PixelsPerDip);dc.DrawText(text,new Point((24-text.Width)/2,2));break;
            }
            if(path!=null)dc.DrawGeometry(null,pen,Geometry.Parse(path));dc.Pop();
        }
    }

    sealed class LyricsWindow : Window {
        const int GWL_EXSTYLE=-20,WS_EX_TRANSPARENT=0x20,WS_EX_NOACTIVATE=0x08000000,WS_EX_TOOLWINDOW=0x80;
        [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd,int index);
        [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hwnd,int index,int value);
        [StructLayout(LayoutKind.Sequential)] struct CursorPoint { public int X,Y; }
        [DllImport("user32.dll")] static extern bool GetCursorPos(out CursorPoint point);
        public readonly LyricCanvas Canvas=new LyricCanvas();
        readonly WrapPanel tools=new WrapPanel { Orientation=Orientation.Horizontal, HorizontalAlignment=HorizontalAlignment.Center };
        readonly Action<string,object> action; readonly Button play; readonly DispatcherTimer leaveTimer;
        readonly Border toolbar,hoverFrame; IntPtr handle; bool locked,closing,rendering,closingRequested,manipulating;
        readonly Window unlockWindow;readonly Button unlockButton;readonly DispatcherTimer lockHover;
        public bool Locked { get { return locked; } }
        public LyricsWindow(Action<string,object> send) {
            action=send;Title="日语歌词振假名 Plus · 桌面歌词";WindowStyle=WindowStyle.None;AllowsTransparency=true;Background=Brushes.Transparent;
            ShowInTaskbar=false;ShowActivated=false;Topmost=true;ResizeMode=ResizeMode.CanResize;SizeToContent=SizeToContent.Height;Template=FramelessTemplate();
            Width=900;MinWidth=240;MaxWidth=SystemParameters.VirtualScreenWidth;MinHeight=60;
            var grid=new Grid {Margin=new Thickness(8,0,8,8),Background=Brushes.Transparent};grid.RowDefinitions.Add(new RowDefinition {Height=GridLength.Auto,MinHeight=32});grid.RowDefinitions.Add(new RowDefinition {Height=GridLength.Auto});
            toolbar=new Border {Background=Brushes.Transparent,HorizontalAlignment=HorizontalAlignment.Center,Child=tools,Visibility=Visibility.Hidden};
            Add("detail","打开当前歌曲播放页",()=>action("detail",null));Add("offset_back","歌词延后 0.5 秒",()=>action("offset_back",null));Add("offset_forward","歌词提前 0.5 秒",()=>action("offset_forward",null));
            Add("playprev","上一首",()=>action("playprev",null));play=Add("play_pause","播放 / 暂停",()=>action("play_pause",null));Add("playnext","下一首",()=>action("playnext",null));
            Add("setting","桌面歌词设置",()=>action("setting",null));Add("lock","锁定桌面歌词",()=>action("lock",null));Add("close","关闭桌面歌词",()=>{closingRequested=true;Hide();action("close",null);});
            grid.Children.Add(toolbar);Grid.SetRow(Canvas,1);Canvas.Margin=new Thickness(8,0,8,0);grid.Children.Add(Canvas);
            hoverFrame=new Border {BorderThickness=new Thickness(1),BorderBrush=Brushes.Transparent,Background=Brushes.Transparent,CornerRadius=new CornerRadius(4),Child=grid};Content=hoverFrame;
            var area=SystemParameters.WorkArea;Left=area.Left+Math.Max(0,(area.Width-Width)/2);Top=area.Bottom-230;
            leaveTimer=new DispatcherTimer {Interval=TimeSpan.FromMilliseconds(350)};leaveTimer.Tick+=(s,e)=>{CursorPoint p;if(!manipulating&&(!GetCursorPos(out p)||!new Rect(0,0,ActualWidth,ActualHeight).Contains(PointFromScreen(new Point(p.X,p.Y))))){leaveTimer.Stop();SetHover(false);}};
            // The lyrics stay click-through; a small separate handle can unlock.
            unlockButton=IconButton("unlock","解锁桌面歌词",false);unlockButton.Width=34;unlockButton.Height=32;
            var unlockGlyph=(ToolbarGlyph)unlockButton.Content;unlockGlyph.Width=20;unlockGlyph.Height=26;unlockGlyph.Effect=new System.Windows.Media.Effects.DropShadowEffect {Color=Colors.Black,BlurRadius=2,ShadowDepth=1,Opacity=.4};
            unlockWindow=new Window {Title="桌面歌词解锁",Width=34,Height=32,WindowStyle=WindowStyle.None,AllowsTransparency=true,Background=Brushes.Transparent,ShowInTaskbar=false,ShowActivated=false,ResizeMode=ResizeMode.NoResize,Content=unlockButton,Template=FramelessTemplate()};
            unlockWindow.SourceInitialized+=(s,e)=>{var h=new WindowInteropHelper(unlockWindow).Handle;SetWindowLong(h,GWL_EXSTYLE,GetWindowLong(h,GWL_EXSTYLE)|WS_EX_NOACTIVATE|WS_EX_TOOLWINDOW);};
            unlockButton.Click+=(s,e)=>action("unlock",null);
            lockHover=new DispatcherTimer {Interval=TimeSpan.FromMilliseconds(120)};
            lockHover.Tick+=(s,e)=>{CursorPoint p;if(!locked||!IsVisible||!GetCursorPos(out p)){unlockWindow.Hide();return;}var local=PointFromScreen(new Point(p.X,p.Y));if(new Rect(0,0,ActualWidth,ActualHeight).Contains(local)||unlockWindow.IsMouseOver)ShowUnlockHandle();else unlockWindow.Hide();};
            MouseEnter+=(s,e)=>{if(!locked){leaveTimer.Stop();SetHover(true);}};MouseLeave+=(s,e)=>leaveTimer.Start();
            Canvas.MouseLeftButtonDown+=(s,e)=>{if(!locked){SetManipulating(true);try{DragMove();SaveBounds();}catch(InvalidOperationException){}finally{SetManipulating(false);}}};
            PreviewMouseWheel+=(s,e)=>{if(locked)return;if((Keyboard.Modifiers&ModifierKeys.Control)!=0)action("fontSize",Canvas.FontSize+(e.Delta>0?1:-1));else action(e.Delta>0?"offset_back":"offset_forward",null);e.Handled=true;};
            SourceInitialized+=(s,e)=>{handle=new WindowInteropHelper(this).Handle;SetWindowLong(handle,GWL_EXSTYLE,GetWindowLong(handle,GWL_EXSTYLE)|WS_EX_NOACTIVATE|WS_EX_TOOLWINDOW);HwndSource.FromHwnd(handle).AddHook(ResizeHitTest);};
            SizeChanged+=(s,e)=>{if(!rendering)SaveBounds();};Closing+=(s,e)=>{if(!closing){e.Cancel=true;closingRequested=true;Hide();action("close",null);}};
        }
        static ControlTemplate FramelessTemplate(){var template=new ControlTemplate(typeof(Window));var presenter=new FrameworkElementFactory(typeof(ContentPresenter));presenter.SetValue(ContentPresenter.ContentProperty,new TemplateBindingExtension(ContentControl.ContentProperty));template.VisualTree=presenter;return template;}
        IntPtr ResizeHitTest(IntPtr hwnd,int msg,IntPtr wp,IntPtr lp,ref bool handled){
            if(msg==0x231&&!locked){SetManipulating(true);return IntPtr.Zero;}
            if(msg==0x232){SetManipulating(false);SaveBounds();return IntPtr.Zero;}
            if(msg==0xa0&&!locked){SetHover(true);leaveTimer.Start();}
            if(msg!=0x84||locked)return IntPtr.Zero;long packed=lp.ToInt64();var p=PointFromScreen(new Point((short)(packed&0xffff),(short)((packed>>16)&0xffff)));int hit=0;
            if(p.X>=0&&p.Y>=0&&p.X<=ActualWidth&&p.Y<=ActualHeight){bool left=p.X<4,right=p.X>ActualWidth-4,top=p.Y<4,bottom=p.Y>ActualHeight-4;hit=top?(left?13:right?14:12):bottom?(left?16:right?17:15):left?10:right?11:0;}
            if(hit!=0){handled=true;return new IntPtr(hit);}return IntPtr.Zero;
        }
        static Button IconButton(string kind,string title,bool hoverFill=true) {
            var b=new Button {Content=new ToolbarGlyph(kind),ToolTip=title,Focusable=false,Width=34,Height=30,Background=Brushes.Transparent,BorderThickness=new Thickness(0),Cursor=Cursors.Hand};
            var template=new ControlTemplate(typeof(Button));var border=new FrameworkElementFactory(typeof(Border));border.SetValue(Border.CornerRadiusProperty,new CornerRadius(3));border.SetValue(Border.BackgroundProperty,new TemplateBindingExtension(Control.BackgroundProperty));var content=new FrameworkElementFactory(typeof(ContentPresenter));content.SetValue(FrameworkElement.HorizontalAlignmentProperty,HorizontalAlignment.Center);content.SetValue(FrameworkElement.VerticalAlignmentProperty,VerticalAlignment.Center);border.AppendChild(content);template.VisualTree=border;
            if(hoverFill){var hover=new Trigger {Property=IsMouseOverProperty,Value=true};hover.Setters.Add(new Setter(Control.BackgroundProperty,new SolidColorBrush(Color.FromArgb(45,255,255,255))));template.Triggers.Add(hover);}b.Template=template;return b;
        }
        Button Add(string kind,string title,Action click) {var b=IconButton(kind,title);b.Click+=(s,e)=>click();tools.Children.Add(b);return b;}
        void SetHover(bool value){value=(value||manipulating)&&!locked;toolbar.Visibility=value?Visibility.Visible:Visibility.Hidden;hoverFrame.Background=value?new SolidColorBrush(Color.FromArgb(120,0,0,0)):Brushes.Transparent;hoverFrame.BorderBrush=value?new SolidColorBrush(Color.FromArgb(70,255,255,255)):Brushes.Transparent;}
        void SetManipulating(bool value){manipulating=value;if(value)leaveTimer.Stop();SetHover(value||IsMouseOver);if(!value)leaveTimer.Start();}
        void SaveBounds() { if(IsLoaded)action("bounds",new {x=Left,y=Top,width=Width}); }
        public void SetLocked(bool value) { locked=value;if(handle!=IntPtr.Zero){int style=GetWindowLong(handle,GWL_EXSTYLE);SetWindowLong(handle,GWL_EXSTYLE,value?style|WS_EX_TRANSPARENT:style&~WS_EX_TRANSPARENT);}if(value){SetHover(false);ResizeMode=ResizeMode.NoResize;lockHover.Start();}else{ResizeMode=ResizeMode.CanResize;lockHover.Stop();unlockWindow.Hide();SetHover(IsMouseOver);} }
        void ShowUnlockHandle(){if(unlockWindow.Owner==null&&IsVisible)unlockWindow.Owner=this;unlockWindow.Topmost=Topmost;unlockWindow.Left=Left+(ActualWidth-unlockWindow.Width)/2;unlockWindow.Top=Top+1;if(!unlockWindow.IsVisible)unlockWindow.Show();}
        public void TestUnlockClick(){ShowUnlockHandle();unlockButton.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));}
        public bool UnlockIsCentered {get{return Math.Abs(unlockWindow.Left+unlockWindow.Width/2-Left-ActualWidth/2)<1;}}
        public bool UnlockAboveLyrics {get{return unlockWindow.Top+unlockWindow.Height<=Top+Canvas.TransformToAncestor(this).Transform(new Point()).Y+.1;}}
        public bool UnlockBackgroundTransparent {get{return ((SolidColorBrush)unlockButton.Background).Color.A==0;}}
        public bool TestResizeBounds(){SetManipulating(true);SetHover(false);bool visible=((SolidColorBrush)hoverFrame.Background).Color.A>0;SetManipulating(false);return visible;}
        public void SaveUnlockPreview(string path){unlockWindow.UpdateLayout();var image=new RenderTargetBitmap((int)Math.Ceiling(unlockWindow.ActualWidth),(int)Math.Ceiling(unlockWindow.ActualHeight),96,96,PixelFormats.Pbgra32);image.Render(unlockWindow);var png=new PngBitmapEncoder();png.Frames.Add(BitmapFrame.Create(image));using(var output=File.Create(path))png.Save(output);}
        public bool TestHoverBounds(){SetHover(true);bool shown=toolbar.Visibility==Visibility.Visible&&((SolidColorBrush)hoverFrame.Background).Color.A>0;SetHover(false);return shown&&((SolidColorBrush)hoverFrame.Background).Color.A==0;}
        public void SaveChromePreview(string path){SetHover(true);UpdateLayout();var image=new RenderTargetBitmap((int)Math.Ceiling(ActualWidth),(int)Math.Ceiling(ActualHeight),96,96,PixelFormats.Pbgra32);image.Render(this);var png=new PngBitmapEncoder();png.Frames.Add(BitmapFrame.Create(image));using(var output=File.Create(path))png.Save(output);SetHover(false);}
        public int ExtendedStyle {get{return handle==IntPtr.Zero?0:GetWindowLong(handle,GWL_EXSTYLE);}}
        public void Apply(IDictionary<string,object> frame) {
            if(closingRequested)return;
            rendering=true;
            try {
                Topmost=Data.Bool(frame,"topmost",true);((ToolbarGlyph)play.Content).Kind=Data.Bool(frame,"playing")?"pause":"play_pause";
                var bounds=Data.Object(frame,"bounds");
                if(!IsVisible && bounds.Count>0){var work=SystemParameters.WorkArea;Width=Data.Clamp(Data.Number(bounds,"width",900),240,Math.Max(240,work.Width));Left=Data.Clamp(Data.Number(bounds,"x",work.Left+(work.Width-Width)/2),SystemParameters.VirtualScreenLeft,SystemParameters.VirtualScreenLeft+SystemParameters.VirtualScreenWidth-100);Top=Data.Clamp(Data.Number(bounds,"y",work.Bottom-230),SystemParameters.VirtualScreenTop,SystemParameters.VirtualScreenTop+SystemParameters.VirtualScreenHeight-60);}
                SetLocked(Data.Bool(frame,"locked"));Canvas.SetFrame(frame);if(!IsVisible)Show();
            }finally{rendering=false;}
        }
        public void Shutdown() { closing=true;leaveTimer.Stop();lockHover.Stop();unlockWindow.Close();Close(); }
    }

    sealed class LocalServer : IDisposable {
        readonly TcpListener listener=new TcpListener(IPAddress.Loopback,0); readonly string token;
        readonly Queue<object> events=new Queue<object>();readonly AutoResetEvent signal=new AutoResetEvent(false);readonly Action<IDictionary<string,object>> frame;readonly Action stop;
        volatile bool disposed; public DateTime LastSeen=DateTime.UtcNow;public int Port {get{return ((IPEndPoint)listener.LocalEndpoint).Port;}}
        public LocalServer(string secret,Action<IDictionary<string,object>> setFrame,Action shutdown){token=secret;frame=setFrame;stop=shutdown;listener.Start(8);ThreadPool.QueueUserWorkItem(_=>Accept());}
        public void Send(string type,object value){lock(events){if(events.Count<64)events.Enqueue(new {type=type,value=value});}signal.Set();}
        void Accept(){while(!disposed)try{var client=listener.AcceptTcpClient();ThreadPool.QueueUserWorkItem(_=>Serve(client));}catch(SocketException){if(!disposed)Thread.Sleep(50);}catch(ObjectDisposedException){return;}}
        void Serve(TcpClient client){using(client)try{
            client.ReceiveTimeout=4000;client.SendTimeout=4000;client.NoDelay=true;var stream=client.GetStream();var header=new List<byte>();int b;
            while(header.Count<8192 && (b=stream.ReadByte())>=0){header.Add((byte)b);int n=header.Count;if(n>=4&&header[n-4]==13&&header[n-3]==10&&header[n-2]==13&&header[n-1]==10)break;}
            string[] lines=Encoding.ASCII.GetString(header.ToArray()).Split(new[]{"\r\n"},StringSplitOptions.None);string[] request=lines[0].Split(' ');if(request.Length!=3)return;
            var uri=new Uri("http://127.0.0.1"+request[1]);
            if(request[0]=="OPTIONS"){Reply(stream,200,"{}");return;}
            if(uri.Query!="?token="+token){Reply(stream,403,"{}");return;}LastSeen=DateTime.UtcNow;
            if(request[0]=="GET"&&uri.AbsolutePath=="/events"){
                bool empty;lock(events)empty=events.Count==0;if(empty)signal.WaitOne(1000);
                var batch=new List<object>();lock(events){while(events.Count>0)batch.Add(events.Dequeue());}Reply(stream,200,Data.Json.Serialize(new {events=batch}));return;
            }
            if(request[0]=="GET"&&uri.AbsolutePath=="/health"){var process=Process.GetCurrentProcess();Reply(stream,200,Data.Json.Serialize(new {version="1.6.0",workingSetBytes=process.WorkingSet64,privateBytes=process.PrivateMemorySize64,cpuMilliseconds=process.TotalProcessorTime.TotalMilliseconds}));return;}
            if(request[0]!="POST"){Reply(stream,404,"{}");return;}
            int length=0;foreach(string h in lines){if(h.StartsWith("Transfer-Encoding:",StringComparison.OrdinalIgnoreCase)){Reply(stream,400,"{}");return;}if(h.StartsWith("Content-Length:",StringComparison.OrdinalIgnoreCase))int.TryParse(h.Substring(15).Trim(),out length);}
            if(length<0||length>524288){Reply(stream,413,"{}");return;}var body=new byte[length];for(int at=0;at<length;){int n=stream.Read(body,at,length-at);if(n<=0)return;at+=n;}
            if(uri.AbsolutePath=="/frame"){var value=Data.Json.DeserializeObject(Encoding.UTF8.GetString(body)) as IDictionary<string,object>;if(value==null){Reply(stream,400,"{}");return;}frame(value);Reply(stream,200,"{\"ok\":true}");}
            else if(uri.AbsolutePath=="/stop"){Reply(stream,200,"{\"ok\":true}");stop();}else Reply(stream,404,"{}");
        }catch(IOException){}catch(SocketException){}catch(ArgumentException){}catch(ObjectDisposedException){} }
        static void Reply(Stream stream,int status,string json){byte[] body=Encoding.UTF8.GetBytes(json),head=Encoding.ASCII.GetBytes("HTTP/1.1 "+status+" Result\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Methods: GET,POST,OPTIONS\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: "+body.Length+"\r\n\r\n");stream.Write(head,0,head.Length);stream.Write(body,0,body.Length);}
        public void Dispose(){disposed=true;listener.Stop();signal.Set();}
    }

    static class Program {
        [STAThread] static int Main(string[] args) {
            // Lyrics change a few times per line. Software rendering avoids a
            // dedicated GPU/D3D context for an otherwise idle transparent window.
            RenderOptions.ProcessRenderMode=RenderMode.SoftwareOnly;
            if(args.Length==2&&args[0]=="--render")return RenderSample(args[1]);
            if(args.Length==2&&args[0]=="--self-test")return SelfTest(args[1]);
            if(args.Length!=1)return 2;string ready=null;LocalServer server=null;
            try {
                var cfg=Data.Json.DeserializeObject(Encoding.UTF8.GetString(Convert.FromBase64String(args[0]))) as IDictionary<string,object>;
                string token=Data.Text(cfg,"token");if(token.Length!=32||!System.Text.RegularExpressions.Regex.IsMatch(token,"^[a-f0-9]{32}$"))return 2;
                ready=Path.GetFullPath(Data.Text(cfg,"ready"));if(Path.GetFileName(ready)!="desktop-"+token+".json"||!Directory.Exists(Path.GetDirectoryName(ready))||File.Exists(ready))return 2;
                var app=new Application {ShutdownMode=ShutdownMode.OnExplicitShutdown};LyricsWindow window=null;
                Action shutdown=()=>app.Dispatcher.BeginInvoke(new Action(()=>{if(window!=null)window.Shutdown();app.Shutdown();}));
                server=new LocalServer(token,value=>app.Dispatcher.BeginInvoke(new Action(()=>window.Apply(value))),shutdown);
                window=new LyricsWindow((type,value)=>server.Send(type,value));
                if(Data.Bool(cfg,"offscreenTest")){window.Left=-10000;window.Top=-10000;}
                var watchdog=new DispatcherTimer {Interval=TimeSpan.FromSeconds(2)};watchdog.Tick+=(s,e)=>{if(DateTime.UtcNow-server.LastSeen>TimeSpan.FromSeconds(15))shutdown();};watchdog.Start();
                File.WriteAllText(ready,Data.Json.Serialize(new {protocol=1,version="1.6.0",port=server.Port,token=token,pid=Process.GetCurrentProcess().Id}),new UTF8Encoding(false));
                app.Run();watchdog.Stop();return 0;
            }catch(Exception e){if(ready!=null)try{File.WriteAllText(ready+".error",e.GetType().Name+": "+e.Message);}catch{}return 1;}
            finally{if(server!=null)server.Dispose();if(ready!=null&&File.Exists(ready))File.Delete(ready);}
        }
        static int SelfTest(string directory) {
            Directory.CreateDirectory(directory);
            try {
                var app=new Application();string lastAction="";var window=new LyricsWindow((t,v)=>{lastAction=t;});window.Left=-10000;window.Top=-10000;window.Width=800;window.Show();
                var frame=Data.Json.DeserializeObject("{\"fontSize\":36,\"rtSize\":60,\"rtOpacity\":80,\"segments\":[{\"text\":\"空\",\"rt\":\"そら\"},{\"text\":\"を\"},{\"text\":\"見\",\"rt\":\"み\"},{\"text\":\"上\",\"rt\":\"あ\"},{\"text\":\"げる\"}],\"translation\":\"仰望天空\",\"style\":{\"fontFamily\":\"Microsoft YaHei\",\"outline\":true}}") as IDictionary<string,object>;
                window.Apply(frame);window.UpdateLayout();window.SetLocked(true);int locked=window.ExtendedStyle;window.TestUnlockClick();bool unlockAction=lastAction=="unlock",unlockCentered=window.UnlockIsCentered,unlockAboveLyrics=window.UnlockAboveLyrics,unlockTransparent=window.UnlockBackgroundTransparent;window.SaveUnlockPreview(Path.Combine(directory,"desktop-native-unlock.png"));window.SetLocked(false);int unlocked=window.ExtendedStyle;bool hoverBounds=window.TestHoverBounds(),resizeBounds=window.TestResizeBounds();window.SaveChromePreview(Path.Combine(directory,"desktop-native-chrome.png"));
                // Render a root visual without the live window's layout offset.
                var canvas=new LyricCanvas();canvas.SetFrame(frame);canvas.Measure(new Size(760,double.PositiveInfinity));canvas.Arrange(new Rect(0,0,760,canvas.DesiredSize.Height));canvas.UpdateLayout();
                var image=new RenderTargetBitmap(760,(int)Math.Ceiling(canvas.ActualHeight),96,96,PixelFormats.Pbgra32);
                image.Render(canvas);
                var png=new PngBitmapEncoder();png.Frames.Add(BitmapFrame.Create(image));using(var output=File.Create(Path.Combine(directory,"desktop-native-preview.png")))png.Save(output);
                var pixels=new byte[image.PixelWidth*image.PixelHeight*4];image.CopyPixels(pixels,image.PixelWidth*4,0);int clear=0,ink=0;for(int i=3;i<pixels.Length;i+=4){if(pixels[i]==0)clear++;else ink++;}
                frame["rtOpacity"]=20;var faint=RenderCanvas(frame);frame["rtOpacity"]=80;var bright=RenderCanvas(frame);bool opacity=TopAlpha(bright)>TopAlpha(faint)+100;
                frame["rtSize"]=20;var small=RenderCanvas(frame);frame["rtSize"]=100;var large=RenderCanvas(frame);bool readingSize=large.PixelHeight>small.PixelHeight+30;
                frame["karaoke"]=true;frame["highlightTo"]=0;var unplayed=RenderCanvas(frame);frame["highlightTo"]=5;var played=RenderCanvas(frame);bool karaoke=InkDifference(unplayed,played)>300;
                bool passed=window.AllowsTransparency&&(locked&0x80000)!=0&&(locked&0x20)!=0&&(unlocked&0x20)==0&&unlockAction&&unlockCentered&&unlockAboveLyrics&&unlockTransparent&&hoverBounds&&resizeBounds&&opacity&&readingSize&&karaoke&&clear>ink&&ink>300;
                File.WriteAllText(Path.Combine(directory,"native-result.json"),Data.Json.Serialize(new {passed=passed,transparentPixels=clear,inkPixels=ink,layered=(locked&0x80000)!=0,lockedClickThrough=(locked&0x20)!=0,unlockedInteractive=(unlocked&0x20)==0,unlockHandle=unlockAction,unlockCentered,unlockAboveLyrics,unlockTransparent,hoverBounds,resizeBounds,opacity,readingSize,karaoke,width=image.PixelWidth,height=image.PixelHeight}),new UTF8Encoding(false));
                window.Shutdown();app.Shutdown();return passed?0:1;
            }catch(Exception e){File.WriteAllText(Path.Combine(directory,"native-result.json"),Data.Json.Serialize(new {passed=false,error=e.ToString()}));return 1;}
        }
        static RenderTargetBitmap RenderCanvas(IDictionary<string,object> frame){var canvas=new LyricCanvas();canvas.SetFrame(frame);canvas.Measure(new Size(760,double.PositiveInfinity));canvas.Arrange(new Rect(0,0,760,canvas.DesiredSize.Height));canvas.UpdateLayout();var image=new RenderTargetBitmap(760,(int)Math.Ceiling(canvas.ActualHeight),96,96,PixelFormats.Pbgra32);image.Render(canvas);return image;}
        static byte[] Pixels(RenderTargetBitmap image){var bytes=new byte[image.PixelWidth*image.PixelHeight*4];image.CopyPixels(bytes,image.PixelWidth*4,0);return bytes;}
        static int TopAlpha(RenderTargetBitmap image){var bytes=Pixels(image);int max=0;for(int i=3;i<Math.Min(bytes.Length,image.PixelWidth*26*4);i+=4)max=Math.Max(max,bytes[i]);return max;}
        static int InkDifference(RenderTargetBitmap first,RenderTargetBitmap second){var a=Pixels(first);var b=Pixels(second);int changed=0;for(int i=0;i<Math.Min(a.Length,b.Length);i+=4)if(a[i]!=b[i]||a[i+1]!=b[i+1]||a[i+2]!=b[i+2])changed++;return changed;}
        static int RenderSample(string encoded){
            try{
                var cfg=Data.Json.DeserializeObject(Encoding.UTF8.GetString(Convert.FromBase64String(encoded))) as IDictionary<string,object>;
                var app=new Application();var canvas=new LyricCanvas();canvas.SetFrame(Data.Object(cfg,"frame"));double width=Data.Number(cfg,"width",760),dpi=Data.Number(cfg,"dpi",96);
                canvas.Measure(new Size(width,double.PositiveInfinity));canvas.Arrange(new Rect(0,0,width,canvas.DesiredSize.Height));canvas.UpdateLayout();
                var image=new RenderTargetBitmap((int)Math.Ceiling(width*dpi/96),(int)Math.Ceiling(canvas.ActualHeight*dpi/96),dpi,dpi,PixelFormats.Pbgra32);image.Render(canvas);
                var png=new PngBitmapEncoder();png.Frames.Add(BitmapFrame.Create(image));using(var output=File.Create(Data.Text(cfg,"output")))png.Save(output);app.Shutdown();return 0;
            }catch{return 1;}
        }
    }
}
