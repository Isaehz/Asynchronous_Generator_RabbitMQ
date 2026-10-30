import fs from 'fs';
import path from 'path';
import { stringify } from 'csv-stringify';
import dotenv from 'dotenv';
import { pool } from '../db/index.js';
import { createLogger } from '../logging/logger.js';

dotenv.config();

const logger = createLogger('csv-generator');
const STORAGE_DIR = process.env.STORAGE_DIR || './storage/reports';

// Ensure storage dir exists
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

export async function generateSalesCSV(reportId, startDate, endDate) {
  const finalFilename = `${reportId}.csv`;
  const tempFilename = `${reportId}.tmp`;
  const finalPath = path.resolve(STORAGE_DIR, finalFilename);
  const tempPath = path.resolve(STORAGE_DIR, tempFilename);

  logger.info('REPORT_GENERATION_STARTED', { reportId, startDate, endDate });

  const queryText = `
    SELECT 
      id AS "ID de venta",
      to_char(sale_date, 'YYYY-MM-DD') AS "Fecha de venta",
      customer_name AS "Nombre del cliente",
      product_name AS "Nombre del producto",
      quantity AS "Cantidad",
      to_char(unit_price, 'FM999999990.00') AS "Precio unitario",
      to_char(total_amount, 'FM999999990.00') AS "Importe total"
    FROM sales
    WHERE sale_date >= $1 AND sale_date <= $2
    ORDER BY sale_date ASC, id ASC;
  `;

  const { rows } = await pool.query(queryText, [startDate, endDate]);

  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(tempPath);
    const stringifier = stringify({
      header: true,
      columns: [
        'ID de venta',
        'Fecha de venta',
        'Nombre del cliente',
        'Nombre del producto',
        'Cantidad',
        'Precio unitario',
        'Importe total'
      ],
      quoted_string: true
    });

    writeStream.on('finish', () => {
      // Atomic rename: from .tmp to .csv only when complete
      try {
        fs.renameSync(tempPath, finalPath);
        logger.info('REPORT_FILE_WRITTEN_ATOMICALLY', { reportId, finalPath, rowsCount: rows.length });
        resolve({
          filePath: finalPath,
          exportedRows: rows.length
        });
      } catch (renameErr) {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        reject(renameErr);
      }
    });

    writeStream.on('error', (err) => {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      reject(err);
    });

    stringifier.pipe(writeStream);

    for (const row of rows) {
      stringifier.write(row);
    }
    stringifier.end();
  });
}
