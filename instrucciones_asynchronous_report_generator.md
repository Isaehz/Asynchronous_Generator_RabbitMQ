# Asynchronous Report Generator with RabbitMQ
## Instrucciones del profesor y plan de implementación

> **Objetivo del documento:** permitir que otro agente de IA o desarrollador implemente el proyecto de forma autónoma, siguiendo los requisitos de la consigna y el stack elegido.
>
> **Stack elegido:** Node.js + Express para API y workers; React + Vite + Tailwind CSS para el frontend; PostgreSQL; RabbitMQ; Docker Compose.
>
> **Importante:** los requisitos de la sección “Consigna del profesor” proceden de la tarea original. Las decisiones técnicas de implementación se indican como recomendaciones y no sustituyen los requisitos del profesor.

---

## 1. Objetivo del proyecto

Diseñar e implementar un sistema que genere reportes de ventas en segundo plano usando RabbitMQ. La API debe aceptar una solicitud de reporte inmediatamente, mientras un worker independiente genera el archivo. El usuario debe poder consultar el progreso y descargar el reporte cuando termine.

La evaluación cubre tanto el funcionamiento normal como la recuperación ante fallos.

### Flujo principal

1. El usuario solicita un reporte de ventas desde la interfaz web.
2. La API valida la solicitud, crea un ID de reporte y registra el trabajo.
3. La API publica un mensaje en RabbitMQ y responde `202 Accepted` sin esperar a que se genere el archivo.
4. Un worker independiente consume el mensaje y procesa el reporte.
5. El worker consulta las ventas en PostgreSQL, genera un CSV y guarda el archivo.
6. El sistema registra el resultado y el estado final en PostgreSQL.
7. El usuario consulta el estado y descarga el CSV cuando está listo.

## 2. Stack y arquitectura

### Tecnologías obligatorias o elegidas

- **Node.js + Express:** API HTTP.
- **Node.js worker separado:** consumidor de mensajes y generador de CSV.
- **React + Vite:** aplicación frontend.
- **Tailwind CSS:** estilos de la interfaz.
- **RabbitMQ:** cola de trabajos.
- **PostgreSQL:** datos sintéticos de ventas y ciclo de vida de reportes.
- **Almacenamiento de archivos:** CSV completados.
- **RabbitMQ Management UI:** inspección de colas y consumidores.
- **Docker Compose:** forma recomendada de levantar servicios reproducibles.

La consigna exige RabbitMQ, una API, workers en procesos o contenedores separados, base de datos, almacenamiento de archivos y la interfaz de administración de RabbitMQ. React, Vite, Tailwind y Docker Compose son elecciones del proyecto.

### Arquitectura propuesta

```text
React + Vite + Tailwind
          |
          | HTTP
          v
     Express API --------------------> PostgreSQL
          |
          | publica trabajo
          v
       RabbitMQ <------------------ Workers Node.js
          |                              |
          | cola durable                 | consultan ventas
          |                              | generan CSV
          +------------------------------+------> almacenamiento CSV
```

- La API y los workers deben ser procesos separados.
- Todos los workers deben consumir de la misma cola de procesamiento de reportes para compartir el trabajo.
- PostgreSQL conserva los datos duraderos y el estado del reporte.
- RabbitMQ conserva y distribuye mensajes pendientes.
- El CSV solo debe estar disponible para descarga cuando esté completo.

## 3. Requisitos de la consigna del profesor

### 3.1 Dataset y CSV

Crear un script reproducible de seed que genere **al menos 10,000 ventas sintéticas**. Cada venta debe incluir:

- ID de venta.
- Fecha de venta.
- Nombre del cliente.
- Nombre del producto.
- Cantidad.
- Precio unitario.
- Importe total.

El reporte debe:

