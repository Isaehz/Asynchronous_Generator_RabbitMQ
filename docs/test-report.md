# Informe de Pruebas y Validación de Escenarios

Este documento registra los **12 escenarios obligatorios** requeridos por la consigna del profesor, incluyendo pasos ejecutados, comportamiento esperado, resultado observado y evidencia técnica.

---

### Escenario 1: Solicitud Válida
- **Pasos:** Enviar `POST /reports` con fechas válidas. Consultar inmediatamente `GET /reports/{id}` y posteriormente descargar el CSV cuando pase a `completed`.
- **Comportamiento Esperado:** Respuesta HTTP 202 en milisegundos sin bloquear por el CSV. El CSV final contiene los datos correspondientes.
- **Resultado Observado:** La API responde en < 15ms con código 202 y cuerpo `{ reportId: "...", status: "pending", statusUrl: "/reports/..." }`. Tras el procesamiento del worker, el reporte pasa a `completed` con el conteo de filas y el CSV está disponible.
- **Evidencia:** Prueba automatizada en `tests/api.test.js` ("POST /reports returns 202 Accepted immediately for valid request") ejecutada con éxito.

---

### Escenario 2: Rango de Fechas Inválido
- **Pasos:** Enviar `POST /reports` con `startDate: '2026-05-01'` y `endDate: '2026-01-01'` (inicio mayor a fin).
- **Comportamiento Esperado:** Rechazo HTTP 400 sin encolar ningún mensaje en RabbitMQ.
- **Resultado Observado:** La API responde `400 Bad Request` con mensaje `"startDate no puede ser posterior a endDate"`. Ningún registro se publica en la cola.
- **Evidencia:** Prueba automatizada en `tests/api.test.js` ("POST /reports rejects invalid date ranges").

---

### Escenario 3: Sin Ventas Coincidentes
- **Pasos:** Enviar `POST /reports` para un rango fuera del dataset (ej: 2025-01-01 a 2025-01-10).
- **Comportamiento Esperado:** El worker genera un archivo CSV válido que contiene únicamente la fila de encabezados y cero filas de datos (`exportedRows: 0`).
- **Resultado Observado:** Se crea el archivo CSV con los 7 encabezados requeridos y 0 filas. Estado en BD `completed` y `exported_rows: 0`.
- **Evidencia:** Verificado mediante streaming de `generateSalesCSV` devolviendo cabeceras vacías con escape adecuado.

---

### Escenario 4: 20 Solicitudes con 1 Worker
- **Pasos:** Disparar 20 reportes concurrentes teniendo un único worker activo (`prefetch=1`, retraso de 5s).
- **Comportamiento Esperado:** Los trabajos se encolan en RabbitMQ. El worker procesa secuencialmente uno a uno.
- **Resultado Observado:** RabbitMQ acumula los 20 mensajes. El worker extrae 1 trabajo cada ~5 segundos. Todos los 20 trabajos terminan en `completed` sin pérdida.
- **Evidencia:** Registrado en la comparativa de `docs/performance.md`.

---

### Escenario 5: Mismo Conjunto con 3 Workers
- **Pasos:** Disparar 20 reportes concurrentes con 3 workers activos compartiendo la cola `reports_queue`.
- **Comportamiento Esperado:** La carga se distribuye equitativamente entre los 3 workers gracias a `channel.prefetch(1)`.
- **Resultado Observado:** Los 3 workers consumen trabajos en paralelo. El tiempo total de procesamiento se reduce a casi un tercio. Ningún reporte se corrompe ni se procesa dos veces.
- **Evidencia:** Registrado en `docs/performance.md`.

---

### Escenario 6: Worker Detenido Durante el Procesamiento
- **Pasos:** Iniciar el procesamiento de un reporte en un worker y matar el proceso antes del ACK. Iniciar un nuevo worker.
- **Comportamiento Esperado:** Dado que el ACK es manual y nunca se emitió, RabbitMQ devuelve el mensaje a la cola (`unacked` -> `ready`) al cerrarse la conexión TCP. El nuevo worker lo toma y lo completa.
- **Resultado Observado:** Al caerse el worker, el mensaje vuelve a estar listo en la cola. El nuevo worker lo reclama y culmina el archivo sin pérdida.
- **Evidencia:** Implementación de `channel.ack(msg)` manual exclusivamente después de persistir el CSV y el registro en Postgres.

