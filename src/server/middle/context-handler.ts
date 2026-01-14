// src/middleware/context-handler.ts
import { LogContext, logContextStore } from "../../shared/format-loggers";
import { serverId } from "../routes";

export function contextMiddleware(req: any, res: any, next: () => void) {
    const context: LogContext = {
        correlationId: req.headers[ "x-correlation-id" ],
        projectId: req.headers[ "x-project-id" ],
        workerId: `${process.env.HOSTNAME || 'express'}-${process.pid}`,
        serverId,
        shouldPublishLog: false,
        method: req.method,
        url: req.path
    };

    logContextStore.run(context, () => {
        // res.setHeader("X-Correlation-ID", context.correlationId);
        next();
    });
}