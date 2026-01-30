import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes.js";
import { serveStatic } from "./static.js";
import { createServer } from "http";
import { Storage } from "@google-cloud/storage";
import * as dotenv from "dotenv";

import { initLogger } from "../shared/logger/index.js";
import { contextMiddleware } from "./middle/context-handler.js";
import { getPool, initializeDatabase } from "../shared/db/index.js";


if (process.env.NODE_ENV !== "production") {
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  console.log('🔍 RESOLUTION CHECK:', {
    dbPath: require.resolve('../shared/db/index.js'),
    env: process.env.NODE_ENV
  });
}


dotenv.config();

initLogger();

initializeDatabase(getPool());

const app = express();
const httpServer = createServer(app);

const gcpProjectId = process.env.GCP_PROJECT_ID;
const bucketName = process.env.GCP_BUCKET_NAME;

if (!gcpProjectId) throw Error("A projectId was not provided");
if (!bucketName) throw Error("A bucket name was not provided");

const bucket = new Storage({ projectId: gcpProjectId }).bucket(bucketName);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: false }));

app.use(contextMiddleware);

app.use((req, res, next) => {
  const start = Date.now();

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    (res as any).locals.logBody = bodyJson;
    return originalResJson.apply(res, [ bodyJson, ...args ]);  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (req.path.startsWith("/api")) {
      const body = (res as any).locals.logBody;
      const bodyStr = body ? ` :: ${JSON.stringify(body)}` : "";
      console.log(`${req.method} ${req.path} ${res.statusCode} in ${duration}ms${bodyStr}`);
    }
  });

  next();
});

(async () => {
  try {
    await registerRoutes(httpServer, app, bucket);

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      console.error(`API Error: ${message}`, {
        status,
        stack: err.stack,
        path: _req.path
      });

      res.status(status).json({ message });
    });

    if (process.env.NODE_ENV === "production") {
      serveStatic(app);
    } else {
      const { setupVite } = await import("./vite.js");
      await setupVite(httpServer, app);
    }

    const port = parseInt(process.env.PORT || "8000", 10);
    httpServer.listen(
      {
        port,
        host: "0.0.0.0",
      },
      () => {
        console.log(`Serving port ${port}`);
      },
    );

    if ((import.meta as any).hot) {
      (import.meta as any).hot.on("vite:beforeFullReload", () => {
        console.log("Reload");
        httpServer.close();
      });

      (import.meta as any).hot.dispose(() => {
        console.log("Closing...");
        httpServer.close();
      });
    }
  } catch (error) {
    console.error("[Server] FATAL: Failed to initialize server:", error);
    console.error("[Server] Shutting down due to initialization failure...");
    process.exit(1);
  }
})();
