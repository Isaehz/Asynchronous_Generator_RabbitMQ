import { pool } from '../db/index.js';
import { publishReportJob } from '../queue/rabbit.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('reconciler');

export async function reconcilePendingReports() {
  logger.info('RECONCILIATION_STARTED');

  // 1. Re-publish pending reports that failed publishing to RabbitMQ
  const pendingRes = await pool.query(`
    SELECT id, report_type, start_date, end_date 
    FROM reports 
    WHERE status = 'pending' AND created_at < NOW() - INTERVAL '15 seconds';
  `);

  logger.info('RECONCILING_PENDING_REPORTS', { count: pendingRes.rows.length });

  for (const row of pendingRes.rows) {
    try {
      await publishReportJob({
        schemaVersion: 1,
        reportId: row.id,
        type: row.report_type,
        startDate: row.start_date.toISOString().split('T')[0],
        endDate: row.end_date.toISOString().split('T')[0]
      });

      await pool.query("UPDATE reports SET status = 'queued', updated_at = NOW() WHERE id = $1", [row.id]);
      logger.info('RECONCILED_PENDING_REPORT', { reportId: row.id });
    } catch (err) {
      logger.error('RECONCILE_PENDING_FAILED', { reportId: row.id, error: err.message });
    }
  }

  // 2. Recover abandoned processing reports (e.g., worker died without ACK or crash)
  const abandonedRes = await pool.query(`
    SELECT id, report_type, start_date, end_date, attempt_count
    FROM reports 
    WHERE status = 'processing' AND locked_at < NOW() - INTERVAL '2 minutes';
  `);

  logger.info('RECONCILING_ABANDONED_REPORTS', { count: abandonedRes.rows.length });

  for (const row of abandonedRes.rows) {
    try {
      if (row.attempt_count >= 3) {
        await pool.query("UPDATE reports SET status = 'failed', error_message = 'Abandoned and exceeded max attempts', updated_at = NOW() WHERE id = $1", [row.id]);
      } else {
        await pool.query("UPDATE reports SET status = 'queued', updated_at = NOW() WHERE id = $1", [row.id]);
        await publishReportJob({
          schemaVersion: 1,
          reportId: row.id,
          type: row.report_type,
          startDate: row.start_date.toISOString().split('T')[0],
          endDate: row.end_date.toISOString().split('T')[0]
        });
      }
      logger.info('RECONCILED_ABANDONED_REPORT', { reportId: row.id });
    } catch (err) {
      logger.error('RECONCILE_ABANDONED_FAILED', { reportId: row.id, error: err.message });
    }
  }

  logger.info('RECONCILIATION_FINISHED');
}

if (process.argv[1]?.endsWith('reconcile-pending.js')) {
  reconcilePendingReports().then(() => pool.end()).catch((e) => {
    logger.error('RECONCILER_FATAL', { error: e.message });
    process.exit(1);
  });
}
