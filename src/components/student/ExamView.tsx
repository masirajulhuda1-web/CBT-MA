import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StudentQuestion, User } from '../../types';
import { apiService } from '../../services/apiService';
import { soundEffects } from '../../services/soundEffects';
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Send,
  RefreshCw,
  Volume2,
  Grid,
  Flag,
} from 'lucide-react';

interface ExamViewProps {
  user: User;
  examId: string;
  token: string;
  onFinishExam: (result: {
    score: number;
    correctCount: number;
    incorrectCount: number;
    unansweredCount: number;
    submittedAt: string;
  }) => void;
  onExit: () => void;
}

type SaveStatus = 'saved' | 'saving' | 'error';

export const ExamView: React.FC<ExamViewProps> = ({
  user,
  examId,
  token,
  onFinishExam,
  onExit,
}) => {
  const [sessionId, setSessionId] = useState<string>('');
  const [examTitle, setExamTitle] = useState<string>('Memuat Ujian...');
  const [questions, setQuestions] = useState<StudentQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [doubtful, setDoubtful] = useState<Record<string, boolean>>({});
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [violationCount, setViolationCount] = useState<number>(0);
  const [maxViolations, setMaxViolations] = useState<number>(3);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const [showViolationModal, setShowViolationModal] = useState<boolean>(false);
  const [violationMessage, setViolationMessage] = useState<string>('');
  const [showNavGridMobile, setShowNavGridMobile] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Auto-save queue ref to debounce rapid clicks
  const pendingSaveRef = useRef<{ questionId: string; optionKey: string; isDoubtful: boolean } | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize and retrieve exam questions (strictly without answer key)
  useEffect(() => {
    let isMounted = true;

    async function initExam() {
      try {
        const res = await apiService.startExam(examId, token);
        if (!isMounted) return;

        if (res.success && res.questions) {
          setSessionId(res.sessionId || '');
          setExamTitle(res.examTitle || 'Ujian Semester');
          setQuestions(res.questions);
          setAnswers(res.savedAnswers || {});
          setDoubtful(res.doubtful || {});
          setRemainingSeconds(res.remainingSeconds || 0);
          setViolationCount(res.violationCount || 0);
          setMaxViolations(res.maxViolations || 3);
          setLoading(false);
        } else {
          alert(res.error || 'Gagal memuat ujian.');
          onExit();
        }
      } catch (err) {
        alert('Terjadi kesalahan saat memuat soal ujian.');
        onExit();
      }
    }

    initExam();

    return () => {
      isMounted = false;
    };
  }, [examId, token, onExit]);

  // Server-synced countdown timer
  useEffect(() => {
    if (loading || remainingSeconds <= 0) return;

    const timer = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleAutoSubmit('Waktu Ujian Telah Habis. Ujian dikumpulkan otomatis.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [loading, remainingSeconds]);

  // Anti-Cheat: Tab Switch & Window Blur Detection with Web Audio Synthesizer Alarm
  const handleTriggerViolation = useCallback(
    (reason: string) => {
      if (loading || submitting || !sessionId) return;

      // 1. Play loud warning siren
      soundEffects.playCheatAlarm();

      // 2. Increment local count and set message
      setViolationCount((prev) => {
        const next = prev + 1;
        setViolationMessage(
          `Terdeteksi membuka aplikasi lain atau beralih dari layar ujian (${reason}). Pelanggaran ke-${next} dari ${maxViolations}.`
        );
        setShowViolationModal(true);

        // 3. Log to server
        apiService.logViolation(sessionId, `${reason} - Strike #${next}`);

        // 4. Auto-submit if exceeded
        if (next >= maxViolations) {
          setTimeout(() => {
            handleAutoSubmit(`Ujian dibatalkan dan dikumpulkan karena batas pelanggaran (${maxViolations}x) terlampaui.`);
          }, 1500);
        }

        return next;
      });
    },
    [loading, submitting, sessionId, maxViolations]
  );

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleTriggerViolation('Perpindahan Tab / Jendela Browser');
      }
    };

    const handleWindowBlur = () => {
      handleTriggerViolation('Jendela browser kehilangan fokus');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [handleTriggerViolation]);

  // Anti-Copy & Anti-Cheating Event Blockers
  useEffect(() => {
    const blockCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      soundEffects.playCheatAlarm();
      handleTriggerViolation('Percobaan Menyalin Teks Soal (Copy)');
      return false;
    };

    const blockContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      return false;
    };

    const blockKeyShortcuts = (e: KeyboardEvent) => {
      // Block Ctrl+C, Ctrl+V, Ctrl+U, F12, Ctrl+Shift+I, Alt+Tab
      if (
        (e.ctrlKey && (e.key === 'c' || e.key === 'v' || e.key === 'u' || e.key === 'a' || e.key === 'p')) ||
        e.key === 'F12'
      ) {
        e.preventDefault();
        soundEffects.playCheatAlarm();
        handleTriggerViolation('Penggunaan Tombol Shortcut Terlarang (' + e.key + ')');
        return false;
      }
    };

    document.addEventListener('copy', blockCopy);
    document.addEventListener('cut', blockCopy);
    document.addEventListener('contextmenu', blockContextMenu);
    document.addEventListener('keydown', blockKeyShortcuts);

    return () => {
      document.removeEventListener('copy', blockCopy);
      document.removeEventListener('cut', blockCopy);
      document.removeEventListener('contextmenu', blockContextMenu);
      document.removeEventListener('keydown', blockKeyShortcuts);
    };
  }, [handleTriggerViolation]);

  // Answer selection handler with immediate UI update + debounced auto-save
  const handleSelectOption = (originalKey: string) => {
    if (!currentQuestion) return;
    soundEffects.playClick();

    const qId = currentQuestion.id;
    const isCurrentDoubtful = doubtful[qId] || false;

    // Immediate local state update
    setAnswers((prev) => ({ ...prev, [qId]: originalKey }));
    setSaveStatus('saving');
    setSaveErrorMsg(null);

    // Queue save to server
    pendingSaveRef.current = { questionId: qId, optionKey: originalKey, isDoubtful: isCurrentDoubtful };

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      await flushPendingSave();
    }, 400);
  };

  const handleToggleDoubtful = () => {
    if (!currentQuestion) return;
    const qId = currentQuestion.id;
    const nextVal = !doubtful[qId];
    setDoubtful((prev) => ({ ...prev, [qId]: nextVal }));

    const currentAnswer = answers[qId] || '';
    pendingSaveRef.current = { questionId: qId, optionKey: currentAnswer, isDoubtful: nextVal };

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      await flushPendingSave();
    }, 400);
  };

  const flushPendingSave = async () => {
    if (!pendingSaveRef.current || !sessionId) return;
    const { questionId, optionKey, isDoubtful } = pendingSaveRef.current;

    try {
      const res = await apiService.saveAnswer(sessionId, questionId, optionKey, isDoubtful);
      if (res.success) {
        setSaveStatus('saved');
        setSaveErrorMsg(null);
      } else {
        setSaveStatus('error');
        setSaveErrorMsg('Gagal menyimpan jawaban. Periksa koneksi internet.');
      }
    } catch {
      setSaveStatus('error');
      setSaveErrorMsg('Koneksi terganggu. Klik tombol coba lagi.');
    }
  };

  const handleManualRetrySave = () => {
    setSaveStatus('saving');
    flushPendingSave();
  };

  // Submit Exam
  const handleManualSubmit = async () => {
    if (submitting || !sessionId) return;
    setSubmitting(true);

    try {
      // Ensure any pending save is sent
      if (pendingSaveRef.current) {
        await flushPendingSave();
      }

      const res = await apiService.submitExam(sessionId);
      if (res.success) {
        soundEffects.playSuccessChime();
        onFinishExam({
          score: res.score ?? 0,
          correctCount: res.correctCount ?? 0,
          incorrectCount: res.incorrectCount ?? 0,
          unansweredCount: res.unansweredCount ?? 0,
          submittedAt: (res.submittedAt as string) || new Date().toISOString(),
        });
      } else {
        alert(res.error || 'Gagal mengumpulkan ujian.');
        setSubmitting(false);
      }
    } catch {
      alert('Terjadi kesalahan saat mengumpulkan ujian.');
      setSubmitting(false);
    }
  };

  const handleAutoSubmit = async (reason: string) => {
    if (submitting || !sessionId) return;
    setSubmitting(true);
    alert(reason);

    try {
      const res = await apiService.submitExam(sessionId);
      if (res.success) {
        onFinishExam({
          score: res.score ?? 0,
          correctCount: res.correctCount ?? 0,
          incorrectCount: res.incorrectCount ?? 0,
          unansweredCount: res.unansweredCount ?? 0,
          submittedAt: (res.submittedAt as string) || new Date().toISOString(),
        });
      } else {
        onExit();
      }
    } catch {
      onExit();
    }
  };

  // Format seconds to HH:MM:SS
  const formatTime = (totalSec: number) => {
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return hours > 0
      ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(minutes)}:${pad(seconds)}`;
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center space-y-4">
        <div className="w-10 h-10 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-semibold text-slate-700">
          Menyiapkan Lembar Ujian & Mengacak Soal...
        </p>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];
  const totalQuestions = questions.length;
  const answeredCount = Object.keys(answers).length;
  const isTimeCritical = remainingSeconds < 300; // < 5 mins
  const isTimeWarning = remainingSeconds < 600 && !isTimeCritical; // < 10 mins

  return (
    <div className="exam-secure-zone max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 select-none">
      {/* Top Floating Bar: Timer, Auto-Save Status, & Strike Counter */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4 shadow-sm mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Exam Info */}
        <div className="min-w-0">
          <h2 className="text-sm sm:text-base font-bold text-slate-900 truncate">
            {examTitle}
          </h2>
          <p className="text-[11px] text-slate-500 font-medium">
            Peserta: {user.fullName} ({user.className || 'Kelas X'})
          </p>
        </div>

        {/* Center: Realtime Countdown Timer */}
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border font-mono font-bold text-sm sm:text-base tabular-nums ${
            isTimeCritical
              ? 'bg-rose-50 text-rose-700 border-rose-300 animate-pulse'
              : isTimeWarning
              ? 'bg-amber-50 text-amber-800 border-amber-300'
              : 'bg-slate-50 text-slate-800 border-slate-200'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Sisa Waktu: {formatTime(remainingSeconds)}</span>
        </div>

        {/* Right: Auto-save status and mobile question drawer toggle */}
        <div className="flex items-center gap-2">
          {/* Save Status Badge */}
          {saveStatus === 'saved' && (
            <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span className="hidden sm:inline">Jawaban</span>
              <span>Tersimpan</span>
            </div>
          )}
          {saveStatus === 'saving' && (
            <div className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-600" />
              <span>Menyimpan...</span>
            </div>
          )}
          {saveStatus === 'error' && (
            <button
              onClick={handleManualRetrySave}
              className="flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-md border border-rose-200 hover:bg-rose-100"
            >
              <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
              <span>Gagal (Coba Lagi)</span>
            </button>
          )}

          {/* Strikes Counter */}
          <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-md">
            <ShieldAlert className="w-3.5 h-3.5 text-slate-500" />
            <span className="hidden sm:inline">Pelanggaran:</span>
            <span className="tabular-nums font-mono font-bold text-rose-700">
              {violationCount}/{maxViolations}
            </span>
          </div>

          {/* Toggle question grid drawer on mobile */}
          <button
            onClick={() => setShowNavGridMobile(!showNavGridMobile)}
            className="lg:hidden p-2 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
            title="Daftar Soal"
          >
            <Grid className="w-4 h-4" />
          </button>
        </div>
      </div>

      {saveErrorMsg && (
        <div className="p-3 mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between">
          <span>{saveErrorMsg}</span>
          <button
            onClick={handleManualRetrySave}
            className="text-xs font-bold underline hover:text-rose-900"
          >
            Kirim Ulang Sekarang
          </button>
        </div>
      )}

      {/* Main 2-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Column: Question Card & Answer Choices (Takes 3 Cols on Desktop) */}
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-7 shadow-sm">
            {/* Question Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100">
                  Nomor {currentIndex + 1}
                </span>
                <span className="text-xs text-slate-600">
                  dari {totalQuestions} Soal
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-600 font-medium hidden sm:inline">
                  Bobot: {currentQuestion?.points || 10} Poin
                </span>
                {/* Ragu-ragu Checkbox */}
                <button
                  type="button"
                  onClick={handleToggleDoubtful}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    doubtful[currentQuestion.id]
                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Flag className="w-3.5 h-3.5 fill-current" />
                  <span>Ragu-ragu</span>
                </button>
              </div>
            </div>

            {/* Question Text */}
            <div className="py-6 text-sm sm:text-base leading-relaxed text-slate-900 font-medium">
              {currentQuestion ? (
                <div className="whitespace-pre-wrap">{currentQuestion.questionText}</div>
              ) : (
                <p>Memuat soal...</p>
              )}
            </div>

            {/* Multiple Choice Options (A, B, C, D, E) */}
            <div className="space-y-3 pt-2">
              {currentQuestion?.options.map((opt) => {
                const isSelected = answers[currentQuestion.id] === opt.originalKey;

                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => handleSelectOption(opt.originalKey)}
                    className={`w-full text-left p-3.5 sm:p-4 rounded-xl border text-xs sm:text-sm transition-all flex items-start gap-3.5 group cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-50/70 border-emerald-500 shadow-xs ring-1 ring-emerald-500/20'
                        : 'bg-white border-slate-200 hover:border-emerald-300 hover:bg-slate-50/60'
                    }`}
                  >
                    <span
                      className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-emerald-700 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-700 group-hover:bg-emerald-100 group-hover:text-emerald-800'
                      }`}
                    >
                      {opt.key}
                    </span>
                    <span className="flex-1 text-slate-800 leading-normal pt-1">
                      {opt.text}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bottom Pagination Controls */}
          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
              disabled={currentIndex === 0}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-xs transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Sebelumnya</span>
            </button>

            {currentIndex === totalQuestions - 1 ? (
              <button
                type="button"
                onClick={() => setShowSubmitModal(true)}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-white bg-emerald-700 hover:bg-emerald-800 shadow-sm transition-colors"
              >
                <Send className="w-4 h-4" />
                <span>Kumpulkan Ujian</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCurrentIndex((prev) => Math.min(totalQuestions - 1, prev + 1))}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 shadow-xs transition-colors"
              >
                <span>Selanjutnya</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Right Column: Question Grid Navigation (Desktop & Mobile Drawer) */}
        <div
          className={`lg:block ${
            showNavGridMobile
              ? 'fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4'
              : 'hidden'
          }`}
        >
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4 max-w-sm w-full max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm">
                Navigasi Butir Soal
              </h3>
              {showNavGridMobile && (
                <button
                  onClick={() => setShowNavGridMobile(false)}
                  className="lg:hidden text-xs font-semibold text-slate-600 px-2 py-1 bg-slate-100 rounded"
                >
                  Tutup
                </button>
              )}
            </div>

            {/* Status Legend */}
            <div className="grid grid-cols-3 gap-1.5 text-[11px] text-slate-600 pb-2 border-b border-slate-100">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-emerald-600 shrink-0"></span>
                <span>Sudah</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-amber-400 shrink-0"></span>
                <span>Ragu</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-slate-100 border border-slate-300 shrink-0"></span>
                <span>Belum</span>
              </div>
            </div>

            {/* Questions Grid Numbers */}
            <div className="grid grid-cols-5 gap-2">
              {questions.map((q, idx) => {
                const isAnswered = Boolean(answers[q.id]);
                const isDoubt = Boolean(doubtful[q.id]);
                const isCurrent = idx === currentIndex;

                let btnStyle = 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200';
                if (isDoubt) {
                  btnStyle = 'bg-amber-400 text-amber-950 font-bold border-amber-500';
                } else if (isAnswered) {
                  btnStyle = 'bg-emerald-600 text-white font-bold border-emerald-700';
                }

                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => {
                      setCurrentIndex(idx);
                      setShowNavGridMobile(false);
                    }}
                    className={`h-9 rounded-lg text-xs flex items-center justify-center border font-mono transition-all ${btnStyle} ${
                      isCurrent ? 'ring-2 ring-slate-900 ring-offset-2' : ''
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            <div className="pt-3 border-t border-slate-100 space-y-2">
              <div className="text-xs text-slate-500 flex justify-between">
                <span>Total Dijawab:</span>
                <span className="font-bold text-slate-900 tabular-nums font-mono">
                  {answeredCount} / {totalQuestions}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowSubmitModal(true)}
                className="w-full py-2.5 px-4 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Selesai & Kumpulkan</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Violation Alert Warning Modal with Loud Audio Confirmation */}
      {showViolationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-rose-950/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border-2 border-rose-500 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6 animate-bounce" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="font-bold text-rose-900 text-lg">
                Peringatan Pelanggaran Terdeteksi!
              </h3>
              <p className="text-xs text-rose-700 font-medium leading-relaxed">
                {violationMessage}
              </p>
            </div>

            <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 text-center text-xs text-rose-900">
              <span>Sisa Toleransi: </span>
              <strong className="font-bold font-mono">
                {Math.max(0, maxViolations - violationCount)} kali lagi
              </strong>
              <p className="text-[11px] text-rose-700 mt-1">
                Jika kuota pelanggaran habis, ujian Anda akan otomatis dikumpulkan dan nilai ditutup.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowViolationModal(false)}
              className="w-full py-2.5 px-4 text-xs font-bold text-white bg-rose-700 hover:bg-rose-800 rounded-xl transition-colors shadow-sm"
            >
              Saya Mengerti & Kembali Mengerjakan
            </button>
          </div>
        </div>
      )}

      {/* Final Submit Confirmation Modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto">
              <Send className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="font-bold text-slate-900 text-lg">
                Konfirmasi Pengumpulan Ujian
              </h3>
              <p className="text-xs text-slate-500">
                Apakah Anda yakin ingin mengakhiri dan mengumpulkan jawaban ujian ini?
              </p>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-2 text-xs">
              <div className="flex justify-between">
                <span>Soal Sudah Dijawab:</span>
                <span className="font-bold text-emerald-700">{answeredCount} Soal</span>
              </div>
              <div className="flex justify-between">
                <span>Soal Belum Dijawab:</span>
                <span className={`font-bold ${totalQuestions - answeredCount > 0 ? 'text-rose-600' : 'text-slate-700'}`}>
                  {totalQuestions - answeredCount} Soal
                </span>
              </div>
              <div className="flex justify-between">
                <span>Soal Ditandai Ragu-ragu:</span>
                <span className="font-bold text-amber-600">
                  {Object.values(doubtful).filter(Boolean).length} Soal
                </span>
              </div>
            </div>

            {totalQuestions - answeredCount > 0 && (
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>
                  Masih terdapat {totalQuestions - answeredCount} butir soal yang belum Anda jawab. Jawaban kosong akan bernilai 0.
                </span>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowSubmitModal(false)}
                disabled={submitting}
                className="w-1/2 py-2.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Kembali Periksa
              </button>
              <button
                type="button"
                onClick={handleManualSubmit}
                disabled={submitting}
                className="w-1/2 py-2.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-1.5"
              >
                {submitting ? (
                  <span>Mengumpulkan...</span>
                ) : (
                  <span>Ya, Kumpulkan</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
