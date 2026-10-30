# Documentación de Arquitectura

## 1. Visión General del Sistema

El sistema implementa un **Generador Asíncrono de Reportes de Ventas** diseñado para desacoplar solicitudes HTTP de operaciones pesadas de E/S y procesamiento de bases de datos.

```text
  +-----------------------------------------------------------+
  |              Frontend (React + Vite + Tailwind)           |
  |     - Formulario con Idempotencia y Simulador de Fallos   |
  |     - Monitoreo en vivo de Estados y Descargas Directas   |
  |     - Generador de Carga Masiva (20 solicitudes)          |
  +-----------------------------------------------------------+
                                |
                                | HTTP REST (/reports)
                                v
  +-----------------------------------------------------------+
  |                 API Backend (Node.js + Express)           |
  |     - Validación estricta de fechas y tipos               |
  |     - Deduplicación con Idempotency-Key                   |
  |     - Persistencia inicial (estado: pending) en Postgres  |
  |     - Publisher Confirms a RabbitMQ Exchange              |
  |     - Respuesta inmediata HTTP 202 Accepted              |
  +-----------------------------------------------------------+
            |                                         |
            | Publica trabajo                         | Consulta estado
            v                                         v
+-------------------------------+         +------------------------+
|      RabbitMQ Message Broker  |         |   PostgreSQL Database  |
| - reports_exchange (direct)   |         | - Tabla sales (10,000+)|
| - reports_queue (durable)     |         | - Tabla reports        |
| - reports_retry_queue (TTL/DLX|         | - Locks transaccionales|
| - reports_dlq (Dead-Letter)   |         +------------------------+
+-------------------------------+                     ^
            |                                         |
            | Mensaje persistente                     |
            v                                         |
  +---------------------------------------------------+-------+
  |            Workers de Procesamiento (Node.js)             |
  |     - Prefetch(1) para balanceo justo                     |
  |     - Reclamo atómico (SELECT FOR UPDATE)                 |
  |     - Retraso configurable (5 a 15 segundos)              |
  |     - Generación CSV con streaming y escaping             |
  |     - Escritura atómica (.tmp -> .csv)                    |
  |     - Actualización a 'completed' en Postgres             |
  |     - ACK manual solo tras persistencia exitosa           |
  |     - Reintentos exponenciales (máximo 3) o desvío a DLQ  |
  +-----------------------------------------------------------+
                                |
                                v
                   Almacenamiento Local Seguro
                     (storage/reports/*.csv)
```

## 2. Componentes Principales

### 2.1 API Express
- Responde `202 Accepted` de inmediato con el `reportId` y URL de consulta.
- Garantiza idempotencia: si se envía el mismo `Idempotency-Key` con los mismos parámetros, devuelve el reporte existente; si los parámetros difieren, rechaza con `409 Conflict`.
- Maneja reconciliación: si la publicación a RabbitMQ fallara momentáneamente, el registro queda en estado `pending` para reconciliación posterior.

### 2.2 Broker RabbitMQ
- Colas durables (`durable: true`) y mensajes persistentes (`deliveryMode: 2`).
- **Publisher Confirms**: La API espera la confirmación del broker antes de responder con éxito.
- **Consumer Manual ACKs**: El worker procesa el reporte y solo emite `channel.ack(msg)` tras haber escrito el archivo CSV final y actualizado la base de datos a `completed`.
- **Estrategia de Reintentos y DLQ**:
  - En caso de error recuperable, el worker actualiza el reporte a `retrying`, emite un mensaje a `reports_retry_queue` con TTL de 5000ms y ACK al mensaje original.
  - Al vencer el TTL, RabbitMQ enruta el mensaje automáticamente de regreso a `reports_queue`.
  - Al agotar 3 intentos o ante fallos irrecuperables, se actualiza a `failed` y se enruta a `reports_dlq`.

### 2.3 PostgreSQL
- Almacena el conjunto de datos de ventas sintéticas (`sales`, más de 10,000 registros reproducibles).
- Conserva el ciclo de vida de los reportes (`reports`).
- Evita condiciones de carrera usando transacciones y `SELECT ... FOR UPDATE` al reclamar un trabajo.

### 2.4 Generación y Almacenamiento Seguro de CSV
- Los datos se transmiten usando streaming con `csv-stringify` para bajo uso de memoria.
- Se escribe primero a un archivo temporal (`{report_id}.tmp`) y se renombra atómicamente a `{report_id}.csv` únicamente al concluir.
- La descarga (`GET /reports/:id/download`) valida la existencia en disco, el estado `completed` y restringe la ruta estrictamente a `storage/reports`.
