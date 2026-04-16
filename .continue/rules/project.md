# Rime AI 项目规则

## 技术栈（不可更改）
- Node.js ESM，Express
- OpenAI SDK（兼容格式，用于 LLM 和 STT）
- config.yaml 管理所有配置
- 当前只做 Windows 端

## 编码规范
- 不要使用 TypeScript，纯 JS
- 不要引入未在 package.json 中声明的依赖
- 不要创建未被要求的文件
- 不要重构已有代码，除非当前任务明确要求
- 错误处理：只处理真实会发生的错误，不做防御性编程
- 每个模块职责单一：server.js 管 HTTP，voice.js 管语音，config.js 管配置

## 架构约束
- LLM API：DeepSeek V3，baseURL 从 config.yaml 读取
- STT API：Groq Whisper，baseURL 从 config.yaml 读取
- 两者都用 openai SDK，只是 baseURL 不同
- 服务端口：LLM 3001，配置页 3000
- 语音触发：全局快捷键 Ctrl+Space，Push-to-talk

## 验证方式
- 每个功能必须能用 curl 或手动操作验证
- 不写单元测试（MVP 阶段）
