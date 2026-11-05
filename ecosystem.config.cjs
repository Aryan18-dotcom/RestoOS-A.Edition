module.exports = {
  apps: [
    { name: "restaurantos-api", cwd: "./apps/api", script: "src/server.js", instances: 1, exec_mode: "fork", autorestart: true, max_memory_restart: "700M", env: { NODE_ENV: "production" } },
    { name: "restaurantos-web", cwd: "./apps/web", script: "node_modules/next/dist/bin/next", args: "start", instances: 1, exec_mode: "fork", autorestart: true, max_memory_restart: "900M", env: { NODE_ENV: "production", PORT: 3000 } }
  ]
};
