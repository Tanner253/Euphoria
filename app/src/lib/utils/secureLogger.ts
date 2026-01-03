/**
 * Simple Logger Utility
 * 
 * Rule: NEVER log environment variables or secrets
 */

const isDev = () => process.env.NODE_ENV === 'development';

export const logger = {
  info(context: string, data?: Record<string, unknown>): void {
    if (isDev()) {
      console.log(context, data || '');
    }
  },

  warn(context: string, data?: Record<string, unknown>): void {
    console.warn(context, data || '');
  },

  error(context: string, error?: unknown): void {
    // Log context only, error message in dev only
    if (isDev() && error instanceof Error) {
      console.error(context, error.message);
    } else {
      console.error(context);
    }
  },
};

export default logger;
