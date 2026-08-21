module.exports = {
  apps: [
    {
      name: 'inventorymgr-api',
      cwd: './backend',
      script: 'uv',
      args: 'run uvicorn app.main:app --host 127.0.0.1 --port 8000',
      interpreter: 'none',
      env: { APP_ENV: 'production' },
    },
    {
      name: 'inventorymgr-web',
      cwd: './frontend',
      script: 'nub',
      args: 'run start',
      interpreter: 'none',
      env: { NODE_ENV: 'production' },
    },
  ],
};
