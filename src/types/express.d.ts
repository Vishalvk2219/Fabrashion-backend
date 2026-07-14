// Ambient type augmentation for Express requests.
// `req.log` and `req.id` are added by pino-http (see middleware/requestLogger.ts).
import 'express';

declare global {
  namespace Express {
    interface Request {
      /** Populated by the auth middleware (Phase 1). */
      user?: {
        id: string;
        role: 'CUSTOMER' | 'STAFF' | 'ADMIN';
      };
    }
  }
}

export {};
