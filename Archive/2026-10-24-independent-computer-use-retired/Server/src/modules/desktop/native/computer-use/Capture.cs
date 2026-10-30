using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Threading;
using System.Windows.Automation;

sealed class Snapshot {
    public string Id=Guid.NewGuid().ToString("N"), Started;
    public IntPtr Window;
    public Windows.Rect Bounds;
    public int Width,Height;
    public bool HasScreenshot;
    public readonly Dictionary<string,AutomationElement> Elements=new Dictionary<string,AutomationElement>();
    public readonly Dictionary<string,System.Windows.Rect> Frames=new Dictionary<string,System.Windows.Rect>();
    public readonly Dictionary<string,string> Fingerprints=new Dictionary<string,string>();
    public System.Windows.Rect RootFrame;
    public object Frame(System.Windows.Rect frame) {
        if(frame.IsEmpty || RootFrame.IsEmpty || RootFrame.Width<=0 || RootFrame.Height<=0)return null;
        return new {x=(frame.X-RootFrame.X)*Width/RootFrame.Width,y=(frame.Y-RootFrame.Y)*Height/RootFrame.Height,
            width=frame.Width*Width/RootFrame.Width,height=frame.Height*Height/RootFrame.Height};
    }
    public Windows.Point Pixel(double x,double y) { return new Windows.Point {x=Bounds.left+(int)Math.Round(x*(Bounds.right-Bounds.left)/Width),y=Bounds.top+(int)Math.Round(y*(Bounds.bottom-Bounds.top)/Height)}; }
    public void AssertCurrent() {
        if(Windows.Started(Window)!=Started)throw new Failure("WINDOW_REPLACED");
        var r=Windows.Rectangle(Window);
        if(r.left!=Bounds.left || r.top!=Bounds.top || r.right!=Bounds.right || r.bottom!=Bounds.bottom)throw new Failure("WINDOW_CHANGED");
    }
}

static class Capture {
    public static readonly Dictionary<string,Snapshot> Snapshots=new Dictionary<string,Snapshot>();
    public static object Observe(Dictionary<string,object> input,CancellationToken token) {
        IntPtr window=Windows.Target(input); var bounds=Windows.Rectangle(window);
        var shot=new Snapshot {Window=window,Bounds=bounds,Started=Windows.Started(window),HasScreenshot=Windows.Flag(input,"screenshot",true)};
        int width=bounds.right-bounds.left,height=bounds.bottom-bounds.top;
        if((long)width*height>64000000)throw new Failure("CAPTURE_TOO_LARGE");
        double scale=Math.Min(1.0,1600.0/Math.Max(width,height));shot.Width=Math.Max(1,(int)Math.Round(width*scale));shot.Height=Math.Max(1,(int)Math.Round(height*scale));
        var images=new List<object>();
        if(shot.HasScreenshot) {
            if(Windows.IsIconic(window))throw new Failure("WINDOW_MINIMIZED");
            // Screen capture is deliberately foreground-only: never label another app's pixels as this window.
            Visible(window,bounds);
            token.ThrowIfCancellationRequested();
            using(var bitmap=new Bitmap(width,height)) {
                using(var graphics=Graphics.FromImage(bitmap))graphics.CopyFromScreen(bounds.left,bounds.top,0,0,new Size(width,height),CopyPixelOperation.SourceCopy);
                using(var resized=new Bitmap(shot.Width,shot.Height)) {
                    using(var graphics=Graphics.FromImage(resized)) {graphics.InterpolationMode=InterpolationMode.HighQualityBicubic;graphics.DrawImage(bitmap,0,0,shot.Width,shot.Height);}
                    using(var stream=new MemoryStream()) {resized.Save(stream,ImageFormat.Png);images.Add(new {mime="image/png",data=Convert.ToBase64String(stream.ToArray())});}
                }
            }
        }
        object focus=null; var elements=new List<object>(); bool complete=false;
        if(Windows.Flag(input,"text",false)) Accessibility.Read(shot,elements,out focus,out complete,token);
        token.ThrowIfCancellationRequested();shot.AssertCurrent();if(shot.HasScreenshot)Visible(window,bounds);
        // A newer observation replaces every previous token for this window.
        if(Snapshots.Count>=128 && !Snapshots.ContainsKey(window.ToInt64().ToString())) {var keys=new List<string>(Snapshots.Keys);Snapshots.Remove(keys[0]);}
        Snapshots[window.ToInt64().ToString()]=shot;
        uint pid;Windows.GetWindowThreadProcessId(window,out pid);
        return new {window=new {pid=(int)pid,windowId=window.ToInt64().ToString(),app=Windows.Text(input,"app"),title=Windows.Title(window),bounds=Windows.Bounds(bounds),minimized=Windows.IsIconic(window)},
            snapshot=shot.Id,elements=elements,images=images,width=shot.HasScreenshot?shot.Width:0,height=shot.HasScreenshot?shot.Height:0,
            scale=scale,frameValid=shot.HasScreenshot?(object)true:null,screenshotIncluded=shot.HasScreenshot,elementsComplete=complete,truncated=!complete&&elements.Count>=400,
            elementCoordinateSpace="window_screenshot_pixels",focusedElement=focus,captureBackend="foreground_screen_copy",textRequested=Windows.Flag(input,"text",false)};
    }
    public static Snapshot Consume(Dictionary<string,object> input) {
        string key=Windows.Text(input,"window_id");Snapshot shot;
        if(!Snapshots.TryGetValue(key,out shot) || shot.Id!=Windows.Text(input,"snapshot"))throw new Failure("OBSERVATION_REQUIRED");
        Snapshots.Remove(key);shot.AssertCurrent();return shot;
    }
    static void Visible(IntPtr window,Windows.Rect bounds) {
        if(Windows.GetForegroundWindow()!=window)throw new Failure("CAPTURE_REQUIRES_FOREGROUND");
        int[] xs={bounds.left+10,(bounds.left+bounds.right)/2,bounds.right-11};
        int[] ys={bounds.top+35,(bounds.top+bounds.bottom)/2,bounds.bottom-11};
        foreach(int x in xs)foreach(int y in ys)if(!Windows.Hit(window,x,y))throw new Failure("WINDOW_OCCLUDED");
    }
}
