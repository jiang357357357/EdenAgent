using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Eden implementation of the documented window-bound Computer Use workflow.
// This does not load or communicate with Codex's private Computer Use helper.
static class Windows {
    public delegate bool EnumWindow(IntPtr window, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int x, y; }
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern IntPtr GetThreadDpiAwarenessContext();
    [DllImport("user32.dll")] static extern bool AreDpiAwarenessContextsEqual(IntPtr first,IntPtr second);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect bounds);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr window, int x, int y, int width, int height, bool redraw);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindow callback, IntPtr data);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    public static void DpiAware() { SetThreadDpiAwarenessContext(new IntPtr(-4));if(!AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(),new IntPtr(-4)))throw new Failure("DPI_AWARENESS_UNAVAILABLE"); }
    public static object Bounds(Rect r) { return new { x=r.left, y=r.top, width=r.right-r.left, height=r.bottom-r.top }; }
    public static string Title(IntPtr window) { var text=new StringBuilder(1024); GetWindowText(window,text,text.Capacity); return text.ToString(); }
    public static Dictionary<string,object> Object(object value) { return value as Dictionary<string,object> ?? new Dictionary<string,object>(); }
    public static string Text(Dictionary<string,object> input,string key,string fallback="") { object value; return input.TryGetValue(key,out value) && value != null ? Convert.ToString(value) : fallback; }
    public static int Number(Dictionary<string,object> input,string key,int fallback=0) { object value; return input.TryGetValue(key,out value) && value != null ? Convert.ToInt32(value) : fallback; }
    public static bool Flag(Dictionary<string,object> input,string key,bool fallback=false) { object value; return input.TryGetValue(key,out value) && value != null ? Convert.ToBoolean(value) : fallback; }
    public static IntPtr Target(Dictionary<string,object> input) {
        IntPtr window=new IntPtr(long.Parse(Text(input,"window_id"))); uint pid;
        if(!IsWindow(window)) throw new Failure("WINDOW_CLOSED");
        GetWindowThreadProcessId(window,out pid);
        if(pid != Number(input,"pid")) throw new Failure("WINDOW_REPLACED");
        return window;
    }
    public static Rect Rectangle(IntPtr window) {
        Rect rect; if(!GetWindowRect(window,out rect) || rect.right<=rect.left || rect.bottom<=rect.top) throw new Failure("WINDOW_UNAVAILABLE");
        return rect;
    }
    public static string Started(IntPtr window) { uint pid; GetWindowThreadProcessId(window,out pid); using(var process=Process.GetProcessById((int)pid)) return process.StartTime.ToUniversalTime().Ticks.ToString(); }
    public static bool Hit(IntPtr window,int x,int y) { return GetAncestor(WindowFromPoint(new Point {x=x,y=y}),2)==window; }
    public static void Activate(IntPtr window,CancellationToken token) {
        if(IsIconic(window)) ShowWindowAsync(window,9);
        SetForegroundWindow(window);
        for(int attempt=0;attempt<20;attempt++) { token.ThrowIfCancellationRequested(); if(GetForegroundWindow()==window)return; Thread.Sleep(25); }
        throw new Failure("WINDOW_NOT_FOREGROUND");
    }
    public static object List() {
        var values=new List<object>();
        EnumWindows((window,unused)=> {
            if(values.Count>=512)return false;
            if(!IsWindowVisible(window) && !IsIconic(window))return true;
            string title=Title(window); if(title.Length==0)return true;
            uint pid; GetWindowThreadProcessId(window,out pid);
            try { using(var process=Process.GetProcessById((int)pid)) values.Add(new {pid=(int)pid,windowId=window.ToInt64().ToString(),
                app=process.ProcessName+".exe",title=title,bounds=Bounds(Rectangle(window)),minimized=IsIconic(window)}); }
            catch(ArgumentException) {} catch(System.ComponentModel.Win32Exception) {} catch(Failure) {}
            return true;
        },IntPtr.Zero);
        return values;
    }
}

sealed class Failure:Exception {
    public readonly string Code;
    public Failure(string code):base(code) { Code=code; }
}
