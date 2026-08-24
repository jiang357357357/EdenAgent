# Mon 项目环境变量规范

**版本**: 1.0.0 | **创建日期**: 2026-04-17

---

## 1. 概述

Mon 项目采用统一的 `.monconfig` 配置系统，替代传统的 `.env` 文件，实现：

- **多层配置继承**：支持全局、项目、模块多层配置
- **工作区自动识别**：第一个找到的 `.monconfig` 所在文件夹即为工作区
- **人类友好格式**：配置节分组 + 扁平变量，易读易维护

---

## 2. 配置文件格式

### 2.1 文件命名
- **配置文件名**：`.monconfig`
- **文件编码**：UTF-8
- **文件位置**：项目根目录或任意父级目录

### 2.2 格式规范

```ini
# ============================================================
# 项目名称 .monconfig
# 项目描述
# ============================================================

# ==============================
# [配置节名]  配置节描述
# ==============================
[section]
KEY=VALUE                    # 变量注释
PREFIX_KEY=VALUE             # 用前缀区分子分组
ANOTHER_PREFIX_KEY=VALUE

# ==============================
# [另一个配置节]  另一个描述
# ==============================
[another_section]
SETTING=value
```

### 2.3 格式要点

- **配置节**：`[section]` 用于功能模块分组，方便人类阅读
- **变量格式**：`KEY=VALUE`，与传统 .env 一致
- **变量前缀**：节内用前缀区分子分组（如 `WEBSOCKET_`、`DB_`）
- **注释**：`#` 开头的行为注释
- **空行**：用于分隔不同配置节

---

## 3. 配置边界

- 模块只加载从调用位置向上找到的第一份 `.monconfig`，不继承父模块配置。
- Mon 工作区根目录由 `.monconfig` 与 `.monworkspace` 双锚点识别。
- 跨模块读取必须显式声明；生命周期和健康检查统一位于 MonPM 配置。
- 完整语法、优先级和目录规则见根目录 `文档/配置/monconfig.md`。

---

## 4. 标准配置节定义

### 4.1 通用配置节

| 配置节 | 用途 | 示例变量 |
|--------|------|----------|
| `[service]` | 服务标识 | `NAME`, `VERSION` |
| `[server]` | 服务器配置 | `HOST`, `PORT`, `BASE_URL` |
| `[django]` | Django框架 | `DEBUG`, `SECRET_KEY`, `ALLOWED_HOSTS` |
| `[storage]` | 数据存储 | `MEDIA_ROOT`, `STATIC_ROOT` |
| `[log]` | 日志配置 | `LEVEL`, `FILE`, `PLAIN_FILE` |
| `[process]` | 进程管理 | `NAME`, `SCRIPT_START`, `SCRIPT_STOP` |

### 4.2 模块专用配置节

| 配置节 | 适用模块 | 用途 |
|--------|----------|------|
| `[websocket]` | MonCore | WebSocket服务配置 |
| `[esp32]` | MonCore | ESP32设备配置 |

---

## 5. 变量命名规范

### 5.1 命名原则

- **大写字母**：所有变量名使用大写字母
- **下划线分隔**：多个单词用下划线连接
- **前缀分组**：同一功能的变量使用相同前缀

### 5.2 常用前缀

| 前缀 | 用途 | 示例 |
|------|------|------|
| `DB_` | 数据库相关 | `DB_NAME`, `DB_ENGINE` |
| `WEBSOCKET_` | WebSocket相关 | `WEBSOCKET_PORT`, `WEBSOCKET_DISCOVERY_ENABLED` |
| `SCRIPT_` | 脚本路径 | `SCRIPT_START`, `SCRIPT_STOP` |
| `AI_` | AI服务相关 | `AI_CHROMA_DIR`, `AI_MODEL_NAME` |
| `RENDER_` | 渲染日志 | `RENDER_PANELS`, `RENDER_SVG_DIR` |
| `MON_AGENT_SEARCH_` | Agent 搜索工具 | `MON_AGENT_SEARCH_TIMEOUT_MS` |

