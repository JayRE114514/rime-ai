// server.js - 主服务入口
import express from 'express';
import OpenAI from 'openai';
import yaml from 'js-yaml';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';
import config, { reloadConfig } from './config.js';
import { startVoice, stopVoice } from './voice.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

// 配置页服务
const configApp = express();
configApp.use(express.json());
configApp.use(express.static(join(__dirname, 'public')));

// 配置 API
configApp.get('/api/config', (req, res) => {
  // apiKey 脱敏
  const safeConfig = JSON.parse(JSON.stringify(config));
  if (safeConfig.llm.apiKey) {
    safeConfig.llm.apiKey = safeConfig.llm.apiKey.slice(0, 4) + '****';
  }
  if (safeConfig.stt.apiKey) {
    safeConfig.stt.apiKey = safeConfig.stt.apiKey.slice(0, 4) + '****';
  }
  res.json(safeConfig);
});

configApp.post('/api/config', (req, res) => {
  const newConfig = req.body;

  // 如果 apiKey 是脱敏值，保留原值
  if (newConfig.llm?.apiKey?.endsWith('****')) {
    newConfig.llm.apiKey = config.llm.apiKey;
  }
  if (newConfig.stt?.apiKey?.endsWith('****')) {
    newConfig.stt.apiKey = config.stt.apiKey;
  }

  // 写入 config.yaml
  const configPath = join(__dirname, 'config.yaml');
  writeFileSync(configPath, yaml.dump(newConfig), 'utf8');

  // 重新加载配置
  const updated = reloadConfig();

  // 更新 LLM 客户端
  openai = new OpenAI({
    baseURL: updated.llm.baseURL,
    apiKey: updated.llm.apiKey,
  });

  // 重启语音模块
  stopVoice();
  try { startVoice(); } catch (e) { /* ignore */ }

  res.json({ status: 'ok' });
});

configApp.post('/api/restart', (req, res) => {
  stopVoice();
  try { startVoice(); } catch (e) { /* ignore */ }
  res.json({ status: 'ok' });
});

// LLM 客户端
let openai = new OpenAI({
  baseURL: config.llm.baseURL,
  apiKey: config.llm.apiKey,
});

// 防抖 + AbortController 状态
let debounceTimer = null;
let currentController = null;

