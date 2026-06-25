import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { accessSync, constants, createReadStream, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

const workspaceRoot = resolve(process.cwd());
const documentsRoot = resolve(process.env.HOME ?? "", "Documents");

const mimeTypes = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function isInside(parent, child) {
  const normalizedParent = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child === parent || child.startsWith(normalizedParent);
}

function localAssetPlugin() {
  const handler = (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? "", "http://local.asset");
      const rawPath = requestUrl.searchParams.get("path");
      if (!rawPath) {
        res.statusCode = 400;
        res.end("Missing path");
        return;
      }

      const localPath = resolve(rawPath);
      const allowed =
        isInside(workspaceRoot, localPath) || isInside(documentsRoot, localPath);

      if (!allowed) {
        res.statusCode = 403;
        res.end("Local asset path is outside allowed folders");
        return;
      }

      const stat = statSync(localPath);
          if (!stat.isFile()) {
            res.statusCode = 404;
            res.end("Local asset is not a file");
            return;
          }

          accessSync(localPath, constants.R_OK);

          const contentType = mimeTypes[extname(localPath).toLowerCase()] ?? "application/octet-stream";
          res.setHeader("Content-Type", contentType);
          res.setHeader("Cache-Control", "no-cache");
          const stream = createReadStream(localPath);
          stream.on("error", (error) => {
            if (!res.headersSent) {
              res.statusCode = error?.code === "ENOENT" ? 404 : 403;
              res.end(error?.message ?? "Unable to read local asset");
              return;
            }
            res.destroy(error);
          });
          stream.pipe(res);
    } catch (error) {
      res.statusCode = error?.code === "ENOENT" ? 404 : 403;
      res.end(error?.message ?? "Unable to read local asset");
    }
  };

  return {
    name: "local-asset-proxy",
    configureServer(server) {
      server.middlewares.use("/__local_asset__", handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/__local_asset__", handler);
    },
  };
}

export default defineConfig({
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4174",
    },
    warmup: {
      clientFiles: ["./src/main.tsx"],
    },
  },
  plugins: [localAssetPlugin(), react()],
});