### 5.3 布尔值规范

布尔值使用以下格式：

```ini
# 真值
DEBUG=true
ENABLED=yes  
ACTIVE=1
DEVELOPMENT=on

# 假值  
DEBUG=false
ENABLED=no
ACTIVE=0
PRODUCTION=off
```

---

### 5.4 MonAgent 联网搜索与网页抓取变量

MonAgent 使用可插拔的搜索 Provider。默认 `auto` 会优先选择已经配置密钥的结构化搜索 API，然后降级到无需账号的必应与 DuckDuckGo HTML 入口。搜索结果统一包含 `source_id`、标题、URL、摘要、来源域名，以及 Provider 能提供的发布时间和相关度。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MON_AGENT_SEARCH_PROVIDER` | `auto` | Provider 或逗号分隔的优先顺序；支持 `auto`、`brave`、`exa`、`tavily`、`searxng`、`bing`、`duckduckgo` |
| `MON_AGENT_SEARCH_TIMEOUT_MS` | `10000` | 单个搜索入口超时，范围 `1000`～`60000` 毫秒 |
| `MON_AGENT_SEARCH_CACHE_TTL_SECONDS` | `120` | 进程内搜索缓存时间；设为 `0` 可关闭，最大 `3600` 秒 |
| `BRAVE_SEARCH_API_KEY` | 空 | Brave Search API 密钥；也兼容 `BRAVE_API_KEY` |
| `EXA_API_KEY` | 空 | Exa Search API 密钥 |
| `TAVILY_API_KEY` | 空 | Tavily Search API 密钥 |
| `MON_AGENT_SEARXNG_URL` | 空 | 自建 SearXNG 根地址；也兼容 `SEARXNG_URL` |
| `MON_AGENT_FETCH_TIMEOUT_MS` | `20000` | `web_fetch` 超时，范围 `1000`～`120000` 毫秒 |
| `MON_AGENT_FETCH_MAX_BYTES` | `2097152` | 单页最大下载字节数，范围 64 KiB～10 MiB |

可以通过进程环境变量配置，也可以写入 MonAgent `.monconfig` 的 `[search]` 段。只配置一个结构化搜索服务即可，例如：

```ini
[search]
PROVIDER=auto
BRAVE_API_KEY=your-key
CACHE_TTL_SECONDS=120
```

也可以固定优先顺序：

```ini
[search]
PROVIDER=exa,brave
EXA_API_KEY=your-exa-key
BRAVE_API_KEY=your-brave-key
```

`.monconfig` 中对应的键为 `PROVIDER`、`TIMEOUT_MS`、`CACHE_TTL_SECONDS`、`BRAVE_API_KEY`、`EXA_API_KEY`、`TAVILY_API_KEY`、`SEARXNG_URL`、`FETCH_TIMEOUT_MS` 和 `FETCH_MAX_BYTES`。同名进程环境变量的优先级更高。

`web_fetch` 只允许公开的 HTTP/HTTPS 地址，会拦截本机、私网、链路本地和保留地址，并对每次重定向重新校验。旧版外部搜索进程变量已废弃；必应和 DuckDuckGo HTML 解析只作为无密钥降级路径保留。

---

## 6. 项目配置示例

### 6.1 MonCore 配置示例

```ini
# ============================================================
# MonCore .monconfig
# Django 后端核心服务配置
# ============================================================

[service]
NAME=MonCore
VERSION=1.0.0

[server]
HOST=0.0.0.0
PORT=6020
BASE_URL=http://0.0.0.0:6020
WEBSOCKET_PORT=6020
WEBSOCKET_DISCOVERY_ENABLED=true

[django]
DEBUG=true
ALLOWED_HOSTS=localhost,127.0.0.1,0.0.0.0,*
SECRET_KEY=your-secret-key-here
DB_NAME=Data/DB/SQLite/db.sqlite3
DB_ENGINE=django.db.backends.sqlite3

