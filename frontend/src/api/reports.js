const API_BASE = '/api';

export async function requestReport({ type = 'sales', startDate, endDate, idempotencyKey, simulateError }) {
  const headers = {
    'Content-Type': 'application/json'
  };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  const response = await fetch(`${API_BASE}/reports`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ type, startDate, endDate, simulateError })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Error ${response.status}`);
  }
  return data;
}

export async function fetchReports() {
  const response = await fetch(`${API_BASE}/reports`);
  if (!response.ok) {
    throw new Error(`Error ${response.status}`);
  }
  return response.json();
}

export async function fetchReportStatus(reportId) {
  const response = await fetch(`${API_BASE}/reports/${reportId}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Error ${response.status}`);
  }
  return data;
}

export function getDownloadUrl(reportId) {
  return `${API_BASE}/reports/${reportId}/download`;
}
