/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const path = require("node:path");

const repositoryRoot = __dirname;

module.exports = {
  apps: [
    {
      name: "aia-acreditacao-web",
      cwd: path.join(repositoryRoot, "apps", "web"),
      script: path.join(repositoryRoot, "apps", "web", "node_modules", "next", "dist", "bin", "next"),
      args: "start --hostname localhost --port 3100",
      interpreter: process.execPath,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2_000,
      time: true,
      env: {
        DEBUG: "",
      },
    },
    {
      name: "aia-acreditacao-worker",
      shutdown_with_message:true,
      kill_timeout:50000,
      cwd: path.join(repositoryRoot, "apps", "worker"),
      script: path.join(repositoryRoot, "apps", "worker", "dist", "main.js"),
      interpreter: process.execPath,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2_000,
      time: true,
    },
  ],
};
