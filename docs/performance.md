# Comparativa de Rendimiento: 1 Worker vs. 3 Workers

Medición realizada con una ráfaga idéntica de **20 solicitudes de reportes de ventas** sobre una base de datos con 10,000 registros sintéticos y un retraso artificial configurable en el worker de **5 segundos por reporte** (para emular agregaciones analíticas pesadas).

---

## 1. Tabla Resumen de Métricas

| Métrica | 1 Worker | 3 Workers | Factor de Mejora |
| :--- | :--- | :--- | :--- |
| **Total de Trabajos** | 20 | 20 | - |
| **Trabajos Completados Exitosamente** | 20 (100%) | 20 (100%) | Idéntica fiabilidad |
| **Trabajos Fallidos / Perdidos** | 0 | 0 | 0% pérdidas |
| **Tiempo Total de Vaciado de Cola** | ~103.4 segundos | ~36.8 segundos | **~2.81x más rápido** |
| **Tiempo Promedio de Espera en Cola** | ~48.2 segundos | ~14.6 segundos | **~3.3x menor latencia** |
| **Tiempo Promedio de Procesamiento por Job** | 5.15 segundos | 5.22 segundos | Similar por proceso |

---

## 2. Análisis Técnico: ¿Por qué la mejora no es perfectamente proporcional (3x exacto)?

Si bien triplicar los workers redujo el tiempo total de ~103s a ~37s (acercándose notablemente al ideal teórico de 34s), no es exactamente un multiplicador perfecto de $3.00\times$. Las razones de diseño e infraestructura son:

1. **Concurrencia en la Base de Datos (I/O y Pool Contention):**
   - Con 3 workers ejecutando consultas analíticas simultáneas (`WHERE sale_date BETWEEN ...`), PostgreSQL debe atender lecturas concurrentes y bloqueos de fila (`SELECT ... FOR UPDATE` para el reclamo atómico del reporte).
2. **Latencia de Red y Broker RabbitMQ:**
   - La distribución mediante `channel.prefetch(1)` introduce una leve sincronización de red entre el despacho del mensaje (`delivery`), el acuse de recibo manual (`ack`) y el siguiente despacho.
3. **Contención de Escritura en Disco:**
   - Tres procesos de Node.js escribiendo archivos CSV al mismo sistema de archivos simultáneamente compiten por ancho de banda de E/S de disco.
4. **Ley de Amdahl:**
   - La porción de publicación en la API, validación HTTP y confirmación de broker es compartida y secuencial para la ráfaga de entrada, lo que impone un límite superior al paralelismo.

---

## 3. Conclusión de Diseño

El esquema de colas con RabbitMQ y `prefetch(1)` distribuye el trabajo de forma equitativa y predecible entre múltiples consumidores. Escalar de 1 a 3 workers descongestiona la cola significativamente, manteniendo la integridad transaccional e impidiendo que dos workers procesen el mismo reporte.
