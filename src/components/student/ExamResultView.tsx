import React from 'react';
import { CheckCircle2, Award, ArrowLeft, Calendar, UserCheck, ShieldCheck } from 'lucide-react';
import { User } from '../../types';

interface ExamResultViewProps {
  user: User;
  result: {
    score: number;
    correctCount: number;
    incorrectCount: number;
    unansweredCount: number;
    submittedAt: string;
  };
  onBackToDashboard: () => void;
}

export const ExamResultView: React.FC<ExamResultViewProps> = ({
  user,
  result,
  onBackToDashboard,
}) => {
  const isPassed = result.score >= 75;

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-10 shadow-sm text-center space-y-6">
        {/* Animated Trophy / Checkmark */}
        <div className={`w-20 h-20 rounded-2xl mx-auto flex items-center justify-center border ${
          isPassed
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm'
            : 'bg-amber-50 text-amber-700 border-amber-200 shadow-sm'
        }`}>
          <Award className="w-10 h-10" />
        </div>

        <div>
          <span className="text-xs uppercase font-bold tracking-widest text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
            Hasil Ujian Tervalidasi Server
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-3 tracking-tight">
            Ujian Berhasil Dikumpulkan
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Jawaban Anda telah dinilai oleh server CBT MA Sirajul Huda Marindi
          </p>
        </div>

        {/* Big Score Box */}
        <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200/80 max-w-sm mx-auto space-y-2">
          <span className="text-xs font-semibold text-slate-500 block uppercase tracking-wider">
            Nilai Perolehan
          </span>
          <div className="text-5xl font-black font-mono text-slate-900 tabular-nums">
            {result.score}
          </div>
          <div className="pt-2">
            <span className={`inline-flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full ${
              isPassed
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800'
            }`}>
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{isPassed ? 'Tuntas / Memenuhi KKM (75)' : 'Perlu Perbaikan / Remidial'}</span>
            </span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-3 max-w-md mx-auto text-center text-xs">
          <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100">
            <span className="text-emerald-800 text-[11px] block font-medium">Jawaban Benar</span>
            <span className="text-lg font-bold text-emerald-900 font-mono mt-0.5 block">
              {result.correctCount}
            </span>
          </div>
          <div className="p-3 bg-rose-50/60 rounded-xl border border-rose-100">
            <span className="text-rose-800 text-[11px] block font-medium">Jawaban Salah</span>
            <span className="text-lg font-bold text-rose-900 font-mono mt-0.5 block">
              {result.incorrectCount}
            </span>
          </div>
          <div className="p-3 bg-slate-100 rounded-xl border border-slate-200">
            <span className="text-slate-600 text-[11px] block font-medium">Tidak Dijawab</span>
            <span className="text-lg font-bold text-slate-800 font-mono mt-0.5 block">
              {result.unansweredCount}
            </span>
          </div>
        </div>

        {/* Audit Meta */}
        <div className="text-[11px] text-slate-600 space-y-1 pt-2 border-t border-slate-100">
          <p>
            Nama Siswa: <strong className="text-slate-700">{user.fullName}</strong> ({user.className || 'X MIPA'})
          </p>
          <p>
            Waktu Submit: {new Date(result.submittedAt).toLocaleString('id-ID')}
          </p>
        </div>

        <button
          onClick={onBackToDashboard}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 text-xs sm:text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors shadow-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali ke Beranda Ujian</span>
        </button>
      </div>
    </div>
  );
};