- Aceptar fecha inicial y fecha final.
- Incluir ambas fechas límite.
- Exportar todos los campos requeridos con una fila de encabezados.
- Mantener un orden consistente, por ejemplo, fecha de venta y luego ID.
- Generar un CSV válido con solo encabezados si no existen coincidencias.
- Escapar correctamente comas y comillas en los valores.
- Tener un retraso configurable de **5 a 15 segundos** para las demostraciones. El retraso debe ocurrir en el worker, nunca bloquear la API.

### 3.2 API HTTP

#### `POST /reports`

Aceptar el tipo de reporte y el rango de fechas. Admitir la cabecera `Idempotency-Key`.

Para una solicitud válida:

- Crear un registro de reporte.
- Organizar la publicación del trabajo.
- Responder con HTTP `202 Accepted`.
- Incluir el ID del reporte y la URL para consultar el estado.
- No esperar a que finalice la generación del CSV.

Idempotencia:

- La misma clave con los mismos parámetros debe devolver el ID del reporte existente.
- La misma clave con parámetros diferentes debe responder `409 Conflict`.

Validación:

- Rechazar fechas inválidas.
- Rechazar rangos inválidos.
- Rechazar tipos de reporte no admitidos.
- No encolar solicitudes inválidas.

#### `GET /reports/{report_id}`

Devolver:

- ID del reporte.
- Estado actual.
- Fecha y hora de creación y última actualización.
- Número de intentos de procesamiento.
- Número de filas exportadas, si está disponible.
- URL de descarga, cuando esté listo.
- Descripción segura del error, si falló.

Un ID desconocido debe responder `404`.

#### `GET /reports/{report_id}/download`

- Descargar el CSV como archivo adjunto si el reporte terminó correctamente.
- Responder `409` si el reporte existe pero aún no está listo.
- Responder `404` si el ID no existe.
- Nunca aceptar una ruta arbitraria del sistema de archivos enviada por el cliente.

### 3.3 Estados del reporte

Persistir el ciclo de vida en PostgreSQL; los logs no sustituyen los registros de estado.

- `pending`: solicitud aceptada, pero publicación aún no confirmada.
- `queued`: mensaje publicado y esperando procesamiento.
- `processing`: un worker ha reclamado el reporte.
- `retrying`: ocurrió un error temporal y se planificó otro intento.
- `completed`: el CSV está disponible.
- `failed`: el procesamiento no puede continuar.

No permitir que una actualización retrasada cambie un reporte `completed` a un estado anterior.

### 3.4 RabbitMQ, durabilidad y publicación

- Usar colas durables.
- Publicar mensajes persistentes.
- Mantener un volumen persistente de RabbitMQ.
- Habilitar publisher confirms.
- Detectar y gestionar mensajes no enrutables.
- Si falla la publicación, no perder silenciosamente la solicitud: conservar un registro `pending` recuperable.
- Proporcionar un comando o proceso de reconciliación documentado para volver a publicar trabajos pendientes.

### 3.5 Acknowledgments y recuperación

- Usar acknowledgments manuales del consumidor.
- Confirmar un mensaje exitoso solo después de guardar el archivo final y el resultado en la base de datos.
- Si el worker se detiene antes del acknowledgment, otro worker debe poder recuperar el trabajo.
- Documentar cómo se detectan y recuperan reportes abandonados en `processing`.

### 3.6 Reintentos y errores

- Diferenciar fallos temporales de permanentes.
- Máximo de **tres intentos en total**, incluido el inicial.
- Aplicar un retraso o backoff documentado entre reintentos.
- Evitar ciclos de reencolado inmediato e infinito.
- Persistir la decisión de reintentar antes de confirmar el mensaje actual.
- Al agotar los intentos, marcar el reporte `failed` y publicar un mensaje de fallo en una cola de inspección o dead-letter queue (DLQ).

### 3.7 Duplicados e idempotencia

