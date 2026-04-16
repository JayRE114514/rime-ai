module.exports = {
  apps: [
    {
      name: 'rime-ai',
      script: 'server.js',
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
    },
  ],
};
