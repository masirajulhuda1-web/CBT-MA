import React, { useState, useEffect } from 'react';
import { EmblemLogo } from '../common/EmblemLogo';
import { ShieldCheck, Lock, User as UserIcon, AlertCircle, Code, GraduationCap, Briefcase, RefreshCw, Database, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { User } from '../../types';
import { apiService } from '../../services/apiService';

interface LoginViewProps {
  onLoginSuccess: (user: User) => void;
  onOpenGasGuide: () => void;
}

type LoginPortalType = 'siswa' | 'staff';

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess, onOpenGasGuide }) => {
  const [portalType, setPortalType] = useState<LoginPortalType>('siswa');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [gasUrlInput, setGasUrlInput] = useState('');
  const [isSyncingServer, setIsSyncingServer] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const initCrossDeviceSync = async () => {
      await apiService.syncWithServer();
      const cfg = apiService.getConfig();
      if (mounted && cfg.gasWebAppUrl) {
        setGasUrlInput(cfg.gasWebAppUrl);
      }
      if (cfg.useLiveGas && cfg.gasWebAppUrl) {
        await apiService.syncUsersFromGas();
      }
    };
    void initCrossDeviceSync();
    return () => {
      mounted = false;
    };
  }, []);

  const handleManualSyncSpreadsheet = async () => {
    setIsSyncingServer(true);
    setSyncNotice(null);
    setErrorMessage(null);
    try {
      const cleanUrl = gasUrlInput.trim();
      if (cleanUrl) {
        apiService.saveConfig({ gasWebAppUrl: cleanUrl, useLiveGas: true });
      }
      await apiService.syncWithServer();
      const cfg = apiService.getConfig();
      if (cfg.gasWebAppUrl) {
        setGasUrlInput(cfg.gasWebAppUrl);
        await apiService.syncUsersFromGas(cfg.gasWebAppUrl);
        setSyncNotice('Data akun dari Google Spreadsheet berhasil disinkronkan ke perangkat ini.');
      } else {
        setSyncNotice('Sinkronisasi server lokal berhasil.');
      }
    } catch {
      setErrorMessage('Gagal menyinkronkan data dari server Spreadsheet.');
    } finally {
      setIsSyncingServer(false);
    }
  };

  const handlePortalSwitch = (type: LoginPortalType) => {
    setPortalType(type);
    setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMessage('Silakan isi username dan kata sandi.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const { apiService } = await import('../../services/apiService');
      const response = await apiService.login(username.trim(), password, portalType);

      if (response.success && response.user && response.token) {
        const loggedUser = response.user as User;

        // Validasi pemisahan portal: Siswa vs Guru & Admin
        if (portalType === 'siswa' && loggedUser.role !== 'siswa') {
          setErrorMessage(
            `Akun ini terdaftar sebagai ${
              loggedUser.role === 'admin' ? 'Administrator' : 'Guru Pengawas'
            }. Silakan beralih ke menu 'Login Guru & Admin'.`
          );
          setIsLoading(false);
          return;
        }

        if (portalType === 'staff' && loggedUser.role === 'siswa') {
          setErrorMessage('Akun ini adalah akun Siswa. Silakan masuk melalui menu "Login Siswa".');
          setIsLoading(false);
          return;
        }

        apiService.setStoredToken(response.token as string);
        apiService.setStoredUser(loggedUser);
        onLoginSuccess(loggedUser);
      } else {
        setErrorMessage(response.error || 'Username atau kata sandi tidak valid.');
      }
    } catch (err: unknown) {
      setErrorMessage((err as Error).message || 'Terjadi kesalahan jaringan.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-65px)] flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8 bg-slate-50">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <EmblemLogo size="xl" showText={false} />
        </div>
        <h2 className="mt-4 text-center text-2xl font-bold tracking-tight text-slate-900">
          CBT MA Sirajul Huda Marindi
        </h2>
        <p className="mt-1 text-center text-xs md:text-sm text-slate-600">
          Portal Ujian Semester Berbasis Komputer & Handphone
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        {/* Tab Pemisah: Login Siswa vs Login Guru & Admin */}
        <div className="flex items-center p-1 bg-slate-200/80 rounded-xl mb-3 shadow-inner">
          <button
            type="button"
            onClick={() => handlePortalSwitch('siswa')}
            className={`flex-1 py-2.5 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
              portalType === 'siswa'
                ? 'bg-white text-emerald-800 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <GraduationCap className="w-4 h-4 text-emerald-700" />
            <span>Login Siswa</span>
          </button>
          <button
            type="button"
            onClick={() => handlePortalSwitch('staff')}
            className={`flex-1 py-2.5 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
              portalType === 'staff'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Briefcase className="w-4 h-4 text-slate-700" />
            <span>Login Guru & Admin</span>
          </button>
        </div>

        <div className="bg-white py-6 px-5 shadow-sm border border-slate-200 sm:rounded-2xl sm:px-8">
          <div className="mb-5 pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              {portalType === 'siswa' ? (
                <>
                  <GraduationCap className="w-4 h-4 text-emerald-700" />
                  <span>Portal Masuk Peserta Ujian (Siswa)</span>
                </>
              ) : (
                <>
                  <Briefcase className="w-4 h-4 text-slate-800" />
                  <span>Portal Pengawas & Administrator</span>
                </>
              )}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {portalType === 'siswa'
                ? 'Gunakan NISN atau username akun siswa yang diberikan oleh madrasah'
                : 'Khusus dewan guru, pengawas ruang ujian, dan tim proktor madrasah'}
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {errorMessage && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {portalType === 'siswa' ? 'Username / NISN Siswa' : 'Username Guru / Administrator'}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <UserIcon className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={
                    portalType === 'siswa'
                      ? 'Contoh: siswa_fahmi atau 008129381'
                      : 'Contoh: guru_fikih atau admin_sirajulhuda'
                  }
                  className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Kata Sandi
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan Kata Sandi"
                  className="w-full pl-9 pr-10 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  title={showPassword ? 'Sembunyikan kata sandi' : 'Lihat kata sandi'}
                  aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Lihat kata sandi'}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {portalType === 'siswa'
                  ? 'Format sandi bawaan siswa: Siswa123!'
                  : 'Format sandi bawaan: Guru123! (Guru) atau Admin123! (Admin)'}
              </p>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full flex justify-center py-2.5 px-4 text-sm font-semibold rounded-lg text-white shadow-sm transition-colors disabled:opacity-50 ${
                portalType === 'siswa'
                  ? 'bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 focus:ring-emerald-600'
                  : 'bg-slate-900 hover:bg-slate-800 active:bg-slate-950 focus:ring-slate-700'
              } focus:outline-none focus:ring-2 focus:ring-offset-2`}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
                  <span>Memverifikasi...</span>
                </span>
              ) : portalType === 'siswa' ? (
                'Masuk ke Ruang Ujian'
              ) : (
                'Masuk ke Panel Pengawas'
              )}
            </button>
          </form>

          {/* Security details callout */}
          <div className="mt-5 p-3 rounded-lg bg-emerald-50/70 border border-emerald-100 text-[11px] text-emerald-900 leading-relaxed">
            <div className="flex items-center gap-1.5 font-semibold text-emerald-950 mb-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
              <span>Standar Keamanan Madrasah</span>
            </div>
            <p className="text-emerald-800/90">
              Kata sandi di-hash menggunakan SHA-256 + Unique Salt. Kunci jawaban tidak pernah dikirim ke browser peserta. Timer dan penilaian divalidasi penuh oleh server.
            </p>
          </div>

          {/* Developer Credit */}
          <div className="mt-5 pt-3.5 border-t border-slate-100 flex items-center justify-center gap-1.5 text-xs text-slate-500">
            <Code className="w-3.5 h-3.5 text-emerald-600" />
            <span>Pengembang Aplikasi:</span>
            <strong className="text-slate-800 font-semibold">Siti Aisyah</strong>
          </div>
        </div>

        {/* Cross-Device Sync (URL Apps Script dikunci & disembunyikan demi keamanan) */}
        <div className="mt-4 text-center space-y-2">
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={handleManualSyncSpreadsheet}
              disabled={isSyncingServer}
              className="text-xs font-semibold text-slate-500 hover:text-emerald-700 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-emerald-600 ${isSyncingServer ? 'animate-spin' : ''}`} />
              <span>{isSyncingServer ? 'Menyinkronkan Data Akun...' : 'Segarkan Sinkronisasi Akun'}</span>
            </button>
          </div>
          {syncNotice && (
            <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>{syncNotice}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
