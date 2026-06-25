import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "./db.mjs";

const SESSION_COOKIE = "resume_session";
const SESSION_TTL_DAYS = 30;

export function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function setSessionCookie(res, sessionId) {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function createSession(userId) {
  const id = createId("sess");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
  ).run(id, userId, expiresAt);

  return id;
}

export function destroySession(sessionId) {
  if (!sessionId) return;
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function getSessionUser(sessionId) {
  if (!sessionId) return null;

  const row = db
    .prepare(
      `SELECT users.id, users.email
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ? AND sessions.expires_at > CURRENT_TIMESTAMP`,
    )
    .get(sessionId);

  return row ?? null;
}

export function requireAuth(req, res, next) {
  const user = getSessionUser(req.cookies?.[SESSION_COOKIE]);

  if (!user) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  req.user = user;
  next();
}

export { SESSION_COOKIE };
