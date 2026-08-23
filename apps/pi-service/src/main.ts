import { createPiServer } from "./server.ts";

const port = Number(process.env.PI_SERVICE_PORT ?? "8010");
const host = process.env.PI_SERVICE_HOST ?? "127.0.0.1";
const token = process.env.PI_SERVICE_TOKEN ?? "linkcv-pi-local-change-me";

createPiServer(token).listen(port, host, () => {
  process.stdout.write(`LinkCV Pi Service listening on ${host}:${port}\n`);
});
