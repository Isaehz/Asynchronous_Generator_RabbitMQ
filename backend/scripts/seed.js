import { pool } from '../src/db/index.js';
import { migrate } from './migrate.js';

const CUSTOMERS = [
  'TechCorp Solutions', 'Global Retail SA', 'Alpha Logistics', 'Nexus Systems',
  'Innova Medical', 'Quantum Labs', 'Prime Market', 'Starlight Media',
  'Apex Industrial', 'Blue Ocean Trading', 'Horizon Software', 'Solaris Energy'
];

const PRODUCTS = [
  { name: 'Enterprise Cloud License', price: 1200.00 },
  { name: 'Database Optimization Suite', price: 450.50 },
  { name: 'Real-Time Monitoring Agent', price: 99.99 },
  { name: 'Security Audit Toolkit', price: 850.00 },
  { name: 'API Gateway Subscription', price: 299.00 },
  { name: 'High-Performance SSD Cache', price: 180.25 },
  { name: 'Developer Support Tier-1', price: 150.00 },
  { name: 'Data Pipeline Connector', price: 320.00 }
];

export async function seed(targetRows = 10000) {
  await migrate();

  const client = await pool.connect();
  try {
    const res = await client.query('SELECT COUNT(*) FROM sales');
    const existing = parseInt(res.rows[0].count, 10);
    if (existing >= targetRows) {
      console.log(`[Seed] Already seeded with ${existing} sales. Skipping.`);
      return;
    }

    console.log(`[Seed] Generating ${targetRows} synthetic sales...`);
    await client.query('BEGIN');

    // Reproducible random seed generator
    let seedState = 42;
    function pseudoRandom() {
      seedState = (seedState * 1664525 + 1013904223) % 4294967296;
      return seedState / 4294967296;
    }

    const batchSize = 1000;
    const startDate = new Date('2026-01-01T00:00:00Z').getTime();
    const endDate = new Date('2026-12-31T23:59:59Z').getTime();

    for (let i = 0; i < targetRows; i += batchSize) {
      const currentBatch = Math.min(batchSize, targetRows - i);
      const values = [];
      const placeholders = [];

      for (let j = 0; j < currentBatch; j++) {
        const index = i + j + 1;
        const id = `SALE-${String(index).padStart(6, '0')}`;
        
        // Random date within 2026
        const randomTime = startDate + pseudoRandom() * (endDate - startDate);
        const saleDate = new Date(randomTime).toISOString().split('T')[0];
        
        const customer = CUSTOMERS[Math.floor(pseudoRandom() * CUSTOMERS.length)];
        const productObj = PRODUCTS[Math.floor(pseudoRandom() * PRODUCTS.length)];
        const quantity = Math.floor(pseudoRandom() * 10) + 1;
        const unitPrice = productObj.price;
        const totalAmount = parseFloat((quantity * unitPrice).toFixed(2));

        const offset = j * 7;
        placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`);
        values.push(id, saleDate, customer, productObj.name, quantity, unitPrice, totalAmount);
      }

      const queryText = `
        INSERT INTO sales (id, sale_date, customer_name, product_name, quantity, unit_price, total_amount)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (id) DO NOTHING;
      `;
      await client.query(queryText, values);
      process.stdout.write(`[Seed] Progress: ${Math.min(i + batchSize, targetRows)} / ${targetRows}\r`);
    }

    await client.query('COMMIT');
    console.log(`\n[Seed] Successfully seeded sales dataset.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Seed] Error seeding data:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith('seed.js')) {
  seed(10000).then(() => pool.end()).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
