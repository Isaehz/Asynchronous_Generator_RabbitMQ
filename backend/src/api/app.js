import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import reportsRouter from './routes/reportsRoutes.js';
import { createLogger } from '../logging/logger.js';
import { migrate } from '../../scripts/migrate.js';
import { seed } from '../../scripts/seed.js';

dotenv.config();

const logger = createLogger('express-api');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Request logger middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('HTTP_REQUEST', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start
    });
  });
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount routes
app.use(reportsRouter);

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error('UNHANDLED_ERROR', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Error interno en el servidor.' });
});

// Auto-migrate and seed in development mode if started directly
if (process.argv[1]?.endsWith('app.js')) {
  (async () => {
    try {
      await migrate();
      await seed(10000);
    } catch (e) {
      logger.warn('STARTUP_MIGRATION_OR_SEED_FAILED', { error: e.message });
    }

    app.listen(PORT, () => {
      logger.info('SERVER_STARTED', { port: PORT, env: process.env.NODE_ENV || 'development' });
    });
  })();
}

export default app;