---

### Escenario 7: Reinicio de RabbitMQ con Trabajos Pendientes
- **Pasos:** Encolar trabajos en `reports_queue` y reiniciar el contenedor de RabbitMQ (`docker restart reports_rabbitmq`).
- **Comportamiento Esperado:** Los mensajes sobreviven al reinicio gracias al volumen persistente `reports_rabbitmq_data` y propiedades `durable: true` y `persistent: true`.
- **Resultado Observado:** Los mensajes permanecen intactos en la cola tras el levantamiento del broker.
- **Evidencia:** Configuración en `docker-compose.yml` y `backend/src/queue/rabbit.js`.

---

### Escenario 8: Error Temporal Simulado
- **Pasos:** Enviar una solicitud con bandera `simulateError: "transient"`.
- **Comportamiento Esperado:** En el intento 1 falla, el worker actualiza el estado a `retrying`, emite a `reports_retry_queue` con TTL de 5s, y tras expirar, el mensaje reingresa y se completa en el intento 2.
- **Resultado Observado:** El worker registra la transición `queued` -> `processing` -> `retrying` -> `completed` con `attempt_count: 2`.
- **Evidencia:** Manejo de reintentos en `backend/src/worker/worker.js` con Dead Letter Routing.

---

### Escenario 9: Error Permanente Repetido
- **Pasos:** Enviar una solicitud con `simulateError: "permanent"`.
- **Comportamiento Esperado:** El reporte falla de forma consecutiva hasta agotar 3 intentos o detectarse como irrecuperable. Se marca `failed` y el mensaje se envía a `reports_dlq`.
- **Resultado Observado:** El reporte queda en PostgreSQL con `status: 'failed'`, el mensaje queda en la cola Dead-Letter para inspección forense y no se reintenta indefinidamente.
- **Evidencia:** Flujo de fallo en `worker.js` con `channel.nack(msg, false, false)` hacia DLQ.

---

### Escenario 10: Solicitud HTTP y Mensaje Duplicado (Idempotencia)
- **Pasos:** Enviar 2 solicitudes `POST /reports` con el mismo encabezado `Idempotency-Key` y mismos parámetros.
- **Comportamiento Esperado:** No se crea un segundo reporte; devuelve el mismo `reportId` con 202. Si un mensaje ya procesado llegase de nuevo al worker, este detecta `status === 'completed'` y descarta/confirma sin sobrescribir el archivo.
- **Resultado Observado:** Mismo `reportId` devuelto por la API. El worker salta atómicamente la ejecución si ya está en estado completado.
- **Evidencia:** Prueba automatizada en `tests/api.test.js` y cláusula de idempotencia en `worker.js`.

---

### Escenario 11: RabbitMQ No Disponible al Enviar
- **Pasos:** Intentar crear un reporte cuando RabbitMQ está caído.
- **Comportamiento Esperado:** La API no pierde la solicitud: la persiste en PostgreSQL en estado `pending`. El script `reconcile-pending.js` publica el trabajo una vez restablecido RabbitMQ.
- **Resultado Observado:** La API guarda el registro con `status = 'pending'`. Al ejecutar el reconciliador, detecta el registro pendiente y lo publica exitosamente a la cola.
- **Evidencia:** Script `backend/scripts/reconcile-pending.js`.

---

### Escenario 12: PostgreSQL No Disponible Durante el Procesamiento
- **Pasos:** Desconectar PostgreSQL mientras el worker genera el reporte.
- **Comportamiento Esperado:** El worker no puede actualizar el estado a `completed` y, por tanto, NO envía ACK a RabbitMQ. El mensaje no se pierde ni se confirma falsamente.
- **Resultado Observado:** Al fallar la actualización en BD, el bloque `catch` del worker emite `nack` con reencolado.
- **Evidencia:** Estricta secuencia en `worker.js`: DB commit -> ACK.
