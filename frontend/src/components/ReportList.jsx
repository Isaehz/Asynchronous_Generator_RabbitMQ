import React from 'react';
import { Download, RefreshCw, CheckCircle2, Clock, AlertTriangle, XCircle } from 'lucide-react';
import { getDownloadUrl } from '../api/reports';

const STATUS_CONFIG = {
  pending: {
    label: 'Pendiente (Registrado)',
    icon: Clock,
    color: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    animate: false
  },
  queued: {
    label: 'En Cola RabbitMQ',
    icon: Clock,
    color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    animate: false
  },
  processing: {
    label: 'Worker Procesando',
    icon: RefreshCw,
    color: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    animate: true
  },
  retrying: {
    label: 'Reintentando (Backoff)',
    icon: AlertTriangle,
    color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    animate: true
  },
  completed: {
    label: 'Completado',
    icon: CheckCircle2,
    color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    animate: false
  },
  failed: {
    label: 'Fallido (DLQ)',
    icon: XCircle,
    color: 'bg-red-500/10 text-red-400 border-red-500/20',
    animate: false
  }
};

export function ReportList({ reports, onRefresh, isPolling }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            Monitor de Reportes y Colas
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Actualización en vivo cada 1.5s para observar el ciclo de vida de los workers.
          </p>
        </div>

        <button
          onClick={onRefresh}
          className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 flex items-center gap-1.5 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isPolling ? 'animate-spin text-indigo-400' : ''}`} />
          Refrescar Ahora
        </button>
      </div>

      {reports.length === 0 ? (
        <div className="text-center py-12 text-slate-500 border border-dashed border-slate-800 rounded-lg">
          No hay reportes solicitados todavía. Genera uno con el formulario de arriba.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/60 text-slate-400 uppercase text-[11px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">ID del Reporte</th>
                <th className="py-3 px-4">Rango</th>
                <th className="py-3 px-4">Estado en Vivo</th>
                <th className="py-3 px-4">Intentos</th>
                <th className="py-3 px-4">Filas</th>
                <th className="py-3 px-4 text-right">Descarga</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {reports.map((report) => {
                const conf = STATUS_CONFIG[report.status] || STATUS_CONFIG.pending;
                const Icon = conf.icon;
                const isCompleted = report.status === 'completed';

                return (
                  <tr key={report.reportId} className="hover:bg-slate-850/40 transition">
                    <td className="py-3 px-4 font-semibold text-slate-200">
                      {report.reportId.slice(0, 8)}...
                      <span className="text-[10px] text-slate-500 ml-1">({new Date(report.createdAt).toLocaleTimeString()})</span>
                    </td>
                    <td className="py-3 px-4 text-slate-300">
                      {report.startDate} <span className="text-slate-500">&rarr;</span> {report.endDate}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-sans font-medium border ${conf.color}`}>
                        <Icon className={`w-3.5 h-3.5 ${conf.animate ? 'animate-spin' : ''}`} />
                        {conf.label}
                      </span>
                      {report.error && (
                        <p className="text-[10px] text-red-400 mt-1 font-sans">{report.error}</p>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      {report.attemptCount} / 3
                    </td>
                    <td className="py-3 px-4 text-slate-300">
                      {report.exportedRows != null ? `${report.exportedRows.toLocaleString()} reg.` : '-'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {isCompleted ? (
                        <a
                          href={getDownloadUrl(report.reportId)}
                          download
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-sans font-medium transition shadow-sm"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Descargar CSV
                        </a>
                      ) : (
                        <span className="text-slate-500 text-[11px] font-sans italic">
                          {report.status === 'failed' ? 'No disponible' : 'Generando...'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
