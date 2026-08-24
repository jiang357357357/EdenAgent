---
name: openttd-line-planning
description: 为 OpenTTD 当前服务器规划开局盈利线路：探查周边城镇与产业、定位装卸货运站、判断车型与货种，并给出建站/修路/设调度的工作流。默认由用户自行启动
  OpenTTD 服务器，助手根据用户提供的实例信息接入；适合新开局选线路或排查调度问题时使用。
metadata:
  monagent:
    display_name: OpenTTD 开局线路规划
    version: 1.3.0
    tools:
    - query_openttd
    - execute_connector_action
    - list_connectors
    profiles:
    - user_chat
    - self_awake
---

当需要为当前 OpenTTD 服务器规划线路、排查调度、或评估运营时使用本技能。

## 服务器启动约定（默认）
1. 默认由用户自行启动 OpenTTD 服务器（在游戏内选择「多人游戏」以主机身份开始或载入存档，或由用户手动启动服务器进程）。助手不主动拉起受管实例。
2. 用户启动后，助手根据用户提供的实例信息接入：确认游戏进程（PID）、游戏端口与 admin 端口（admin 端口取 openttd.cfg 的 server_admin_port），必要时生成/确认 active-instance.json，再让连接器连接。
3. 只有用户明确要求时，助手才代为启动受管实例；启动后也必须告知用户当前实例信息，而不是默认接管。

## 第一步：拉取现状
先调用 query_openttd 的 get_state 确认服务器日期与在线公司列表。注意：桥的 get_state 只返回日期 + 公司名/总裁；资金、贷款、收入、车辆数、站点数来自连接器管理协议侧的 economy/statistics 状态，属于另一套数据源，需另外读取。再调用 get_company_assets 查看现有车队和站点（站点含 accepted_cargo 与 waiting 量；车辆含 cargo_loaded、容量、profit、orders）。注意 get_company_assets 的 accepted_cargo 只反映当前正在计费/等待的货，不代表站点"能接受"的货，判断站点收货能力时不要据此下结论。

## 第二步：探查产业与城镇
用 find_industries 列出周边产业，用 find_towns 列出城镇人口。注意：find_industries 只返回类型名(type_name)、类型号(type_id)与 production_level，不返回产业"接受/产出"的货种矩阵——货种关系需按类型名结合官方 wiki 判断，或参考下方第三步。重点标记：煤矿、铁矿、油田（产地）；钢铁厂、工厂、发电厂（收货地）。

## 第三步：推荐线路（按优先级，货种以官方 wiki 为准）
1. 经典开局盈利线：煤矿 → 发电厂（煤电），或铁矿 → 钢铁厂（铁钢）。
2. 货种机制（基础版）：发电厂只收 Coal；钢铁厂（Steel Mill）只收 Iron Ore、产出 Steel。**煤不会进钢铁厂**。若开的是 FIRS/AXIS 等 NewGRF，收货矩阵会不同，需以实际类型为准。
3. 气候注意：钢铁厂只在温带（Temperate）出现，亚北极/亚热带没有铁矿石与钢铁厂，需先判气候。温带地图会出现：煤矿、铁矿、油田、农场、林场、锯木厂、钢铁厂、火力发电厂、工厂。
4. 客运可选，但初期资金有限时优先货线。

## 第四步：判断装卸点
关键规则：卡车/火车只能去「车站」装卸货，不能直接去矿场/工厂本身。确认产业旁是否已有对应货运站；没有则需补建。get_company_assets 可看现有站点的坐标与车型，但桥未把站点与其覆盖的产业关联，需按坐标自行判断。

## 第五步：车型与货种
用 list_road_engines 查可用载具，按 cargo_name 匹配对应车型（实测车辆 NewGRF 下卡车按货种专车专用，如 铁矿石→铁矿石卡车、煤→煤炭卡车、原油→油罐车、谷物→谷物卡车、木材→木材卡车）。若车已买但货种不对，需去车库重装（refit）。

## 第六步：输出方案
给出：起点站/终点站坐标、货种、推荐车型、是否已有货运站、调度顺序（装载站→卸载站循环）。

## 执行能力（重要）
连接器可执行 gameplay_plan / gameplay_command，命令包括：build_road、build_road_station、build_road_depot、buy_road_vehicle（可带 orders 追加）、build_hq_near，以及 modify_orders（set_flags / remove / insert / move）——因此**可以直接修改已有车辆的调度/订单**，不必让用户手动改单。整条线路优先用 gameplay_plan 一次性提交。注意：这些变更命令是站点/车辆/订单级的；连接器目前尚不提供货种单价表、产业收货矩阵、气候字段等查询，需结合 wiki 判断。
