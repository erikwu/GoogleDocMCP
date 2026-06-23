import { startServer } from "./server.js";

startServer().catch((error) => {
  console.error("google-workspace-mcp failed to start:", error);
  process.exit(1);
});
