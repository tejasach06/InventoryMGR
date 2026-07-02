// Copy to ecosystem.config.js and adjust paths for your deployment host.
// JWT_SECRET/DATABASE_URL are intentionally omitted — the backend loads them
// from ../.env (see backend/app/core/config.py, .env.example).
module.exports = {
  apps: [
    // Backend - FastAPI with uvicorn
    {
      name: 'inventorymgr-backend',
      script: 'uv',
      args: 'run uvicorn app.main:app --host 127.0.0.1 --port 8000',
      cwd: __dirname + '/backend',
      env: {
        APP_ENV: 'production',
      },
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '500M',
      restart_delay: 5000,
      error_file: 'backend/logs/backend-error.log',
      out_file: 'backend/logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    // Frontend - Next.js production server
    {
      name: 'inventorymgr-frontend',
      script: 'bun',
      args: 'run start',
      cwd: __dirname + '/frontend',
      env: {
        NODE_ENV: 'production',
        INVENTORYMGR_API_URL: 'http://127.0.0.1:8000',
      },
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '800M',
      restart_delay: 5000,
      error_file: 'frontend/logs/frontend-error.log',
      out_file: 'frontend/logs/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
