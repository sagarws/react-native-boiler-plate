type LogArg = unknown;

type Logger = {
  info: (...args: LogArg[]) => void;
  warn: (...args: LogArg[]) => void;
  error: (...args: LogArg[]) => void;
};

function createLogger(): Logger {
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

  return {
    info: (...args) => {
      if (isDev) {
        console.log('[info]', ...args);
      }
    },
    warn: (...args) => {
      if (isDev) {
        console.warn('[warn]', ...args);
      }
    },
    error: (...args) => {
      console.error('[error]', ...args);
    },
  };
}

export const logger: Logger = createLogger();
