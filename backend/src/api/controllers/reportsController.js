import express from 'express';
import { v4 as uuidv4, validate as validateUuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import { pool } from '../../db/index.js';
import { publishReportJob } from '../../queue/rabbit.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('reports-controller');

export async function createReport(req, res) {
  const { type, startDate, endDate, simulateError } = req.body;
  const idempotencyKey = req.header('Idempotency-Key');

  // 1. Validation
  if (type !== 'sales') {
    return res.status(400).json({ error: 'Tipo de reporte inválido. Solo se admite "sales".' });
  }

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate y endDate son obligatorios (formato YYYY-MM-DD).' });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: 'Fechas inválidas.' });
  }

  if (start > end) {
    return res.status(400).json({ error: 'startDate no puede ser posterior a endDate.' });
  }

  // 2. Idempotency Check
  if (idempotencyKey) {
    const existing = await pool.query(
      'SELECT id, report_type, start_date, end_date, status FROM reports WHERE idempotency_key = $1',
      [idempotencyKey]
    );

    if (existing.rows.length > 0) {
      const existingReport = existing.rows[0];
      const existingStart = existingReport.start_date.toISOString().split('T')[0];
      const existingEnd = existingReport.end_date.toISOString().split('T')[0];

      // Same key, same parameters -> return existing report
      if (existingReport.report_type === type && existingStart === startDate && existingEnd === endDate) {
        logger.info('IDEMPOTENT_REQUEST_MATCH', { idempotencyKey, reportId: existingReport.id });
        return res.status(202).json({
          reportId: existingReport.id,
          status: existingReport.status,
          statusUrl: `/reports/${existingReport.id}`
        });
      } else {
        // Same key, DIFFERENT parameters -> 409 Conflict
        logger.warn('IDEMPOTENCY_KEY_CONFLICT', { idempotencyKey });
        return res.status(409).json({ error: 'La Idempotency-Key ya fue usada con diferentes parámetros.' });
      }
    }
  }

  // 3. Create Report Record in pending status
  const reportId = uuidv4();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      INSERT INTO reports (id, idempotency_key, report_type, start_date, end_date, status, attempt_count)
      VALUES ($1, $2, $3, $4, $5, 'pending', 0);
    `, [reportId, idempotencyKey || null, type, startDate, endDate]);

    await client.query('COMMIT');

    // 4. Publish to RabbitMQ
    try {
      await publishReportJob({
        schemaVersion: 1,
        reportId,
        type,
        startDate,
        endDate,
        simulateError: simulateError || null
      });

      // Update to queued after confirmed publish
      await pool.query("UPDATE reports SET status = 'queued', updated_at = NOW() WHERE id = $1", [reportId]);
    } catch (pubErr) {
      // RabbitMQ failed, leave status as 'pending' for reconciler recovery
      logger.error('REPORT_PUBLISH_FAILED_KEPT_PENDING', { reportId, error: pubErr.message });
    }

    // 5. Immediate 202 Accepted response
    return res.status(202).json({
      reportId,
      status: 'pending',
      statusUrl: `/reports/${reportId}`
    });
  } catch (dbErr) {
    await client.query('ROLLBACK');
    logger.error('CREATE_REPORT_DB_ERROR', { error: dbErr.message });
    return res.status(500).json({ error: 'Error interno al registrar reporte.' });
  } finally {
    client.release();
  }
}

export async function getReportStatus(req, res) {
  const { report_id } = req.params;

  if (!validateUuid(report_id)) {
    return res.status(404).json({ error: 'Reporte no encontrado.' });
  }

  const result = await pool.query(`
    SELECT id, status, created_at, updated_at, attempt_count, exported_rows, error_message
    FROM reports
    WHERE id = $1;
  `, [report_id]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Reporte no encontrado.' });
  }

  const row = result.rows[0];
  const response = {
    reportId: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attemptCount: row.attempt_count,
    exportedRows: row.exported_rows,
    downloadUrl: row.status === 'completed' ? `/reports/${row.id}/download` : null,
    error: row.error_message ? 'El reporte no pudo ser completado.' : null
  };

  return res.status(200).json(response);
}

export async function downloadReport(req, res) {
  const { report_id } = req.params;

  if (!validateUuid(report_id)) {
    return res.status(404).json({ error: 'Reporte no encontrado.' });
  }

  const result = await pool.query(`
    SELECT status, file_path FROM reports WHERE id = $1;
  `, [report_id]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Reporte no encontrado.' });
  }

  const { status, file_path } = result.rows[0];

  if (status !== 'completed' || !file_path) {
    return res.status(409).json({ error: 'El reporte aún no está listo para ser descargado.' });
  }

  // Security check: ensure path is inside local storage directory
  const safeBaseDir = path.resolve(process.env.STORAGE_DIR || './storage/reports');
  const safeFilePath = path.resolve(file_path);

  if (!safeFilePath.startsWith(safeBaseDir) || !fs.existsSync(safeFilePath)) {
    return res.status(404).json({ error: 'Archivo no encontrado en el servidor.' });
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="reporte-ventas-${report_id}.csv"`);
  return res.sendFile(safeFilePath);
}

export async function listRecentReports(req, res) {
  const result = await pool.query(`
    SELECT id, report_type, start_date, end_date, status, attempt_count, exported_rows, created_at, updated_at, error_message
    FROM reports
    ORDER BY created_at DESC
    LIMIT 50;
  `);

  return res.status(200).json(result.rows.map(row => ({
    reportId: row.id,
    type: row.report_type,
    startDate: row.start_date.toISOString().split('T')[0],
    endDate: row.end_date.toISOString().split('T')[0],
    status: row.status,
    attemptCount: row.attempt_count,
    exportedRows: row.exported_rows,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    downloadUrl: row.status === 'completed' ? `/reports/${row.id}/download` : null,
    error: row.error_message
  })));
}
