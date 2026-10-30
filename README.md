# Asynchronous Report Generator con RabbitMQ

Sistema que genera reportes de ventas en segundo plano usando RabbitMQ como cola de trabajos. La API acepta solicitudes de forma inmediata (HTTP 202), mientras workers independientes procesan el CSV y el usuario puede consultar el progreso y descargar el resultado.

**Stack:** Node.js · Express · React + Vite + Tailwind CSS · PostgreSQL · RabbitMQ · Docker

---

## Prerrequisitos

- [Node.js](https://nodejs.org/) v20+ y npm v10+
- [Docker](https://docs.docker.com/get-docker/) (con acceso al socket sin sudo, o usar `sudo`)

---

## Instalación y arranque rápido

### 1. Clonar el repositorio

```bash
git clone <URL_DEL_REPO>
cd asynchronous-report-generator
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
# Editar .env si cambias puertos o credenciales
```

### 3. Levantar infraestructura (Postgres + RabbitMQ)

```bash
docker network create reports_net

docker run -d --name reports_postgres --network reports_net -p 5432:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=reports_db \
  -v reports_postgres_data:/var/lib/postgresql/data postgres:16-alpine

docker run -d --name reports_rabbitmq --network reports_net -p 5672:5672 -p 15672:15672 \
  -e RABBITMQ_DEFAULT_USER=guest -e RABBITMQ_DEFAULT_PASS=guest \
  -v reports_rabbitmq_data:/var/lib/rabbitmq rabbitmq:3-management-alpine
```

### 4. Instalar dependencias

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 5. Migrar esquema y sembrar datos de ventas (10,000 registros)

```bash
cd backend && npm run seed
```

### 6. Iniciar la API (terminal 1)

```bash
cd backend && node src/api/app.js
# Disponible en: http://localhost:3000
```

### 7. Iniciar un worker (terminal 2)

```bash
cd backend && WORKER_ID=worker-1 WORKER_DELAY_SECONDS=7 node src/worker/worker.js
```

Para escalar a 3 workers, abrir 2 terminales adicionales y ejecutar con IDs distintos:

```bash
WORKER_ID=worker-2 WORKER_DELAY_SECONDS=7 node src/worker/worker.js
WORKER_ID=worker-3 WORKER_DELAY_SECONDS=7 node src/worker/worker.js
```

### 8. Iniciar el frontend (terminal 3)

```bash
cd frontend && npm run dev
# Disponible en: http://localhost:5173
```

---

## Apagar todo

```bash
# Detener contenedores
docker stop reports_rabbitmq reports_postgres
docker rm reports_rabbitmq reports_postgres

# Ctrl+C en cada terminal de Node.js
```

---

## Eliminar datos de prueba / entorno limpio

```bash
# Eliminar volúmenes (borra todos los datos)
docker volume rm reports_postgres_data reports_rabbitmq_data

# Eliminar CSVs generados
rm -f storage/reports/*.csv

# Re-sembrar desde cero
cd backend && npm run seed
```

---

## Ejemplos de uso de la API

### Crear un reporte de ventas

```http
POST http://localhost:3000/reports
Content-Type: application/json
Idempotency-Key: sales-enero-2026

{
  "type": "sales",
  "startDate": "2026-01-01",
  "endDate": "2026-01-31"
}
```

Respuesta inmediata `202 Accepted`:

```json
{
  "reportId": "d3b07384-d113-40b9-8c4d-b6a4b1f41392",
  "status": "pending",
  "statusUrl": "/reports/d3b07384-d113-40b9-8c4d-b6a4b1f41392"
}
```

### Consultar estado

```http
GET http://localhost:3000/reports/d3b07384-d113-40b9-8c4d-b6a4b1f41392
```

### Descargar CSV (solo cuando `status === "completed"`)

```http
GET http://localhost:3000/reports/d3b07384-d113-40b9-8c4d-b6a4b1f41392/download
```

### Simular fallo temporal (para pruebas)

```json
{
  "type": "sales",
  "startDate": "2026-01-01",
  "endDate": "2026-01-31",
  "simulateError": "transient"
}
```

### Simular fallo permanente (para pruebas)

```json
{
  "type": "sales",
  "startDate": "2026-01-01",
  "endDate": "2026-01-31",
  "simulateError": "permanent"
}
```

---

## Ejecutar pruebas automatizadas

```bash
cd backend && npm test
```

Cubre 6 escenarios automáticos: validación de tipo, rango de fechas inválido, respuesta 202 inmediata, idempotencia con mismos parámetros, 409 Conflict con parámetros diferentes, 404 en ID desconocido y 409 en descarga de reporte no completado.

---

## Reconciliar trabajos pendientes (recuperación manual)

Ejecutar cuando RabbitMQ haya estado caído y existan reportes atascados en `pending`:

```bash
cd backend && npm run reconcile
```

---

## RabbitMQ Management UI

Disponible en `http://localhost:15672` con usuario `guest` / contraseña `guest`.

Permite inspeccionar las colas `reports_queue`, `reports_retry_queue` y `reports_dlq` en tiempo real.

---

## Estructura del proyecto

```
.
├── backend/
│   ├── scripts/
│   │   ├── migrate.js          # Crea tablas en Postgres
│   │   ├── seed.js             # Siembra 10,000 ventas sintéticas
│   │   └── reconcile-pending.js
│   ├── src/
│   │   ├── api/
│   │   │   ├── app.js
│   │   │   ├── controllers/reportsController.js
│   │   │   └── routes/reportsRoutes.js
│   │   ├── db/index.js
│   │   ├── logging/logger.js
│   │   ├── queue/rabbit.js
│   │   ├── storage/csvGenerator.js
│   │   └── worker/worker.js
│   └── tests/api.test.js
├── frontend/
│   └── src/
│       ├── App.jsx             # Dashboard principal con métricas en vivo
│       ├── api/reports.js
│       └── components/
│           ├── ReportForm.jsx  # Formulario + simulador de fallos
│           ├── ReportList.jsx  # Tabla de estados en tiempo real
│           └── BatchTester.jsx # Ráfaga de 20 solicitudes para pruebas
├── docs/
│   ├── architecture.md
│   ├── database-and-message-schema.md
│   ├── test-report.md
│   └── performance.md
├── storage/reports/            # CSVs generados (ignorado por Git)
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Solución de problemas

| Problema | Solución |
|---|---|
| `ECONNREFUSED` al iniciar la API | Verificar que el contenedor de Postgres esté corriendo: `docker ps` |
| `connect ECONNREFUSED 5672` en el worker | Verificar que el contenedor de RabbitMQ esté corriendo |
| El worker no procesa mensajes | Revisar que `RABBITMQ_URL` en `.env` apunte al host correcto |
| Puerto 5432 ocupado | Cambiar `POSTGRES_PORT` en `.env` y ajustar el mapeo del contenedor |
| CSV no descargable | El reporte aún no está en estado `completed`, esperar al worker |

---

## Declaración de uso de IA

Este proyecto fue implementado con asistencia de herramientas de IA (Google Antigravity) para generación de código, depuración y estructuración de documentación. Cada integrante del equipo revisó, verificó y puede explicar el código generado, así como reproducir y demostrar todos los escenarios de prueba.

---

## Declaración de contribuciones

> Completar con los nombres e integrantes del equipo y su participación específica en el proyecto.
