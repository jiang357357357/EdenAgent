class EdenAgentBridgeInfo extends GSInfo {
    function GetAuthor()      { return "Eden Agent"; }
    function GetName()        { return "EdenAgentBridge"; }
    function GetDescription() { return "Structured Admin Port bridge for Eden Agent gameplay commands."; }
    function GetVersion()     { return 6; }
    function MinVersionToLoad(){ return 1; }
    function GetDate()        { return "2026-08-07"; }
    function CreateInstance() { return "EdenAgentBridge"; }
    function GetShortName()   { return "MABR"; }
    function GetAPIVersion()  { return "15"; }
}

RegisterGS(EdenAgentBridgeInfo());
