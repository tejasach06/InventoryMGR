// graphify-mcp-tools OpenCode plugin
// - Reminds the agent that MCP graph tools are available before bash/edit.
// - Auto-rebuilds graphify-out after edits (debounced, non-blocking, AST-only).
import { existsSync, appendFileSync } from "fs";
import { spawn } from "child_process";
import { join } from "path";

const EDIT_TOOLS = new Set(["edit", "write", "patch"]);
const DEBOUNCE_MS = 3000;

export const GraphifyMcpPlugin = async ({ directory }) => {
  let bashReminded = false;

  let timer = null;
  let running = false;
  let dirty = false;

  const graphExists = () =>
    existsSync(join(directory, "graphify-out", "graph.json"));

  const logFile = join(directory, ".opencode", "graphify-update.log");
  const log = (msg) => {
    try {
      appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
    } catch {}
  };

  const rebuild = () => {
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    log("graphify update . started");
    const child = spawn("graphify", ["update", "."], {
      cwd: directory,
      detached: true,
      stdio: "ignore",
    });
    child.on("error", (e) => {
      running = false;
      log(`graphify update failed to spawn: ${e.message}`);
    });
    child.on("exit", (code) => {
      running = false;
      log(`graphify update exited (${code})`);
      if (dirty) {
        dirty = false;
        scheduleRebuild();
      }
    });
    child.unref();
  };

  const scheduleRebuild = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      rebuild();
    }, DEBOUNCE_MS);
  };

  return {
    "tool.execute.before": async (input, output) => {
      if (!graphExists()) return;

      if (input.tool === "bash" && !bashReminded) {
        output.args.command =
          'echo "[graphify-mcp-tools] Knowledge graph MCP server available. Use graph_search/graph_impact/graph_path tools instead of manual grep." && ' +
          output.args.command;
        bashReminded = true;
      }
    },

    "tool.execute.after": async (input) => {
      if (!graphExists()) return;
      if (EDIT_TOOLS.has(input.tool)) scheduleRebuild();
    },
  };
};
