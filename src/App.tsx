import React, { useState, useEffect } from 'react';
import { User } from './types';
import { apiService } from './services/apiService';
import { Navbar } from './components/common/Navbar';
import { LoginView } from './components/auth/LoginView';
import { StudentDashboard } from './components/student/StudentDashboard';
import { ExamView } from './components/student/ExamView';
import { ExamResultView } from './components/student/ExamResultView';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { BookOpen, ShieldCheck, Database, CheckCircle2 } from 'lucide-react';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<string>('home');
  const [activeExam, setActiveExam] = useState<{ id: string; token: string } | null>(null);
  const [lastExamResult, setLastExamResult] = useState<{
    score: number;
    correctCount: number;
    incorrectCount: number;
    unansweredCount: number;
    submittedAt: string;
  } | null>(null);

  // Restore stored session if exists
  useEffect(() => {
    const user = apiService.getStoredUser();
    const token = apiService.getStoredToken();
    if (user && token) {
      setCurrentUser(user);
      if (user.role === 'admin' || user.role === 'guru') {
        setActiveTab('monitoring');
      } else {
        setActiveTab('home');
      }
    }
  }, []);

  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
    if (user.role === 'siswa') {
      setActiveTab('home');
    } else {
      setActiveTab('monitoring');
    }
  };

  const handleLogout = () => {
    apiService.logout();
    setCurrentUser(null);
    setActiveExam(null);
    setLastExamResult(null);
    setActiveTab('home');
  };

  const handleStartExam = (examId: string, token: string) => {
    setActiveExam({ id: examId, token });
    setLastExamResult(null);
  };

  const handleFinishExam = (result: {
    score: number;
    correctCount: number;
    incorrectCount: number;
    unansweredCount: number;
    submittedAt: string;
  }) => {
    setActiveExam(null);
    setLastExamResult(result);
  };

  const handleBackToDashboard = () => {
    setLastExamResult(null);
    setActiveTab('home');
  };

  // If user is not logged in
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <Navbar
          user={null}
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          onLogout={handleLogout}
        />
        <main className="flex-1 flex items-center justify-center">
          <LoginView
            onLoginSuccess={handleLoginSuccess}
            onOpenGasGuide={() => {}}
          />
        </main>
      </div>
    );
  }

  // Active student exam room
  if (currentUser.role === 'siswa' && activeExam) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col">
        <Navbar
          user={currentUser}
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          onLogout={handleLogout}
          isExamMode={true}
        />
        <main className="flex-1 py-4">
          <ExamView
            user={currentUser}
            examId={activeExam.id}
            token={activeExam.token}
            onFinishExam={handleFinishExam}
            onExit={() => setActiveExam(null)}
          />
        </main>
      </div>
    );
  }

  // Post exam result view
  if (currentUser.role === 'siswa' && lastExamResult) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <Navbar
          user={currentUser}
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          onLogout={handleLogout}
        />
        <main className="flex-1">
          <ExamResultView
            user={currentUser}
            result={lastExamResult}
            onBackToDashboard={handleBackToDashboard}
          />
        </main>
      </div>
    );
  }

  // Main Authenticated Workspace
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Navbar
        user={currentUser}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onLogout={handleLogout}
      />

      <main className="flex-1">
        {currentUser.role === 'siswa' ? (
          <>
            {activeTab === 'home' && (
              <StudentDashboard
                user={currentUser}
                onStartExam={handleStartExam}
                onViewResult={() => {}}
              />
            )}
            {activeTab === 'history' && (
              <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
                <h2 className="text-xl font-bold text-slate-900">
                  Riwayat Nilai Semester
                </h2>
                <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center space-y-2">
                  <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
                  <p className="text-sm font-semibold text-slate-800">
                    Nilai Ujian Anda Terhubung ke Buku Induk Madrasah
                  </p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Seluruh lembar jawaban disimpan secara terenkripsi dan dapat dicetak oleh wali kelas saat pembagian raport semester.
                  </p>
                </div>
              </div>
            )}
            {activeTab === 'guide' && (
              <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
                <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-4">
                  <h2 className="text-xl font-bold text-slate-900">
                    Tata Tertib Peserta CBT MA Sirajul Huda Marindi
                  </h2>
                  <ol className="list-decimal list-inside space-y-2 text-xs sm:text-sm text-slate-700 leading-relaxed">
                    <li>Peserta wajib menggunakan peramban (browser) standar seperti Chrome, Safari, atau Firefox.</li>
                    <li>Sebelum menekan tombol Mulai Ujian, pastikan baterai perangkat di atas 50% dan terhubung ke koneksi internet madrasah.</li>
                    <li>Sistem CBT dilengkapi dengan pendeteksi perpindahan aplikasi. Jika peserta beralih aplikasi atau membuka tab lain, alarm peringatan akan berbunyi secara otomatis dan pelanggaran dicatat oleh server pengawas.</li>
                    <li>Peserta dilarang menyalin (copy) teks butir soal atau kunci pilihan jawaban.</li>
                    <li>Jika terjadi kendala teknis (mati lampu, kuota habis, HP reboot), segera lapor ke proktor ruangan agar sesi Anda dapat di-reset melalui dashboard pengawas.</li>
                  </ol>
                </div>
              </div>
            )}
          </>
        ) : (
          <AdminDashboard
            user={currentUser}
            activeTab={activeTab}
            onSelectTab={setActiveTab}
          />
        )}
      </main>

      {/* Clean, quiet footer */}
      <footer className="border-t border-slate-200 bg-white py-4 px-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>&copy; 2026 MA Sirajul Huda Marindi &middot; Pengembang: <strong className="font-semibold text-slate-800">Siti Aisyah</strong></span>
          <span className="font-mono text-[11px] text-slate-400">
            CBT Engine v2.4 &middot; Google Apps Script & Sheets Backend
          </span>
        </div>
      </footer>
    </div>
  );
}
