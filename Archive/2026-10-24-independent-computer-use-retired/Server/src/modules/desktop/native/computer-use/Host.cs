using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Threading;
using System.Web.Script.Serialization;

class ComputerUseHost {
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer {MaxJsonLength=32*1024*1024};
    static readonly object Output=new object();
    static readonly ConcurrentDictionary<string,CancellationTokenSource> Running=new ConcurrentDictionary<string,CancellationTokenSource>();
    static readonly BlockingCollection<Dictionary<string,object>> Queue=new BlockingCollection<Dictionary<string,object>>(32);
    static void Emit(object value) {lock(Output) {Console.WriteLine(Json.Serialize(value));Console.Out.Flush();}}
    static void Cancel(CancellationTokenSource cancellation) {try {cancellation.Cancel();} catch(ObjectDisposedException) {}}
    static void Enqueue(string id,Dictionary<string,object> request) {
        var cancellation=new CancellationTokenSource();
        if(!Running.TryAdd(id,cancellation)) {cancellation.Dispose();throw new Failure("REQUEST_REJECTED");}
        if(Queue.TryAdd(request))return;
        CancellationTokenSource removed;Running.TryRemove(id,out removed);cancellation.Dispose();throw new Failure("REQUEST_REJECTED");
    }
    static object Dispatch(Dictionary<string,object> input,CancellationToken token) {
        string action=Windows.Text(input,"action");var args=Windows.Object(input.ContainsKey("args")?input["args"]:null);
        token.ThrowIfCancellationRequested();
        if(action=="windows")return Windows.List();
        if(action=="observe")return Capture.Observe(args,token);
        if(action=="launch_app") {
            string application=Windows.Text(args,"path",Windows.Text(args,"name"));
            if(application.Length==0 || application.IndexOf('\0')>=0)throw new Failure("APPLICATION_INVALID");
            if(!System.IO.Path.HasExtension(application))application+=".exe";
            if(!application.EndsWith(".exe",StringComparison.OrdinalIgnoreCase))throw new Failure("APPLICATION_INVALID");
            var parameters=new List<string>();var extra=args.ContainsKey("additional_arguments")?args["additional_arguments"] as object[]:null;
            if(extra!=null)foreach(object value in extra)parameters.Add(Quote(Convert.ToString(value)));
            using(var process=Process.Start(new ProcessStartInfo(application,string.Join(" ",parameters.ToArray())) {UseShellExecute=false})) {}
            return new {status="delivered",route="system_api",message="应用已请求启动，请重新发现实际窗口"};
        }
        if(action=="bring_to_front" || action=="set_window_frame") {
            var window=Windows.Target(args);if(action=="bring_to_front")Windows.Activate(window,token);
            else if(!Windows.MoveWindow(window,Windows.Number(args,"x"),Windows.Number(args,"y"),Windows.Number(args,"width"),Windows.Number(args,"height"),true))throw new Failure("WINDOW_RESIZE_FAILED");
            Capture.Snapshots.Remove(window.ToInt64().ToString());
            return new {status="delivered",route="system_api",message="窗口操作已请求，请重新观察"};
        }
        return Input.Act(action,args,token);
    }
    static string Quote(string value) {
        var result=new System.Text.StringBuilder("\"");int slashes=0;
        foreach(char c in value) {if(c=='\\') {slashes++;continue;}if(c=='\"')result.Append('\\',slashes*2+1);else result.Append('\\',slashes);result.Append(c);slashes=0;}
        return result.Append('\\',slashes*2).Append('"').ToString();
    }
    static void Worker() {
        try {Windows.DpiAware();} catch(Failure error) {Emit(new {error=error.Code});return;}
        Emit(new {ready=true,backend="eden.computer-use.windows.v1"});
        foreach(var request in Queue.GetConsumingEnumerable()) {
            string id=Windows.Text(request,"id");CancellationTokenSource cancellation;
            if(!Running.TryGetValue(id,out cancellation))continue;
            try {Emit(new {id=id,result=Dispatch(request,cancellation.Token)});}
            catch(Exception error) {Emit(new {id=id,error=new {code=error is Failure?((Failure)error).Code:error is OperationCanceledException?"COMPUTER_USE_CANCELLED":"COMPUTER_USE_FAILED"}});}
            finally {CancellationTokenSource removed;Running.TryRemove(id,out removed);cancellation.Dispose();}
        }
    }
    [STAThread] static int Main() {
        Console.InputEncoding=new System.Text.UTF8Encoding(false);Console.OutputEncoding=new System.Text.UTF8Encoding(false);
        try {Windows.SetProcessDpiAwarenessContext(new IntPtr(-4));} catch(EntryPointNotFoundException) {Emit(new {error="DPI_AWARENESS_UNAVAILABLE"});return 1;}
        var worker=new Thread(Worker);worker.SetApartmentState(ApartmentState.STA);worker.IsBackground=true;worker.Start();
        var readerJson=new JavaScriptSerializer {MaxJsonLength=128*1024};
        string line;
        while((line=Console.ReadLine())!=null) {
            try {
                if(line.Length>128*1024)throw new Failure("REQUEST_TOO_LARGE");
                var request=readerJson.Deserialize<Dictionary<string,object>>(line);string id=Windows.Text(request,"id");
                if(Windows.Text(request,"action")=="cancel") {CancellationTokenSource cancellation;if(Running.TryGetValue(Windows.Text(request,"requestId"),out cancellation))Cancel(cancellation);continue;}
                Enqueue(id,request);
            } catch {Emit(new {error="REQUEST_REJECTED"});}
        }
        foreach(var cancellation in Running.Values)Cancel(cancellation);Queue.CompleteAdding();worker.Join(3000);return 0;
    }
}
