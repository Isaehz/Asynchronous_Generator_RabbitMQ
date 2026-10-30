import { pool } from '../src/db/index.js';

export async function migrate() {
  const client = await pool.connect();
  try {
    console.log('[Migration] Starting database migration...');

    await client.query('BEGIN');

    // Create sales table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id VARCHAR(64) PRIMARY KEY,
        sale_date DATE NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
        total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Indexes for sales queries by date
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales (sale_date, id);
    `);

    // Create reports table
    // States: pending, queued, processing, retrying, completed, failed
    await client.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id UUID PRIMARY KEY,
        idempotency_key VARCHAR(255) UNIQUE,
        report_type VARCHAR(50) NOT NULL DEFAULT 'sales',
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        exported_rows INTEGER,
        file_path VARCHAR(500),
        error_message TEXT,
        worker_id VARCHAR(100),
        locked_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status);
      CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports (created_at DESC);
    `);

    await client.query('COMMIT');
    console.log('[Migration] Database schema migrated successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith('migrate.js')) {
  migrate().then(() => pool.end()).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
