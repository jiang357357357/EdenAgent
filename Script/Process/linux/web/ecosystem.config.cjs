const path = require("path");

const projectRoot = path.resolve(__dirname, "../../../..");
const appName = process.env.MON_AGENT_WEB_PM2_NAME || "agent-web";
const processTag = process.env.MON_PROCESS_TAG || "monagent-main";
const serverPort = process.env.MON_AGENT_PORT || "40092";
const webPort = process.env.MON_AGENT_WEB_PORT || "40091";
const logStartDir = process.env.MON_LOG_START_DIR || "";
const processLogFile = logStartDir ? path.join(logStartDir, "Process", "monagent_web_process.log") : "";

module.exports = {
  apps: [
    {
      name: appName,
      cwd: projectRoot,
      script: path.join(projectRoot, "Script/Process/linux/web/run_web.sh"),
      interpreter: "bash",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      time: true,
      ...(processLogFile ? {
        out_file: processLogFile,
        error_file: processLogFile,
        merge_logs: true,
      } : {}),
      env: {
        MON_PM2_NAME: appName,
        MON_PROCESS_NAME: appName,
        MON_PROCESS_TAG: processTag,
        MON_AGENT_PORT: serverPort,
        MON_AGENT_WEB_PORT: webPort,
        MON_LOG_START_DIR: logStartDir,
      },
    },
  ],
};