- Probar el envío repetido del mismo mensaje.
- Mantener un solo resultado lógico, un único archivo canónico descargable y un estado consistente en la base de datos.
- Usar restricciones de base de datos u operaciones atómicas; no depender solo de un `Set` en memoria.
- No permitir descargar archivos temporales.
- Publicar el artefacto final solo cuando esté completo.

### 3.8 Pruebas obligatorias

Para cada escenario, documentar **pasos, comportamiento esperado, resultado observado y evidencia**.

1. Solicitud válida: la API responde antes de terminar el CSV y el contenido es correcto.
2. Rango de fechas inválido: se rechaza y no se publica trabajo.
3. Sin ventas coincidentes: CSV con encabezados y cero filas de datos.
4. 20 solicitudes con un worker: todos los trabajos avanzan y terminan.
5. El mismo conjunto con tres workers: trabajo distribuido y ningún reporte perdido.
6. Worker detenido durante el procesamiento: recuperación tras iniciar otro worker.
7. Reinicio de RabbitMQ con trabajos pendientes: los mensajes sobreviven con el volumen intacto.
8. Error temporal simulado: el trabajo se reintenta y termina correctamente dentro de tres intentos.
9. Error permanente repetido: termina en `failed` y queda disponible para inspección.
10. Solicitud HTTP duplicada y mensaje duplicado: no se crea un resultado lógico duplicado.
11. RabbitMQ no disponible al enviar: no hay pérdida silenciosa; se puede reconciliar la publicación.
12. PostgreSQL no disponible durante el procesamiento: el worker no confirma falsamente el éxito.

Incluir una forma exclusiva para pruebas de activar fallos y documentarla claramente.

### 3.9 Logs y mediciones

Usar logs estructurados que incluyan:

- ID del reporte.
- Identificador del worker.
- Número de intento.
- Marca de tiempo.
- Acción o estado.
- Categoría del error, si aplica.

No registrar credenciales.

Medir el mismo conjunto de **20 trabajos** con uno y tres workers:

- Tiempo total de finalización.
- Tiempo promedio de espera en cola.
- Tiempo promedio de procesamiento.
- Número de trabajos completados y fallidos.

Explicar los resultados y por qué más workers no necesariamente multiplican el rendimiento de forma perfectamente proporcional.

## 4. Entregables

La entrega debe incluir:

1. Enlace al repositorio accesible para el profesor.
2. `README.md` con prerrequisitos, comandos de instalación, seed, ejemplos de API, pruebas y solución de problemas.
3. Diagrama de arquitectura con API, broker, colas, workers, base de datos y almacenamiento.
4. Modelo de base de datos y esquema del mensaje.
5. Informe de pruebas con todos los escenarios requeridos.
6. Comparación de rendimiento entre uno y tres workers.
7. Video de demostración de **5 a 8 minutos** que muestre operación normal, workers en paralelo, recuperación y manejo de duplicados.
8. Declaración de contribución de cada integrante.
9. Archivo `.env.example` con valores de ejemplo, nunca secretos reales.
10. Instrucciones en README para iniciar un entorno limpio y eliminar datos de prueba.

### Preguntas de diseño que deben contestarse en el informe

1. ¿Por qué es apropiado el procesamiento asíncrono?
2. ¿Qué guarda RabbitMQ y qué corresponde a PostgreSQL?
3. ¿En qué se diferencian publisher confirms y consumer acknowledgments?
4. ¿Qué pasa si el worker genera el archivo y se cae antes de confirmar el mensaje?
5. ¿Se pueden procesar mensajes más de una vez?
6. ¿FIFO garantiza el orden de finalización con varios workers?
7. ¿Cómo evitar que dos workers corrompan el mismo reporte?
8. ¿Qué pasa si llegan solicitudes más rápido de lo que los workers pueden procesarlas?
9. ¿Qué ventanas de fallo quedan en la implementación?
10. ¿Cómo evolucionaría el diseño para trabajar en varias máquinas?

## 5. Plan de implementación para el agente

