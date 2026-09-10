class EdenAgentCompanyInfo extends AIInfo {
    function GetAuthor()      { return "Eden Agent"; }
    function GetName()        { return "Eden Agent Company"; }
    function GetDescription() { return "Passive company owner controlled through the Eden Agent GameScript bridge."; }
    function GetVersion()     { return 1; }
    function MinVersionToLoad(){ return 1; }
    function GetDate()        { return "2026-08-07"; }
    function CreateInstance() { return "EdenAgentCompany"; }
    function GetShortName()   { return "MAAI"; }
    function GetAPIVersion()  { return "15"; }
}

RegisterAI(EdenAgentCompanyInfo());
