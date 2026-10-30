export function createLogger(serviceName = 'app') {
  function formatLog(level, action, meta = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      service: serviceName,
      level,
      action,
      ...meta
    };
    return JSON.stringify(entry);
  }

  return {
    info(action, meta) {
      console.log(formatLog('INFO', action, meta));
    },
    warn(action, meta) {
      console.warn(formatLog('WARN', action, meta));
    },
    error(action, meta) {
      console.error(formatLog('ERROR', action, meta));
    }
  };
}

export const logger = createLogger('report-system');
