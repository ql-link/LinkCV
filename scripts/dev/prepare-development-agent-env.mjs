import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2];
if (!target) throw new Error("runtime Agent env path is required");

const stored = {};
if (existsSync(target)) {
  for (const line of readFileSync(target, "utf8").split("\n")) {
    const separator = line.indexOf("=");
    if (separator > 0) stored[line.slice(0, separator)] = line.slice(separator + 1);
  }
}

const value = (name) =>
  process.env[name]?.trim() || stored[name]?.trim() || randomBytes(32).toString("hex");
const serviceToken = value("PI_SERVICE_TOKEN");
let internalToken = value("LINKCV_INTERNAL_AGENT_TOKEN");
if (internalToken === serviceToken) internalToken = randomBytes(32).toString("hex");

writeFileSync(
  target,
  `PI_SERVICE_TOKEN=${serviceToken}\nLINKCV_INTERNAL_AGENT_TOKEN=${internalToken}\n`,
  { encoding: "utf8", mode: 0o600 },
);
chmodSync(target, 0o600);
