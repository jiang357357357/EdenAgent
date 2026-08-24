# 输出字段说明

脚本 `scripts/report.py` 输出的 JSON 包含两个字段：

## greeting

- 类型：字符串
- 含义：问候语。由 `assets/greeting.txt` 模板生成，其中 `{name}` 占位符会被替换为运行脚本时传入的姓名参数。
- 示例：传入 `Mon` 时，若模板为 `你好，{name}！`，则 greeting 为 `你好，Mon！`

## source

- 类型：字符串
- 含义：输出来源标识，固定为 `skill-script`，用于区分技能脚本输出与其他来源。
- 取值：`skill-script`（常量，不随参数变化）
