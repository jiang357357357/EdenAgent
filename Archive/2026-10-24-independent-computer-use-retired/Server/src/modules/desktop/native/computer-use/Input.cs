using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;

static class Input {
    [StructLayout(LayoutKind.Sequential)] struct Mouse {public int x,y;public uint data,flags,time;public UIntPtr extra;}
    [StructLayout(LayoutKind.Sequential)] struct Key {public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
    [StructLayout(LayoutKind.Explicit)] struct Data {[FieldOffset(0)]public Mouse mouse;[FieldOffset(0)]public Key key;}
    [StructLayout(LayoutKind.Sequential)] struct Event {public uint type;public Data data;}
    [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,Event[] events,int size);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
    static void Send(Event[] events) {if(SendInput((uint)events.Length,events,Marshal.SizeOf(typeof(Event)))!=events.Length)throw new Failure("INPUT_PARTIAL");}
    static Event Keyboard(ushort vk,ushort scan,uint flags) {return new Event {type=1,data=new Data {key=new Key {vk=vk,scan=scan,flags=flags}}};}
    static void MouseEvent(uint flags,uint data=0) {Send(new[] {new Event {type=0,data=new Data {mouse=new Mouse {flags=flags,data=data}}}});}
    static ushort KeyCode(string name) {
        name=name.ToLowerInvariant().Replace("_l","").Replace("_r","");
        var keys=new Dictionary<string,ushort> {{"ctrl",17},{"control",17},{"alt",18},{"shift",16},{"enter",13},{"return",13},{"tab",9},{"esc",27},{"escape",27},
            {"space",32},{"backspace",8},{"back",8},{"delete",46},{"del",46},{"left",37},{"up",38},{"right",39},{"down",40},{"home",36},{"end",35},{"pageup",33},{"pagedown",34},{"insert",45}};
        ushort code;if(keys.TryGetValue(name,out code))return code;
        if(name.Length==1 && char.IsLetterOrDigit(name[0]))return (ushort)char.ToUpperInvariant(name[0]);
        int number;if(name.StartsWith("f") && int.TryParse(name.Substring(1),out number) && number>=1 && number<=24)return (ushort)(111+number);
        if(name.StartsWith("kp_") && int.TryParse(name.Substring(3),out number) && number>=0 && number<=9)return (ushort)(96+number);
        throw new Failure("KEY_UNSUPPORTED");
    }
    static Windows.Point Point(Snapshot shot,Dictionary<string,object> input,string xKey="x",string yKey="y") {
        double x=Convert.ToDouble(input[xKey]),y=Convert.ToDouble(input[yKey]);
        if(!shot.HasScreenshot || double.IsNaN(x) || double.IsNaN(y) || x<0 || y<0 || x>=shot.Width || y>=shot.Height)throw new Failure("COORDINATE_OUTSIDE_WINDOW");
        return shot.Pixel(x,y);
    }
    static Windows.Point TargetPoint(Snapshot shot,Dictionary<string,object> input) {
        if(Windows.Text(input,"element_token").Length==0)return Point(shot,input);
        var element=Accessibility.Element(shot,input);var frame=element.Current.BoundingRectangle;
        double x=(frame.X+frame.Width/2-shot.RootFrame.X)*shot.Width/shot.RootFrame.Width;
        double y=(frame.Y+frame.Height/2-shot.RootFrame.Y)*shot.Height/shot.RootFrame.Height;
        if(double.IsNaN(x) || double.IsNaN(y) || x<0 || y<0 || x>=shot.Width || y>=shot.Height)throw new Failure("ELEMENT_NOT_VISIBLE");
        return shot.Pixel(x,y);
    }
    static void Position(Snapshot shot,Windows.Point point) {
        shot.AssertCurrent();
        if(Windows.GetForegroundWindow()!=shot.Window)throw new Failure("WINDOW_NOT_FOREGROUND");
        if(!Windows.Hit(shot.Window,point.x,point.y))throw new Failure("POINT_NOT_TARGET_WINDOW");
        if(!SetCursorPos(point.x,point.y))throw new Failure("POINTER_UNAVAILABLE");
    }
    public static object Act(string action,Dictionary<string,object> input,CancellationToken token) {
        var shot=Capture.Consume(input);Windows.Activate(shot.Window,token);shot.AssertCurrent();
        token.ThrowIfCancellationRequested();
        if(action=="set_value") {
            var element=Accessibility.Element(shot,input);object pattern;
            if(!element.TryGetCurrentPattern(ValuePattern.Pattern,out pattern) || ((ValuePattern)pattern).Current.IsReadOnly)throw new Failure("SET_VALUE_UNSUPPORTED");
            ((ValuePattern)pattern).SetValue(Windows.Text(input,"value"));
        } else if(action=="type_text") Type(shot,input,token);
        else if(action=="hotkey") Keys(input,token);
        else if(action=="drag") Drag(shot,input,token);
        else {
            var point=TargetPoint(shot,input);Position(shot,point);token.ThrowIfCancellationRequested();
            if(action=="click") {
                string button=Windows.Text(input,"button","left");uint down=button=="right"?8u:button=="middle"?32u:2u;
                for(int n=0;n<Windows.Number(input,"count",1);n++) {token.ThrowIfCancellationRequested();MouseEvent(down);try {} finally {MouseEvent(down*2);} if(n+1<Windows.Number(input,"count",1))Thread.Sleep(60);}
            } else if(action=="scroll") {
                string direction=Windows.Text(input,"direction","down");int delta=Windows.Number(input,"amount",3)*120*(direction=="up"||direction=="right"?1:-1);
                MouseEvent(direction=="left"||direction=="right"?0x1000u:0x800u,unchecked((uint)delta));
            } else throw new Failure("ACTION_UNSUPPORTED");
        }
        return new {status="delivered",route=action=="set_value"?"accessibility":"global_input",effect="unverifiable"};
    }
    static void Type(Snapshot shot,Dictionary<string,object> input,CancellationToken token) {
        var focused=AutomationElement.FocusedElement;
        if(focused==null || focused.Current.IsPassword)throw new Failure("FOCUS_REQUIRED");
        var current=focused;var root=AutomationElement.RootElement;var target=AutomationElement.FromHandle(shot.Window);
        while(current!=null && !Automation.Compare(current,root) && !Automation.Compare(current,target))current=TreeWalker.ControlViewWalker.GetParent(current);
        if(current==null || Automation.Compare(current,root))throw new Failure("FOCUS_NOT_TARGET_WINDOW");
        string key=Windows.Text(input,"element_token");
        if(key.Length>0 && !Automation.Compare(Accessibility.Element(shot,input),focused))throw new Failure("FOCUS_NOT_TARGET_ELEMENT");
        string text=Windows.Text(input,"text");
        for(int offset=0;offset<text.Length;offset+=64) {
            token.ThrowIfCancellationRequested();if(Windows.GetForegroundWindow()!=shot.Window)throw new Failure("FOCUS_CHANGED");
            var events=new List<Event>();for(int index=offset;index<Math.Min(text.Length,offset+64);index++) {events.Add(Keyboard(0,text[index],4));events.Add(Keyboard(0,text[index],6));}Send(events.ToArray());
        }
    }
    static void Keys(Dictionary<string,object> input,CancellationToken token) {
        var keys=input["keys"] as object[];if(keys==null || keys.Length==0 || keys.Length>6)throw new Failure("KEY_UNSUPPORTED");
        var codes=new List<ushort>();foreach(object key in keys)codes.Add(KeyCode(Convert.ToString(key)));
        var events=new List<Event>();foreach(ushort code in codes)events.Add(Keyboard(code,0,0));
        for(int index=codes.Count-1;index>=0;index--)events.Add(Keyboard(codes[index],0,2));token.ThrowIfCancellationRequested();
        try {Send(events.ToArray());} finally {var release=new List<Event>();foreach(ushort code in codes)release.Add(Keyboard(code,0,2));Send(release.ToArray());}
    }
    static void Drag(Snapshot shot,Dictionary<string,object> input,CancellationToken token) {
        Snapshot destination=shot;
        if(Windows.Text(input,"to_window_id").Length>0)destination=Capture.Consume(new Dictionary<string,object> {{"window_id",input["to_window_id"]},{"snapshot",input["to_snapshot"]}});
        var from=Point(shot,input,"from_x","from_y");var to=Point(destination,input,"to_x","to_y");Position(shot,from);
        if(!Windows.Hit(destination.Window,to.x,to.y))throw new Failure("POINT_NOT_TARGET_WINDOW");
        MouseEvent(2);
        try {for(int n=1;n<=20;n++) {token.ThrowIfCancellationRequested();SetCursorPos(from.x+(to.x-from.x)*n/20,from.y+(to.y-from.y)*n/20);Thread.Sleep(Math.Max(5,Windows.Number(input,"duration_ms",500)/20));}}
        finally {MouseEvent(4);}
    }
}
