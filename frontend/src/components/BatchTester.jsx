import React, { useState } from 'react';
import { Layers, FastForward, CheckCircle2 } from 'lucide-react';
import { requestReport } from '../api/reports';

export function BatchTester({ onBatchTriggered }) {
  const [count, setCount] = useState(20);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const triggerBatch = async () => {
    setRunning(true);
    setProgress(0);

    const dates = [
      { start: '2026-01-01', end: '2026-01-31' },
      { start: '2026-02-01', end: '2026-02-28' },
      { start: '2026-03-01', end: '2026-03-31' },
      { start: '2026-04-01', end: '2026-04-30' },
      { start: '2026-05-01', end: '2026-05-31' },
    ];

    try {
      for (let i = 0; i < count; i++) {
        const d = dates[i % dates.length];
        await requestReport({
          type: 'sales',
          startDate: d.start,
          endDate: d.end
        });
        setProgress(i + 1);
      }
      if (onBatchTriggered) onBatchTriggered();
    } catch (e) {
      console.error(e);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Layers className="w-5 h-5 text-purple-400" />
          Generador de Carga Masiva (Pruebas de Concurrencia)
        </h3>
        <span className="text-xs bg-purple-500/10 text-purple-300 px-2 py-0.5 rounded border border-purple-500/20">
          Escenarios 4 y 5
        </span>
      </div>

      <p className="text-xs text-slate-400 mb-4 leading-relaxed">
        Dispara ráfagas de 20 solicitudes concurrentes para contrastar visualmente el tiempo de vaciado de cola y distribución de carga entre <strong>1 worker</strong> frente a <strong>3 workers</strong>.
      </p>

      <div className="flex items-center gap-4">
        <button
          onClick={triggerBatch}
          disabled={running}
          className="bg-purple-600 hover:bg-purple-500 text-white font-medium py-2 px-4 rounded-lg text-sm flex items-center gap-2 transition disabled:opacity-50"
        >
          <FastForward className="w-4 h-4" />
          {running ? `Encolando... (${progress}/${count})` : `Disparar ráfaga de ${count} reportes`}
        </button>

        {progress === count && count > 0 && !running && (
          <span className="text-xs text-emerald-400 flex items-center gap-1 font-medium">
            <CheckCircle2 className="w-4 h-4" /> 20 trabajos encolados en RabbitMQ exitosamente
          </span>
        )}
      </div>
    </div>
  );
}
