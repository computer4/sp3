import { Prisma } from '@prisma/client';
import { HttpError } from '../lib/errors.js';

export function notFound(req, res) {
  res.status(404).json({ error: { message: 'Not found.', code: 'NOT_FOUND' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: { message: err.message, code: err.code, fields: err.fields },
    });
  }

  // Malformed JSON body
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Invalid request body.', code: 'BAD_REQUEST' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { message: 'Request is too large.', code: 'BAD_REQUEST' } });
  }

  const isDbError =
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientUnknownRequestError ||
    err instanceof Prisma.PrismaClientRustPanicError;

  // Details are logged server-side only; the client gets a safe generic message.
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  if (isDbError) {
    return res.status(503).json({
      error: {
        message: 'We could not reach our database right now. Please try again in a moment.',
        code: 'DATABASE_ERROR',
      },
    });
  }
  res.status(500).json({ error: { message: 'Something went wrong. Please try again.', code: 'SERVER_ERROR' } });
}
