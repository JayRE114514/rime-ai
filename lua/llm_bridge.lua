-- llm_bridge.lua
-- Rime Lua 脚本：调用本地 Node.js LLM 服务获取 AI 候选

local function llm_translator(input, seg, env)
  local pinyin = input
  if #pinyin == 0 then return end

  -- 构造 curl 命令调用本地服务
  local json_body = '{"context":"","pinyin":"' .. pinyin .. '"}'
  local cmd = 'curl -s --max-time 0.5 -X POST http://localhost:3001/complete '
    .. '-H "Content-Type: application/json" '
    .. '-d "' .. json_body:gsub('"', '\\"') .. '"'

  -- Windows 下使用 io.popen 执行 curl
  local handle = io.popen(cmd)
  if not handle then return end

  local result = handle:read("*a")
  handle:close()

  -- 如果有结果，作为候选项返回
  if result and #result > 0 then
    -- 去除首尾空白
    result = result:match("^%s*(.-)%s*$")
    if #result > 0 then
      local cand = Candidate("ai", seg.start, seg._end, result, "AI")
      cand.quality = -1  -- 较低优先级，排在正常候选之后
      yield(cand)
    end
  end
end

return llm_translator
