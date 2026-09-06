import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    startedAt: number;
  }
}

/** Assigns (or propagates) a request id and echoes it on the response. */
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = req.header(REQUEST_ID_HEADER);
  const id = incoming && /^[A-Za-z0-9-_]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  req.startedAt = performance.now();
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
};
