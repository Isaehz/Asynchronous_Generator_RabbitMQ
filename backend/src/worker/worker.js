import dotenv from 'dotenv';
import { pool } from '../db/index.js';
import { getRabbitChannel, QUEUES, EXCHANGES } from '../queue/rabbit.js';
import { generateSalesCSV } from '../storage/csvGenerator.js';
import { createLogger } from '../logging/logger.js';

dotenv.config();

const workerId = process.env.WORKER_ID || `worker-${process.pid}`;
const logger = createLogger(workerId);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const DELAY_SECONDS = parseInt(process.env.WORKER_DELAY_SECONDS || '5', 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startWorker() {
  logger.info('WORKER_STARTING', { workerId, maxRetries: MAX_RETRIES, delaySeconds: DELAY_SECONDS });
  const channel = await getRabbitChannel();

  // Fair dispatch: only deliver 1 unacknowledged message to this worker at a time
  await channel.prefetch(1);

  channel.consume(QUEUES.REPORTS, async (msg) => {
    if (!msg) return;

    let payload;
    try {
      payload = JSON.parse(msg.content.toString());
    } catch (parseErr) {
      logger.error('WORKER_PAYLOAD_PARSE_FAILED', { error: parseErr.message });
      // Non-recoverable malformed message, send to DLQ
      channel.nack(msg, false, false);
      return;
    }

    const { reportId, startDate, endDate, simulateError } = payload;
    logger.info('WORKER_MESSAGE_RECEIVED', { reportId, workerId });

    const client = await pool.connect();
    try {
      // 1. ATOMIC CLAIM:
      // Try to transition report from 'queued', 'pending' or 'retrying' to 'processing'
      // If already 'completed', this is an idempotent duplicate delivery -> ACK and return
      await client.query('BEGIN');
      const checkRes = await client.query('SELECT status, attempt_count FROM reports WHERE id = $1 FOR UPDATE', [reportId]);
      
      if (checkRes.rows.length === 0) {
        logger.error('REPORT_NOT_FOUND', { reportId });
        await client.query('ROLLBACK');
        channel.ack(msg);
        return;
      }

      const currentStatus = checkRes.rows[0].status;
      let attemptCount = checkRes.rows[0].attempt_count;

      if (currentStatus === 'completed') {
        logger.info('REPORT_ALREADY_COMPLETED_IDEMPOTENT_SKIP', { reportId });
        await client.query('ROLLBACK');
        channel.ack(msg);
        return;
      }

      attemptCount += 1;

      // Update state to processing
      await client.query(`
        UPDATE reports 
        SET status = 'processing',
            attempt_count = $1,
            worker_id = $2,
            locked_at = NOW(),
            updated_at = NOW()
        WHERE id = $3;
      `, [attemptCount, workerId, reportId]);

      await client.query('COMMIT');

      logger.info('REPORT_PROCESSING_STARTED', { reportId, attemptCount, workerId });

      // Configurable demo delay (5 to 15 seconds)
      if (DELAY_SECONDS > 0) {
        await sleep(DELAY_SECONDS * 1000);
      }

      // Check for test failure simulations (required by spec 3.8)
      const isTransient = simulateError === 'transient' || process.env.SIMULATE_TRANSIENT_ERROR === 'true';
      const isPermanent = simulateError === 'permanent' || process.env.SIMULATE_PERMANENT_ERROR === 'true';

      if (isTransient && attemptCount === 1) {
        throw new Error('Simulated transient worker error on attempt 1');
      }

      if (isPermanent) {
        throw new Error('Simulated unrecoverable permanent error');
      }

      // 2. Generate CSV
      const { filePath, exportedRows } = await generateSalesCSV(reportId, startDate, endDate);

      // 3. Mark completed in PostgreSQL BEFORE acknowledging RabbitMQ
      await pool.query(`
        UPDATE reports 
        SET status = 'completed',
            file_path = $1,
            exported_rows = $2,
            error_message = NULL,
            updated_at = NOW()
        WHERE id = $3;
      `, [filePath, exportedRows, reportId]);

      logger.info('REPORT_COMPLETED_SUCCESSFULLY', { reportId, exportedRows, attemptCount });

      // 4. MANUAL ACKNOWLEDGMENT only after DB and file are safely saved
      channel.ack(msg);

    } catch (err) {
      logger.error('WORKER_PROCESSING_ERROR', { reportId, error: err.message });

      try {
        const res = await pool.query('SELECT attempt_count FROM reports WHERE id = $1', [reportId]);
        const attempts = res.rows[0]?.attempt_count || 1;

        if (attempts >= MAX_RETRIES || (payload.simulateError === 'permanent')) {
          // Exhausted retries -> mark failed and publish to DLQ
          logger.warn('REPORT_RETRIES_EXHAUSTED_MARKING_FAILED', { reportId, attempts });
          await pool.query(`
            UPDATE reports 
            SET status = 'failed',
                error_message = $1,
                updated_at = NOW()
            WHERE id = $2;
          `, [err.message, reportId]);

          // Reject without requeue so it routes to DLQ
          channel.nack(msg, false, false);
        } else {
          // Plan retry -> mark retrying and route to retry delayed queue
          logger.info('REPORT_SCHEDULING_RETRY', { reportId, nextAttempt: attempts + 1 });
          await pool.query(`
            UPDATE reports 
            SET status = 'retrying',
                error_message = $1,
                updated_at = NOW()
            WHERE id = $2;
          `, [err.message, reportId]);

          // Publish to delayed retry queue and ACK original
          channel.sendToQueue(
            QUEUES.RETRY,
            Buffer.from(JSON.stringify(payload)),
            { persistent: true }
          );
          channel.ack(msg);
        }
      } catch (recoveryErr) {
        logger.error('WORKER_RECOVERY_FAILED', { reportId, error: recoveryErr.message });
        // Nack with requeue if we couldn't even reach the database
        channel.nack(msg, false, true);
      }
    } finally {
      client.release();
    }
  });

  logger.info('WORKER_LISTENING_FOR_JOBS', { queue: QUEUES.REPORTS });
}

if (process.argv[1]?.endsWith('worker.js')) {
  startWorker().catch((err) => {
    logger.error('WORKER_FATAL', { error: err.message });
    process.exit(1);
  });
}
