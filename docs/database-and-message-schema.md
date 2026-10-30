# Esquema de Base de Datos y Mensajes

## 1. Esquema de Base de Datos (PostgreSQL)

### Tabla: `sales`
Almacena el conjunto de datos de ventas sobre el cual se ejecutan las consultas de reportes.

```sql
CREATE TABLE sales (
  id VARCHAR(64) PRIMARY KEY,
  sale_date DATE NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
  total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sales_sale_date ON sales (sale_date, id);
```

### Tabla: `reports`
Registra el ciclo de vida, estado de ejecución, metadatos y control de concurrencia de cada reporte.

```sql
CREATE TABLE reports (
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

CREATE INDEX idx_reports_status ON reports (status);
CREATE INDEX idx_reports_created_at ON reports (created_at DESC);
```

### Estados Permitidos en `status`:
- `pending`: Solicitud registrada en base de datos; confirmación de broker en curso o pendiente de reconciliación.
- `queued`: Mensaje publicado exitosamente en RabbitMQ y en espera de consumidor.
- `processing`: Un worker ha reclamado atómicamente el reporte y se encuentra procesando el CSV.
- `retrying`: Ocurrió un error temporal y el reporte ha sido agendado para un nuevo intento (con backoff).
- `completed`: El archivo CSV canónico está disponible para descarga.
- `failed`: Se agotaron los 3 intentos o se produjo un fallo permanente irrecuperable.

---

## 2. Esquema del Mensaje RabbitMQ

El mensaje viaja por RabbitMQ con formato JSON persistente:

```json
{
  "schemaVersion": 1,
  "reportId": "d3b07384-d113-40b9-8c4d-b6a4b1f41392",
  "type": "sales",
  "startDate": "2026-01-01",
  "endDate": "2026-03-31",
  "simulateError": null
}
```

### Propiedades AMQP:
- `deliveryMode`: 2 (persistente en disco).
- `contentType`: `application/json`.
- `mandatory`: true (dispara devolución si no hay cola enlazada).
- `exchange`: `reports_exchange`
- `routingKey`: `process_report`
