import express from "express";
import cookieParser from "cookie-parser";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { db, databaseInfo } from "./db.mjs";
import {
  clearSessionCookie,
  createId,
  createSession,
  destroySession,
  getSessionUser,
  hashPassword,
  requireAuth,
  setSessionCookie,
  verifyPassword,
  SESSION_COOKIE,
} from "./auth.mjs";
import { defaultResumeMarkdown, defaultResumeSettings } from "./defaultResume.mjs";
import {
  buildAssetObjectName,
  dataUrlToImage,
  ensureAssetBucket,
  getAssetObject,
  inferImageContentType,
  minioConfig,
  uploadAssetObject,
} from "./minio.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const port = Number(process.env.API_PORT ?? 4174);
const app = express();

app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());

function publicUser(user) {
  return user ? { id: user.id, email: user.email } : null;
}

function parseResume(row) {
  return {
    id: row.id,
    title: row.title,
    markdown: row.markdown,
    settings: JSON.parse(row.settings_json),
    splitRatio: row.split_ratio,
    previewScale: row.preview_scale,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 8;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, database: databaseInfo.path });
});

app.post("/api/assets", requireAuth, async (req, res) => {
  try {
    const image = dataUrlToImage(req.body?.dataUrl);
    if (!image) {
      res.status(400).json({ error: "INVALID_IMAGE" });
      return;
    }

    if (image.buffer.length > 10 * 1024 * 1024) {
      res.status(413).json({ error: "IMAGE_TOO_LARGE" });
      return;
    }

    const objectName = buildAssetObjectName({
      userId: req.user.id,
      fileName: req.body?.fileName,
      contentType: image.contentType,
    });

    await uploadAssetObject({
      objectName,
      buffer: image.buffer,
      contentType: image.contentType,
    });

    res.status(201).json({
      asset: {
        objectName,
        url: `/api/assets/${encodeURIComponent(objectName)}`,
      },
    });
  } catch (error) {
    console.error("Unable to upload asset to MinIO", error);
    res.status(502).json({ error: "ASSET_UPLOAD_FAILED" });
  }
});

app.get("/api/assets/:objectName", requireAuth, async (req, res) => {
  const objectName = decodeURIComponent(req.params.objectName);

  if (!objectName.startsWith(`users/${req.user.id}/assets/`)) {
    res.status(403).end("Forbidden");
    return;
  }

  try {
    const object = await getAssetObject(objectName);
    object.on("error", (error) => {
      if (!res.headersSent) {
        res.status(error?.code === "NoSuchKey" ? 404 : 502).end("Unable to read asset");
        return;
      }
      res.destroy(error);
    });
    res.setHeader("Content-Type", inferImageContentType(objectName));
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    await pipeline(object, res);
  } catch (error) {
    console.error("Unable to read asset from MinIO", error);
    res.status(error?.code === "NoSuchKey" ? 404 : 502).end("Unable to read asset");
  }
});

app.get("/api/auth/me", (req, res) => {
  const user = getSessionUser(req.cookies?.[SESSION_COOKIE]);
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/register", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");

  if (!validateEmail(email)) {
    res.status(400).json({ error: "INVALID_EMAIL" });
    return;
  }

  if (!validatePassword(password)) {
    res.status(400).json({ error: "WEAK_PASSWORD" });
    return;
  }

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    res.status(409).json({ error: "EMAIL_EXISTS" });
    return;
  }

  const userId = createId("user");
  const passwordHash = await hashPassword(password);

  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(
    userId,
    email,
    passwordHash,
  );

  const sessionId = createSession(userId);
  setSessionCookie(res, sessionId);
  res.status(201).json({ user: { id: userId, email } });
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const user = db.prepare("SELECT id, email, password_hash FROM users WHERE email = ?").get(email);

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    res.status(401).json({ error: "INVALID_CREDENTIALS" });
    return;
  }

  const sessionId = createSession(user.id);
  setSessionCookie(res, sessionId);
  res.json({ user: { id: user.id, email: user.email } });
});

app.post("/api/auth/logout", (req, res) => {
  destroySession(req.cookies?.[SESSION_COOKIE]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/resumes", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, title, created_at, updated_at
       FROM resumes
       WHERE user_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(req.user.id);

  res.json({
    resumes: rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
});

app.post("/api/resumes", requireAuth, (req, res) => {
  const id = createId("resume");
  const title = String(req.body?.title ?? "未命名简历").trim() || "未命名简历";
  const markdown = typeof req.body?.markdown === "string" ? req.body.markdown : defaultResumeMarkdown;
  const settings = req.body?.settings && typeof req.body.settings === "object"
    ? { ...defaultResumeSettings, ...req.body.settings, showSource: false }
    : defaultResumeSettings;
  const splitRatio = Number(req.body?.splitRatio ?? 0.4);
  const previewScale = Number(req.body?.previewScale ?? 1);

  db.prepare(
    `INSERT INTO resumes
      (id, user_id, title, markdown, settings_json, split_ratio, preview_scale)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, req.user.id, title, markdown, JSON.stringify(settings), splitRatio, previewScale);

  const row = db
    .prepare("SELECT * FROM resumes WHERE id = ? AND user_id = ?")
    .get(id, req.user.id);

  res.status(201).json({ resume: parseResume(row) });
});

app.get("/api/resumes/:id", requireAuth, (req, res) => {
  const row = db
    .prepare("SELECT * FROM resumes WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);

  if (!row) {
    res.status(404).json({ error: "RESUME_NOT_FOUND" });
    return;
  }

  res.json({ resume: parseResume(row) });
});

app.put("/api/resumes/:id", requireAuth, (req, res) => {
  const existing = db
    .prepare("SELECT id FROM resumes WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);

  if (!existing) {
    res.status(404).json({ error: "RESUME_NOT_FOUND" });
    return;
  }

  const title = String(req.body?.title ?? "未命名简历").trim() || "未命名简历";
  const markdown = String(req.body?.markdown ?? "");
  const settings = {
    ...defaultResumeSettings,
    ...(req.body?.settings && typeof req.body.settings === "object" ? req.body.settings : {}),
    showSource: false,
  };
  const splitRatio = Number(req.body?.splitRatio ?? 0.4);
  const previewScale = Number(req.body?.previewScale ?? 1);

  db.prepare(
    `UPDATE resumes
     SET title = ?,
         markdown = ?,
         settings_json = ?,
         split_ratio = ?,
         preview_scale = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
  ).run(
    title,
    markdown,
    JSON.stringify(settings),
    splitRatio,
    previewScale,
    req.params.id,
    req.user.id,
  );

  const row = db
    .prepare("SELECT * FROM resumes WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  res.json({ resume: parseResume(row) });
});

app.delete("/api/resumes/:id", requireAuth, (req, res) => {
  const result = db
    .prepare("DELETE FROM resumes WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.user.id);

  res.json({ deleted: result.changes > 0 });
});

ensureAssetBucket()
  .then(() => {
    console.log(`MinIO bucket ready: ${minioConfig.bucket}`);
  })
  .catch((error) => {
    console.error("Unable to initialize MinIO bucket", error);
  });

if (process.env.NODE_ENV === "production") {
  app.use(express.static(resolve(projectRoot, "dist")));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }

    res.sendFile(resolve(projectRoot, "dist", "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Resume API listening on http://127.0.0.1:${port}`);
  console.log(`SQLite database: ${databaseInfo.path}`);
});
