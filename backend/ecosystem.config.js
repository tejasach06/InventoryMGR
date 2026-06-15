module.exports = {
  apps: [
    {
      name: 'inventorymgr-backend',
      script: '/home/tejas_acharya/Projects/InventoryMGR/.devbox/nix/profile/default/bin/uv',
      args: 'run uvicorn app.main:app --host 127.0.0.1 --port 8000',
      cwd: '/home/tejas_acharya/Projects/InventoryMGR/backend',
      env: {
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql+psycopg://inventorymgr@127.0.0.1:54329/inventorymgr',
        JWT_SECRET: 'a-very-long-random-secret-key-that-is-at-least-32-bytes-long-for-production',
        APP_CORS_ORIGINS: 'http://127.0.0.1:3000',
      },
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '500M',
      restart_delay: 5000,
      error_file: 'logs/backend-error.log',
      out_file: 'logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};