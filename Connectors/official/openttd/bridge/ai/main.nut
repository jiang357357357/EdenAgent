class EdenAgentCompany extends AIController {
    function Save() { return {}; }
    function Load(version, data) {}

    function Start() {
        AICompany.SetName("Eden Agent Transport");
        while (true) this.Sleep(365 * 74);
    }
}
