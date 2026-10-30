import React, { useState, useEffect } from 'react';
import { Database, Cpu, Activity, RefreshCw } from 'lucide-react';
import { ReportForm } from './components/ReportForm';
import { ReportList } from './components/ReportList';
import { BatchTester } from './components/BatchTester';
import { fetchReports } from './api/reports';

export function App() {
  const [reports, setReports] = useState([]);
  const [isPolling, setIsPolling] = useState(false);

  const loadReports = async () => {
    try {
      setIsPolling(true);
      const data = await fetchReports();
      setReports(data);
    } catch (err) {
      console.error('Error fetching reports:', err);
    } finally {
      setIsPolling(false);
    }
  };

  useEffect(() => {
    loadReports();
    // Live polling every 2 seconds for real-time demonstration
    const interval = setInterval(loadReports, 2000);
    return () => clearInterval(interval);
  }, []);

  const totalCompleted = reports.filter((r) => r.status === 'completed').length;
  const totalProcessing = reports.filter((r) => r.status === 'processing').length;
  const totalQueued = reports.filter((r) => r.status === 'queued' || r.status === 'pending').length;
  const totalFailed = reports.filter((r) => r.status === 'failed').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <header className="border-b border-slate-800 pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="p-2 bg-indigo-600/20 text-indigo-400 rounded-lg border border-indigo-500/30">
                <Activity className="w-6 h-6" />
              </span>
              <div>
                <h1 className="text-2xl font-black text-white tracking-tight">
                  Generador Asíncrono de Reportes
                </h1>
                <p className="text-sm text-slate-400">
                  RabbitMQ Work Queue + PostgreSQL + Workers Node.js Independientes
                </p>
              </div>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="flex items-center gap-3">
            <div className="bg-slate-900 border border-slate-800 px-3.5 py-2 rounded-xl text-center">
              <span className="block text-[11px] uppercase tracking-wider text-slate-500 font-semibold">En Cola</span>
              <span className="text-lg font-mono font-bold text-blue-400">{totalQueued}</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 px-3.5 py-2 rounded-xl text-center">
              <span className="block text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Procesando</span>
              <span className="text-lg font-mono font-bold text-indigo-400">{totalProcessing}</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 px-3.5 py-2 rounded-xl text-center">
              <span className="block text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Completados</span>
              <span className="text-lg font-mono font-bold text-emerald-400">{totalCompleted}</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 px-3.5 py-2 rounded-xl text-center">
              <span className="block text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Fallidos</span>
              <span className="text-lg font-mono font-bold text-red-400">{totalFailed}</span>
            </div>
          </div>
        </header>

        {/* Main Grid: Form + Batch Tester */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <ReportForm onReportCreated={loadReports} />
          </div>
          <div className="lg:col-span-1">
            <BatchTester onBatchTriggered={loadReports} />
          </div>
        </div>

        {/* Live List */}
        <ReportList reports={reports} onRefresh={loadReports} isPolling={isPolling} />

        {/* Architecture details footer */}
        <footer className="text-xs text-slate-500 text-center pt-6 border-t border-slate-900 flex flex-wrap items-center justify-center gap-6">
          <span className="flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-slate-400" /> PostgreSQL: &gt;10,000 ventas sintéticas
          </span>
          <span className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-slate-400" /> RabbitMQ: Mensajes persistentes & manual ACKs
          </span>
          <span>Docker Compose: Entorno reproducible y escalable</span>
        </footer>
      </div>
    </div>
  );
}

export default App;
