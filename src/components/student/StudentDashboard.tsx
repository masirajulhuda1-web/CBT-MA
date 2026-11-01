import React, { useState, useEffect } from 'react';
import { User, Exam } from '../../types';
import { apiService } from '../../services/apiService';
import {
  Clock,
  BookOpen,
  AlertTriangle,
  Play,
  CheckCircle,
  Award,
  KeyRound,
  ShieldAlert,
  Sparkles,
  Calendar,
  Lock,
  RefreshCw,
} from 'lucide-react';
import { formatIndoDate, formatIndoTime, getExamScheduleStatus } from '../../utils/dateUtils';

interface StudentDashboardProps {
  user: User;
  onStartExam: (examId: string, token: string) => void;
  onViewResult: (resultId: string) => void;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  user,
  onStartExam,
  onViewResult,
}) => {
  const [exams, setExams] = useState<(Exam & { isWithinWindow: boolean; studentAttempt: { id?: string; status: string; totalScore?: number } })[]>(
    () => apiService.getCachedAvailableExams(user)
  );
  const [loading, setLoading] = useState(() => apiService.getCachedAvailableExams(user).length === 0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(() => new Date());
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const cached = apiService.getCachedAvailableExams(user);
    if (cached.length > 0) {
      setExams(cached);
      setLoading(false);
    }
    loadExams(false);
    const clock = setInterval(() => setCurrentTime(new Date()), 1000);
    const syncTimer = setInterval(async () => {
      try {
        const res = await apiService.getAvailableExams();
        if (res.success && res.exams) {
          setExams(res.exams);
          setLastRefreshedAt(new Date());
        }
      } catch {
        // ignore background poll error
      }
    }, 10000);
    return () => {
      clearInterval(clock);
      clearInterval(syncTimer);
    };
  }, [user]);

  const loadExams = async (isManualRefresh = true) => {
    if (isManualRefresh) {
      setIsRefreshing(true);
    } else if (exams.length === 0) {
      setLoading(true);
    }
    try {
      if (isManualRefresh) {
        await apiService.syncWithServer(true);
      }
      const res = await apiService.getAvailableExams();
      if (res.success && res.exams) {
        setExams(res.exams);
      }
      setCurrentTime(new Date());
      setLastRefreshedAt(new Date());
    } catch (err) {
      console.error('Gagal memuat jadwal ujian:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleOpenTokenModal = (exam: Exam) => {
    setSelectedExam(exam);
    setTokenInput(exam.token || ''); // prefill default token for smooth demo/testing
    setTokenError(null);
  };

  const handleConfirmStart = async () => {
    if (!selectedExam) return;
    if (selectedExam.token && !tokenInput.trim()) {
      setTokenError('Token ujian wajib diisi.');
      return;
    }

    setStarting(true);
    setTokenError(null);

    try {
      onStartExam(selectedExam.id, tokenInput.trim());
    } catch (err) {
      setTokenError((err as Error).message || 'Gagal memulai ujian.');
      setStarting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Student Welcome Header Card */}
      <div className="bg-gradient-to-r from-emerald-800 to-teal-900 rounded-2xl p-6 sm:p-8 text-white shadow-sm border border-emerald-700/50">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/10 text-emerald-200 text-xs font-semibold mb-1">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Tahun Ajaran 2026/2027 &middot; Semester Ganjil</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              Ahlan wa Sahlan, {user.fullName}
            </h1>
            <p className="text-emerald-100/90 text-xs sm:text-sm">
              Kelas: <span className="font-semibold text-white">{user.className || 'Kelas X MIPA'}</span> &middot; MA Sirajul Huda Marindi
            </p>
          </div>

          <div className="flex flex-col sm:items-end gap-2 shrink-0">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-2 border border-white/10 text-right sm:text-right">
              <span className="text-[11px] uppercase tracking-wider text-emerald-200 block">Waktu Server Saat Ini</span>
              <span className="text-sm font-bold text-white flex items-center justify-end gap-1.5 font-mono">
                <Clock className="w-3.5 h-3.5 text-emerald-300" />
                <span>{currentTime.toLocaleTimeString('id-ID')} WIB</span>
              </span>
              <span className="text-[10px] text-emerald-100/80 block mt-0.5">
                {formatIndoDate(currentTime)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Rules & Anti-Cheating Notice */}
      <div className="bg-amber-50/90 border border-amber-200/80 rounded-xl p-4 sm:p-5 text-amber-950 text-xs sm:text-sm">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="font-bold text-amber-900">
              Tata Tertib & Pengawasan Ketat Ujian CBT
            </h3>
            <ul className="list-disc list-inside space-y-1 text-amber-800 text-xs sm:text-xs">
              <li>Dilarang membuka tab browser lain, aplikasi chat, atau meminimalisir jendela browser.</li>
              <li>Sistem dilengkapi <strong>sensor suara alarm</strong> yang akan berbunyi keras jika Anda beralih layar.</li>
              <li>Teks soal dan pilihan jawaban diproteksi dari penyalinan (copy-paste).</li>
              <li>Ujian <strong>otomatis aktif</strong> pada tanggal dan rentang jam pelaksanaan yang tertera pada kartu jadwal masing-masing.</li>
              <li>Timer ujian dikendalikan secara mutlak oleh server. Pastikan menyelesaikan ujian tepat waktu.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Available Exams Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              Jadwal Ujian Tersedia
            </h2>
            <p className="text-xs text-slate-500">
              Sistem akan mengaktifkan tombol ujian secara otomatis saat tanggal dan jam pelaksanaan tiba
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              Diperbarui: <strong className="text-slate-700 font-mono">{lastRefreshedAt.toLocaleTimeString('id-ID')}</strong>
            </span>
            <button
              onClick={() => loadExams(true)}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'Menyegarkan...' : 'Segarkan Status'}</span>
            </button>
          </div>
        </div>

        {loading && exams.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2].map((n) => (
              <div key={n} className="bg-white p-6 rounded-xl border border-slate-200 animate-pulse space-y-3">
                <div className="h-4 bg-slate-200 rounded w-1/3"></div>
                <div className="h-6 bg-slate-200 rounded w-3/4"></div>
                <div className="h-4 bg-slate-100 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        ) : exams.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-2">
            <BookOpen className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="text-sm font-semibold text-slate-700">
              Tidak Ada Ujian Aktif Saat Ini
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Belum ada jadwal ujian semester yang dibuka untuk kelas Anda. Silakan hubungi proktor atau guru mata pelajaran.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {exams.map((exam) => {
              const attempt = exam.studentAttempt;
              const isFinished = attempt && (attempt.status === 'submitted' || attempt.status === 'timed_out');
              const isInProgress = attempt && attempt.status === 'in_progress';
              const schedule = getExamScheduleStatus(exam);

              return (
                <div
                  key={exam.id}
                  className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-100">
                        {exam.subjectName || 'Mata Pelajaran'}
                      </span>
                      {isFinished ? (
                        <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Selesai</span>
                        </span>
                      ) : isInProgress ? (
                        <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 animate-spin text-amber-600" />
                          <span>Sedang Dikerjakan</span>
                        </span>
                      ) : (
                        <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full border ${schedule.badgeClass}`}>
                          {schedule.status === 'active' && (
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          )}
                          <span>{schedule.label}</span>
                        </span>
                      )}
                    </div>

                    <div>
                      <h3 className="text-base font-bold text-slate-900 leading-snug">
                        {exam.title}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Sasaran: {exam.className || 'Seluruh Kelas'}
                      </p>
                    </div>

                    {/* Date and Time Schedule Strip */}
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between text-slate-700">
                        <div className="flex items-center gap-1.5 font-medium">
                          <Calendar className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Tanggal Ujian:</span>
                        </div>
                        <span className="font-bold text-slate-900">
                          {formatIndoDate(schedule.examDate)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-700">
                        <div className="flex items-center gap-1.5 font-medium">
                          <Clock className="w-3.5 h-3.5 text-blue-700" />
                          <span>Jam Pelaksanaan:</span>
                        </div>
                        <span className="font-semibold text-slate-800 font-mono text-[11px]">
                          {`${schedule.startTime} - ${schedule.endTime} WIB`}
                        </span>
                      </div>
                      <div className="pt-1 border-t border-slate-200/60 text-[11px]">
                        <span className={schedule.status === 'active' ? 'font-semibold text-emerald-700' : 'text-slate-500'}>
                          {schedule.details}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                      <div>
                        <span className="text-slate-500 text-[11px] block">Durasi</span>
                        <span className="font-semibold text-slate-800">{exam.durationMinutes} Menit</span>
                      </div>
                      <div>
                        <span className="text-slate-500 text-[11px] block">Soal</span>
                        <span className="font-semibold text-slate-800">{exam.totalQuestions} Butir PG</span>
                      </div>
                      <div>
                        <span className="text-slate-500 text-[11px] block">KKM</span>
                        <span className="font-semibold text-slate-800">{exam.passingScore}</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                    {isFinished ? (
                      <div className="flex items-center justify-between w-full">
                        <div className="text-xs">
                          <span className="text-slate-500">Nilai Akhir: </span>
                          <span className="font-bold text-slate-900 font-mono text-sm">
                            {attempt.totalScore ?? '-'}
                          </span>
                        </div>
                        <button
                          onClick={() => attempt.id && onViewResult(attempt.id)}
                          className="px-3.5 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer"
                        >
                          Lihat Rincian
                        </button>
                      </div>
                    ) : isInProgress ? (
                      <button
                        onClick={() => handleOpenTokenModal(exam)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition-colors cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Lanjutkan Ujian (Sesi Aktif)</span>
                      </button>
                    ) : schedule.status === 'upcoming' ? (
                      <button
                        disabled
                        title={schedule.details}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-semibold text-slate-400 bg-slate-100 rounded-xl cursor-not-allowed border border-slate-200"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Belum Dibuka (Mulai {schedule.startTime} WIB)</span>
                      </button>
                    ) : schedule.status === 'expired' ? (
                      <button
                        disabled
                        title="Jadwal pengerjaan ujian telah berakhir"
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-semibold text-slate-400 bg-slate-100 rounded-xl cursor-not-allowed border border-slate-200"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Jadwal Ujian Telah Berakhir</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleOpenTokenModal(exam)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl shadow-xs transition-colors cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Mulai Kerjakan Ujian</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Token Entry Modal */}
      {selectedExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base leading-tight">
                  Konfirmasi Token Ujian
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedExam.title}
                </p>
              </div>
            </div>

            {tokenError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {tokenError}
              </div>
            )}

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1.5 text-xs text-slate-600">
              <div className="flex justify-between">
                <span>Durasi Waktu:</span>
                <span className="font-bold text-slate-900">{selectedExam.durationMinutes} Menit</span>
              </div>
              <div className="flex justify-between">
                <span>Jumlah Butir Soal:</span>
                <span className="font-bold text-slate-900">{selectedExam.totalQuestions} Soal PG</span>
              </div>
              <div className="flex justify-between">
                <span>Batas Pelanggaran:</span>
                <span className="font-bold text-rose-700">{selectedExam.maxViolations || 3} Kali Pindah Tab</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Masukkan Token Ujian dari Pengawas:
              </label>
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value.toUpperCase())}
                placeholder="Contoh: SHM2026"
                className="w-full text-center text-lg font-mono font-bold tracking-widest px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 uppercase focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                autoFocus
              />
              <p className="text-[11px] text-slate-600 mt-1">
                Token dapat diperoleh langsung dari guru atau pengawas ruang ujian.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectedExam(null)}
                disabled={starting}
                className="w-1/2 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmStart}
                disabled={starting}
                className="w-1/2 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm"
              >
                {starting ? (
                  <span>Menyiapkan...</span>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Mulai Sekarang</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
