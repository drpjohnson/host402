module.exports = {
  apps: [
    {
      name: 'aihosting-platform',
      script: 'dist/index.js',
      cwd: '/var/www/aihosting',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'host402-showcase',
      script: 'dist/services/showcase-runner.js',
      cwd: '/var/www/aihosting',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