[storage]
MEDIA_ROOT=Data/File
STATIC_ROOT=Data/Static
AI_CHROMA_DIR=Data/DB/Chroma

[log]
LEVEL=info
FILE=Data/Logs/Text/MonCore/MonCore.log
PLAIN_FILE=Data/Logs/Text/MonCore/MonCore_plain.log

[process]
NAME=core
SCRIPT_START=Script/Start/start_moncore.ps1
SCRIPT_STOP=Script/Start/stop_moncore.ps1

```

---

## 7. 编程接口

### 7.1 Python 使用示例

```python
from Application.System.MonConfig.loader import MonConfig

# 加载配置
config = MonConfig()

# 读取单个变量
port = config.get("server", "PORT")                    # "6020"
debug = config.get("django", "DEBUG", cast=bool)       # True

# 读取整个配置节
server_config = config.section("server")
# {"HOST": "0.0.0.0", "PORT": "6020", ...}

# 获取工作区根目录
workspace = config.workspace_root()
# Path("/path/to/MonCore")

# 查看加载的配置文件
files = config.loaded_files()
# [Path("/.../MonCore/.monconfig"), ...]
```

### 7.2 Django 集成示例

```python
# Config/core/base.py
from Application.System.MonConfig.loader import MonConfig

mon_config = MonConfig()

def get_config(section: str, key: str, default=None, cast=None):
    """从 .monconfig 读取配置值"""
    value = mon_config.get(section, key, default)
    if cast and value is not None:
        return cast(value)
    return value

# 使用配置
SERVER_HOST = get_config('server', 'HOST', default='127.0.0.1')
SERVER_PORT = get_config('server', 'PORT', default=8000, cast=int)
DEBUG = get_config('django', 'DEBUG', default=True, cast=bool)
```

---

## 8. 迁移指南

### 8.1 从 .env 迁移到 .monconfig

**步骤1：转换格式**
```bash
# 原 .env 格式
SERVER_HOST=0.0.0.0
SERVER_PORT=6020
WEBSOCKET_PORT=6020
DJANGO_DEBUG=true

# 新 .monconfig 格式
[server]
HOST=0.0.0.0
PORT=6020
WEBSOCKET_PORT=6020

[django]  
DEBUG=true
```

**步骤2：更新代码**
```python
# 原代码
from decouple import config
SERVER_HOST = config('SERVER_HOST')

# 新代码
SERVER_HOST = get_config('server', 'HOST')
```

**步骤3：删除旧文件**
```bash
rm Config/ENV/.env
```

### 8.2 兼容性处理

配置加载器支持环境变量回退：

```python
def get_config(section: str, key: str, default=None):
    # 优先从 .monconfig 读取
    value = mon_config.get(section, key)
    if value is None:
        # 回退到环境变量
        env_key = f"{section.upper()}_{key.upper()}"
        value = os.environ.get(env_key, default)
    return value
```

---

## 9. 最佳实践

### 9.1 配置分层建议

```
项目根/.monconfig          # 全局默认配置
├── 通用配置（日志、存储等）
└── 默认值设置

模块根/.monconfig           # 模块专用配置  
├── 服务端口、地址
├── 模块特定功能
└── 覆盖全局默认值

开发环境/.monconfig         # 开发者本地配置
├── 调试开关
├── 本地路径
└── 测试配置
```

### 9.2 安全注意事项

- **敏感信息**：SECRET_KEY、密码等敏感信息不要提交到版本控制
- **本地配置**：开发者本地的 `.monconfig` 应加入 `.gitignore`
- **生产环境**：生产环境配置单独管理，不与开发配置混合

### 9.3 维护建议

- **文档同步**：配置变更时同步更新文档
- **向后兼容**：新增配置项时提供默认值
- **配置验证**：启动时验证关键配置项的有效性

---

**注意**: 本规范适用于 Mon 项目的所有模块，确保配置系统的一致性和可维护性。
