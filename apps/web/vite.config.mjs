import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { accessSync, constants, createReadStream, statSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(webRoot, "../..");
const documentsRoot = resolve(process.env.HOME ?? "", "Documents");
const backendPort = process.env.BACKEND_PORT ?? "8000";
const backendTarget = process.env.BACKEND_PROXY_TARGET ?? `http://127.0.0.1:${backendPort}`;

export function resolveAssetBase(rawValue = process.env.VITE_ASSET_BASE_URL) {
  const value = rawValue?.trim();
  if (!value) return "/";

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("VITE_ASSET_BASE_URL must be an absolute HTTPS URL");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(
      "VITE_ASSET_BASE_URL must be an HTTPS URL without credentials, query, or fragment",
    );
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${normalizedPath}/`;
}

const assetBase = resolveAssetBase();

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
  base: assetBase,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (
            id.includes("/node_modules/react/")
            || id.includes("/node_modules/react-dom/")
            || id.includes("/node_modules/scheduler/")
            || id.includes("/node_modules/zustand/")
            || id.includes("/node_modules/use-sync-external-store/")
          ) {
            return "vendor-react";
          }
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(webRoot, "src"),
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    // 允许隧道域名（如 *.trycloudflare.com）访问本地 dev server，便于分享预览链接验收
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": {
        target: backendTarget,
        changeOrigin: true,
        timeout: 190000,
        proxyTimeout: 190000,
      },
    },
    warmup: {
      clientFiles: ["./src/main.tsx"],
    },
  },
  plugins: [localAssetPlugin(), react()],
});
