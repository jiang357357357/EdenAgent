using System;
using System.Collections.Generic;
using System.Threading;
using System.Windows.Automation;

static class Accessibility {
    public static void Read(Snapshot shot,List<object> elements,out object focused,out bool complete,CancellationToken token) {
        focused=null;complete=false;
        var root=AutomationElement.FromHandle(shot.Window);shot.RootFrame=root.Current.BoundingRectangle;
        var pending=new Queue<Tuple<AutomationElement,string,int>>();pending.Enqueue(Tuple.Create(root,(string)null,0));
        bool truncated=false;
        while(pending.Count>0 && elements.Count<400) {
            token.ThrowIfCancellationRequested();var entry=pending.Dequeue();var element=entry.Item1;
            try {
                var current=element.Current;if(current.IsPassword)continue;
                string index=elements.Count.ToString(), key=shot.Id+":"+index;
                string role=current.ControlType.ProgrammaticName.Replace("ControlType.","");if(role=="Window")role="Document";
                string value="";bool valueAvailable=false;object pattern;
                var actions=new List<string>();
                if(element.TryGetCurrentPattern(ValuePattern.Pattern,out pattern)) {var v=(ValuePattern)pattern;value=v.Current.Value??"";valueAvailable=true;if(!v.Current.IsReadOnly)actions.Add("set_value");}
                if(element.TryGetCurrentPattern(InvokePattern.Pattern,out pattern))actions.Add("invoke");
                if(element.TryGetCurrentPattern(TextPattern.Pattern,out pattern)) {actions.Add("text");if(!valueAvailable) {value=((TextPattern)pattern).DocumentRange.GetText(16001)??"";valueAvailable=true;}}
                shot.Elements[key]=element;shot.Frames[key]=current.BoundingRectangle;shot.Fingerprints[key]=Fingerprint(element);
                bool valueTruncated=value.Length>16000;string label=current.Name??"";bool labelTruncated=label.Length>1000;
                var record=new {token=key,index=index,parent=entry.Item2,role=role,label=label.Substring(0,Math.Min(label.Length,1000)),
                    value=value.Substring(0,Math.Min(value.Length,16000)),valueAvailable=valueAvailable,valueTruncated=valueTruncated,labelTruncated=labelTruncated,
                    enabled=current.IsEnabled,actions=actions,frame=shot.Frame(current.BoundingRectangle),focused=current.HasKeyboardFocus};
                elements.Add(record);if(current.HasKeyboardFocus)focused=record;
                var child=TreeWalker.ControlViewWalker.GetFirstChild(element);
                while(child!=null) {
                    if(entry.Item3>=20 || pending.Count+elements.Count>=800) {truncated=true;break;}
                    pending.Enqueue(Tuple.Create(child,index,entry.Item3+1));child=TreeWalker.ControlViewWalker.GetNextSibling(child);
                }
            } catch(ElementNotAvailableException) {truncated=true;} catch(InvalidOperationException) {truncated=true;}
        }
        complete=pending.Count==0 && !truncated;
    }
    public static AutomationElement Element(Snapshot shot,Dictionary<string,object> input) {
        string key=Windows.Text(input,"element_token");AutomationElement element;
        if(!shot.Elements.TryGetValue(key,out element))throw new Failure("ELEMENT_REFERENCE_EXPIRED");
        if(element.Current.IsPassword || !element.Current.IsEnabled)throw new Failure("ELEMENT_NOT_ACTIONABLE");
        // Retain the observed UIA object and verify its rectangle, rather than looking up a new index.
        if(element.Current.BoundingRectangle!=shot.Frames[key])throw new Failure("ELEMENT_MOVED");
        if(Fingerprint(element)!=shot.Fingerprints[key])throw new Failure("ELEMENT_CHANGED");
        return element;
    }
    static string Fingerprint(AutomationElement element) {
        var text=new System.Text.StringBuilder(element.Current.ControlType.ProgrammaticName+"|"+element.Current.Name);
        object value;if(element.TryGetCurrentPattern(ValuePattern.Pattern,out value))text.Append('|').Append(((ValuePattern)value).Current.Value);
        // Unnamed conversation rows are identified by their visible child names, not by their index alone.
        var child=TreeWalker.ControlViewWalker.GetFirstChild(element);int count=0;
        while(child!=null && count++<8) {
            text.Append('|').Append(child.Current.Name);var nested=TreeWalker.ControlViewWalker.GetFirstChild(child);int inner=0;
            while(nested!=null && inner++<8) {text.Append('|').Append(nested.Current.Name);nested=TreeWalker.ControlViewWalker.GetNextSibling(nested);}
            child=TreeWalker.ControlViewWalker.GetNextSibling(child);
        }
        using(var hash=System.Security.Cryptography.SHA256.Create())return Convert.ToBase64String(hash.ComputeHash(System.Text.Encoding.UTF8.GetBytes(text.ToString())));
    }
}
