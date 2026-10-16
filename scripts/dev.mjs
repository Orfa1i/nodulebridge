// Start web and api together. API port defaults to 8000; override with API_PORT.
import { spawn } from "node:child_process";

const apiPort = process.env.API_PORT ?? "8000";
const run = (name, cmd, args, env = {}) => {
  const p = spawn(cmd, args, { stdio: "inherit", shell: true, env: { ...process.env, ...env } });
  p.on("exit", (code) => { if (code) process.exit(code); });
  return p;
};
run("web", "pnpm", ["--dir", "web", "dev"], { NEXT_PUBLIC_API_BASE_URL: `http://localhost:${apiPort}` });
run("api", "uv", ["run", "--project", "api", "uvicorn", "app.main:app", "--reload", "--port", apiPort, "--app-dir", "api"]);
