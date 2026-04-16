// voice.js - 语音输入模块
import { uIOhook, UiohookKey } from 'uiohook-napi';
import recorder from 'node-record-lpcm16';
import OpenAI from 'openai';
import { execSync } from 'child_process';
import { Writable } from 'stream';
import config from './config.js';

let recording = null;
let audioChunks = [];
let isRecording = false;
let groq = null;

// 解析 hotkey 字符串为键码配置
function parseHotkey(hotkeyStr) {
  const parts = hotkeyStr.toLowerCase().split('+').map(s => s.trim());
  return {
    ctrl: parts.includes('ctrl'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
    key: parts.find(p => !['ctrl', 'alt', 'shift'].includes(p)),
  };
}

// 检查键盘事件是否匹配快捷键
function isHotkey(event, hotkeyConfig) {
  if (hotkeyConfig.ctrl && !event.ctrlKey) return false;
  if (hotkeyConfig.alt && !event.altKey) return false;
  if (hotkeyConfig.shift && !event.shiftKey) return false;

  const keyMap = {
    space: UiohookKey.Space,
  };
  const targetKeycode = keyMap[hotkeyConfig.key] || 0;
  return event.keycode === targetKeycode;
}

function startRecording() {
  if (isRecording) return;
  isRecording = true;
  audioChunks = [];

  recording = recorder.record({
    sampleRate: 16000,
    channels: 1,
    recorder: 'sox',
    audioType: 'wav',
  });

  recording.stream().pipe(
    new Writable({
      write(chunk, encoding, callback) {
        audioChunks.push(chunk);
        callback();
      },
    })
  );

  console.log('🎤 开始录音...');
}

async function stopRecording() {
  if (!isRecording || !recording) return;
  isRecording = false;
  recording.stop();
  recording = null;

  console.log('🎤 录音结束，正在转写...');

  // 将音频 buffer 发送给 Groq Whisper
  const audioBuffer = Buffer.concat(audioChunks);
  if (audioBuffer.length === 0) {
    console.log('音频为空，跳过');
    return;
  }

  try {
    const file = new File([audioBuffer], 'audio.wav', { type: 'audio/wav' });
    const transcription = await groq.audio.transcriptions.create({
      file,
      model: config.stt.model,
      language: config.stt.language,
    });

    const text = transcription.text;
    if (text && text.trim()) {
      console.log(`转写结果：${text}`);
      typeText(text.trim());
    }
  } catch (err) {
    console.error('STT error:', err.message);
  }
}

// 模拟键盘输入文字（Windows）
function typeText(text) {
  // Windows: 使用 PowerShell SendKeys
  const escaped = text.replace(/'/g, "''");
  const cmd = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}');"`;
  try {
    execSync(cmd, { windowsHide: true });
  } catch (err) {
    console.error('模拟键盘输入失败:', err.message);
  }
}

export function startVoice() {
  if (!config.stt.enabled) {
    console.log('⚠️ 语音输入已禁用');
    return;
  }

  groq = new OpenAI({
    baseURL: config.stt.baseURL,
    apiKey: config.stt.apiKey,
  });

  const hotkeyConfig = parseHotkey(config.stt.hotkey);

  uIOhook.on('keydown', (e) => {
    if (isHotkey(e, hotkeyConfig)) {
      startRecording();
    }
  });

  uIOhook.on('keyup', (e) => {
    if (isHotkey(e, hotkeyConfig)) {
      stopRecording();
    }
  });

  uIOhook.start();
  console.log(`✅ 语音输入已启动（快捷键：${config.stt.hotkey}）`);
}

export function stopVoice() {
  if (isRecording && recording) {
    recording.stop();
    recording = null;
    isRecording = false;
  }
  try {
    uIOhook.stop();
  } catch (e) {
    // 静默忽略
  }
}