app.post('/complete', (req, res) => {
  const { context, pinyin } = req.body;

  if (!pinyin) {
    return res.status(400).json({ error: 'pinyin is required' });
  }

  // 取消上一次进行中的请求
  if (currentController) {
    currentController.abort();
  }

  // 清除上一次防抖定时器
  clearTimeout(debounceTimer);

  debounceTimer = setTimeout(async () => {
    currentController = new AbortController();
    const signal = currentController.signal;

    try {
      const stream = await openai.chat.completions.create(
        {
          model: config.llm.model,
          messages: [
            {
              role: 'system',
              content:
                '你是中文输入法助手，根据上文预测续写内容，只输出候选文字，不超过20字，不解释。',
            },
            {
              role: 'user',
              content: `上文：${context || ''}\n当前拼音输入：${pinyin}\n候选：`,
            },
          ],
          stream: true,
        },
        { signal }
      );

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          res.write(content);
        }
      }
      res.end();
    } catch (err) {
      if (err.name === 'AbortError') {
        // 被新请求取消，静默关闭
        if (!res.headersSent) res.status(499).end();
        return;
      }
      console.error('LLM error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  }, config.llm.debounceMs);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 启动 LLM 服务
const server = app.listen(config.server.port, () => {
  console.log(`✅ LLM 服务运行在 http://localhost:${config.server.port}`);

  // 启动语音模块
  try {
    startVoice();
  } catch (err) {
    console.error('语音模块启动失败:', err.message);
  }
});

// 启动配置页服务
const configServer = configApp.listen(config.server.configPort, () => {
  console.log(`✅ 配置页运行在 http://localhost:${config.server.configPort}`);
});

// 系统托盘
function initTray() {
  import('systray2').then((mod) => {
    const SysTray = mod.default.default || mod.default;
    const itemOpenConfig = {
      title: '打开配置页',
      tooltip: '在浏览器中打开配置页面',
      checked: false,
      enabled: true,
      click: () => {
        const url = `http://localhost:${config.server.configPort}`;
        exec(`start ${url}`, { windowsHide: true });
      },
    };

    const itemRestart = {
      title: '重启服务',
      tooltip: '重启语音模块',
      checked: false,
      enabled: true,
      click: () => {
        stopVoice();
        try { startVoice(); } catch (e) { /* ignore */ }
        console.log('✅ 服务已重启');
      },
    };

    const itemExit = {
      title: '退出',
      tooltip: '退出 Rime AI',
      checked: false,
      enabled: true,
      click: () => {
        stopVoice();
        systray.kill(false);
        server.close();
        configServer.close();
        process.exit(0);
      },
    };

    // 16x16 纯蓝色 ICO 图标 (base64)
    const ICON_BASE64 = 'AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAQAABMLAAATCwAAAAAAAAAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AIqz7gCKs+4hirPuYYqz7qGKs+6hirPuYYqz7iGKs+4A////AP///wD///8A////AP///wD///8A////AIqz7gCKs+5hirPu4Yqz7v+Ks+7/irPu/4qz7v+Ks+7hirPuAP///wD///8A////AP///wD///8A////AIqz7gCKs+5hirPu4Yqz7v+Ks+7/irPu/4qz7v+Ks+7hirPuAP///wD///8A////AP///wD///8A////AIqz7gCKs+5hirPu4Yqz7v+Ks+7/irPu/4qz7v+Ks+7hirPuAP///wD///8A////AP///wD///8A////AIqz7gCKs+5hirPu4Yqz7v+Ks+7/irPu/4qz7v+Ks+7hirPuAP///wD///8A////AP///wD///8A////AIqz7gCKs+5hirPu4Yqz7v+Ks+7/irPu/4qz7v+Ks+7hirPuAP///wD///8A////AP///wCKs+4AirPuIYqz7mGKs+7hirPu/4qz7v+Ks+7/irPu/4qz7v+Ks+7hirPuYYqz7iGKs+4A////AP///wCKs+4hirPu4Yqz7v+Ks+7/irPu/4qz7v+Ks+7/irPu/4qz7v+Ks+7/irPu/4qz7uGKs+4h////AP///wCKs+4hirPu4Yqz7v+Ks+7/irPu/4qz7v+Ks+7/irPu/4qz7v+Ks+7/irPu/4qz7uGKs+4h////AP///wCKs+4hirPu4Yqz7v+Ks+7/irPu/4qz7v+Ks+7/irPu/4qz7v+Ks+7/irPu/4qz7uGKs+4h////AP///wCKs+4AirPuIYqz7mGKs+7hirPu/4qz7v+Ks+7/irPu/4qz7v+Ks+7hirPuYYqz7iGKs+4A////AP///wD///8A////AIqz7gCKs+5hirPu4Yqz7v+Ks+7/irPu/4qz7v+Ks+7hirPuAP///wD///8A////AP///wD///8A////AIqz7gCKs+5hirPu4Yqz7v+Ks+7/irPu/4qz7v+Ks+7hirPuAP///wD///8A////AP///wD///8A////AIqz7gCKs+5hirPu4Yqz7v+Ks+7/irPu/4qz7v+Ks+7hirPuAP///wD///8A////AP///wD///8A////AP///wD///8AirPuAIqz7iGKs+5hirPuoYqz7qGKs+5hirPuIYqz7gD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A//8AAOAfAADgHwAA4B8AAOAfAADgHwAA4B8AAAAAAAAAAAAAAAAAAAAAAAAAAOAPAADAD8AAwA/AAMAP+B/4Hw==';

    const systray = new SysTray({
      menu: {
        icon: ICON_BASE64,
        title: '',
        tooltip: 'Rime AI 输入助手',
        items: [
          itemOpenConfig,
          itemRestart,
          SysTray.separator,
          itemExit,
        ],
      },
      debug: false,
      copyDir: false,
    });

    systray.onClick((action) => {
      if (action.item.click) action.item.click();
    });

    systray.ready().then(() => {
      console.log('✅ 系统托盘已启动');
    }).catch((err) => {
      console.log('⚠️ 系统托盘启动失败:', err.message);
    });
  }).catch((err) => {
    console.log('⚠️ 系统托盘不可用:', err.message);
  });
}

initTray();

// 进程退出清理
function cleanup() {
  console.log('\n正在关闭服务...');
  stopVoice();
  server.close();
  configServer.close();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

export { app, server, openai };
