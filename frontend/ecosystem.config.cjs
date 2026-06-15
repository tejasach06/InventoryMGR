module.exports = {
  apps: [
    {
      name: 'inventorymgr-frontend',
      script: 'bun',
      args: 'run start',
      cwd: '.',
      env: {
        NODE_ENV: 'production',
        INVENTORYMGR_API_URL: 'http://127.0.0.1:8000',
      },
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '800M',
      restart_delay: 5000,
      error_file: 'logs/frontend-error.log',
      out_file: 'logs/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};