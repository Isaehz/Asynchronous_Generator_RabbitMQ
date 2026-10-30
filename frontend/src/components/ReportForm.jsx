import React, { useState } from 'react';
import { Play, Sparkles, AlertCircle, RefreshCw } from 'lucide-react';
import { requestReport } from '../api/reports';

export function ReportForm({ onReportCreated }) {
  const [startDate, setStartDate] = useState('2026-01-01');
  const [endDate, setEndDate] = useState('2026-03-31');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [simulateError, setSimulateError] = useState('none');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastResponse, setLastResponse] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setLastResponse(null);

    try {
      const res = await requestReport({
        type: 'sales',
        startDate,
        endDate,
        idempotencyKey: idempotencyKey.trim() || undefined,
        simulateError: simulateError !== 'none' ? simulateError : undefined
      });

      setLastResponse(res);
      if (onReportCreated) onReportCreated(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const generateQuickKey = () => {
    setIdempotencyKey(`DEMO-KEY-${Date.now().toString().slice(-5)}`);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Play className="w-5 h-5 text-indigo-400" />
          Solicitar Nuevo Reporte
        </h2>
        <span className="text-xs bg-indigo-500/10 text-indigo-400 px-2.5 py-1 rounded-full border border-indigo-500/20 font-medium">
          Asíncrono (HTTP 202)
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">
              Fecha Inicial (Inclusive)
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">
              Fecha Final (Inclusive)
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Clave de Idempotencia (Opcional)
            </label>
            <button
              type="button"
              onClick={generateQuickKey}
              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
            >
              <Sparkles className="w-3 h-3" /> Generar clave de prueba
            </button>
          </div>
          <input
            type="text"
            placeholder="Ej: request-sales-001 (para probar deduplicación / 409)"
            value={idempotencyKey}
            onChange={(e) => setIdempotencyKey(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">
            Simulación de Fallos (Para Evaluación y Pruebas)
          </label>
          <select
            value={simulateError}
            onChange={(e) => setSimulateError(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="none">Flujo Normal (Sin errores)</option>
            <option value="transient">Fallo Temporal (Reintento automático)</option>
            <option value="permanent">Fallo Permanente (3 intentos agotados -&gt; DLQ / Failed)</option>
          </select>
        </div>

        {error && (
          <div className="p-3 bg-red-950/50 border border-red-800 text-red-300 rounded-lg text-sm flex items-start gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-400" />
            <div>
              <p className="font-semibold">Error al solicitar reporte:</p>
              <p className="text-xs">{error}</p>
            </div>
          </div>
        )}

        {lastResponse && (
          <div className="p-3 bg-emerald-950/40 border border-emerald-800/80 text-emerald-300 rounded-lg text-sm">
            <p className="font-medium flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Solicitud Aceptada Inmediatamente (HTTP 202)
            </p>
            <div className="text-xs font-mono mt-1 text-slate-300">
              Report ID: <span className="text-emerald-400 font-semibold">{lastResponse.reportId}</span>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition disabled:opacity-50"
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Publicando trabajo en RabbitMQ...
            </>
          ) : (
            'Enviar Trabajo a la Cola'
          )}
        </button>
      </form>
    </div>
  );
}
