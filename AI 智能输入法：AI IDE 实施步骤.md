# AI 智能输入法：AI IDE 实施步骤
> 适用于 Cursor / Windsurf 等 AI IDE，每步包含明确目标、Prompt 指令、验证标准
> 参考技术选型：[最终技术选型方案]
---
## 使用方式
1. 按顺序执行每个 Step
2. 每个 Step 包含一段「AI Prompt」，直接复制粘贴到 AI IDE 的 Chat/Composer
3. 完成「验证标准」后再进入下一步，不要跳步
4. 遇到报错先让 AI IDE 修复，不要手动改
---
## Phase 1：基础可用
### Step 1 — 初始化项目结构
**目标**：创建项目骨架，安装所有依赖，确保环境可运行
**AI Prompt**：
```
创建一个名为 rime-ai 的 Node.js 项目，要求：
1. 初始化 package.json，type 设为 module（使用 ESM）
2. 安装以下依赖：openai, express, js-yaml, uiohook-napi, node-record-lpcm16, systray-v2
3. 创建以下空文件：server.js, voice.js, config.js, public/index.html
4. 创建 config.yaml，内容如下：
   llm:
     baseURL: "https://api.deepseek.com/v1"
     apiKey: "sk-替换为你的key"
     model: "deepseek-chat"
     debounceMs: 300
     contextChars: 200
   stt:
     baseURL: "https://api.groq.com/openai/v1"
     apiKey: "gsk_替换为你的key"
     model: "whisper-large-v3-turbo"
     hotkey: "ctrl+space"
     language: "zh"
     enabled: true
   server:
     port: 3001
     configPort: 3000
5. 创建 .gitignore，忽略 node_modules 和 config.yaml
6. 创建 config.js，负责读取和导出 config.yaml 的内容
不要写任何业务逻辑，只建结构。
```
**验证标准**：
- [ ] `node -e "import('./config.js').then(m => console.log(m.default))"` 能打印出 config.yaml 的内容
- [ ] 项目目录结构与设计一致
---
### Step 2 — LLM 补全服务（核心）
**目标**：Node.js 服务监听 3001 端口，接收 `{context, pinyin}`，返回 LLM 候选文字
**AI Prompt**：
```
在 server.js 中实现一个 Express HTTP 服务，要求：
1. 监听 config.server.port（3001）端口
2. 实现 POST /complete 接口：
   - 接收 JSON body：{ context: string, pinyin: string }
   - 使用 openai 库，baseURL 和 apiKey 从 config.js 读取
   - 实现防抖：同一个客户端 300ms 内的重复请求，取消上一次，只处理最新一次
   - 使用 AbortController 取消进行中的请求
   - Prompt 模板固定为：
     系统：你是中文输入法助手，根据上文预测续写内容，只输出候选文字，不超过20字，不解释。
     上文：{context}
     当前拼音输入：{pinyin}
     候选：
   - 流式返回（stream: true），将 chunk 逐步写入 response
   - 请求出错时返回 { error: string }
3. 实现 GET /health 接口，返回 { status: "ok" }
4. 不要实现配置页、托盘、语音，只做 /complete 和 /health
```
**验证标准**：
- [ ] `node server.js` 启动无报错
- [ ] 用 curl 或 Postman 调用 `POST localhost:3001/complete`，body 为 `{"context":"今天天气","pinyin":"zhen hao"}` 能收到流式中文文字返回
- [ ] 快速连续发两次请求，第一次被取消，只有第二次返回结果
---
### Step 3 — Rime Lua 桥接脚本
**目标**：Rime 在用户输入拼音时，调用 Node.js 服务获取 LLM 候选，显示在候选区
**AI Prompt**：
```
创建 lua/llm_bridge.lua，这是一个 Rime 输入法的 Lua 脚本，要求：
1. 定义一个 Translator，名为 llm_translator
2. 当用户输入拼音时，读取当前 composition 的 input 作为 pinyin
3. 通过 Rime 的 io 或 os.execute 调用本地 HTTP 接口：
   curl -s -X POST http://localhost:3001/complete \
     -H "Content-Type: application/json" \
     -d '{"context":"","pinyin":"<当前拼音>"}'
4. 解析返回的文字，作为一个候选项插入候选列表，标注来源为「AI」
5. 如果调用失败或超时（超过 500ms），静默忽略，不影响正常 Rime 候选
6. 同时创建 lua/llm_bridge_readme.md，说明如何将此脚本挂载到 rime.lua 和 schema 配置中
不要修改任何 Rime 核心配置文件，只创建这两个文件。
```
**验证标准**：
- [ ] 按照 readme 挂载后，重新部署 Rime
- [ ] 输入拼音时，候选区出现标注「AI」的候选项
- [ ] 拔掉网络或停止 Node.js 服务，Rime 正常输入不受影响
---
## Phase 2：语音集成
### Step 4 — Push-to-talk 语音输入
**目标**：按住 Ctrl+Space 录音，松开后转写为文字并模拟键盘上屏
**AI Prompt**：
```
在 voice.js 中实现 Push-to-talk 语音输入，要求：
1. 使用 uiohook-napi 监听全局键盘事件
2. 从 config.js 读取 config.stt.hotkey（默认 ctrl+space）解析为对应键码
3. 按下快捷键时：开始用 node-record-lpcm16 录音，采样率 16000Hz，格式 wav
4. 松开快捷键时：停止录音，将音频 buffer 传给 Groq Whisper API
   - 使用 openai 库，baseURL 和 apiKey 从 config.stt 读取
   - model: whisper-large-v3-turbo，language: zh
5. 收到转写文字后，使用 Node.js child_process 调用系统命令模拟键盘输入：
   - macOS：使用 osascript 模拟按键
   - Windows：使用 PowerShell 的 SendKeys
6. 如果 config.stt.enabled 为 false，整个模块不启动
7. 导出 startVoice() 和 stopVoice() 两个函数
注意：不要在 voice.js 里直接 import server.js，保持模块独立。
```
**验证标准**：
- [ ] 在任意文本输入框，按住 Ctrl+Space 说「你好世界」，松开后输入框出现「你好世界」
- [ ] 将 config.yaml 中 `stt.enabled` 改为 false，重启后快捷键无响应
- [ ] macOS 和 Windows 分别测试通过
---
### Step 5 — 整合主入口
**目标**：server.js 同时启动 LLM 服务和语音模块，统一入口
**AI Prompt**：
```
修改 server.js，在现有 LLM 服务基础上整合语音模块，要求：
1. 在服务启动后，调用 voice.js 的 startVoice()
2. 监听进程退出信号（SIGINT, SIGTERM），调用 stopVoice() 后再退出
3. 启动时打印：
   ✅ LLM 服务运行在 http://localhost:3001
   ✅ 语音输入已启动（快捷键：ctrl+space）
   或
   ⚠️ 语音输入已禁用
4. 不要改动任何已有的 /complete 和 /health 逻辑
只做最小改动，不重构现有代码。
```
**验证标准**：
- [ ] `node server.js` 启动后，LLM 补全和语音输入同时工作
- [ ] Ctrl+C 退出时无报错，进程干净退出
---
## Phase 3：配置与部署
### Step 6 — localhost 配置页
**目标**：在 3000 端口提供配置页，可视化修改 config.yaml 并实时生效
**AI Prompt**：
```
实现配置管理功能，要求：
1. 在 server.js 中新增 Express 路由，监听 config.server.configPort（3000）端口
2. 实现以下 API：
   GET  /api/config        返回当前 config.yaml 内容（apiKey 脱敏，只显示前4位+****）
   POST /api/config        接收修改后的 config，写入 config.yaml，重启语音模块
   POST /api/restart       重启语音模块（stopVoice + startVoice）
3. 在 public/index.html 实现配置页（纯 HTML + 原生 JS，不用任何框架），包含：
   - LLM 配置区：API Key 输入框、模型选择下拉（deepseek-chat/qwen-turbo/gpt-4o-mini）、baseURL 输入框、防抖时间滑块
   - STT 配置区：API Key 输入框、快捷键输入框（可录制按键）、语音开关
   - 保存按钮：调用 POST /api/config，保存成功提示「✅ 已保存并生效」
   - 页面底部显示服务状态（调用 GET /health）
4. Express 静态托管 public/ 目录
不要用任何前端构建工具，public/index.html 是单文件，所有 CSS 和 JS 内联。
```
**验证标准**：
- [ ] 浏览器打开 `http://localhost:3000`，配置页正常显示
- [ ] 修改防抖时间并保存，`config.yaml` 文件内容同步更新
- [ ] 修改 API Key 后，/complete 接口使用新 Key 发起请求
---
### Step 7 — 系统托盘
**目标**：系统托盘图标，右键菜单可打开配置页、重启服务、退出
**AI Prompt**：
```
在 server.js 中集成系统托盘，要求：
1. 使用 systray-v2 创建托盘图标
2. 图标使用内联 base64 的简单图标（16x16 PNG，纯色即可）
3. 右键菜单包含：
   - 「打开配置页」→ 调用系统命令在默认浏览器打开 http://localhost:3000
     macOS: open http://localhost:3000
     Windows: start http://localhost:3000
   - 「重启服务」→ 调用 stopVoice() + startVoice()
   - 分隔线
   - 「退出」→ 调用 stopVoice()，然后 process.exit(0)
4. 托盘图标 tooltip 显示「Rime AI 输入助手」
5. 如果 systray-v2 初始化失败（如在无 GUI 环境），静默忽略，不影响服务启动
```
**验证标准**：
- [ ] 系统托盘出现图标
- [ ] 点击「打开配置页」，浏览器打开 localhost:3000
- [ ] 点击「退出」，进程完全退出，托盘图标消失
---
### Step 8 — PM2 部署与开机自启
**目标**：用 PM2 管理服务，实现开机自启、崩溃自动重启
**AI Prompt**：
```
创建 PM2 配置文件和部署说明，要求：
1. 创建 ecosystem.config.cjs，内容：
   - name: "rime-ai"
   - script: "server.js"
   - watch: false
   - max_memory_restart: "200M"
   - env: { NODE_ENV: "production" }
   - error_file: "logs/error.log"
   - out_file: "logs/out.log"
2. 创建 deploy.md，包含完整部署步骤：
   # 部署步骤
   ## 安装 PM2
   npm install -g pm2
   ## 启动服务
   pm2 start ecosystem.config.cjs
   ## 设置开机自启（执行后按提示运行输出的命令）
   pm2 startup
   pm2 save
   ## 常用命令
   pm2 logs rime-ai      # 查看日志
   pm2 restart rime-ai   # 重启
   pm2 stop rime-ai      # 停止
   pm2 delete rime-ai    # 删除
   ## macOS 注意事项
   - 需要在「系统设置 → 隐私与安全性 → 辅助功能」中授权 node 或终端
   ## Windows 注意事项
   - 以管理员身份运行 pm2 startup
   - 安装 SoX：https://sourceforge.net/projects/sox/
3. 创建 logs/ 目录并加入 .gitignore
```
**验证标准**：
- [ ] `pm2 start ecosystem.config.cjs` 启动成功，status 为 online
- [ ] `pm2 logs rime-ai` 能看到启动日志
- [ ] 重启电脑后，服务自动启动（托盘图标出现）
---
## 常见问题速查
| 问题 | 原因 | 解决 |
|------|------|------|
| macOS 快捷键无响应 | 辅助功能权限未授权 | 系统设置 → 隐私 → 辅助功能 → 添加终端/node |
| Windows 录音无声 | SoX 未安装 | 安装 SoX 并加入 PATH |
| Rime 候选无 AI 项 | Node.js 服务未启动 | `pm2 status` 检查服务状态 |
| LLM 返回慢 | 网络延迟 | config.yaml 切换到 Qwen（国内节点更快） |
| 配置页打不开 | 端口冲突 | 修改 config.yaml 中 configPort |