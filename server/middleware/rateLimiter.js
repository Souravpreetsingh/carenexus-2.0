const rateLimitStore = new Map();

function createRateLimiter(options = {}) {
  const { windowMs = 60000, max = 30, message = 'Too many requests, please try again later.' } = options;

  return function (req, res, next) {
    const key = (req.user ? req.user.id : req.ip) + '_' + (req.baseUrl || '') + (req.path || '');
    const now = Date.now();

    let record = rateLimitStore.get(key);
    if (!record) {
      record = { count: 1, resetTime: now + windowMs };
      rateLimitStore.set(key, record);
    } else {
      if (now > record.resetTime) {
        record.count = 1;
        record.resetTime = now + windowMs;
      } else {
        record.count++;
      }
    }

    if (record.count > max) {
      return res.status(429).json({ message, retryAfterSeconds: Math.ceil((record.resetTime - now) / 1000) });
    }

    next();
  };
}

module.exports = {
  createRateLimiter
};
