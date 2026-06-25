import rateLimit from 'express-rate-limit';

const onLimitReached = (req: any) => {
  console.warn(`Rate limit exceeded — IP: ${req.ip}, path: ${req.path}`);
};

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    onLimitReached(req);
    res.status(options.statusCode).json({ error: options.message });
  },
});

export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    onLimitReached(req);
    res.status(options.statusCode).json({ error: options.message });
  },
});
