# Rime LLM 桥接脚本挂载说明

## 前提条件
- Rime 输入法已安装（Windows: Weasel 小狼毫 / macOS: Squirrel 鼠须管）
- Node.js LLM 服务已启动（`node server.js`）
- 系统已安装 curl

## 安装步骤

### 1. 复制 Lua 脚本

将 `llm_bridge.lua` 复制到 Rime 用户配置目录的 `lua/` 文件夹下：

- **Windows**: `%APPDATA%\Rime\lua\llm_bridge.lua`
- **macOS**: `~/Library/Rime/lua/llm_bridge.lua`
- **Linux**: `~/.config/rime/lua/llm_bridge.lua`  (如适用)

### 2. 注册到 rime.lua

在 Rime 用户配置目录下的 `rime.lua` 文件末尾添加：

```lua
llm_translator = require("llm_bridge")
```

如果 `rime.lua` 不存在，创建该文件并写入上述内容。

### 3. 修改输入方案配置

在你使用的输入方案 YAML 文件中（例如 `rime_ice.schema.yaml` 或对应的 `.custom.yaml`），在 `engine/translators` 中添加：

```yaml
engine:
  translators:
    - lua_translator@llm_translator
    # ... 其他已有的 translators 保持不变
```

推荐使用 `.custom.yaml` 补丁方式，例如创建 `rime_ice.custom.yaml`：

```yaml
patch:
  engine/translators/+:
    - lua_translator@llm_translator
```

### 4. 重新部署 Rime

- **Windows (Weasel)**: 右键托盘图标 → 重新部署
- **macOS (Squirrel)**: 点击菜单栏图标 → 重新部署

## 验证

1. 确保 Node.js 服务已启动：`node server.js`
2. 在任意输入框切换到 Rime 输入法
3. 输入拼音，候选区应出现标注「AI」的候选项
4. 如果未出现，检查 Rime 日志（Windows: `%TEMP%\rime.weasel.*`）

## 故障排除

| 问题 | 解决方案 |
|------|---------|
| 无 AI 候选 | 确认 `node server.js` 正在运行 |
| 响应慢 | curl 超时设为 0.5 秒，超时后静默跳过 |
| 部署失败 | 检查 `rime.lua` 语法，确认 lua 文件路径正确 |
