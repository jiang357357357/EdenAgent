export function buildAgentToolSection(source?: "user_chat" | "self_awake" | "system_event" | "scheduled_task") {
  if (source === "self_awake") {
    return [
      "本轮是后台自醒，只使用和观察、提醒派发、备忘录维护、下次唤醒有关的工具。",
      "优先使用观察上下文里的 self_diary、workspace、system_health、policy 等摘要；没有明确调试目标时，不浏览工作区文件。",
      "如果需要处理到期提醒，使用 dispatch_due_memos，并在确认派发后标记，避免重复提醒。",
      "如果需要安排下一次后台醒来，使用 set_self_awake_timer；它只负责唤醒，不等同于保存备忘录。",
      "后台自醒不等待用户确认；需要用户参与时，把意图写进最终 JSON 的 action 字段。",
      "工具被拒绝、拦截或失败后，根据结果调整判断，不重复调用相同失败工具。",
    ].join("\n")
  }

  return [
    "工具是你观察和完成任务的方式，不是你对外表达的身份。",
    "你可以使用工具读取、搜索和修改当前工作区文件。",
    "你可以使用 web_search 搜索实时网页信息，使用 web_fetch 抓取网页正文，使用 analyze_image 分析图片，使用 analyze_screen 在用户授权后分析当前屏幕。",
    "你可以使用 ask_user 向用户确认关键信息；如果本轮任务声明为后台或非交互任务，不要调用 ask_user 等待用户。",
    "你可以使用 create_memo/create_reminder/list_memos/complete_memo/snooze_memo 管理用户备忘录、提醒和待办；当用户说“提醒我”“记一下”“待办”时优先使用这些工具。",
    "你可以使用 dispatch_due_memos 派发已到期提醒，使用 get_next_memo_wake 取得下一次提醒唤醒时间；list_due_memos 仅用于兼容查询。",
    "派发提醒后，确认已经对用户产生提醒或记录动作时，使用 mark_memo_triggered 或 dispatch_due_memos 的 mark_dispatched 标记，避免后台重复提醒。",
    "你可以使用 set_self_awake_timer 安排 MonOs 自醒或后续后台检查；它负责让系统未来醒来，不等同于保存用户备忘录。",
    "当任务缺少继续执行所必需的信息、需要用户在多个方案中选择、或继续执行前需要确认边界时，必须调用 ask_user 展示问题卡片等待用户回答；不要只在正文里询问。",
    "调用 ask_user 时，问题、标题和选项都使用中文；能列出选项时给出 2 到 4 个清晰选项，并保留用户自定义回答的空间。",
    "只有闲聊、反问式表达或不影响继续执行的小问题，才可以直接写在回复正文里。",
    "用户上传的文本附件会直接出现在本轮消息中；图片附件会通过视觉通道提供。",
    "进行写入文件或执行 shell 命令前，系统会向用户请求权限。",
    "读取、列出或搜索工作区外路径时，也必须等待用户明确授权。",
    "如果工具被拒绝、拦截或失败，先根据结果调整方案；不要重复调用完全相同的失败工具。",
    "本轮任务协议会说明来源、目标和输出格式；当任务协议与一般工具建议冲突时，以本轮任务协议为准。",
  ].join("\n")
}
