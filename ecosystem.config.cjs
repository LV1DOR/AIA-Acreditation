/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const path = require("node:path");

const repositoryRoot = __dirname;
const development = process.env.AIA_LOCAL_RUNTIME === "development";

module.exports = {
  apps: [
    {
      name: "aia-acreditacao-web",
      cwd: path.join(repositoryRoot, "apps", "web"),
      script: path.join(repositoryRoot, "apps", "web", "node_modules", "next", "dist", "bin", "next"),
      args: `${development ? "dev" : "start"} --hostname localhost --port 3100`,
      // NextURL normalizes loopback IPs to localhost. Keep that hostname and
      // prefer IPv4 so Tailscale's 127.0.0.1 proxy reaches the same listener.
      ...(development ? { node_args: ["--dns-result-order=ipv4first"] } : {}),
      interpreter: process.execPath,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2_000,
      time: true,
      env: {
        DEBUG: "",
        ...(development ? { NODE_ENV: "development", NEXT_DIST_DIR: ".next-stale-dev" } : {}),
      },
    },
    {
      name: "aia-acreditacao-worker",
      shutdown_with_message:true,
      kill_timeout:50000,
      cwd: path.join(repositoryRoot, "apps", "worker"),
      script: development
        ? path.join(repositoryRoot, "apps", "worker", "src", "main.ts")
        : path.join(repositoryRoot, "apps", "worker", "dist", "main.js"),
      ...(development ? {
        node_args: ["--import", "tsx"],
        // PM2 owns the worker directly, so its existing shutdown IPC still drains
        // jobs before a watched source change restarts it on Windows.
        watch: ["apps/worker/src", "packages/config/src", "packages/database/src", "packages/domain/src", "packages/email/src", "packages/storage/src"].map(directory => path.join(repositoryRoot, directory)),
        ignore_watch: ["node_modules", "generated"],
        watch_delay: 1000,
        env: { NODE_ENV: "development", DEBUG: "" },
      } : {}),
      interpreter: process.execPath,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2_000,
      time: true,
    },
  ],
};
