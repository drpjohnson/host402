import { Router, Request, Response } from "express";
import { db } from "../db/index.js";
import { storage } from "../services/storage.js";

export const serveRouter = Router();

/**
 * Serves files for a given deployment ID:
 * e.g. GET /sites/:id/
 *      GET /sites/:id/index.html
 *      GET /sites/:id/assets/app.js
 */
serveRouter.get("/sites/:id*", (req: Request, res: Response) => {
  const deploymentId = String(req.params.id);
  const dep = db.getDeployment(deploymentId);

  if (!dep) {
    return res.status(404).send(renderErrorPage("404 Not Found", "Deployment does not exist."));
  }

  if (dep.status === "deleted") {
    return res.status(410).send(renderErrorPage("410 Gone", "This deployment has been deleted by its owner."));
  }

  if (new Date(dep.expiresAt).getTime() < Date.now()) {
    return res
      .status(402)
      .send(
        renderErrorPage(
          "402 Lease Expired",
          `This site's hosting lease has expired. The owner can extend it at /v1/sites/${deploymentId}/renew.`
        )
      );
  }

  // Extract relative path after /sites/:id
  const fullPath = req.path;
  const prefix = `/sites/${deploymentId}`;
  let relativePath = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : "";
  if (!relativePath || relativePath === "/") {
    relativePath = dep.entrypoint || "index.html";
  } else if (relativePath.startsWith("/")) {
    relativePath = relativePath.slice(1);
  }

  const file = storage.getFile(deploymentId, relativePath);
  if (!file) {
    return res.status(404).send(renderErrorPage("404 Not Found", `File '${relativePath}' not found in deployment.`));
  }

  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Served-By", "Host402-Agent-Gateway");
  return res.send(file.content);
});

function renderErrorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title} | Host402</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f3f4f6; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 2.5rem; max-width: 480px; text-align: center; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); }
    h1 { color: #60a5fa; margin-top: 0; font-size: 1.75rem; }
    p { color: #9ca3af; line-height: 1.6; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; background: #1f2937; color: #38bdf8; border-radius: 9999px; font-size: 0.85rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="badge">Host402 Autonomous Cloud</div>
  </div>
</body>
</html>`;
}
