import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.flatten().fieldErrors;
      const firstMessage = Object.values(details).flat()[0];
      res.status(400).json({
        error: firstMessage || 'Validation error',
        details,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
