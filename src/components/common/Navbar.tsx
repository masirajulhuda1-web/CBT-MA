import React from 'react';
import { User } from '../../types';
import { EmblemLogo } from './EmblemLogo';
import { LogOut, BookOpen, Database, ShieldAlert, Award } from 'lucide-react';

interface NavbarProps {
  user: User | null;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  onLogout: () => void;
  isExamMode?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  activeTab,
  onSelectTab,
  onLogout,
  isExamMode = false,
}) => {
  // If student is actively taking an exam, show minimalist secured header
  if (isExamMode) {
    return (
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-4 md:px-8 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <EmblemLogo size="sm" showText={false} />
            <div>
              <h1 className="text-sm md:text-base font-bold text-slate-900 tracking-tight leading-tight">
                Ruang Ujian Mandiri CBT
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                MA Sirajul Huda Marindi &middot; Mode Pengawasan Aktif
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-rose-700 bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-200">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Pengawasan Otomatis</span>
            <span className="tabular-nums font-mono">AKTIF</span>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-4 md:px-8 py-3.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-8">
        {/* Zone 1: Brand wordmark & emblem */}
        <div className="flex items-center gap-3 shrink-0 cursor-pointer" onClick={() => onSelectTab('home')}>
          <EmblemLogo size="md" />
        </div>

        {/* Zone 2: Navigation Links (Single-line, unboxed text links) */}
        {user && (
          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-600">
            {user.role === 'siswa' ? (
              <>
                <button
                  onClick={() => onSelectTab('home')}
                  className={`whitespace-nowrap shrink-0 transition-colors ${
                    activeTab === 'home' ? 'text-emerald-700 font-semibold' : 'hover:text-slate-900'
                  }`}
                >
                  Daftar Ujian
                </button>
                <button
                  onClick={() => onSelectTab('history')}
                  className={`whitespace-nowrap shrink-0 transition-colors ${
                    activeTab === 'history' ? 'text-emerald-700 font-semibold' : 'hover:text-slate-900'
                  }`}
                >
                  Riwayat Nilai
                </button>
                <button
                  onClick={() => onSelectTab('guide')}
                  className={`whitespace-nowrap shrink-0 transition-colors ${
                    activeTab === 'guide' ? 'text-emerald-700 font-semibold' : 'hover:text-slate-900'
                  }`}
                >
                  Tata Tertib
                </button>
              </>
            ) : user.role === 'guru' ? (
              <>
                <button
                  onClick={() => onSelectTab('monitoring')}
                  className={`whitespace-nowrap shrink-0 transition-colors ${
                    activeTab === 'monitoring' ? 'text-emerald-700 font-semibold' : 'hover:text-slate-900'
                  }`}
                >
                  Monitoring Mapel
                </button>
                <button
                  onClick={() => onSelectTab('bank-soal')}
                  className={`whitespace-nowrap shrink-0 transition-colors ${
                    activeTab === 'bank-soal' ? 'text-emerald-700 font-semibold' : 'hover:text-slate-900'
                  }`}
                >
                  Bank Soal Mapel
                </button>
                <button
                  onClick={() => onSelectTab('jadwal')}
                  className={`whitespace-nowrap shrink-0 transition-colors ${
                    activeTab === 'jadwal' ? 'text-emerald-700 font-semibold' : 'hover:text-slate-900'
                  }`}
                >
                  Jadwal Ujian
                </button>
                <button
                  onClick={() => onSelectTab('rekap')}
                  className={`whitespace-nowrap shrink-0 transition-colors ${
                    activeTab === 'rekap' ? 'text-emerald-700 font-semibold' : 'hover:text-slate-900'
                  }`}
                >
                  Rekap Nilai
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => onSelectTab('monitoring')}
                  className={`whitespace-nowrap shrink-0 transition-colors ${
                    activeTab === 'monitoring' ? 'text-emerald-700 font-semibold' : 'hover:text-slate-900'
                  }`}
                >
                  Monitoring Realtime
                </button>
                <button
                  onClick={() => onSelectTab('bank-soal')}
                  className={`whitespace-nowrap shrink-0 transition-colors ${
                    activeTab === 'bank-soal' ? 'text-emerald-700 font-semibold' : 'hover:text-slate-900'
                  }`}
                >
                  Bank Soal
                </button>
                <button
                  onClick={() => onSelectTab('jadwal')}
                  className={`whitespace-nowrap shrink-0 transition-colors ${
                    activeTab === 'jadwal' ? 'text-emerald-700 font-semibold' : 'hover:text-slate-900'
                  }`}
                >
                  Jadwal Ujian
                </button>
                <button
                  onClick={() => onSelectTab('rombel')}
                  className={`whitespace-nowrap shrink-0 transition-colors ${
                    activeTab === 'rombel' ? 'text-emerald-700 font-semibold' : 'hover:text-slate-900'
                  }`}
                >
                  Rombel Kelas
                </button>
                <button
                  onClick={() => onSelectTab('guru')}
                  className={`whitespace-nowrap shrink-0 transition-colors ${
                    activeTab === 'guru' ? 'text-emerald-700 font-semibold' : 'hover:text-slate-900'
                  }`}
                >
                  Akun Guru
                </button>
                <button
                  onClick={() => onSelectTab('rekap')}
                  className={`whitespace-nowrap shrink-0 transition-colors ${
                    activeTab === 'rekap' ? 'text-emerald-700 font-semibold' : 'hover:text-slate-900'
                  }`}
                >
                  Rekap Nilai
                </button>
                <button
                  onClick={() => onSelectTab('gas-center')}
                  className={`whitespace-nowrap shrink-0 transition-colors flex items-center gap-1.5 ${
                    activeTab === 'gas-center' ? 'text-emerald-700 font-semibold' : 'hover:text-slate-900'
                  }`}
                >
                  <Database className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Google Apps Script</span>
                </button>
              </>
            )}
          </nav>
        )}

        {/* Zone 3: 1 Primary Action (Profile & Logout) */}
        <div className="flex items-center gap-3 shrink-0">
          {user ? (
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex flex-col text-right">
                <span className="text-xs font-semibold text-slate-900 leading-tight truncate max-w-[150px]">
                  {user.fullName}
                </span>
                <span className="text-[11px] font-medium text-emerald-700 uppercase">
                  {user.role === 'guru' ? 'GURU MAPEL' : user.role} {user.className ? `· ${user.className}` : ''}
                </span>
              </div>
              <button
                onClick={onLogout}
                title="Keluar dari akun"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Keluar</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
};
