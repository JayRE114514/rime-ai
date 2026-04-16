// voice.js - 语音输入模块
import { uIOhook, UiohookKey } from 'uiohook-napi';
import { createRequire } from 'module';
import OpenAI from 'openai';
import { execSync } from 'child_process';
import state from './config.js';

const require = createRequire(import.meta.url);
const Decibri = require('decibri');

let mic = null;
let audioChunks = [];
let isRecording = false;
let groq = null;
let micAvailable = true;

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

// 构造 44 字节标准 WAV 文件头（16kHz, 16-bit, mono）
function buildWavHeader(dataLength) {
  const header = Buffer.alloc(44);
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;

  header.write('RIFF', 0);                        // ChunkID
  header.writeUInt32LE(36 + dataLength, 4);        // ChunkSize
  header.write('WAVE', 8);                         // Format
  header.write('fmt ', 12);                        // Subchunk1ID
  header.writeUInt32LE(16, 16);                    // Subchunk1Size (PCM)
  header.writeUInt16LE(1, 20);                     // AudioFormat (PCM=1)
  header.writeUInt16LE(channels, 22);              // NumChannels
  header.writeUInt32LE(sampleRate, 24);             // SampleRate
  header.writeUInt32LE(byteRate, 28);               // ByteRate
  header.writeUInt16LE(blockAlign, 32);             // BlockAlign
  header.writeUInt16LE(bitsPerSample, 34);          // BitsPerSample
  header.write('data', 36);                        // Subchunk2ID
  header.writeUInt32LE(dataLength, 40);             // Subchunk2Size

  return header;
}

function startRecording() {
  if (isRecording || !micAvailable) return;
  isRecording = true;
  audioChunks = [];

  try {
    mic = new Decibri({ sampleRate: 16000, channels: 1 });
    mic.on('data', (chunk) => {
      audioChunks.push(chunk);
    });
    mic.on('error', (err) => {
      console.error('录音错误:', err.message);
    });
    console.log('🎤 开始录音...');
  } catch (err) {
    console.error('⚠️ 麦克风初始化失败:', err.message);
    micAvailable = false;
    isRecording = false;
  }
}

async function stopRecording() {
  if (!isRecording || !mic) return;
  isRecording = false;
  mic.stop();
  mic = null;

  console.log('🎤 录音结束，正在转写...');

  // 将 PCM chunks 拼接并加上 WAV header
  const pcmData = Buffer.concat(audioChunks);
  if (pcmData.length === 0) {
    console.log('音频为空，跳过');
    return;
  }
  const wavBuffer = Buffer.concat([buildWavHeader(pcmData.length), pcmData]);

  try {
    const file = new File([wavBuffer], 'audio.wav', { type: 'audio/wav' });
    const transcription = await groq.audio.transcriptions.create({
      file,
      model: state.config.stt.model,
      language: state.config.stt.language,
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
  // 先写入剪贴板，再 Ctrl+V 粘贴（SendKeys 不支持中文）
  const escaped = text.replace(/'/g, "''");
  const cmd = `powershell -Command "Set-Clipboard '${escaped}'; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v');"`;
  try {
    execSync(cmd, { windowsHide: true });
  } catch (err) {
    console.error('模拟键盘输入失败:', err.message);
  }
}

export function startVoice() {
  if (!state.config.stt.enabled) {
    console.log('⚠️ 语音输入已禁用');
    return;
  }

  groq = new OpenAI({
    baseURL: state.config.stt.baseURL,
    apiKey: state.config.stt.apiKey,
  });

  const hotkeyConfig = parseHotkey(state.config.stt.hotkey);

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
  console.log(`✅ 语音输入已启动（快捷键：${state.config.stt.hotkey}）`);
}

export function stopVoice() {
  if (isRecording && mic) {
    mic.stop();
    mic = null;
    isRecording = false;
  }
  try {
    uIOhook.stop();
  } catch (e) {
    // 静默忽略
  }
}
