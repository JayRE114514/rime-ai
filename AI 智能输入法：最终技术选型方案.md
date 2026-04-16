# AI 智能输入法：最终技术选型方案
> 基于 Rime + LLM + 语音集成，Windows + macOS 双平台
## 架构总览
```
用户输入拼音
    ↓
[第1层] Rime 引擎（雾凇拼音）
    ↓ Lua 脚本触发
[第2层] Node.js 桥接服务（LLM 补全）
    ↓ OpenAI 兼容 API
DeepSeek V3 → 智能候选返回 Rime
    ↑
[第3层] 语音输入（Push-to-talk）
Ctrl+Space → 录音 → Groq Whisper → 文字上屏
    ↑
[第4层] 系统集成
PM2 管理服务 + 托盘图标 + localhost 配置页
```
---
## 第 1 层：输入前端
### 技术选型
| 组件 | 选型 |
|------|------|
| 输入法引擎 | Rime |
| Windows 前端 | Weasel（小狼毫） |
| macOS 前端 | Squirrel（鼠须管） |
| 拼音方案 | 雾凇拼音 `iDvel/rime-ice`（全拼，开箱即用） |
| LLM 扩展挂载点 | Rime Lua 脚本接口 |
### 安装步骤
1. Windows 安装 Weasel，macOS 安装 Squirrel
2. 克隆 `iDvel/rime-ice` 到 Rime 用户配置目录
3. 重新部署 Rime
4. 在 `rime.lua` 中挂载 LLM 桥接调用逻辑
### 目录结构
```
~/.config/rime/          # Linux/macOS
%APPDATA%/Rime/          # Windows
├── rime_ice.schema.yaml
├── rime.lua             # LLM 扩展入口
└── custom/
    └── llm_bridge.lua   # 调用本地 Node.js 服务
```
---
## 第 2 层：LLM 补全
### 技术选型
| 组件 | 选型 |
|------|------|
| 桥接服务语言 | Node.js |
| 通信方式 | Rime Lua → 本地 HTTP（localhost:3001） |
| 触发策略 | 防抖 300ms + AbortController 取消 |
| API 格式 | OpenAI 兼容 |
| 首选模型 | DeepSeek V3（`api.deepseek.com`） |
| 备选模型 | Qwen-turbo / GPT-4o-mini（一行切换） |
| 延迟预期 | 300-500ms（宽松模式） |
### 功能列表
- **智能续写**：以输入框已有文字为 context，预测下一词/短语
- **上下文感知**：读取输入框前 N 字符，自动适配语气风格
- **长句直出**：检测连续拼音串，触发整句翻译模式
### Prompt 模板
```
系统：你是中文输入法助手，根据上文续写，只输出候选文字，不解释。
上文：{input_box_context}
当前输入：{current_pinyin}
候选：
```
### 核心代码结构
```js
// server.js - Node.js 桥接服务核心逻辑
let debounceTimer = null;
let currentController = null;

app.post('/complete', async (req, res) => {
  const { context, pinyin } = req.body;

  // 取消上一次请求
  if (currentController) currentController.abort();
  currentController = new AbortController();

  // 防抖 300ms
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    const completion = await openai.chat.completions.create({
      model: config.llm.model,        // 配置文件控制
      messages: buildPrompt(context, pinyin),
      stream: true,
      signal: currentController.signal
    });
    // 流式返回候选
    streamToRime(completion, res);
  }, 300);
});
```
### 模型切换（仅改 base_url）
```js
// DeepSeek（默认）
baseURL: "https://api.deepseek.com/v1"
// Qwen
baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
// OpenAI
baseURL: "https://api.openai.com/v1"
```
---
## 第 3 层：语音输入
### 技术选型
| 组件 | 选型 |
|------|------|
| 触发方式 | Push-to-talk（按住说话） |
| 默认快捷键 | `Ctrl+Space`（可在配置页修改） |
| 全局键盘监听 | `uiohook-napi`（跨平台，Windows + macOS） |
| 录音库 | `node-record-lpcm16` |
| STT 服务 | Groq Whisper large-v3-turbo |
| API 格式 | OpenAI 兼容（与 LLM 层同一 SDK） |
| 预期延迟 | ~200ms（Groq 边缘推理） |
| 文字上屏 | 模拟键盘输入（`robotjs` / `nut-js`） |
### 工作流程
```
Ctrl+Space 按下
    ↓
开始录音（node-record-lpcm16 → PCM 流）
    ↓
Ctrl+Space 松开
    ↓
停止录音 → 音频 Buffer
    ↓
Groq Whisper API（OpenAI 兼容）
    ↓
返回文字 → 模拟键盘上屏
```
### 核心代码结构
```js
// voice.js
import { uIOhook } from 'uiohook-napi';
import recorder from 'node-record-lpcm16';
import OpenAI from 'openai';

const groq = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: config.stt.apiKey
});

uIOhook.on('keydown', async (e) => {
  if (isHotkey(e, config.stt.hotkey)) startRecording();
});

uIOhook.on('keyup', async (e) => {
  if (isHotkey(e, config.stt.hotkey)) {
    const audio = stopRecording();
    const { text } = await groq.audio.transcriptions.create({
      file: audio,
      model: 'whisper-large-v3-turbo',
      language: 'zh'
    });
    typeText(text); // 模拟键盘上屏
  }
});
```
---
## 第 4 层：系统集成与部署
### 技术选型
| 组件 | 选型 |
|------|------|
| 服务管理 | PM2 |
| 开机自启 | `pm2 startup`（跨平台） |
| 配置界面 | 系统托盘图标 + localhost:3000 网页 |
| 托盘库 | `systray-v2`（Node.js，跨平台） |
| 配置存储 | `config.yaml`（本地文件） |
| 日志管理 | PM2 内置日志（`pm2 logs`） |
### 配置页功能（localhost:3000）
- API Key 管理（LLM + STT 分别配置）
- 模型切换（DeepSeek / Qwen / OpenAI）
- 语音快捷键自定义（默认 Ctrl+Space）
- 防抖时间调整（默认 300ms）
- 语音功能开关
- 实时日志查看
### 配置文件结构
```yaml
# config.yaml
llm:
  baseURL: "https://api.deepseek.com/v1"
  apiKey: "sk-..."
  model: "deepseek-chat"
  debounceMs: 300
  contextChars: 200      # 读取输入框前 N 个字符

stt:
  baseURL: "https://api.groq.com/openai/v1"
  apiKey: "gsk_..."
  model: "whisper-large-v3-turbo"
  hotkey: "ctrl+space"
  language: "zh"
  enabled: true

server:
  port: 3001             # LLM 桥接服务端口
  configPort: 3000       # 配置页端口
```
### PM2 部署
```bash
# 启动服务
pm2 start server.js --name "rime-ai"

# 开机自启（一次性配置）
pm2 startup
pm2 save

# 日常管理
pm2 logs rime-ai        # 查看日志
pm2 restart rime-ai     # 重启服务
pm2 stop rime-ai        # 停止服务
```
### 项目目录结构
```
rime-ai/
├── server.js            # 主服务入口（LLM + 配置页 + 托盘）
├── voice.js             # 语音输入模块
├── config.yaml          # 用户配置文件
├── public/              # 配置页前端（纯 HTML + JS）
│   └── index.html
├── lua/
│   └── llm_bridge.lua   # Rime Lua 脚本
├── package.json
└── ecosystem.config.js  # PM2 配置
```
---
## 依赖清单
```json
{
  "dependencies": {
    "openai": "^4.x",
    "express": "^4.x",
    "uiohook-napi": "^1.x",
    "node-record-lpcm16": "^1.x",
    "systray-v2": "^1.x",
    "js-yaml": "^4.x",
    "robotjs": "^0.6.x"
  }
}
```
---
## 实施路线图
### Phase 1：基础可用（1-2 天）
- [ ] 安装 Rime + 雾凇拼音，验证基础输入
- [ ] 搭建 Node.js 服务，跑通 DeepSeek API 调用
- [ ] 编写 Lua 脚本，实现 Rime → Node.js 通信
- [ ] 验证 LLM 候选词出现在 Rime 候选区
### Phase 2：语音集成（1 天）
- [ ] 接入 uiohook-napi 全局快捷键监听
- [ ] 接入 node-record-lpcm16 录音
- [ ] 接入 Groq Whisper，验证中文转写准确率
- [ ] 实现文字模拟键盘上屏
### Phase 3：配置与部署（1 天）
- [ ] 实现 localhost:3000 配置页
- [ ] 实现系统托盘图标
- [ ] PM2 配置 + 开机自启
- [ ] Windows + macOS 双平台测试
---
## 关键风险与应对
| 风险 | 概率 | 应对 |
|------|------|------|
| Rime Lua → HTTP 延迟过高 | 中 | 改用 Unix Socket 通信，降低 IPC 开销 |
| uiohook-napi 在 macOS 权限问题 | 高 | 需要在系统偏好设置中授权辅助功能权限 |
| DeepSeek API 不稳定 | 低 | config.yaml 一行切换到 Qwen 备用 |
| node-record-lpcm16 需要 SoX | 中 | Windows/macOS 分别安装 SoX 依赖 |