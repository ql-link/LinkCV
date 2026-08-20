import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const environment = { ...process.env };

if (environment.RABBITMQ_URL) {
  const rabbitmqUrl = new URL(environment.RABBITMQ_URL);
  const containerHostname = /(^|\.)[a-z0-9-]+-rabbitmq$/i.test(rabbitmqUrl.hostname);
  if (containerHostname) {
    const localHost = environment.LINKCV_LOCAL_RABBITMQ_HOST || environment.MYSQL_HOST;
    if (!localHost) {
      throw new Error(
        "RABBITMQ_URL uses a container hostname, but no local RabbitMQ host is configured",
      );
    }
    rabbitmqUrl.hostname = localHost;
    rabbitmqUrl.port = environment.LINKCV_LOCAL_RABBITMQ_PORT || "5672";
    environment.RABBITMQ_URL = rabbitmqUrl.toString();
  }
}

const concurrently = resolve(
  repositoryRoot,
  "node_modules/concurrently/dist/bin/index.js",
);
const child = spawn(
  process.execPath,
  [
    concurrently,
    "-n",
    "web,backend,worker,pi",
    "-c",
    "cyan,green,yellow,magenta",
    "npm:dev:web",
    "npm:dev:backend",
    "npm:dev:worker",
    "npm:dev:pi",
  ],
  { cwd: repositoryRoot, env: environment, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(`Unable to start Development processes: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
