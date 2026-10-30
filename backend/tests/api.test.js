import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import app from '../src/api/app.js';
import { pool } from '../src/db/index.js';

let server;
const PORT = 3099;
const BASE_URL = `http://localhost:${PORT}`;

describe('Asynchronous Reports API Tests', () => {
  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(PORT, resolve);
    });
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
    process.exit(0);
  });

  test('POST /reports rejects unsupported report type', async () => {
    const res = await fetch(`${BASE_URL}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'unsupported',
        startDate: '2026-01-01',
        endDate: '2026-01-31'
      })
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  });

  test('POST /reports rejects invalid date ranges (start > end)', async () => {
    const res = await fetch(`${BASE_URL}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'sales',
        startDate: '2026-05-01',
        endDate: '2026-01-01'
      })
    });
    assert.strictEqual(res.status, 400);
  });

  test('POST /reports returns 202 Accepted immediately for valid request', async () => {
    const res = await fetch(`${BASE_URL}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'sales',
        startDate: '2026-01-01',
        endDate: '2026-01-31'
      })
    });
    assert.strictEqual(res.status, 202);
    const body = await res.json();
    assert.ok(body.reportId);
    assert.strictEqual(body.status, 'pending');
    assert.strictEqual(body.statusUrl, `/reports/${body.reportId}`);
  });

  test('Idempotency-Key returns existing report ID when duplicated with same params', async () => {
    const key = `test-key-${Date.now()}`;
    const payload = {
      type: 'sales',
      startDate: '2026-02-01',
      endDate: '2026-02-15'
    };

    const res1 = await fetch(`${BASE_URL}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(payload)
    });
    const body1 = await res1.json();

    const res2 = await fetch(`${BASE_URL}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(payload)
    });
    const body2 = await res2.json();

    assert.strictEqual(res2.status, 202);
    assert.strictEqual(body1.reportId, body2.reportId);
  });

  test('Idempotency-Key returns 409 Conflict when reused with different params', async () => {
    const key = `test-conflict-key-${Date.now()}`;
    
    await fetch(`${BASE_URL}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({
        type: 'sales',
        startDate: '2026-01-01',
        endDate: '2026-01-10'
      })
    });

    const res2 = await fetch(`${BASE_URL}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({
        type: 'sales',
        startDate: '2026-02-01',
        endDate: '2026-02-10'
      })
    });

    assert.strictEqual(res2.status, 409);
  });

  test('GET /reports/:id returns 404 for unknown report ID', async () => {
    const res = await fetch(`${BASE_URL}/reports/00000000-0000-0000-0000-000000000000`);
    assert.strictEqual(res.status, 404);
  });

  test('GET /reports/:id/download returns 409 Conflict if report is not completed', async () => {
    const postRes = await fetch(`${BASE_URL}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'sales',
        startDate: '2026-01-01',
        endDate: '2026-01-05'
      })
    });
    const { reportId } = await postRes.json();

    const dlRes = await fetch(`${BASE_URL}/reports/${reportId}/download`);
    assert.strictEqual(dlRes.status, 409);
  });
});
