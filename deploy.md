# 部署步骤

## 前提条件

- Node.js 18+ 已安装
- 已配置 `config.yaml`（填入真实的 API Key）

## 安装 PM2

```bash
npm install -g pm2
```

## 启动服务

```bash
pm2 start ecosystem.config.cjs
```

## 设置开机自启

执行后按提示运行输出的命令：

```bash
pm2 startup
pm2 save
```

## 常用命令

```bash
pm2 logs rime-ai      # 查看日志
pm2 restart rime-ai   # 重启
pm2 stop rime-ai      # 停止
pm2 delete rime-ai    # 删除
pm2 status            # 查看状态
```

## Windows 注意事项

- 以管理员身份运行 `pm2 startup`
- 安装 SoX（语音录制依赖）：https://sourceforge.net/projects/sox/
- 安装后确保 `sox` 在系统 PATH 中

## macOS 注意事项

- 需要在「系统设置 → 隐私与安全性 → 辅助功能」中授权 node 或终端
- 安装 SoX：`brew install sox`