Implementar en el orden siguiente. Mantener la aplicación ejecutable al final de cada etapa y actualizar el README conforme se agreguen funciones.

### Etapa 1 — Inspección y estructura

1. Revisar los archivos existentes antes de modificarlos.
2. Crear una estructura modular y clara.
3. Fijar versiones compatibles de dependencias y documentarlas.
4. Preparar `.env.example`, `.gitignore` y configuración de Docker Compose.
5. Definir los contratos de API, los estados y el esquema de mensajes antes de implementar el flujo completo.

Estructura sugerida (se puede ajustar si el repositorio ya tiene una estructura útil):

```text
asynchronous-report-generator/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── api/
│   │   └── App.jsx
│   ├── package.json
│   └── vite.config.js
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   ├── controllers/
│   │   │   └── middleware/
│   │   ├── db/
│   │   ├── queue/
│   │   ├── worker/
│   │   ├── reports/
│   │   ├── storage/
│   │   ├── logging/
│   │   └── app.js
│   ├── scripts/
│   │   ├── seed.js
│   │   └── reconcile-pending.js
│   ├── tests/
│   └── package.json
├── storage/
│   └── reports/          # artefactos locales; ignorados por Git
├── docs/
│   ├── architecture.md
│   ├── database-and-message-schema.md
│   ├── test-report.md
│   └── performance.md
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

### Etapa 2 — Base de datos y datos sintéticos

1. Definir tablas para ventas y reportes.
2. Agregar restricciones e índices necesarios, incluyendo unicidad de la clave de idempotencia dentro de su ámbito.
3. Crear migraciones o un método reproducible para inicializar el esquema.
4. Crear `seed.js` que genere al menos 10,000 ventas sintéticas reproducibles.
5. Verificar fechas, importes y totales.
6. Definir la estrategia para reclamar reportes, recuperar trabajos abandonados y evitar que workers concurrentes procesen el mismo resultado de forma inconsistente.

### Etapa 3 — API mínima

1. Crear Express y middleware de validación, manejo de errores y logs.
2. Implementar `POST /reports`, `GET /reports/:report_id` y `GET /reports/:report_id/download`.
3. Implementar validación estricta de fechas y tipo de reporte.
4. Implementar idempotencia HTTP con `Idempotency-Key`.
5. Definir una estrategia recuperable entre registro en PostgreSQL y publicación en RabbitMQ. Para la versión base, un registro `pending` más un reconciliador documentado es aceptable según la consigna.
6. Probar las respuestas HTTP y el comportamiento de solicitudes duplicadas.

### Etapa 4 — RabbitMQ y worker

1. Configurar RabbitMQ con consola de administración, credenciales por variables de entorno y volumen persistente.
2. Crear una cola durable y un esquema de mensaje versionado que incluya, al menos, `reportId`.
3. Publicar mensajes persistentes y esperar publisher confirms; gestionar mensajes no enrutables.
4. Crear un proceso worker separado de la API.
5. Configurar acknowledgments manuales.
6. Reclamar atómicamente el reporte antes de procesarlo.
7. Generar CSV válido, con orden estable, encabezados, escaping correcto y tratamiento del resultado vacío.
8. Guardar el archivo con nombre interno controlado; evitar que se expongan archivos parciales.
9. Persistir el resultado antes de confirmar el mensaje.
10. Añadir retraso configurable de 5–15 segundos en el worker.

### Etapa 5 — Recuperación, reintentos y duplicados

1. Diseñar el ciclo de estados con transiciones seguras.
2. Implementar la recuperación de mensajes no confirmados y de reportes abandonados.
3. Implementar un máximo de tres intentos totales y backoff.
4. Persistir la decisión de reintento antes de confirmar el mensaje original.
5. Enviar fallos agotados a una cola de inspección o DLQ y marcar el reporte como `failed`.
6. Hacer idempotente la escritura del resultado, con protección transaccional o restricciones en PostgreSQL.
7. Garantizar un único archivo canónico por reporte y no servir temporales.
8. Agregar activadores de fallo solo para pruebas, claramente aislados y documentados.

**Importante:** RabbitMQ proporciona entrega que puede repetirse. No afirmar “exactly once”. El objetivo es procesar de forma segura ante duplicados y producir un único resultado lógico mediante operaciones idempotentes y restricciones duraderas.

### Etapa 6 — Frontend React + Vite + Tailwind

Crear una interfaz clara y utilizable que permita:

- Elegir fecha inicial y final.
- Solicitar un reporte.
- Mostrar confirmación e ID del reporte.
- Ver una lista de reportes y sus estados.
- Actualizar el estado periódicamente mientras esté pendiente o procesándose.
- Mostrar intentos, fechas y errores seguros.
- Habilitar descarga únicamente cuando el estado sea `completed`.
- Mostrar estados de carga, errores de red y respuestas `404`/`409`.
- No mostrar rutas internas del sistema de archivos.

La interfaz es un requisito explícito del profesor. No basta con una API que funcione mediante Postman.

### Etapa 7 — Docker Compose y reproducibilidad

1. Configurar servicios para frontend, API, uno o más workers, PostgreSQL y RabbitMQ.
2. Persistir los volúmenes de PostgreSQL, RabbitMQ y, cuando corresponda, los CSV.
3. Asegurar que la API y los workers esperen la disponibilidad de sus dependencias y manejen reconexiones.
4. Permitir escalar workers sin duplicar servicios que deban ser únicos.
5. Documentar los comandos para levantar, inicializar, probar, escalar y limpiar el entorno.
6. Verificar el arranque en un entorno limpio siguiendo únicamente el README.

### Etapa 8 — Pruebas y rendimiento

1. Automatizar pruebas unitarias e integración donde sea razonable.
2. Ejecutar manual o automáticamente los 12 escenarios obligatorios de la sección 3.8.
3. Guardar evidencia de pasos, resultados esperados y observados.
4. Ejecutar el conjunto de 20 trabajos con un worker.
5. Repetirlo con tres workers.
6. Registrar las métricas requeridas y explicar diferencias, limitaciones y fallos.
7. Verificar que no haya mensajes perdidos, archivos parciales descargables ni resultados duplicados.

### Etapa 9 — Documentación y demostración

Completar los documentos de `docs/`, el README y las respuestas a las diez preguntas de diseño. Preparar una secuencia de demostración de 5–8 minutos que incluya:

1. Solicitud y descarga normal.
2. Procesamiento en segundo plano.
3. Trabajo distribuido entre tres workers.
4. Recuperación después de detener un worker.
5. Reintentos y fallo permanente.
6. Manejo de duplicados.
7. Comparación de métricas con uno y tres workers.

No afirmar que una prueba pasó si no se ejecutó y verificó. Separar claramente resultados observados de expectativas.

## 6. Contratos iniciales sugeridos

### Solicitud de ejemplo

`POST /reports`

Cabeceras:

```http
Content-Type: application/json
Idempotency-Key: sales-2026-001
```

Cuerpo:

```json
{
  "type": "sales",
  "startDate": "2026-01-01",
  "endDate": "2026-01-31"
}
```

Respuesta esperada para una solicitud válida:

```json
{
  "reportId": "UUID",
  "status": "pending",
  "statusUrl": "/reports/UUID"
}
```

La respuesta debe usar el código HTTP `202`. El valor real de `reportId` debe generarse en tiempo de ejecución.

### Mensaje de RabbitMQ sugerido

```json
{
  "schemaVersion": 1,
  "reportId": "UUID",
  "type": "sales",
  "startDate": "2026-01-01",
  "endDate": "2026-01-31"
}
```

El mensaje debe ser pequeño y contener referencias al trabajo, no miles de registros ni el CSV completo.

### Estado de ejemplo

```json
{
  "reportId": "UUID",
  "status": "completed",
  "createdAt": "2026-01-01T12:00:00.000Z",
  "updatedAt": "2026-01-01T12:00:08.000Z",
  "attemptCount": 1,
  "exportedRows": 125,
  "downloadUrl": "/reports/UUID/download",
  "error": null
}
```

Los ejemplos anteriores son contratos propuestos; deben ajustarse a la implementación real sin omitir campos exigidos por el profesor.

## 7. Decisiones técnicas que el agente debe resolver y documentar

- Elegir una biblioteca de acceso a PostgreSQL y documentar la versión fijada.
- Elegir una biblioteca de RabbitMQ para Node.js y fijar la versión.
- Elegir una biblioteca fiable para generar CSV con escaping correcto.
- Elegir migraciones o inicialización de esquema reproducible.
- Definir el ámbito y la persistencia de `Idempotency-Key`.
- Definir las transiciones válidas de estado y el mecanismo de recuperación de trabajos abandonados.
- Definir la cola de reintentos con demora y la DLQ/cola de inspección.
- Definir almacenamiento local persistente para CSV en el entorno Docker.
- Definir cómo coordinar la escritura del archivo y el estado de PostgreSQL frente a caídas.
- Definir logs estructurados y medición de tiempos.
- Definir una estrategia de pruebas de concurrencia y fallos.

No implementar garantías imposibles solo con una promesa o un log. Documentar las ventanas de fallo restantes y cómo se mitigan.

## 8. Criterios de aceptación

El proyecto no se considera completo hasta que:

- [ ] Existen al menos 10,000 ventas sintéticas reproducibles.
- [ ] El frontend React/Vite/Tailwind funciona.
- [ ] La API responde `202` sin esperar la generación del CSV.
- [ ] La API implementa los tres endpoints y los códigos HTTP requeridos.
- [ ] RabbitMQ usa mensajes persistentes, colas durables, publisher confirms y gestión de mensajes no enrutables.
- [ ] Los workers son procesos separados y comparten la cola.
- [ ] Los acknowledgments son manuales.
- [ ] Los estados y resultados se persisten en PostgreSQL.
- [ ] Los CSV son correctos, ordenados, escapados y descargables solo al completarse.
- [ ] Se respetan los tres intentos máximos y existe DLQ/cola de inspección.
- [ ] Los trabajos abandonados pueden recuperarse.
- [ ] Las solicitudes y mensajes duplicados no generan resultados lógicos duplicados.
- [ ] Se ejecutan y documentan los 12 escenarios obligatorios.
- [ ] Se compara el rendimiento de uno y tres workers.
- [ ] Se completan README, diagrama, esquema, informe de pruebas, video y contribuciones.
- [ ] `.env.example` no contiene secretos reales y el entorno puede reconstruirse desde cero.

## 9. Alcance y prioridades

Primero cumplir todos los requisitos obligatorios. Las extensiones opcionales del profesor son:

- Transactional outbox y publicador automático.
- Reportes programados.
- Cancelación y expiración.
- Actualizaciones de progreso.
- Colas separadas por duración.
- Almacenamiento de objetos en lugar de volumen compartido.
- Autenticación y acceso por usuario.

No priorizar extensiones opcionales antes de terminar y verificar las pruebas obligatorias.

## 10. Uso de IA

La consigna permite usar herramientas de IA para explicación, depuración e implementación. Debe incluirse una declaración breve de dónde se utilizó IA y cómo se verificó el resultado. Cada integrante debe poder explicar el código y demostrar los escenarios de fallo.

**Instrucción final para el agente:** trabaja incrementalmente, inspecciona el repositorio antes de cambiar archivos, conserva las decisiones documentadas, ejecuta pruebas reales y reporta qué se implementó, qué comandos se ejecutaron, qué pasó y qué queda pendiente. No inventes resultados de pruebas ni afirmes cumplimiento sin evidencia.
