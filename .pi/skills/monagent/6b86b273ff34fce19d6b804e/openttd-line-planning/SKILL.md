---
name: openttd-line-planning
description: 为 OpenTTD 当前服务器规划开局盈利线路：探查周边城镇与产业、定位装卸货运站、判断车型与货种，并给出建站/修路/设调度的工作流。适合新开局选线路或排查调度问题时使用。
metadata:
  monagent:
    display_name: OpenTTD 开局线路规划
    version: 1.0.0
    tools:
    - query_openttd
    - execute_connector_action
    - list_connectors
    profiles:
    - user_chat
    - self_awake
---

当需要为当前 OpenTTD 服务器规划线路、排查调度、或评估运营时使用本技能。

## 第一步：拉取现状
先调用 query_openttd 的 get_state 确认服务器与公司状态（日期、资金、现有车辆与站点）。再调用 get_company_assets 查看现有车队和站点。

## 第二步：探查产业与城镇
用 find_industries 列出周边产业，用 find_towns 列出城镇人口。重点标记：煤矿、铁矿、油田（产地）；钢铁厂、工厂、发电厂（收货地）。

## 第三步：推荐线路（按优先级）
1. 经典开局盈利线：煤矿 → 发电厂（煤电），或铁矿 → 钢铁厂（铁钢）。原料单价高、需求稳定。
2. 货运链注意：钢铁厂同时收煤+铁，纯单料会卡产量，最好双路喂料。
3. 客运可选，但初期资金有限时优先货线。

## 第四步：判断装卸点
关键规则：卡车/火车只能去「车站」装卸货，不能直接去矿场/工厂本身。确认产业旁是否已有对应货运站；没有则需补建。

## 第五步：车型与货种
根据货种选择对应载具（铁矿石→铁矿石卡车等）。若车已买但货种不对，需去车库重装（refit）。

## 第六步：输出方案
给出：起点站/终点站坐标、货种、推荐车型、是否已有货运站、调度顺序（装载站→卸载站循环）。

## 已知限制（重要）
当前连接器只能执行新建类命令（build_road、build_road_station、build_road_depot、buy_road_vehicle、build_hq_near），无法直接修改已有车辆的调度/订单。若调度有误需让用户手动改单，或通过 gameplay_plan 下发新建命令。
