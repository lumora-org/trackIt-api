/**
 * Fail fast at boot rather than at first request: a missing secret must not
 * surface as a runtime 500 (docs/05 §71).
 */
export function validateEnvironment(raw: Record<string, unknown>): Record<string, unknown> {
  const read = (key: string): string => {
    const value = raw[key];
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
  };

  const env = read('NODE_ENV') || 'development';
  const errors: string[] = [];

  const required = [
    'DATABASE_HOST',
    'DATABASE_NAME',
    'DATABASE_USER',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
  ];

  for (const key of required) {
    if (read(key) === '') errors.push(`${key} is required`);
  }

  if (env === 'production') {
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
      const value = read(key);
      if (value.length > 0 && value.length < 32) {
        errors.push(`${key} must be at least 32 characters in production`);
      }
      if (value.toLowerCase().includes('replace-with')) {
        errors.push(`${key} still contains its placeholder value`);
      }
    }
  }

  if (read('JWT_ACCESS_SECRET') && read('JWT_ACCESS_SECRET') === read('JWT_REFRESH_SECRET')) {
    errors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different (docs/06 §48)');
  }

  // Web Push is optional, so an absent key pair is legal (the feature simply
  // stays off). A half-configured pair is not: it would boot with push looking
  // available and then fail on the first send.
  const hasVapidPublic = read('VAPID_PUBLIC_KEY') !== '';
  const hasVapidPrivate = read('VAPID_PRIVATE_KEY') !== '';
  if (hasVapidPublic !== hasVapidPrivate) {
    errors.push('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together');
  }

  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n  - ${errors.join('\n  - ')}`);
  }

  return raw;
}
