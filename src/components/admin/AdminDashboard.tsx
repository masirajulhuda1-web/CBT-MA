import React, { useState, useEffect } from 'react';
import { User, ClassRoom, Subject, Question, Exam, AuditLog } from '../../types';
import { apiService } from '../../services/apiService';
import {
  Users,
  BookOpen,
  Calendar,
  Award,
  ShieldAlert,
  Database,
  Plus,
  Trash2,
  Edit2,
  RotateCcw,
  Download,
  Search,
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
  Activity,
  KeyRound,
  Eye,
  RefreshCw,
  Upload,
  AlertTriangle,
  Clock,
  GraduationCap,
  Layers,
} from 'lucide-react';
import { AnalyticsCharts } from './AnalyticsCharts';
import { UploadQuestionsModal } from './UploadQuestionsModal';
import {
  formatIndoDate,
  formatIndoTime,
  getExamScheduleStatus,
  getLocalDateString,
  buildIsoWindowWithOffset,
  normalizeExamScheduleFields,
  normalizeTimeHHMM,
} from '../../utils/dateUtils';

interface AdminDashboardProps {
  user: User;
  activeTab: string;
  onSelectTab: (tab: string) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  user,
  activeTab,
  onSelectTab,
}) => {
  // Data States (Initialized synchronously from local cache for 0ms instant rendering)
  const initialSnapshot = React.useMemo(() => apiService.getCachedDashboardSnapshot(), []);
  const [classes, setClasses] = useState<ClassRoom[]>(initialSnapshot.classes);
  const [subjects, setSubjects] = useState<Subject[]>(initialSnapshot.subjects);
  const [questions, setQuestions] = useState<Question[]>(initialSnapshot.questions);
  const [exams, setExams] = useState<Exam[]>(initialSnapshot.exams);
  const [students, setStudents] = useState<User[]>(initialSnapshot.students);
  const [teachers, setTeachers] = useState<User[]>(initialSnapshot.teachers);
  const [examResults, setExamResults] = useState<any[]>(initialSnapshot.results);
  const [logs, setLogs] = useState<AuditLog[]>(initialSnapshot.logs);
  const [stats, setStats] = useState(initialSnapshot.stats);
  const [loading, setLoading] = useState(false);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [, setClockTick] = useState(0);

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState('ALL');

  // Modals & Form States
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Partial<Question> | null>(null);

  const [showExamModal, setShowExamModal] = useState(false);
  const [editingExam, setEditingExam] = useState<Partial<Exam> | null>(null);

  const [showStudentModal, setShowStudentModal] = useState(false);
  const [newStudentData, setNewStudentData] = useState({ username: '', fullName: '', classId: '', password: 'Siswa123!' });

  // Teacher Account Modal State
  const [showTeacherModal, setShowTeacherModal] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<{
    id?: string;
    username: string;
    fullName: string;
    password?: string;
    subjectId?: string;
    subjectIds?: string[];
  } | null>(null);
  const [isSavingTeacher, setIsSavingTeacher] = useState(false);
  const [teacherSearchQuery, setTeacherSearchQuery] = useState('');
  const [claimSubjectId, setClaimSubjectId] = useState<string>('');

  // Role Differentiation: Akun Guru vs Akun Admin
  const isGuru = user.role === 'guru';
  const isAdmin = user.role !== 'guru';

  const normalizePersonName = (rawName: string): string => {
    return (rawName || '')
      .toLowerCase()
      .replace(
        /\b(ustadzah|ustadz|ustzh|ust|hj|h|drs|dra|s\.pd\.i|s\.pd|m\.pd|m\.ag|s\.ag|s\.h\.i|lc|bapak|bpk|ibu|pak|bu|guru)\b\.?/gi,
        ' '
      )
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const isSubjectTaughtByTeacher = (
    s: Subject,
    teacher: Pick<User, 'id' | 'username' | 'fullName'>
  ): boolean => {
    if (!s || !teacher) return false;
    const tId = (teacher.id || '').trim().toLowerCase();
    const tUname = (teacher.username || '').trim().toLowerCase();
    const tFull = (teacher.fullName || '').trim().toLowerCase();
    const sTeacherId = (s.teacherId || '').trim().toLowerCase();
    const sTeacherName = (s.teacherName || '').trim().toLowerCase();

    // 1. Direct match on teacherId
    if (sTeacherId && (sTeacherId === tId || sTeacherId === tUname || sTeacherId === tFull)) {
      return true;
    }

    // 2. Direct match on teacherName
    if (sTeacherName && (sTeacherName === tFull || sTeacherName === tUname || sTeacherName === tId)) {
      return true;
    }

    // 3. Normalized name match (ignoring academic/religious titles and 'guru_' username prefix)
    const normTeacherFull = normalizePersonName(teacher.fullName);
    const normTeacherUname = normalizePersonName(teacher.username.replace(/^guru[_\-\s]*/i, ''));
    const normSubjTeacher = normalizePersonName(s.teacherName || s.teacherId || '');

    if (normSubjTeacher && normSubjTeacher.length >= 2) {
      if (
        normTeacherFull &&
        (normSubjTeacher === normTeacherFull ||
          normTeacherFull.includes(normSubjTeacher) ||
          normSubjTeacher.includes(normTeacherFull))
      ) {
        return true;
      }
      if (
        normTeacherUname &&
        normTeacherUname.length >= 2 &&
        (normSubjTeacher === normTeacherUname ||
          normSubjTeacher.includes(normTeacherUname) ||
          normTeacherUname.includes(normSubjTeacher))
      ) {
        return true;
      }
    }

    // 4. Match if username embeds subject name/code (e.g., guru_fikih -> Fikih) and subject has no other teacher conflicting
    if (!sTeacherName && !sTeacherId && normTeacherUname && normTeacherUname.length >= 3) {
      const subjNameLower = (s.name || '').toLowerCase();
      const subjCodeLower = (s.code || '').toLowerCase();
      if (subjNameLower.includes(normTeacherUname) || subjCodeLower.startsWith(normTeacherUname)) {
        return true;
      }
    }

    return false;
  };

  // Scoped Data for Current Role: Guru ONLY loads subjects they teach (mapel yang diampu)
  const visibleSubjects = isAdmin
    ? subjects
    : subjects.filter((s) => isSubjectTaughtByTeacher(s, user));
  const visibleSubjectIds = new Set(visibleSubjects.map((s) => s.id));
  const visibleQuestions = isAdmin
    ? questions
    : questions.filter((q) => visibleSubjectIds.has(q.subjectId));
  const visibleExams = isAdmin
    ? exams
    : exams.filter((ex) => visibleSubjectIds.has(ex.subjectId));
  const visibleExamIds = new Set(visibleExams.map((ex) => ex.id));
  const visibleExamResults = isAdmin
    ? examResults
    : examResults.filter((r) => visibleExamIds.has(r.examId));

  // Subject Modal State
  const [showSubjectModal, setShowSubjectModal] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Partial<Subject> | null>(null);
  const [isSavingSubject, setIsSavingSubject] = useState(false);

  // Rombel Kelas Modal & Filter State
  const [showClassModal, setShowClassModal] = useState(false);
  const [editingClass, setEditingClass] = useState<Partial<ClassRoom> | null>(null);
  const [isSavingClass, setIsSavingClass] = useState(false);
  const [selectedGradeFilter, setSelectedGradeFilter] = useState<'ALL' | 'X' | 'XI' | 'XII'>('ALL');
  const [rombelSearchQuery, setRombelSearchQuery] = useState('');
  const [selectedRombelId, setSelectedRombelId] = useState<string>('ALL');

  // Helper to generate code from subject name
  const generateSubjectCodeFromName = (name: string): string => {
    const clean = (name || '').trim();
    if (!clean) return '';
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return words.map((w) => w.charAt(0)).join('').toUpperCase().substring(0, 4) + '-10';
    }
    return (clean.substring(0, 3).toUpperCase() || 'MP') + '-10';
  };

  // Batch Upload Modal State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTargetSubjectId, setUploadTargetSubjectId] = useState<string>('');

  // In-App Toast & Confirmation Modal (replaces blocked window.confirm & window.alert in iframe sandbox)
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    type:
      | 'delete_question'
      | 'delete_subject_questions'
      | 'delete_exam'
      | 'delete_student'
      | 'delete_teacher'
      | 'delete_subject'
      | 'delete_class'
      | 'reset_attempt'
      | 'reset_password'
      | 'reset_teacher_password';
    id: string;
    title: string;
    message: string;
    confirmLabel: string;
    isDestructive?: boolean;
  }>({
    isOpen: false,
    type: 'delete_question',
    id: '',
    title: '',
    message: '',
    confirmLabel: 'Hapus',
    isDestructive: true,
  });

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast((cur) => (cur?.message === message ? null : cur));
    }, 4500);
  };

  // GAS Integration Settings
  const [gasUrlInput, setGasUrlInput] = useState('');
  const [gasTestStatus, setGasTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [gasSetupStatus, setGasSetupStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [isSyncingSpreadsheet, setIsSyncingSpreadsheet] = useState(false);
  const [copiedCodeType, setCopiedCodeType] = useState<string | null>(null);

  const applyCachedSnapshot = () => {
    const snap = apiService.getCachedDashboardSnapshot();
    setClasses(snap.classes);
    setSubjects(snap.subjects);
    setQuestions(snap.questions);
    setExams(snap.exams);
    setStudents(snap.students);
    setTeachers(snap.teachers);
    setExamResults(snap.results);
    setLogs(snap.logs);
    setStats(snap.stats);
  };

  // Load all data on mount & keep real-time clock / monitoring status fresh
  useEffect(() => {
    const initDashboard = async () => {
      applyCachedSnapshot();
      await apiService.syncWithServer(true);
      applyCachedSnapshot();
      const config = apiService.getConfig();
      if (config.gasWebAppUrl) {
        setGasUrlInput(config.gasWebAppUrl);
      }
      await loadAllData();
    };
    void initDashboard();

    // Real-time schedule badge evaluator every 5s
    const scheduleTicker = setInterval(() => {
      setClockTick((t) => t + 1);
    }, 5000);

    return () => clearInterval(scheduleTicker);
  }, []);

  // Auto-refresh monitoring sessions in background when Monitoring or Rekap tab is active
  useEffect(() => {
    if (activeTab !== 'monitoring' && activeTab !== 'rekap') return;
    const pollInterval = setInterval(async () => {
      try {
        await apiService.syncWithServer();
        const [resRes, statRes, exRes] = await Promise.all([
          apiService.getExamResults(),
          apiService.getSystemStats(),
          apiService.getExams(),
        ]);
        if (resRes.results) setExamResults(resRes.results);
        if (statRes.stats) setStats(statRes.stats);
        if (exRes.exams) setExams(exRes.exams);
        setLastRefreshedAt(new Date());
      } catch {
        // Ignore background poll error
      }
    }, 8000);
    return () => clearInterval(pollInterval);
  }, [activeTab]);

  // Batasi tab aktif untuk akun Guru agar tidak mengakses menu khusus Admin
  useEffect(() => {
    if (isGuru && ['rombel', 'siswa', 'guru', 'logs', 'gas-center'].includes(activeTab)) {
      onSelectTab('bank-soal');
    }
  }, [isGuru, activeTab, onSelectTab]);

  // Sinkronkan filter mata pelajaran khusus untuk akun Guru agar hanya memuat mapel yang diampu
  useEffect(() => {
    if (isGuru) {
      if (visibleSubjects.length === 1) {
        setSelectedSubjectFilter(visibleSubjects[0].id);
      } else if (
        selectedSubjectFilter !== 'ALL' &&
        !visibleSubjects.some((s) => s.id === selectedSubjectFilter)
      ) {
        setSelectedSubjectFilter(visibleSubjects[0]?.id || 'ALL');
      }
    }
  }, [isGuru, visibleSubjects, selectedSubjectFilter]);

  const loadAllData = async () => {
    setLoading(true);
    // Immediately hydrate from local cache first so UI never feels slow
    applyCachedSnapshot();
    try {
      const [clsRes, subjRes, qRes, exRes, stRes, tchRes, resRes, logRes, statRes] = await Promise.all([
        apiService.getClasses(),
        apiService.getSubjects(),
        apiService.getQuestions(),
        apiService.getExams(),
        apiService.getStudents(),
        apiService.getTeachers(),
        apiService.getExamResults(),
        apiService.getActivityLogs(),
        apiService.getSystemStats(),
      ]);

      const loadedSubjects = subjRes.subjects || [];
      let loadedQuestions = qRes.questions || [];

      // Auto-heal: jika ada butir soal yang subjectId-nya yatim / tidak terdaftar di daftar Mata Pelajaran
      // (misal tersimpan sebagai 'SUBJ-FIQ-10' padahal mata pelajaran yang terdaftar adalah 'bahasa arab 10'),
      // otomatis arahkan ke mata pelajaran sasaran yang terdaftar dan sinkronkan ke Spreadsheet.
      if (loadedSubjects.length > 0 && loadedQuestions.length > 0) {
        const validSubjectIds = new Set(loadedSubjects.map((s) => s.id));
        const orphanedByOldId = new Map<string, Question[]>();

        for (const q of loadedQuestions) {
          if (!validSubjectIds.has(q.subjectId)) {
            const list = orphanedByOldId.get(q.subjectId) || [];
            list.push(q);
            orphanedByOldId.set(q.subjectId, list);
          }
        }

        if (orphanedByOldId.size > 0) {
          const remapTable = new Map<string, string>();
          for (const [oldSubjId, orphanGroup] of orphanedByOldId.entries()) {
            const normOld = (oldSubjId || '').trim().toLowerCase();
            let targetSubj = loadedSubjects.find(
              (s) =>
                s.code.trim().toLowerCase() === normOld ||
                s.name.trim().toLowerCase() === normOld
            );

            if (!targetSubj && loadedSubjects.length === 1) {
              targetSubj = loadedSubjects[0];
            }

            if (!targetSubj) {
              const hasArabicText = orphanGroup.some((oq) =>
                /[\u0600-\u06FF]/.test(`${oq.questionText || ''} ${oq.optionA || ''}`)
              );
              if (hasArabicText) {
                targetSubj = loadedSubjects.find(
                  (s) =>
                    s.name.toLowerCase().includes('arab') ||
                    s.code.toLowerCase().startsWith('ba') ||
                    s.code.toLowerCase().startsWith('arb')
                );
              }
            }

            if (!targetSubj) {
              targetSubj = loadedSubjects[0];
            }

            if (targetSubj && targetSubj.id !== oldSubjId) {
              remapTable.set(oldSubjId, targetSubj.id);
              void apiService.reassignOrphanedQuestions(oldSubjId, targetSubj.id, orphanGroup);
            }
          }

          if (remapTable.size > 0) {
            loadedQuestions = loadedQuestions.map((q) => {
              const mappedId = remapTable.get(q.subjectId);
              return mappedId ? { ...q, subjectId: mappedId } : q;
            });
          }
        }
      }

      const loadedClasses = clsRes.classes || [];
      let loadedExams = exRes.exams || [];

      if (loadedExams.length > 0 && loadedQuestions.length > 0) {
        loadedExams = loadedExams.map((ex) => {
          let effectiveSubj = loadedSubjects.find((s) => s.id === ex.subjectId);
          if (!effectiveSubj && loadedSubjects.length === 1) {
            effectiveSubj = loadedSubjects[0];
          }
          const effectiveSubjectId = effectiveSubj?.id || ex.subjectId;
          const effectiveSubjectName =
            effectiveSubj?.name ||
            (ex.subjectName && ex.subjectName !== 'Mata Pelajaran' ? ex.subjectName : loadedSubjects[0]?.name || 'Mata Pelajaran');
          const effectiveClass = loadedClasses.find((c) => c.id === ex.classId);
          const effectiveClassName = effectiveClass?.name || ex.className || 'Semua Kelas';

          let subjectQs = loadedQuestions.filter((q) => q.subjectId === effectiveSubjectId);
          if (subjectQs.length === 0 && loadedSubjects.length === 1) {
            subjectQs = loadedQuestions;
          }

          const actualQuestionCount = subjectQs.length > 0 ? subjectQs.length : ex.totalQuestions;
          const updatedExam: Exam = {
            ...ex,
            subjectId: effectiveSubjectId,
            subjectName: effectiveSubjectName,
            className: effectiveClassName,
            totalQuestions: actualQuestionCount,
          };

          if (
            (subjectQs.length > 0 && ex.totalQuestions !== subjectQs.length) ||
            ex.subjectId !== effectiveSubjectId
          ) {
            void apiService.saveExam(updatedExam);
          }

          return updatedExam;
        });
      }

      if (clsRes.classes) setClasses(loadedClasses);
      if (subjRes.subjects) setSubjects(loadedSubjects);
      if (qRes.questions) setQuestions(loadedQuestions);
      if (exRes.exams) setExams(loadedExams);
      if (stRes.students) setStudents(stRes.students);
      if (tchRes.teachers) setTeachers(tchRes.teachers);
      if (resRes.results) setExamResults(resRes.results);
      if (logRes.logs) setLogs(logRes.logs);
      if (statRes.stats) setStats(statRes.stats);
      setLastRefreshedAt(new Date());
    } catch (err) {
      console.error('Gagal memuat data dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshStatus = async () => {
    if (isRefreshingStatus) return;
    setIsRefreshingStatus(true);
    try {
      setClockTick((t) => t + 1);
      await apiService.syncWithServer(true);
      applyCachedSnapshot();
      await loadAllData();
      setLastRefreshedAt(new Date());
      showToast('success', 'Status sesi ujian, jadwal, dan seluruh data terbaru berhasil disegarkan.');
    } catch {
      showToast('error', 'Gagal menyegarkan status dari server.');
    } finally {
      setIsRefreshingStatus(false);
    }
  };

  // Execution of confirmed action (Guaranteed to work without window.confirm)
  const executeConfirmAction = async () => {
    if (!confirmModal.isOpen) return;
    const { type, id } = confirmModal;
    setConfirmModal((prev) => ({ ...prev, isOpen: false }));

    try {
      if (type === 'delete_question') {
        const res = await apiService.deleteQuestion(id);
        if (res.success) {
          showToast('success', 'Butir soal berhasil dihapus dari bank soal.');
        } else {
          showToast('error', res.error || 'Gagal menghapus soal.');
        }
        await loadAllData();
      } else if (type === 'delete_subject_questions') {
        const res = await apiService.deleteQuestionsBySubject(id);
        if (res.success) {
          showToast('success', 'Seluruh butir soal pada mata pelajaran tersebut berhasil dibersihkan.');
        } else {
          showToast('error', res.error || 'Gagal menghapus soal mata pelajaran.');
        }
        await loadAllData();
      } else if (type === 'delete_exam') {
        const res = await apiService.deleteExam(id);
        if (res.success) {
          showToast('success', 'Jadwal ujian berhasil dihapus.');
        } else {
          showToast('error', res.error || 'Gagal menghapus jadwal ujian.');
        }
        await loadAllData();
      } else if (type === 'delete_student') {
        const res = await apiService.deleteStudent(id);
        if (res.success) {
          showToast('success', 'Akun siswa berhasil dihapus.');
        } else {
          showToast('error', res.error || 'Gagal menghapus akun siswa.');
        }
        await loadAllData();
      } else if (type === 'delete_subject') {
        const res = await apiService.deleteSubject(id);
        if (res.success) {
          showToast('success', res.message || 'Mata pelajaran berhasil dihapus.');
        } else {
          showToast('error', res.error || 'Gagal menghapus mata pelajaran.');
        }
        await loadAllData();
      } else if (type === 'delete_class') {
        const res = await apiService.deleteClass(id);
        if (res.success) {
          if (selectedRombelId === id) setSelectedRombelId('ALL');
          showToast('success', res.message || 'Rombel kelas berhasil dihapus.');
        } else {
          showToast('error', res.error || 'Gagal menghapus rombel kelas.');
        }
        await loadAllData();
      } else if (type === 'reset_attempt') {
        const res = await apiService.resetStudentExam(id);
        if (res.success) {
          showToast('success', res.message || 'Sesi siswa berhasil direset. Siswa dapat mengikuti ujian kembali.');
        } else {
          showToast('error', res.error || 'Gagal mereset sesi.');
        }
        await loadAllData();
      } else if (type === 'reset_password') {
        const res = await apiService.resetStudentPassword(id);
        if (res.success) {
          showToast('success', res.message || 'Kata sandi siswa berhasil direset ke Siswa123!.');
        } else {
          showToast('error', res.error || 'Gagal mereset kata sandi.');
        }
        await loadAllData();
      } else if (type === 'delete_teacher') {
        const res = await apiService.deleteTeacher(id);
        if (res.success) {
          showToast('success', res.message || 'Akun guru berhasil dihapus.');
        } else {
          showToast('error', res.error || 'Gagal menghapus akun guru.');
        }
        await loadAllData();
      } else if (type === 'reset_teacher_password') {
        const res = await apiService.resetTeacherPassword(id);
        if (res.success) {
          showToast('success', res.message || 'Kata sandi guru berhasil direset ke Guru123!.');
        } else {
          showToast('error', res.error || 'Gagal mereset kata sandi guru.');
        }
        await loadAllData();
      }
    } catch {
      showToast('error', 'Terjadi kesalahan saat memproses aksi.');
    }
  };

  // Save / Delete Subject (Mata Pelajaran)
  const handleSaveSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSubject || !editingSubject.name?.trim()) {
      showToast('error', 'Nama mata pelajaran wajib diisi.');
      return;
    }

    const name = editingSubject.name.trim();
    let code = (editingSubject.code || '').trim().toUpperCase();
    if (!code) {
      code = generateSubjectCodeFromName(name);
    }

    const matchedTeacher = teachers.find(
      (t) =>
        t.id === editingSubject.teacherId ||
        t.fullName.trim().toLowerCase() === (editingSubject.teacherName || '').trim().toLowerCase()
    );

    const payload: Partial<Subject> = {
      ...editingSubject,
      name,
      code,
      teacherName: isGuru ? (editingSubject.teacherName || user.fullName).trim() : (editingSubject.teacherName || '').trim(),
      teacherId: isGuru ? user.id : editingSubject.teacherId || matchedTeacher?.id || undefined,
    };

    setIsSavingSubject(true);
    try {
      const res = await apiService.saveSubject(payload);
      if (res.success) {
        setShowSubjectModal(false);
        setEditingSubject(null);
        showToast('success', res.message || `Mata pelajaran "${name}" berhasil disimpan.`);
        await loadAllData();

        // If question, exam, or upload modal is open, auto-select this new subject
        if (res.id) {
          setUploadTargetSubjectId(res.id);
          if (showQuestionModal && editingQuestion) {
            setEditingQuestion((prev) => (prev ? { ...prev, subjectId: res.id } : prev));
          }
          if (showExamModal && editingExam) {
            setEditingExam((prev) => (prev ? { ...prev, subjectId: res.id } : prev));
          }
        }
      } else {
        showToast('error', res.error || 'Gagal menyimpan mata pelajaran.');
      }
    } catch (err: any) {
      showToast('error', 'Terjadi kesalahan saat menyimpan: ' + (err?.message || 'Gagal menghubungi server.'));
    } finally {
      setIsSavingSubject(false);
    }
  };

  const handleDeleteSubject = (id: string, name: string) => {
    setConfirmModal({
      isOpen: true,
      type: 'delete_subject',
      id,
      title: 'Hapus Mata Pelajaran',
      message: `Apakah Anda yakin ingin menghapus mata pelajaran "${name}"? Butir soal dan jadwal ujian terkait mungkin akan terpengaruh.`,
      confirmLabel: 'Hapus Mapel',
      isDestructive: true,
    });
  };

  // Save / Delete Rombel Kelas (ClassRoom)
  const handleSaveClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClass || !editingClass.name?.trim()) {
      showToast('error', 'Nama rombel kelas wajib diisi.');
      return;
    }

    const name = editingClass.name.trim();
    const grade: 'X' | 'XI' | 'XII' =
      editingClass.grade === 'XI' || editingClass.grade === 'XII' ? editingClass.grade : 'X';
    const description = (editingClass.description || '').trim();

    setIsSavingClass(true);
    try {
      const res = await apiService.saveClass({
        ...editingClass,
        name,
        grade,
        description,
      });
      if (res.success) {
        setShowClassModal(false);
        setEditingClass(null);
        showToast('success', res.message || `Rombel kelas "${name}" berhasil disimpan.`);
        await loadAllData();

        if (res.id) {
          if (showQuestionModal && editingQuestion) {
            setEditingQuestion((prev) => (prev ? { ...prev, classId: res.id! } : prev));
          }
          if (showExamModal && editingExam) {
            setEditingExam((prev) => (prev ? { ...prev, classId: res.id! } : prev));
          }
          if (showStudentModal) {
            setNewStudentData((prev) => ({ ...prev, classId: res.id! }));
          }
        }
      } else {
        showToast('error', res.error || 'Gagal menyimpan rombel kelas.');
      }
    } catch (err: any) {
      showToast('error', 'Terjadi kesalahan saat menyimpan rombel: ' + (err?.message || 'Gagal menghubungi server.'));
    } finally {
      setIsSavingClass(false);
    }
  };

  const handleDeleteClass = (id: string, name: string) => {
    const studentCount = students.filter((st) => st.classId === id).length;
    setConfirmModal({
      isOpen: true,
      type: 'delete_class',
      id,
      title: 'Hapus Rombel Kelas',
      message: `Apakah Anda yakin ingin menghapus rombel kelas "${name}"${
        studentCount > 0 ? ` yang memiliki ${studentCount} siswa terdaftar` : ''
      }?`,
      confirmLabel: 'Hapus Rombel',
      isDestructive: true,
    });
  };

  const handleMoveStudentClass = async (student: User, newClassId: string) => {
    if (!newClassId || student.classId === newClassId) return;
    try {
      const res = await apiService.saveStudent({
        id: student.id,
        username: student.username,
        fullName: student.fullName,
        classId: newClassId,
      });
      if (res.success) {
        const clsName = classes.find((c) => c.id === newClassId)?.name || newClassId;
        showToast('success', `${student.fullName} berhasil dipindahkan ke rombel ${clsName}.`);
        await loadAllData();
      } else {
        showToast('error', res.error || 'Gagal memindahkan rombel siswa.');
      }
    } catch {
      showToast('error', 'Gagal memperbarui rombel siswa.');
    }
  };

  // Reset Student Exam Session (In-app modal)
  const handleResetStudentAttempt = (resultId: string, studentName: string) => {
    setConfirmModal({
      isOpen: true,
      type: 'reset_attempt',
      id: resultId,
      title: 'Reset Sesi Ujian Siswa',
      message: `Apakah Anda yakin ingin MERESET sesi ujian untuk siswa ${studentName}? Data pengerjaan yang macet akan dibersihkan agar siswa dapat ujian kembali dari awal.`,
      confirmLabel: 'Ya, Reset Sesi',
      isDestructive: true,
    });
  };

  // Reset Student Password (In-app modal)
  const handleResetStudentPassword = (userId: string, studentName: string) => {
    setConfirmModal({
      isOpen: true,
      type: 'reset_password',
      id: userId,
      title: 'Reset Kata Sandi Siswa',
      message: `Reset kata sandi ${studentName} kembali ke bawaan sistem: 'Siswa123!'?`,
      confirmLabel: 'Reset Kata Sandi',
      isDestructive: false,
    });
  };

  // Save / Delete Question
  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQuestion || !editingQuestion.questionText || !editingQuestion.subjectId) {
      showToast('error', 'Lengkapi seluruh bidang pertanyaan dan mata pelajaran.');
      return;
    }
    try {
      const res = await apiService.saveQuestion(editingQuestion);
      if (res.success) {
        setShowQuestionModal(false);
        setEditingQuestion(null);
        showToast('success', 'Butir soal berhasil disimpan.');
        loadAllData();
      }
    } catch {
      showToast('error', 'Gagal menyimpan butir soal.');
    }
  };

  const handleDeleteQuestion = (id: string) => {
    setConfirmModal({
      isOpen: true,
      type: 'delete_question',
      id,
      title: 'Hapus Butir Soal',
      message: 'Apakah Anda yakin ingin menghapus butir soal ini dari bank soal? Tindakan ini tidak dapat dibatalkan.',
      confirmLabel: 'Hapus Soal',
      isDestructive: true,
    });
  };

  const handleDeleteAllQuestionsBySubject = (subjectId: string, subjectName: string, count: number) => {
    setConfirmModal({
      isOpen: true,
      type: 'delete_subject_questions',
      id: subjectId,
      title: `Kosongkan Soal ${subjectName}`,
      message: `Apakah Anda yakin ingin menghapus seluruh ${count} butir soal pada mata pelajaran "${subjectName}"? Gunakan fitur ini sebelum mengunggah ulang file CSV baru.`,
      confirmLabel: `Hapus ${count} Soal`,
      isDestructive: true,
    });
  };

  const handleQuickChangeAnswerKey = async (q: Question, newKey: 'A' | 'B' | 'C' | 'D' | 'E') => {
    if (q.correctAnswer === newKey) return;
    // Optimistic update
    setQuestions((prev) =>
      prev.map((item) => (item.id === q.id ? { ...item, correctAnswer: newKey } : item))
    );
    try {
      const res = await apiService.saveQuestion({ ...q, correctAnswer: newKey });
      if (res.success) {
        showToast('success', `Kunci jawaban berhasil diubah ke Pilihan ${newKey}.`);
      } else {
        showToast('error', res.error || 'Gagal memperbarui kunci jawaban.');
        loadAllData();
      }
    } catch {
      showToast('error', 'Gagal menyimpan perubahan kunci jawaban.');
      loadAllData();
    }
  };

  const handleQuickChangeQuestionSubject = async (q: Question, newSubjectId: string) => {
    if (!newSubjectId || q.subjectId === newSubjectId) return;
    const targetSubjName = subjects.find((s) => s.id === newSubjectId)?.name || newSubjectId;
    setQuestions((prev) =>
      prev.map((item) => (item.id === q.id ? { ...item, subjectId: newSubjectId } : item))
    );
    try {
      const res = await apiService.saveQuestion({ ...q, subjectId: newSubjectId });
      if (res.success) {
        showToast('success', `Soal berhasil dipindahkan ke mata pelajaran "${targetSubjName}".`);
      } else {
        showToast('error', res.error || 'Gagal memindahkan mata pelajaran soal.');
        loadAllData();
      }
    } catch {
      showToast('error', 'Gagal menyimpan perubahan mata pelajaran soal.');
      loadAllData();
    }
  };

  // Save / Delete Exam
  const handleSaveExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingExam || !editingExam.title || !editingExam.subjectId) {
      showToast('error', 'Judul dan mata pelajaran ujian wajib diisi.');
      return;
    }
    try {
      const subj = subjects.find((s) => s.id === editingExam.subjectId);
      const cls = classes.find((c) => c.id === editingExam.classId);

      const examDate = editingExam.examDate || getLocalDateString();
      const startTime = normalizeTimeHHMM(editingExam.startTime, '07:30');
      const endTime = normalizeTimeHHMM(editingExam.endTime, '23:59');
      const startWindow = buildIsoWindowWithOffset(examDate, startTime, '00');
      const endWindow = buildIsoWindowWithOffset(examDate, endTime, '59');

      const subjectQuestionsCount = questions.filter(
        (q) => q.subjectId === editingExam.subjectId
      ).length;
      const effectiveTotalQuestions =
        subjectQuestionsCount > 0
          ? subjectQuestionsCount
          : Number(editingExam.totalQuestions) || 50;

      const payload: Partial<Exam> = {
        ...editingExam,
        subjectName: subj?.name || 'Mata Pelajaran',
        className: cls?.name || 'Semua Kelas',
        examDate,
        startTime,
        endTime,
        startWindow,
        endWindow,
        durationMinutes: Number(editingExam.durationMinutes) || 45,
        totalQuestions: effectiveTotalQuestions,
        passingScore: Number(editingExam.passingScore) || 75,
        status: editingExam.status || 'published',
        token: (editingExam.token || 'SHM2026').toUpperCase(),
      };

      await apiService.saveExam(payload);
      setShowExamModal(false);
      setEditingExam(null);
      showToast('success', 'Jadwal ujian berhasil disimpan.');
      loadAllData();
    } catch {
      showToast('error', 'Gagal menyimpan jadwal ujian.');
    }
  };

  const handleDeleteExam = (id: string) => {
    setConfirmModal({
      isOpen: true,
      type: 'delete_exam',
      id,
      title: 'Hapus Jadwal Ujian',
      message: 'Apakah Anda yakin ingin menghapus jadwal ujian ini? Data hasil ujian terkait akan terpengaruh.',
      confirmLabel: 'Hapus Jadwal',
      isDestructive: true,
    });
  };

  // Save Student
  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetClassId = newStudentData.classId || classes[0]?.id || 'CLS-10-MIPA';
    if (!newStudentData.username.trim() || !newStudentData.fullName.trim() || !targetClassId) {
      showToast('error', 'Lengkapi username, nama lengkap, dan kelas siswa.');
      return;
    }
    try {
      await apiService.saveStudent({
        username: newStudentData.username.trim(),
        fullName: newStudentData.fullName.trim(),
        classId: targetClassId,
        password: (newStudentData.password || 'Siswa123!').trim() || 'Siswa123!',
      });
      setShowStudentModal(false);
      setNewStudentData({ username: '', fullName: '', classId: classes[0]?.id || '', password: 'Siswa123!' });
      showToast('success', 'Akun siswa berhasil ditambahkan.');
      await loadAllData();
    } catch {
      showToast('error', 'Gagal menambah siswa.');
    }
  };

  const handleDeleteStudent = (userId: string, name: string) => {
    setConfirmModal({
      isOpen: true,
      type: 'delete_student',
      id: userId,
      title: 'Hapus Akun Siswa',
      message: `Apakah Anda yakin ingin menghapus akun siswa ${name}? Akses login siswa ini akan dicabut.`,
      confirmLabel: 'Hapus Akun',
      isDestructive: true,
    });
  };

  // Save / Delete / Reset Teacher Account (Akun Guru)
  const handleSaveTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeacher || !editingTeacher.username.trim() || !editingTeacher.fullName.trim()) {
      showToast('error', 'Nama lengkap dan username login guru wajib diisi.');
      return;
    }

    const cleanFullName = editingTeacher.fullName.trim();
    const cleanUsername = editingTeacher.username.trim();
    setIsSavingTeacher(true);
    try {
      const res = await apiService.saveTeacher({
        id: editingTeacher.id,
        username: cleanUsername,
        fullName: cleanFullName,
        password: editingTeacher.password?.trim() || undefined,
      });

      if (res.success) {
        const savedTeacherId = res.id || editingTeacher.id || '';
        const selectedIds = new Set<string>(
          editingTeacher.subjectIds && editingTeacher.subjectIds.length > 0
            ? editingTeacher.subjectIds
            : editingTeacher.subjectId
            ? [editingTeacher.subjectId]
            : []
        );

        // Sinkronkan penautan mata pelajaran yang diampu oleh guru ini
        for (const subj of subjects) {
          const wasTaughtByThisTeacher =
            Boolean(editingTeacher.id) &&
            isSubjectTaughtByTeacher(subj, {
              id: editingTeacher.id || '',
              username: cleanUsername,
              fullName: cleanFullName,
            });
          const shouldBeTaught = selectedIds.has(subj.id);

          if (shouldBeTaught) {
            await apiService.saveSubject({
              ...subj,
              teacherName: cleanFullName,
              teacherId: savedTeacherId || subj.teacherId,
            });
          } else if (wasTaughtByThisTeacher && editingTeacher.subjectIds !== undefined) {
            await apiService.saveSubject({
              ...subj,
              teacherName: '',
              teacherId: '',
            });
          }
        }

        // Jika modal mata pelajaran sedang terbuka, otomatis isi nama guru pengampu
        if (showSubjectModal && editingSubject) {
          setEditingSubject((prev) =>
            prev ? { ...prev, teacherName: cleanFullName, teacherId: savedTeacherId } : prev
          );
        }

        setShowTeacherModal(false);
        setEditingTeacher(null);
        showToast('success', res.message || `Akun guru "${cleanFullName}" berhasil disimpan.`);
        await loadAllData();
      } else {
        showToast('error', res.error || 'Gagal menyimpan akun guru.');
      }
    } catch (err: any) {
      showToast('error', 'Gagal menyimpan akun guru: ' + (err?.message || 'Kesalahan jaringan.'));
    } finally {
      setIsSavingTeacher(false);
    }
  };

  // Tautkan mata pelajaran untuk akun guru yang sedang login
  const handleClaimSubjectForTeacher = async (subjectIdToClaim: string) => {
    if (!subjectIdToClaim) {
      showToast('error', 'Pilih mata pelajaran yang Anda ampu terlebih dahulu.');
      return;
    }
    const targetSubj = subjects.find((s) => s.id === subjectIdToClaim);
    if (!targetSubj) return;

    try {
      const res = await apiService.saveSubject({
        ...targetSubj,
        teacherName: user.fullName,
        teacherId: user.id,
      });
      if (res.success) {
        setClaimSubjectId('');
        showToast('success', `Mata pelajaran "${targetSubj.name}" berhasil ditautkan ke akun Anda.`);
        await loadAllData();
      } else {
        showToast('error', res.error || 'Gagal menautkan mata pelajaran.');
      }
    } catch {
      showToast('error', 'Gagal menautkan mata pelajaran ke akun guru.');
    }
  };

  const handleDeleteTeacher = (userId: string, name: string) => {
    setConfirmModal({
      isOpen: true,
      type: 'delete_teacher',
      id: userId,
      title: 'Hapus Akun Guru',
      message: `Apakah Anda yakin ingin menghapus akun guru "${name}"? Akses login guru ini akan dicabut.`,
      confirmLabel: 'Hapus Akun Guru',
      isDestructive: true,
    });
  };

  const handleResetTeacherPassword = (userId: string, teacherName: string) => {
    setConfirmModal({
      isOpen: true,
      type: 'reset_teacher_password',
      id: userId,
      title: 'Reset Kata Sandi Guru',
      message: `Reset kata sandi akun guru "${teacherName}" kembali ke bawaan sistem: 'Guru123!'?`,
      confirmLabel: 'Reset Kata Sandi',
      isDestructive: false,
    });
  };

  // Export Grades to CSV Format
  const handleExportCSV = () => {
    if (visibleExamResults.length === 0) {
      showToast('error', 'Belum ada data nilai untuk diekspor.');
      return;
    }

    const headers = ['ID Sesi', 'Nama Siswa', 'Username/NISN', 'ID Ujian', 'Skor Akhir', 'Benar', 'Salah', 'Kosong', 'Pelanggaran', 'Status', 'Waktu Submit'];
    const rows = visibleExamResults.map((r) => [
      r.id,
      `"${r.studentName || ''}"`,
      r.username || '',
      r.examId || '',
      r.totalScore ?? 0,
      r.correctCount ?? 0,
      r.incorrectCount ?? 0,
      r.unansweredCount ?? 0,
      r.violationCount ?? 0,
      r.status,
      r.endTime ? new Date(r.endTime).toLocaleString('id-ID') : '-',
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Rekap_Nilai_CBT_Sirajul_Huda_${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('success', 'File rekap nilai CSV berhasil diunduh.');
  };

  // Test GAS Web App Connection
  const handleTestGasConnection = async () => {
    if (!gasUrlInput.trim()) {
      showToast('error', 'Masukkan URL Web App Google Apps Script terlebih dahulu.');
      return;
    }
    setGasTestStatus('testing');
    try {
      const cleanUrl = gasUrlInput.trim();
      const isOnline = await apiService.pingGasEndpoint(cleanUrl);
      if (isOnline) {
        setGasTestStatus('success');
        apiService.saveConfig({ gasWebAppUrl: cleanUrl, useLiveGas: true });
        await apiService.syncAllLocalDataToGas(cleanUrl);
        await loadAllData();
        showToast('success', 'Koneksi ke Google Apps Script berhasil & tersinkronisasi untuk semua perangkat!');
      } else {
        setGasTestStatus('error');
        showToast('error', 'Gagal terhubung ke GAS. Pastikan Web App di-deploy dengan akses Anyone.');
      }
    } catch {
      setGasTestStatus('error');
      showToast('error', 'Terjadi kesalahan saat menguji endpoint GAS.');
    }
  };

  const handleRemoteSetupDatabase = async () => {
    if (!gasUrlInput.trim()) {
      showToast('error', 'Masukkan URL Web App Google Apps Script terlebih dahulu.');
      return;
    }
    setGasSetupStatus('running');
    try {
      const cleanUrl = gasUrlInput.trim();
      const res = await apiService.setupGasDatabase(cleanUrl);
      if (res.success) {
        setGasSetupStatus('done');
        await loadAllData();
        showToast('success', res.message || 'Database Google Sheets berhasil disiapkan & disinkronkan!');
      } else {
        setGasSetupStatus('error');
        showToast('error', res.error || 'Gagal menyiapkan database di Google Sheets.');
      }
    } catch {
      setGasSetupStatus('error');
      showToast('error', 'Terjadi kendala saat memicu setup database Google Sheets.');
    }
  };

  const handleSyncAllDevicesAndSpreadsheet = async () => {
    const cleanUrl = gasUrlInput.trim() || apiService.getConfig().gasWebAppUrl;
    if (!cleanUrl) {
      showToast('error', 'Masukkan URL Web App Google Apps Script terlebih dahulu.');
      return;
    }
    setIsSyncingSpreadsheet(true);
    try {
      apiService.saveConfig({ gasWebAppUrl: cleanUrl, useLiveGas: true });
      await apiService.syncAllLocalDataToGas(cleanUrl);
      await loadAllData();
      showToast('success', 'Seluruh akun Siswa & Guru di Spreadsheet berhasil disinkronkan untuk semua perangkat!');
    } catch {
      showToast('error', 'Gagal menyinkronkan data dengan Google Spreadsheet.');
    } finally {
      setIsSyncingSpreadsheet(false);
    }
  };

  const handleCopyShareableLoginLink = () => {
    const cleanUrl = gasUrlInput.trim() || apiService.getConfig().gasWebAppUrl;
    const baseUrl = window.location.origin + window.location.pathname;
    const shareUrl = cleanUrl ? `${baseUrl}?gas=${encodeURIComponent(cleanUrl)}` : baseUrl;
    navigator.clipboard.writeText(shareUrl);
    showToast('success', 'Tautan login lintas perangkat berhasil disalin!');
  };

  // Copy code helpers
  const handleCopyCode = (type: 'code_gs' | 'index_html', text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCodeType(type);
    setTimeout(() => setCopiedCodeType(null), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Banner Identitas Khusus Akun Guru (Menampilkan Mapel yang Diampu) */}
      {isGuru && (
        <div className="bg-gradient-to-r from-emerald-900 to-teal-800 rounded-2xl p-5 sm:p-6 text-white shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white/15 text-emerald-100 text-[11px] font-bold uppercase tracking-wider">
              <BookOpen className="w-3.5 h-3.5" />
              <span>Portal Guru Mata Pelajaran</span>
            </div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight">
              Selamat bertugas, {user.fullName}
            </h1>
            <p className="text-xs text-emerald-100/90 leading-relaxed">
              Akun guru Anda hanya memuat dan mengelola <strong>Bank Soal</strong>, <strong>Jadwal Ujian</strong>, serta <strong>Rekap Nilai</strong> khusus untuk mata pelajaran yang Anda ampu.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col items-start sm:items-center lg:items-end gap-2.5 shrink-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-emerald-200 font-medium">Mapel Diampu:</span>
              {visibleSubjects.length > 0 ? (
                visibleSubjects.map((s) => (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white text-emerald-900 text-xs font-bold shadow-xs"
                  >
                    <span>{s.name}</span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      {s.code}
                    </span>
                  </span>
                ))
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-400/20 border border-amber-300/40 text-amber-100 text-xs font-semibold">
                  Belum ada mata pelajaran tertaut
                </span>
              )}
            </div>

            {visibleSubjects.length === 0 && (
              <div className="flex flex-wrap items-center gap-2 bg-white/10 p-2 rounded-xl border border-white/15">
                {subjects.length > 0 && (
                  <>
                    <select
                      value={claimSubjectId}
                      onChange={(e) => setClaimSubjectId(e.target.value)}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-white text-slate-900 font-semibold"
                    >
                      <option value="">-- Pilih Mapel yang Anda Ampu --</option>
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.code})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleClaimSubjectForTeacher(claimSubjectId)}
                      className="px-3 py-1.5 text-xs font-bold bg-emerald-400 hover:bg-emerald-300 text-emerald-950 rounded-lg transition-colors cursor-pointer"
                    >
                      Tautkan Mapel Saya
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setEditingSubject({
                      name: '',
                      code: '',
                      teacherName: user.fullName,
                      teacherId: user.id,
                    });
                    setShowSubjectModal(true);
                  }}
                  className="px-3 py-1.5 text-xs font-bold bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors cursor-pointer"
                >
                  + Buat Mapel Baru
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Top Banner Stats Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
            {isGuru ? <BookOpen className="w-5 h-5" /> : <Users className="w-5 h-5" />}
          </div>
          <div>
            <span className="text-xs text-slate-500 font-medium block">
              {isGuru ? 'Mata Pelajaran Diampu' : 'Total Siswa'}
            </span>
            <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {isGuru ? visibleSubjects.length : stats.totalStudents}
            </span>
          </div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0 border border-blue-100">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-slate-500 font-medium block">
              {isGuru ? 'Bank Soal Mapel Anda' : 'Bank Soal Aktif'}
            </span>
            <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {isGuru ? visibleQuestions.length : stats.totalQuestions}
            </span>
          </div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center shrink-0 border border-purple-100">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-slate-500 font-medium block">
              {isGuru ? 'Jadwal Ujian Mapel' : 'Jadwal Ujian'}
            </span>
            <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {isGuru ? visibleExams.length : stats.totalExams}
            </span>
          </div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0 border border-amber-100">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-slate-500 font-medium block">
              {isGuru ? 'Peserta Ujian Mapel' : 'Siswa Ujian Aktif'}
            </span>
            <span className="text-xl sm:text-2xl font-bold font-mono text-amber-700 tabular-nums">
              {isGuru
                ? visibleExamResults.filter((r) => r.status === 'in_progress').length
                : stats.activeSessions}
            </span>
          </div>
        </div>
      </div>

      {/* Tab Navigation Pill Bar */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100/80 rounded-xl overflow-x-auto border border-slate-200">
        <button
          onClick={() => onSelectTab('monitoring')}
          className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
            activeTab === 'monitoring'
              ? 'bg-white text-emerald-800 shadow-xs border border-slate-200/60'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Activity className="w-3.5 h-3.5 text-emerald-600" />
          <span>{isGuru ? 'Monitoring Mapel' : 'Monitoring Realtime'}</span>
        </button>

        <button
          onClick={() => onSelectTab('bank-soal')}
          className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
            activeTab === 'bank-soal'
              ? 'bg-white text-emerald-800 shadow-xs border border-slate-200/60'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
          <span>
            {isGuru ? 'Bank Soal Mapel' : 'Bank Soal'} ({visibleQuestions.length})
          </span>
        </button>

        <button
          onClick={() => onSelectTab('jadwal')}
          className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
            activeTab === 'jadwal'
              ? 'bg-white text-emerald-800 shadow-xs border border-slate-200/60'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Calendar className="w-3.5 h-3.5 text-emerald-600" />
          <span>Jadwal Ujian ({visibleExams.length})</span>
        </button>

        {isAdmin && (
          <>
            <button
              onClick={() => onSelectTab('rombel')}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                activeTab === 'rombel'
                  ? 'bg-white text-emerald-800 shadow-xs border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <GraduationCap className="w-3.5 h-3.5 text-emerald-600" />
              <span>Rombel Kelas ({classes.length})</span>
            </button>

            <button
              onClick={() => onSelectTab('siswa')}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                activeTab === 'siswa'
                  ? 'bg-white text-emerald-800 shadow-xs border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5 text-emerald-600" />
              <span>Siswa & Kelas ({students.length})</span>
            </button>

            <button
              onClick={() => onSelectTab('guru')}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                activeTab === 'guru'
                  ? 'bg-white text-emerald-800 shadow-xs border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5 text-emerald-600" />
              <span>Akun Guru ({teachers.length})</span>
            </button>
          </>
        )}

        <button
          onClick={() => onSelectTab('rekap')}
          className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
            activeTab === 'rekap'
              ? 'bg-white text-emerald-800 shadow-xs border border-slate-200/60'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Award className="w-3.5 h-3.5 text-emerald-600" />
          <span>Rekap Nilai ({visibleExamResults.filter((r) => r.status === 'submitted').length})</span>
        </button>

        {isAdmin && (
          <>
            <button
              onClick={() => onSelectTab('logs')}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                activeTab === 'logs'
                  ? 'bg-white text-emerald-800 shadow-xs border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5 text-emerald-600" />
              <span>Log Aktivitas</span>
            </button>

            <button
              onClick={() => onSelectTab('gas-center')}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                activeTab === 'gas-center'
                  ? 'bg-white text-emerald-800 shadow-xs border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Database className="w-3.5 h-3.5 text-emerald-600" />
              <span>Integrasi Google Apps Script</span>
            </button>
          </>
        )}
      </div>

      {/* TAB 1: MONITORING REALTIME */}
      {activeTab === 'monitoring' && (
        <div className="space-y-6">
          {/* Visualisasi Data Recharts: Distribusi Nilai & Tingkat Kehadiran */}
          <AnalyticsCharts
            subjects={visibleSubjects}
            exams={visibleExams}
            students={students}
            examResults={visibleExamResults}
          />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {isGuru
                  ? 'Pengawasan Sesi Ujian Mata Pelajaran Anda'
                  : 'Pengawasan Sesi Ujian Realtime'}
              </h2>
              <p className="text-xs text-slate-500">
                Pantau siswa yang sedang mengerjakan, mendeteksi pelanggaran, dan reset sesi jika siswa terhambat
              </p>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">
                Diperbarui: {lastRefreshedAt.toLocaleTimeString('id-ID')}
              </span>
              <button
                type="button"
                onClick={handleRefreshStatus}
                disabled={isRefreshingStatus}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-emerald-700 ${isRefreshingStatus || loading ? 'animate-spin' : ''}`} />
                <span>{isRefreshingStatus ? 'Menyegarkan...' : 'Segarkan Status'}</span>
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <tr>
                    <th className="py-3 px-4">Nama Siswa</th>
                    <th className="py-3 px-4">Ujian</th>
                    <th className="py-3 px-4">Mulai</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Pelanggaran</th>
                    <th className="py-3 px-4">Nilai Sementara</th>
                    <th className="py-3 px-4 text-right">Tindakan Pengawas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleExamResults.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        {isGuru
                          ? 'Belum ada riwayat pengerjaan ujian pada mata pelajaran yang Anda ampu.'
                          : 'Belum ada riwayat pengerjaan ujian.'}
                      </td>
                    </tr>
                  ) : (
                    visibleExamResults.map((r) => {
                      const isInProgress = r.status === 'in_progress';
                      const hasViolations = r.violationCount > 0;

                      return (
                        <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4 font-semibold text-slate-900">
                            {r.studentName}
                            <span className="block text-[11px] font-normal text-slate-400 font-mono">
                              NISN: {r.username}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-700 font-medium">
                            {exams.find((e) => e.id === r.examId)?.title || r.examId}
                          </td>
                          <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                            {new Date(r.startTime).toLocaleTimeString('id-ID')}
                          </td>
                          <td className="py-3 px-4">
                            {isInProgress ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                                <span>Mengerjakan</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Selesai</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`font-mono font-bold text-xs ${
                                hasViolations ? 'text-rose-600' : 'text-slate-400'
                              }`}
                            >
                              {r.violationCount} strike
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono font-bold text-slate-900 text-sm">
                            {r.status === 'submitted' ? r.totalScore : '-'}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => handleResetStudentAttempt(r.id, r.studentName)}
                              title="Reset status siswa agar dapat mengikuti ujian kembali"
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-200 transition-colors"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Reset Sesi</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: BANK SOAL */}
      {activeTab === 'bank-soal' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {isGuru
                  ? `Bank Soal Mata Pelajaran Diampu (${visibleSubjects.map((s) => s.name).join(', ') || 'Belum Ditautkan'})`
                  : 'Pengelolaan Bank Soal Pilihan Ganda (A-E)'}
              </h2>
              <p className="text-xs text-slate-500">
                {isGuru
                  ? 'Kelola dan unggah butir soal pilihan ganda khusus untuk mata pelajaran yang Anda ampu'
                  : 'Kunci jawaban hanya tersimpan di server dan tidak pernah dikirimkan ke peramban siswa'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingSubject({ name: '', code: '', teacherName: '' });
                    setShowSubjectModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-xl shadow-xs transition-colors cursor-pointer"
                  title="Tambah atau kelola nama mata pelajaran baru"
                >
                  <BookOpen className="w-4 h-4 text-teal-700" />
                  <span>+ Tambah Mata Pelajaran</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (isGuru && visibleSubjects.length === 0) {
                    showToast('error', 'Tautkan atau buat mata pelajaran yang Anda ampu terlebih dahulu.');
                    return;
                  }
                  const defaultId =
                    selectedSubjectFilter !== 'ALL' &&
                    visibleSubjects.some((s) => s.id === selectedSubjectFilter)
                      ? selectedSubjectFilter
                      : visibleSubjects[0]?.id || '';
                  setUploadTargetSubjectId(defaultId);
                  setShowUploadModal(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl shadow-xs transition-colors cursor-pointer"
                title="Unggah bank soal massal via file CSV atau tempel teks"
              >
                <Upload className="w-4 h-4 text-emerald-700" />
                <span>Unggah / Impor Soal</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (isGuru && visibleSubjects.length === 0) {
                    showToast('error', 'Tautkan atau buat mata pelajaran yang Anda ampu terlebih dahulu.');
                    return;
                  }
                  const defaultId =
                    selectedSubjectFilter !== 'ALL' &&
                    visibleSubjects.some((s) => s.id === selectedSubjectFilter)
                      ? selectedSubjectFilter
                      : visibleSubjects[0]?.id || '';
                  setEditingQuestion({
                    subjectId: defaultId,
                    classId: classes[0]?.id || '',
                    points: 10,
                    correctAnswer: 'A',
                    optionA: '',
                    optionB: '',
                    optionC: '',
                    optionD: '',
                    optionE: '',
                  });
                  setShowQuestionModal(true);
                }}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Butir Soal</span>
              </button>
            </div>
          </div>

          {/* Panel Daftar & Pengelolaan Mata Pelajaran */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-emerald-700" />
                <h3 className="font-bold text-slate-900 text-xs sm:text-sm">
                  {isGuru
                    ? `Mata Pelajaran yang Anda Ampu (${visibleSubjects.length})`
                    : `Daftar Mata Pelajaran Terdaftar (${visibleSubjects.length})`}
                </h3>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingSubject({ name: '', code: '', teacherName: '' });
                    setShowSubjectModal(true);
                  }}
                  className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah Mapel Baru</span>
                </button>
              )}
            </div>

            {visibleSubjects.length === 0 ? (
              <div className="p-6 rounded-xl border border-amber-200 bg-amber-50/70 text-center space-y-2">
                <p className="text-xs font-bold text-amber-900">
                  Akun Anda belum ditautkan ke mata pelajaran mana pun.
                </p>
                <p className="text-[11px] text-amber-800">
                  Silakan pilih mata pelajaran yang Anda ampu pada panel di atas, atau hubungi Administrator CBT.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {visibleSubjects.map((s) => {
                  const count = visibleQuestions.filter((q) => q.subjectId === s.id).length;
                  const isSelectedCard = selectedSubjectFilter === s.id;
                  return (
                    <div
                      key={s.id}
                      className={`p-3 rounded-xl border transition-colors flex items-center justify-between gap-3 ${
                        isSelectedCard
                          ? 'border-emerald-500 bg-emerald-50/50 ring-1 ring-emerald-500/20'
                          : 'border-slate-200 bg-slate-50/70 hover:bg-slate-50'
                      }`}
                    >
                      <div
                        onClick={() => setSelectedSubjectFilter(s.id)}
                        className="space-y-0.5 min-w-0 cursor-pointer flex-1"
                        title={`Klik untuk memfilter soal ${s.name}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded">
                            {s.code}
                          </span>
                          <h4 className="font-bold text-slate-900 text-xs truncate">{s.name}</h4>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">
                          {s.teacherName || 'Guru Pengampu: Belum diatur'}
                        </p>
                        <span className="text-[10px] text-slate-400 font-medium">
                          {count} butir soal tersedia
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setUploadTargetSubjectId(s.id);
                            setShowUploadModal(true);
                          }}
                          title={`Unggah Soal ke ${s.name}`}
                          className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5" />
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSubject(s);
                                setShowSubjectModal(true);
                              }}
                              title="Ubah Mata Pelajaran"
                              className="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-white rounded-lg transition-colors cursor-pointer"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSubject(s.id, s.name)}
                              title="Hapus Mata Pelajaran"
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-white rounded-lg transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Filter Mata Pelajaran & Aksi Cepat Bersihkan Soal */}
          <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-xs font-bold text-slate-700">Filter Mata Pelajaran:</span>
              <select
                value={selectedSubjectFilter}
                onChange={(e) => setSelectedSubjectFilter(e.target.value)}
                className="text-xs px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-semibold text-slate-800"
              >
                {(!isGuru || visibleSubjects.length > 1) && (
                  <option value="ALL">
                    {isGuru
                      ? `Semua Mapel Diampu (${visibleQuestions.length} Soal)`
                      : `Semua Mata Pelajaran (${visibleQuestions.length} Soal)`}
                  </option>
                )}
                {visibleSubjects.map((s) => {
                  const c = visibleQuestions.filter((q) => q.subjectId === s.id).length;
                  return (
                    <option key={s.id} value={s.id}>
                      {s.name} ({c} Soal)
                    </option>
                  );
                })}
              </select>
              {selectedSubjectFilter !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => {
                    const subj = visibleSubjects.find((s) => s.id === selectedSubjectFilter);
                    const count = visibleQuestions.filter((q) => q.subjectId === selectedSubjectFilter).length;
                    if (subj && count > 0) {
                      handleDeleteAllQuestionsBySubject(subj.id, subj.name, count);
                    }
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                >
                  Kosongkan Soal Mapel Ini
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              💡 Klik langsung pada salah satu pilihan <strong>A / B / C / D / E</strong> di kartu soal untuk mengubah Kunci Jawaban secara instan.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleQuestions
              .filter((q) => selectedSubjectFilter === 'ALL' || q.subjectId === selectedSubjectFilter)
              .map((q, idx) => (
              <div key={q.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 shrink-0">
                      Soal #{idx + 1}
                    </span>
                    <select
                      value={visibleSubjects.some((s) => s.id === q.subjectId) ? q.subjectId : visibleSubjects[0]?.id || q.subjectId}
                      onChange={(e) => handleQuickChangeQuestionSubject(q, e.target.value)}
                      title="Mata Pelajaran Sasaran Soal"
                      className="text-slate-600 font-semibold text-[11px] bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded px-2 py-0.5 max-w-[170px] truncate cursor-pointer"
                    >
                      {visibleSubjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.code})
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-800 font-medium line-clamp-3 leading-relaxed">
                    {q.questionText}
                  </p>
                  <div className="pt-2 text-[11px] text-slate-600 space-y-1">
                    {(['A', 'B', 'C', 'D', 'E'] as const).map((letter) => {
                      const optKey = `option${letter}` as keyof Question;
                      const isCorrect = q.correctAnswer === letter;
                      return (
                        <div
                          key={letter}
                          onClick={() => handleQuickChangeAnswerKey(q, letter)}
                          title={`Klik untuk menetapkan Pilihan ${letter} sebagai Kunci Jawaban`}
                          className={`flex items-start gap-1.5 px-2 py-1 rounded-md border cursor-pointer transition-colors ${
                            isCorrect
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-900 font-bold'
                              : 'bg-slate-50/60 border-transparent text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          <span className="shrink-0">{letter}.</span>
                          <span className="truncate">{String(q[optKey] || '-')}</span>
                        </div>
                      );
                    })}
                    <div className="pt-1.5 flex items-center justify-between font-semibold text-emerald-700">
                      <span>Kunci Jawaban:</span>
                      <select
                        value={q.correctAnswer}
                        onChange={(e) =>
                          handleQuickChangeAnswerKey(
                            q,
                            e.target.value as 'A' | 'B' | 'C' | 'D' | 'E'
                          )
                        }
                        className="font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300 text-[11px] cursor-pointer"
                      >
                        {(['A', 'B', 'C', 'D', 'E'] as const).map((k) => (
                          <option key={k} value={k}>
                            Pilihan {k}
                          </option>
                        ))}
                      </select>
                    </div>
                    {q.explanation && (
                      <p className="italic text-slate-400 line-clamp-2">
                        Pembahasan: {q.explanation}
                      </p>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                  <button
                    onClick={() => {
                      setEditingQuestion({ ...q, correctAnswer: q.correctAnswer });
                      setShowQuestionModal(true);
                    }}
                    className="p-1.5 text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors"
                    title="Ubah Soal"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteQuestion(q.id)}
                    className="p-1.5 text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors"
                    title="Hapus Soal"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: JADWAL UJIAN */}
      {activeTab === 'jadwal' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {isGuru
                  ? 'Jadwal Ujian Mata Pelajaran yang Anda Ampu'
                  : 'Pengelolaan Jadwal Ujian Semester'}
              </h2>
              <p className="text-xs text-slate-500">
                Atur tanggal pelaksanaan, jam buka & tutup (otomatis aktif), token pengawas, dan kelas target
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={handleRefreshStatus}
                disabled={isRefreshingStatus}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-emerald-700 ${isRefreshingStatus || loading ? 'animate-spin' : ''}`} />
                <span>{isRefreshingStatus ? 'Menyegarkan...' : 'Segarkan Status'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (isGuru && visibleSubjects.length === 0) {
                    showToast('error', 'Tautkan atau buat mata pelajaran yang Anda ampu terlebih dahulu.');
                    return;
                  }
                  const today = getLocalDateString();
                  const defaultSubjId = visibleSubjects[0]?.id || '';
                  const bankCount = visibleQuestions.filter((q) => q.subjectId === defaultSubjId).length;
                  setEditingExam({
                    title: '',
                    subjectId: defaultSubjId,
                    classId: classes[0]?.id || '',
                    examDate: today,
                    startTime: '07:30',
                    endTime: '09:00',
                    durationMinutes: 45,
                    totalQuestions: bankCount > 0 ? bankCount : (visibleQuestions.length > 0 ? visibleQuestions.length : 50),
                    passingScore: 75,
                    token: 'SHM2026',
                    status: 'published',
                    randomizeQuestions: false,
                    randomizeOptions: false,
                    maxViolations: 3,
                  });
                  setShowExamModal(true);
                }}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Buat Jadwal Ujian Baru</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visibleExams.map((ex) => {
              const schedule = getExamScheduleStatus(ex);
              const bankQuestionCount = questions.filter((q) => q.subjectId === ex.subjectId).length;
              const displayTotalQuestions = bankQuestionCount > 0 ? bankQuestionCount : ex.totalQuestions;
              return (
                <div key={ex.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-100">
                      {ex.subjectName}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded border ${schedule.badgeClass}`}>
                        {schedule.status === 'active' && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        )}
                        <span>{schedule.label}</span>
                      </span>
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                        {ex.status}
                      </span>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                      {ex.title}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Target: <span className="font-semibold text-slate-700">{ex.className}</span> &middot; Durasi: {ex.durationMinutes} Menit &middot; Soal: <span className="font-semibold text-emerald-700">{displayTotalQuestions} Butir PG</span>
                    </p>
                  </div>

                  {/* Date & Time Schedule Card Strip */}
                  <div className="p-3 bg-slate-50/90 rounded-xl border border-slate-200/80 space-y-2 text-xs">
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
                    <div className="pt-1.5 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">Status Aktivasi:</span>
                      <span className={schedule.status === 'active' ? 'font-bold text-emerald-700' : 'text-slate-600'}>
                        {schedule.details}
                      </span>
                    </div>
                  </div>

                  <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-slate-500">Token Ujian Pengawas:</span>
                    <span className="font-mono font-bold text-slate-900 tracking-wider">
                      {ex.token}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
                    <button
                      onClick={() => {
                        setEditingExam({
                          ...ex,
                          ...normalizeExamScheduleFields(ex),
                        });
                        setShowExamModal(true);
                      }}
                      className="p-1.5 text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded-lg cursor-pointer"
                      title="Ubah Jadwal"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteExam(ex.id)}
                      className="p-1.5 text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 rounded-lg cursor-pointer"
                      title="Hapus Jadwal"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 4: SISWA & KELAS */}
      {activeTab === 'siswa' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Pengelolaan Akun Siswa & Kelas
              </h2>
              <p className="text-xs text-slate-500">
                Siswa di-hash dengan unique salt per akun. Dilengkapi fitur reset kata sandi mandiri.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => {
                  setEditingTeacher({ username: '', fullName: '', password: 'Guru123!', subjectId: '' });
                  setShowTeacherModal(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <KeyRound className="w-4 h-4 text-emerald-700" />
                <span>+ Tambah Akun Guru</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewStudentData({
                    username: '',
                    fullName: '',
                    classId: classes[0]?.id || 'CLS-10-MIPA',
                    password: 'Siswa123!',
                  });
                  setShowStudentModal(true);
                }}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Siswa Baru</span>
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <tr>
                    <th className="py-3 px-4">Nama Lengkap</th>
                    <th className="py-3 px-4">Username / NISN</th>
                    <th className="py-3 px-4">Kelas</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students.map((st) => (
                    <tr key={st.id} className="hover:bg-slate-50/80">
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {st.fullName}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600">
                        {st.username}
                      </td>
                      <td className="py-3 px-4 text-slate-700 font-medium">
                        {classes.find((c) => c.id === st.classId)?.name || st.classId || 'X MIPA'}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-block text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          Aktif
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right space-x-2">
                        <button
                          onClick={() => handleResetStudentPassword(st.id, st.fullName)}
                          className="px-2 py-1 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded border border-amber-200"
                          title="Reset kata sandi siswa"
                        >
                          Reset Sandi
                        </button>
                        <button
                          onClick={() => handleDeleteStudent(st.id, st.fullName)}
                          className="px-2 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded border border-rose-200"
                          title="Hapus akun"
                        >
                          Hapus
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: AKUN GURU */}
      {activeTab === 'guru' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Manajemen Akun Guru & Pengawas Ujian
              </h2>
              <p className="text-xs text-slate-500">
                Kelola akun login guru pengampu mata pelajaran untuk mengelola Bank Soal, Jadwal Ujian, Monitoring, dan Rekap Nilai
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingTeacher({ username: '', fullName: '', password: 'Guru123!', subjectId: '' });
                setShowTeacherModal(true);
              }}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl shadow-xs transition-colors self-start sm:self-auto cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah Akun Guru</span>
            </button>
          </div>

          {/* Info Akses Login Guru */}
          <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-700 text-white flex items-center justify-center shrink-0 mt-0.5">
                <KeyRound className="w-4 h-4" />
              </div>
              <div className="space-y-0.5">
                <h3 className="text-xs font-bold text-emerald-950">
                  Informasi Kredensial & Hak Akses Akun Guru
                </h3>
                <p className="text-xs text-emerald-800 leading-relaxed">
                  Setiap akun guru baru dapat langsung login di halaman depan menggunakan <strong>Username / NIP</strong> dan kata sandi bawaan <code className="px-1.5 py-0.5 bg-white rounded border border-emerald-200 font-mono font-bold">Guru123!</code> (atau kata sandi khusus yang Anda tentukan).
                </p>
              </div>
            </div>
            <div className="relative w-full sm:w-64 shrink-0">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={teacherSearchQuery}
                onChange={(e) => setTeacherSearchQuery(e.target.value)}
                placeholder="Cari nama guru atau username..."
                className="w-full text-xs pl-8 pr-3 py-2 bg-white border border-emerald-200 rounded-xl focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Tabel Daftar Akun Guru */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <tr>
                    <th className="py-3 px-4">No</th>
                    <th className="py-3 px-4">Nama Lengkap Guru</th>
                    <th className="py-3 px-4">Username Login / NIP</th>
                    <th className="py-3 px-4">Mata Pelajaran Diampu</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {teachers.filter((t) => {
                    const q = teacherSearchQuery.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      t.fullName.toLowerCase().includes(q) ||
                      t.username.toLowerCase().includes(q)
                    );
                  }).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        Belum ada akun guru yang sesuai pencarian. Klik &quot;Tambah Akun Guru&quot; untuk membuat akun baru.
                      </td>
                    </tr>
                  ) : (
                    teachers
                      .filter((t) => {
                        const q = teacherSearchQuery.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          t.fullName.toLowerCase().includes(q) ||
                          t.username.toLowerCase().includes(q)
                        );
                      })
                      .map((tch, idx) => {
                        const taughtSubjects = subjects.filter((s) =>
                          isSubjectTaughtByTeacher(s, tch)
                        );

                        return (
                          <tr key={tch.id} className="hover:bg-slate-50/80">
                            <td className="py-3 px-4 font-mono text-slate-400">{idx + 1}</td>
                            <td className="py-3 px-4 font-semibold text-slate-900">
                              {tch.fullName}
                            </td>
                            <td className="py-3 px-4 font-mono font-semibold text-emerald-800">
                              {tch.username}
                            </td>
                            <td className="py-3 px-4">
                              {taughtSubjects.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {taughtSubjects.map((sub) => (
                                    <span
                                      key={sub.id}
                                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200"
                                    >
                                      {sub.name} ({sub.code})
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 text-[11px] font-semibold">
                                  Belum Ditautkan ke Mapel
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              <span className="inline-block text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                Aktif
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => {
                                  const firstSubj = taughtSubjects[0]?.id || '';
                                  setEditingTeacher({
                                    id: tch.id,
                                    username: tch.username,
                                    fullName: tch.fullName,
                                    password: '',
                                    subjectId: firstSubj,
                                    subjectIds: taughtSubjects.map((s) => s.id),
                                  });
                                  setShowTeacherModal(true);
                                }}
                                className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-200 cursor-pointer"
                                title="Ubah data akun guru & mapel yang diampu"
                              >
                                Ubah / Pilih Mapel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleResetTeacherPassword(tch.id, tch.fullName)}
                                className="px-2.5 py-1 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded border border-amber-200 cursor-pointer"
                                title="Reset kata sandi ke Guru123!"
                              >
                                Reset Sandi
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteTeacher(tch.id, tch.fullName)}
                                className="px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded border border-rose-200 cursor-pointer"
                                title="Hapus akun guru"
                              >
                                Hapus
                              </button>
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: ROMBEL KELAS (ROMBONGAN BELAJAR) */}
      {activeTab === 'rombel' && (
        <div className="space-y-5">
          {/* Header Rombel Kelas */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Manajemen Rombongan Belajar (Rombel Kelas)
              </h2>
              <p className="text-xs text-slate-500">
                Kelola daftar kelas X, XI, dan XII beserta peminatan dan daftar anggota siswa per rombel
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => {
                  setNewStudentData({
                    username: '',
                    fullName: '',
                    classId: selectedRombelId !== 'ALL' ? selectedRombelId : classes[0]?.id || '',
                    password: 'Siswa123!',
                  });
                  setShowStudentModal(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <Users className="w-4 h-4 text-emerald-700" />
                <span>+ Tambah Siswa ke Rombel</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingClass({ name: '', grade: 'X', description: '' });
                  setShowClassModal(true);
                }}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Rombel Kelas</span>
              </button>
            </div>
          </div>

          {/* Ringkasan Statistik Tingkat Rombel */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div
              onClick={() => setSelectedGradeFilter('ALL')}
              className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                selectedGradeFilter === 'ALL'
                  ? 'bg-emerald-50/70 border-emerald-300 shadow-xs'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-slate-700">Semua Rombel</span>
                <Layers className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-xl font-black font-mono text-slate-900">
                {classes.length} <span className="text-xs font-semibold text-slate-500">Kelas</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Total {students.length} siswa aktif terdaftar
              </p>
            </div>

            {(['X', 'XI', 'XII'] as const).map((lvl) => {
              const lvlClasses = classes.filter((c) => c.grade === lvl);
              const lvlClassIds = new Set(lvlClasses.map((c) => c.id));
              const lvlStudents = students.filter((st) => st.classId && lvlClassIds.has(st.classId)).length;
              const isSelected = selectedGradeFilter === lvl;
              return (
                <div
                  key={lvl}
                  onClick={() => setSelectedGradeFilter(isSelected ? 'ALL' : lvl)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-50/70 border-emerald-300 shadow-xs'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-700">Tingkat Kelas {lvl}</span>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      Kelas {lvl}
                    </span>
                  </div>
                  <div className="text-xl font-black font-mono text-slate-900">
                    {lvlClasses.length} <span className="text-xs font-semibold text-slate-500">Rombel</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {lvlStudents} siswa tergabung di tingkat {lvl}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Filter & Pencarian Rombel */}
          <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-700">Filter Tingkat:</span>
              {(['ALL', 'X', 'XI', 'XII'] as const).map((gradeOpt) => (
                <button
                  key={gradeOpt}
                  type="button"
                  onClick={() => setSelectedGradeFilter(gradeOpt)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                    selectedGradeFilter === gradeOpt
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {gradeOpt === 'ALL' ? 'Semua Tingkat' : `Kelas ${gradeOpt}`}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={rombelSearchQuery}
                onChange={(e) => setRombelSearchQuery(e.target.value)}
                placeholder="Cari nama rombel atau jurusan..."
                className="w-full text-xs pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Daftar Kartu Rombel Kelas */}
          {classes.filter((cls) => {
            const matchGrade = selectedGradeFilter === 'ALL' || cls.grade === selectedGradeFilter;
            const q = rombelSearchQuery.trim().toLowerCase();
            const matchQuery =
              !q ||
              cls.name.toLowerCase().includes(q) ||
              (cls.description || '').toLowerCase().includes(q) ||
              cls.id.toLowerCase().includes(q);
            return matchGrade && matchQuery;
          }).length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3">
              <GraduationCap className="w-10 h-10 text-slate-300 mx-auto" />
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-800">Belum Ada Rombel Kelas yang Sesuai</h3>
                <p className="text-xs text-slate-500">
                  Klik tombol &quot;Tambah Rombel Kelas&quot; di kanan atas untuk membuat rombongan belajar baru.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {classes
                .filter((cls) => {
                  const matchGrade = selectedGradeFilter === 'ALL' || cls.grade === selectedGradeFilter;
                  const q = rombelSearchQuery.trim().toLowerCase();
                  const matchQuery =
                    !q ||
                    cls.name.toLowerCase().includes(q) ||
                    (cls.description || '').toLowerCase().includes(q) ||
                    cls.id.toLowerCase().includes(q);
                  return matchGrade && matchQuery;
                })
                .map((cls) => {
                  const studentCount = students.filter((st) => st.classId === cls.id).length;
                  const examCount = exams.filter((ex) => ex.classId === cls.id).length;
                  const questionCount = questions.filter((q) => q.classId === cls.id).length;
                  const isFocused = selectedRombelId === cls.id;

                  return (
                    <div
                      key={cls.id}
                      className={`bg-white rounded-2xl border p-5 shadow-xs flex flex-col justify-between space-y-4 transition-all ${
                        isFocused
                          ? 'border-emerald-500 ring-2 ring-emerald-500/15'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200">
                            <GraduationCap className="w-3.5 h-3.5 text-emerald-700" />
                            <span>Tingkat {cls.grade}</span>
                          </span>
                          <span className="font-mono text-[10px] text-slate-400">{cls.id}</span>
                        </div>

                        <div>
                          <h3 className="text-base font-bold text-slate-900">{cls.name}</h3>
                          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                            {cls.description || `Rombongan belajar kelas ${cls.name} MA Sirajul Huda Marindi`}
                          </p>
                        </div>

                        {/* Statistik Rombel */}
                        <div className="grid grid-cols-3 gap-2 pt-2">
                          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-center">
                            <span className="block text-sm font-black font-mono text-emerald-700">
                              {studentCount}
                            </span>
                            <span className="text-[10px] font-semibold text-slate-500">Siswa</span>
                          </div>
                          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-center">
                            <span className="block text-sm font-black font-mono text-purple-700">
                              {examCount}
                            </span>
                            <span className="text-[10px] font-semibold text-slate-500">Jadwal Ujian</span>
                          </div>
                          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-center">
                            <span className="block text-sm font-black font-mono text-blue-700">
                              {questionCount}
                            </span>
                            <span className="text-[10px] font-semibold text-slate-500">Soal Khusus</span>
                          </div>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedRombelId(isFocused ? 'ALL' : cls.id)}
                            className={`px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-colors cursor-pointer flex items-center gap-1 ${
                              isFocused
                                ? 'bg-emerald-700 text-white border-emerald-700'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>{isFocused ? 'Semua Siswa' : 'Lihat Siswa'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNewStudentData({
                                username: '',
                                fullName: '',
                                classId: cls.id,
                                password: 'Siswa123!',
                              });
                              setShowStudentModal(true);
                            }}
                            title={`Tambah siswa ke rombel ${cls.name}`}
                            className="px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors cursor-pointer"
                          >
                            + Siswa
                          </button>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingClass(cls);
                              setShowClassModal(true);
                            }}
                            className="p-1.5 text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                            title="Ubah Rombel Kelas"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteClass(cls.id, cls.name)}
                            className="p-1.5 text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors cursor-pointer"
                            title="Hapus Rombel Kelas"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          {/* Tabel Daftar Anggota Siswa per Rombel Kelas */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/60">
              <div>
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Users className="w-4 h-4 text-emerald-700" />
                  <span>
                    Daftar Anggota Siswa Rombel:{' '}
                    <span className="text-emerald-800">
                      {selectedRombelId === 'ALL'
                        ? 'Semua Rombel Kelas'
                        : classes.find((c) => c.id === selectedRombelId)?.name || selectedRombelId}
                    </span>
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Anda juga dapat memindahkan siswa antar rombel kelas langsung melalui pilihan dropdown pada tabel di bawah ini.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={selectedRombelId}
                  onChange={(e) => setSelectedRombelId(e.target.value)}
                  className="text-xs px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-semibold text-slate-800"
                >
                  <option value="ALL">Semua Rombel ({students.length} Siswa)</option>
                  {classes.map((c) => {
                    const cnt = students.filter((st) => st.classId === c.id).length;
                    return (
                      <option key={c.id} value={c.id}>
                        {c.name} ({cnt} Siswa)
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <tr>
                    <th className="py-3 px-4">No</th>
                    <th className="py-3 px-4">Nama Lengkap Siswa</th>
                    <th className="py-3 px-4">Username / NISN</th>
                    <th className="py-3 px-4">Rombel Kelas Saat Ini</th>
                    <th className="py-3 px-4">Pindah Rombel</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students.filter((st) => selectedRombelId === 'ALL' || st.classId === selectedRombelId).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        Belum ada siswa yang terdaftar pada rombel kelas ini.
                      </td>
                    </tr>
                  ) : (
                    students
                      .filter((st) => selectedRombelId === 'ALL' || st.classId === selectedRombelId)
                      .map((st, idx) => {
                        const currentClass = classes.find((c) => c.id === st.classId);
                        return (
                          <tr key={st.id} className="hover:bg-slate-50/80">
                            <td className="py-3 px-4 font-mono text-slate-400">{idx + 1}</td>
                            <td className="py-3 px-4 font-semibold text-slate-900">{st.fullName}</td>
                            <td className="py-3 px-4 font-mono text-slate-600">{st.username}</td>
                            <td className="py-3 px-4">
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
                                {currentClass?.name || st.classId || 'Belum Diatur'}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <select
                                value={st.classId || ''}
                                onChange={(e) => handleMoveStudentClass(st, e.target.value)}
                                className="text-xs px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-700 hover:bg-white cursor-pointer"
                              >
                                <option value="" disabled>
                                  Pilih Rombel...
                                </option>
                                {classes.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name} (Tingkat {c.grade})
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-3 px-4 text-right space-x-2">
                              <button
                                onClick={() => handleResetStudentPassword(st.id, st.fullName)}
                                className="px-2 py-1 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded border border-amber-200 cursor-pointer"
                                title="Reset kata sandi siswa"
                              >
                                Reset Sandi
                              </button>
                              <button
                                onClick={() => handleDeleteStudent(st.id, st.fullName)}
                                className="px-2 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded border border-rose-200 cursor-pointer"
                                title="Hapus akun"
                              >
                                Hapus
                              </button>
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: REKAP NILAI */}
      {activeTab === 'rekap' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {isGuru
                  ? 'Rekapitulasi Nilai Ujian Mata Pelajaran Anda'
                  : 'Rekapitulasi Hasil Ujian Semester'}
              </h2>
              <p className="text-xs text-slate-500">
                Penilaian otomatis dihitung oleh server berdasarkan bobot soal pilihan ganda
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={handleRefreshStatus}
                disabled={isRefreshingStatus}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-emerald-700 ${isRefreshingStatus || loading ? 'animate-spin' : ''}`} />
                <span>{isRefreshingStatus ? 'Menyegarkan...' : 'Segarkan Status'}</span>
              </button>
              <button
                type="button"
                onClick={handleExportCSV}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Ekspor ke File CSV</span>
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <tr>
                    <th className="py-3 px-4">Nama Siswa</th>
                    <th className="py-3 px-4">Ujian</th>
                    <th className="py-3 px-4 text-center">Benar</th>
                    <th className="py-3 px-4 text-center">Salah</th>
                    <th className="py-3 px-4 text-center">Kosong</th>
                    <th className="py-3 px-4 text-center">Pelanggaran</th>
                    <th className="py-3 px-4 text-center">Nilai Akhir</th>
                    <th className="py-3 px-4 text-center">Keterangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleExamResults.filter((r) => r.status === 'submitted').length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400">
                        Belum ada ujian yang dikumpulkan siswa pada mata pelajaran ini.
                      </td>
                    </tr>
                  ) : (
                    visibleExamResults
                      .filter((r) => r.status === 'submitted')
                      .map((r) => {
                        const isPassed = (r.totalScore ?? 0) >= 75;
                        return (
                          <tr key={r.id} className="hover:bg-slate-50/80">
                            <td className="py-3 px-4 font-semibold text-slate-900">
                              {r.studentName}
                            </td>
                            <td className="py-3 px-4 text-slate-700">
                              {exams.find((e) => e.id === r.examId)?.title || r.examId}
                            </td>
                            <td className="py-3 px-4 text-center font-mono font-bold text-emerald-700">
                              {r.correctCount ?? 0}
                            </td>
                            <td className="py-3 px-4 text-center font-mono text-rose-700">
                              {r.incorrectCount ?? 0}
                            </td>
                            <td className="py-3 px-4 text-center font-mono text-slate-400">
                              {r.unansweredCount ?? 0}
                            </td>
                            <td className="py-3 px-4 text-center font-mono text-xs">
                              {r.violationCount || 0}
                            </td>
                            <td className="py-3 px-4 text-center font-mono font-black text-slate-900 text-sm">
                              {r.totalScore}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span
                                className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                                  isPassed
                                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                                }`}
                              >
                                {isPassed ? 'TUNTAS' : 'REMIDI'}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: LOG AKTIVITAS */}
      {activeTab === 'logs' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Jejak Audit Aktivitas Sistem (Audit Trail)
            </h2>
            <p className="text-xs text-slate-500">
              Mencatat seluruh percobaan login, pengerjaan, peringatan kecurangan, dan aksi pengawas
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
            {logs.map((log) => (
              <div key={log.id} className="p-4 flex items-start justify-between gap-4 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{log.userName}</span>
                    <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                      {log.action}
                    </span>
                  </div>
                  <p className="text-slate-600">{log.details}</p>
                </div>
                <span className="text-[11px] text-slate-400 font-mono whitespace-nowrap shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString('id-ID')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 7: INTEGRASI GOOGLE APPS SCRIPT (GAS CENTER) */}
      {activeTab === 'gas-center' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-emerald-800 to-teal-900 rounded-2xl p-6 sm:p-8 text-white space-y-3">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/10 text-emerald-200 text-xs font-semibold">
              <Database className="w-3.5 h-3.5" />
              <span>Pusat Integrasi Google Apps Script & Google Sheets</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
              Panduan Pemasangan & Hubungkan Database Langsung
            </h2>
            <p className="text-xs sm:text-sm text-emerald-100/90 max-w-3xl leading-relaxed">
              Aplikasi ini dirancang untuk bekerja secara sempurna dengan Google Sheets sebagai database utama dan Google Apps Script (GAS) sebagai server backend gratis tanpa perlu sewa server bulanan.
            </p>
          </div>

          {/* Connection URL Bar */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <h3 className="font-bold text-slate-900 text-sm">
              Hubungkan ke Web App Google Apps Script Anda
            </h3>
            <p className="text-xs text-slate-500">
              Tempelkan URL deployment Web App Apps Script Anda di bawah ini untuk mengalihkan penyimpanan dari simulasi lokal ke Google Sheets nyata milik madrasah.
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <input
                type="url"
                value={gasUrlInput}
                onChange={(e) => setGasUrlInput(e.target.value)}
                placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                className="flex-1 px-3.5 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono"
              />
              <button
                onClick={handleTestGasConnection}
                disabled={gasTestStatus === 'testing'}
                className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors shadow-xs flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                {gasTestStatus === 'testing' ? (
                  <span>Menguji Koneksi...</span>
                ) : (
                  <>
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Uji & Hubungkan</span>
                  </>
                )}
              </button>
              <button
                onClick={handleRemoteSetupDatabase}
                disabled={gasSetupStatus === 'running'}
                className="px-4 py-2 text-xs font-bold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 rounded-xl transition-colors shadow-xs flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                title="Klik untuk otomatis membuat seluruh 9 sheet di Google Spreadsheet Anda tanpa harus utak-atik Apps Script"
              >
                {gasSetupStatus === 'running' ? (
                  <span>Menyiapkan Sheet...</span>
                ) : (
                  <>
                    <Database className="w-3.5 h-3.5" />
                    <span>Inisialisasi Sheet (1-Klik)</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <p className="text-[11px] text-slate-500">
                URL Google Apps Script yang terhubung otomatis dibagikan ke seluruh perangkat (HP Siswa &amp; Laptop Guru).
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSyncAllDevicesAndSpreadsheet}
                  disabled={isSyncingSpreadsheet}
                  className="px-3 py-1.5 text-xs font-bold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSpreadsheet ? 'animate-spin' : ''}`} />
                  <span>{isSyncingSpreadsheet ? 'Menyinkronkan...' : 'Sinkronkan Akun Spreadsheet'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyShareableLoginLink}
                  className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Salin Link Login Semua Perangkat</span>
                </button>
              </div>
            </div>

            {gasTestStatus === 'success' && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Koneksi Berhasil! Aplikasi kini tersambung ke Google Apps Script dan Google Sheets untuk semua perangkat.</span>
              </div>
            )}
            {gasTestStatus === 'error' && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Gagal terhubung. Pastikan Web App di-deploy dengan akses &quot;Anyone&quot; (Siapa Saja) dan URL valid.</span>
              </div>
            )}
            {gasSetupStatus === 'done' && (
              <div className="p-3 rounded-lg bg-teal-50 border border-teal-200 text-teal-800 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                <span>9 Sheet Database Berhasil Dibuat di Google Spreadsheet Anda beserta akun Admin default!</span>
              </div>
            )}
          </div>

          {/* Quick Copy Files Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">Kode Backend: Code.gs</h4>
                  <p className="text-[11px] text-slate-500">Berisi LockService, Hashing Salt, Auto-Grading & Timer</p>
                </div>
                <button
                  onClick={async () => {
                    const res = await fetch('/gas/Code.gs');
                    const text = await res.text();
                    handleCopyCode('code_gs', text);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedCodeType === 'code_gs' ? 'Tersalin!' : 'Salin Code.gs'}</span>
                </button>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Salin seluruh isi kode ini lalu tempelkan di file <code>Code.gs</code> di editor Google Apps Script Anda.
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">Dokumentasi & Langkah Deploy</h4>
                  <p className="text-[11px] text-slate-500">Panduan setup sheet, akun admin awal, dan batas kapasitas</p>
                </div>
                <button
                  onClick={async () => {
                    const res = await fetch('/gas/PANDUAN_PEMASANGAN.md');
                    const text = await res.text();
                    handleCopyCode('index_html', text);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-200 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedCodeType === 'index_html' ? 'Tersalin!' : 'Salin Panduan'}</span>
                </button>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Panduan langkah demi langkah dari inisialisasi sheet hingga pengujian 50 peserta serentak secara bertahap.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Tambah / Ubah Soal */}
      {showQuestionModal && editingQuestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-xl border border-slate-200 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base">
                {editingQuestion.id ? 'Ubah Butir Soal' : 'Tambah Butir Soal Baru'}
              </h3>
              <button
                onClick={() => setShowQuestionModal(false)}
                className="text-xs font-semibold text-slate-400 hover:text-slate-600"
              >
                Tutup
              </button>
            </div>

            <form onSubmit={handleSaveQuestion} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-700">Mata Pelajaran</label>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSubject({ name: '', code: '', teacherName: '' });
                          setShowSubjectModal(true);
                        }}
                        className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer"
                      >
                        + Mapel Baru
                      </button>
                    )}
                  </div>
                  <select
                    value={editingQuestion.subjectId}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, subjectId: e.target.value })}
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                    required
                  >
                    {visibleSubjects.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-700">Kelas Target</label>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingClass({ name: '', grade: 'X', description: '' });
                          setShowClassModal(true);
                        }}
                        className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer"
                      >
                        + Rombel Baru
                      </button>
                    )}
                  </div>
                  <select
                    value={editingQuestion.classId || ''}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, classId: e.target.value })}
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    <option value="">Semua Kelas</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Teks Pertanyaan Soal</label>
                <textarea
                  rows={4}
                  value={editingQuestion.questionText || ''}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, questionText: e.target.value })}
                  placeholder="Tuliskan butir soal di sini..."
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white"
                  required
                />
              </div>

              {/* Options A-E */}
              <div className="space-y-2">
                <span className="block text-xs font-semibold text-slate-700">Pilihan Jawaban (A - E):</span>
                {(['optionA', 'optionB', 'optionC', 'optionD', 'optionE'] as const).map((key, i) => {
                  const letter = String.fromCharCode(65 + i);
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="w-6 text-center text-xs font-bold text-slate-700">{letter}.</span>
                      <input
                        type="text"
                        value={editingQuestion[key] || ''}
                        onChange={(e) => setEditingQuestion({ ...editingQuestion, [key]: e.target.value })}
                        placeholder={`Teks pilihan ${letter}`}
                        className="flex-1 text-xs px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white"
                        required
                      />
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Kunci Jawaban Benar (Server Only)</label>
                  <select
                    value={editingQuestion.correctAnswer || 'A'}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, correctAnswer: e.target.value as any })}
                    className="w-full text-xs font-bold px-3 py-2 bg-emerald-50 text-emerald-900 border border-emerald-300 rounded-lg"
                  >
                    <option value="A">Pilihan A</option>
                    <option value="B">Pilihan B</option>
                    <option value="C">Pilihan C</option>
                    <option value="D">Pilihan D</option>
                    <option value="E">Pilihan E</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Bobot Poin</label>
                  <input
                    type="number"
                    value={editingQuestion.points || 10}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, points: Number(e.target.value) })}
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                    min={1}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowQuestionModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-xs"
                >
                  Simpan Soal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Jadwal Ujian */}
      {showExamModal && editingExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <h3 className="font-bold text-slate-900 text-base">
              {editingExam.id ? 'Ubah Jadwal Ujian' : 'Buat Jadwal Ujian Baru'}
            </h3>

            <form onSubmit={handleSaveExam} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Judul Ujian</label>
                <input
                  type="text"
                  value={editingExam.title || ''}
                  onChange={(e) => setEditingExam({ ...editingExam, title: e.target.value })}
                  placeholder="Contoh: Penilaian Akhir Semester Fikih X"
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-700">Mata Pelajaran</label>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSubject({ name: '', code: '', teacherName: '' });
                          setShowSubjectModal(true);
                        }}
                        className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer"
                      >
                        + Mapel Baru
                      </button>
                    )}
                  </div>
                  <select
                    value={editingExam.subjectId}
                    onChange={(e) => {
                      const nextSubjectId = e.target.value;
                      const nextCount = questions.filter((q) => q.subjectId === nextSubjectId).length;
                      setEditingExam({
                        ...editingExam,
                        subjectId: nextSubjectId,
                        totalQuestions: nextCount > 0 ? nextCount : (editingExam.totalQuestions || 50),
                      });
                    }}
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    {visibleSubjects.map((s) => {
                      const qCount = questions.filter((q) => q.subjectId === s.id).length;
                      return (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.code}) — {qCount} Soal
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-700">Kelas Sasaran</label>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingClass({ name: '', grade: 'X', description: '' });
                          setShowClassModal(true);
                        }}
                        className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer"
                      >
                        + Rombel Baru
                      </button>
                    )}
                  </div>
                  <select
                    value={editingExam.classId}
                    onChange={(e) => setEditingExam({ ...editingExam, classId: e.target.value })}
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    <option value="">Seluruh Kelas</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Tanggal & Waktu Pelaksanaan Ujian (Otomatis Aktif) */}
              <div className="p-3.5 bg-emerald-50/70 rounded-xl border border-emerald-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-emerald-700" />
                    <span>Jadwal Tanggal & Jam Ujian</span>
                  </span>
                  <div className="flex items-center gap-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                        const today = getLocalDateString();
                        setEditingExam({ ...editingExam, examDate: today });
                      }}
                      className="px-2 py-0.5 bg-white border border-emerald-300 text-emerald-800 rounded font-medium hover:bg-emerald-100 transition-colors cursor-pointer"
                    >
                      Hari Ini
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const tom = getLocalDateString(new Date(Date.now() + 86400000));
                        setEditingExam({ ...editingExam, examDate: tom });
                      }}
                      className="px-2 py-0.5 bg-white border border-emerald-300 text-emerald-800 rounded font-medium hover:bg-emerald-100 transition-colors cursor-pointer"
                    >
                      Besok
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="sm:col-span-1">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Tanggal Pelaksanaan
                    </label>
                    <input
                      type="date"
                      value={editingExam.examDate || getLocalDateString()}
                      onChange={(e) => setEditingExam({ ...editingExam, examDate: e.target.value })}
                      className="w-full text-xs px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg focus:outline-emerald-600 font-medium"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Jam Mulai (Buka)
                    </label>
                    <input
                      type="time"
                      value={editingExam.startTime || '07:30'}
                      onChange={(e) => setEditingExam({ ...editingExam, startTime: e.target.value })}
                      className="w-full text-xs px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg focus:outline-emerald-600 font-mono"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Jam Selesai (Tutup)
                    </label>
                    <input
                      type="time"
                      value={editingExam.endTime || '23:59'}
                      onChange={(e) => setEditingExam({ ...editingExam, endTime: e.target.value })}
                      className="w-full text-xs px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg focus:outline-emerald-600 font-mono"
                      required
                    />
                  </div>
                </div>

                <p className="text-[11px] text-emerald-800 leading-relaxed bg-white/70 p-2 rounded-lg border border-emerald-200/60">
                  ⚡ <strong>Aktivasi Otomatis:</strong> Siswa hanya dapat membuka dan mengerjakan ujian pada tanggal dan rentang jam di atas. Sebelum jadwal tiba atau setelah jam selesai berakhir, sistem otomatis mengunci akses ujian.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Jumlah Soal</label>
                  <input
                    type="number"
                    value={
                      questions.filter((q) => q.subjectId === editingExam.subjectId).length ||
                      editingExam.totalQuestions ||
                      50
                    }
                    onChange={(e) => setEditingExam({ ...editingExam, totalQuestions: Number(e.target.value) })}
                    className="w-full text-xs font-bold text-emerald-800 px-3 py-2 bg-emerald-50/60 border border-emerald-200 rounded-lg"
                    min={1}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Durasi (Menit)</label>
                  <input
                    type="number"
                    value={editingExam.durationMinutes || 45}
                    onChange={(e) => setEditingExam({ ...editingExam, durationMinutes: Number(e.target.value) })}
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                    min={5}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Token Ujian</label>
                  <input
                    type="text"
                    value={editingExam.token || 'SHM2026'}
                    onChange={(e) => setEditingExam({ ...editingExam, token: e.target.value.toUpperCase() })}
                    className="w-full text-xs font-mono font-bold px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg uppercase"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">KKM Nilai</label>
                  <input
                    type="number"
                    value={editingExam.passingScore || 75}
                    onChange={(e) => setEditingExam({ ...editingExam, passingScore: Number(e.target.value) })}
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowExamModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  Simpan Jadwal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Tambah Siswa Baru */}
      {showStudentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base">Tambah Siswa Baru (Peserta Ujian)</h3>
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                Role: Siswa
              </span>
            </div>
            <form onSubmit={handleSaveStudent} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Lengkap Siswa</label>
                <input
                  type="text"
                  value={newStudentData.fullName}
                  onChange={(e) => setNewStudentData({ ...newStudentData, fullName: e.target.value })}
                  placeholder="Contoh: Muhammad Ilham"
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Username / NISN</label>
                <input
                  type="text"
                  value={newStudentData.username}
                  onChange={(e) => setNewStudentData({ ...newStudentData, username: e.target.value })}
                  placeholder="Contoh: 008129381"
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-mono"
                  required
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">Rombel Kelas</label>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingClass({ name: '', grade: 'X', description: '' });
                      setShowClassModal(true);
                    }}
                    className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer"
                  >
                    + Rombel Baru
                  </button>
                </div>
                <select
                  value={newStudentData.classId}
                  onChange={(e) => setNewStudentData({ ...newStudentData, classId: e.target.value })}
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                  required
                >
                  <option value="">Pilih Kelas</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Kata Sandi Login Siswa</label>
                <input
                  type="text"
                  value={newStudentData.password}
                  onChange={(e) => setNewStudentData({ ...newStudentData, password: e.target.value })}
                  placeholder="Default: Siswa123!"
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-mono"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Kata sandi bawaan siswa adalah <code className="font-mono font-bold text-slate-600">Siswa123!</code>
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowStudentModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                >
                  Simpan Siswa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Tambah / Ubah Mata Pelajaran */}
      {showSubjectModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center">
                  <BookOpen className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-900 text-base">
                  {editingSubject?.id ? 'Ubah Mata Pelajaran' : 'Tambah Mata Pelajaran Baru'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isSavingSubject) {
                    setShowSubjectModal(false);
                    setEditingSubject(null);
                  }
                }}
                disabled={isSavingSubject}
                className="text-xs font-semibold text-slate-400 hover:text-slate-600 cursor-pointer disabled:opacity-50"
              >
                Tutup
              </button>
            </div>

            <form onSubmit={handleSaveSubject} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nama Mata Pelajaran <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={editingSubject?.name || ''}
                  onChange={(e) => {
                    const newName = e.target.value;
                    const curCode = editingSubject?.code || '';
                    const oldAuto = generateSubjectCodeFromName(editingSubject?.name || '');
                    const shouldAutoUpdate = !curCode || curCode === oldAuto;
                    setEditingSubject((prev) => ({
                      ...prev,
                      name: newName,
                      code: shouldAutoUpdate ? generateSubjectCodeFromName(newName) : curCode,
                    }));
                  }}
                  placeholder="Contoh: Fiqih, Al-Qur'an Hadis, Bahasa Arab"
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  required
                  autoFocus
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Kode Mata Pelajaran
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (editingSubject?.name) {
                        setEditingSubject((prev) => ({
                          ...prev,
                          code: generateSubjectCodeFromName(editingSubject.name || ''),
                        }));
                      }
                    }}
                    className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer"
                  >
                    Otomatiskan Kode
                  </button>
                </div>
                <input
                  type="text"
                  value={editingSubject?.code || ''}
                  onChange={(e) => setEditingSubject({ ...editingSubject, code: e.target.value.toUpperCase() })}
                  placeholder="Contoh: FIQ-10, QRD-11, MTK-12"
                  className="w-full text-xs font-mono font-bold px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg uppercase focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Jika dikosongkan, kode akan otomatis dibuat dari nama mata pelajaran.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Guru Pengampu / Penanggung Jawab
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTeacher({
                        username: '',
                        fullName: editingSubject?.teacherName || '',
                        password: 'Guru123!',
                        subjectId: editingSubject?.id || '',
                      });
                      setShowTeacherModal(true);
                    }}
                    className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer"
                  >
                    + Buat Akun Guru Baru
                  </button>
                </div>
                <input
                  type="text"
                  list="teacher-list-options"
                  value={editingSubject?.teacherName || ''}
                  onChange={(e) => setEditingSubject({ ...editingSubject, teacherName: e.target.value })}
                  placeholder="Contoh: Ustadz H. Ahmad, S.Pd.I"
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
                <datalist id="teacher-list-options">
                  {teachers.map((t) => (
                    <option key={t.id} value={t.fullName}>
                      {t.username}
                    </option>
                  ))}
                </datalist>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowSubjectModal(false);
                    setEditingSubject(null);
                  }}
                  disabled={isSavingSubject}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSavingSubject}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg cursor-pointer shadow-xs flex items-center gap-1.5"
                >
                  {isSavingSubject ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <span>{editingSubject?.id ? 'Perbarui Mata Pelajaran' : 'Simpan Mata Pelajaran'}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Tambah / Ubah Rombel Kelas */}
      {showClassModal && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <GraduationCap className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-900 text-base">
                  {editingClass?.id ? 'Ubah Rombel Kelas' : 'Tambah Rombel Kelas Baru'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isSavingClass) {
                    setShowClassModal(false);
                    setEditingClass(null);
                  }
                }}
                disabled={isSavingClass}
                className="text-xs font-semibold text-slate-400 hover:text-slate-600 cursor-pointer disabled:opacity-50"
              >
                Tutup
              </button>
            </div>

            <form onSubmit={handleSaveClass} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tingkat Kelas <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['X', 'XI', 'XII'] as const).map((lvl) => {
                    const isSelected = (editingClass?.grade || 'X') === lvl;
                    return (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => {
                          const curName = editingClass?.name || '';
                          let updatedName = curName;
                          if (!curName.trim()) {
                            updatedName = `${lvl} `;
                          }
                          setEditingClass((prev) => ({
                            ...prev,
                            grade: lvl,
                            name: updatedName,
                          }));
                        }}
                        className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        Kelas {lvl}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nama Rombel Kelas <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={editingClass?.name || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    let inferredGrade = editingClass?.grade || 'X';
                    const upper = val.trim().toUpperCase();
                    if (upper.startsWith('XII')) inferredGrade = 'XII';
                    else if (upper.startsWith('XI')) inferredGrade = 'XI';
                    else if (upper.startsWith('X ')) inferredGrade = 'X';
                    setEditingClass((prev) => ({
                      ...prev,
                      name: val,
                      grade: inferredGrade,
                    }));
                  }}
                  placeholder="Contoh: X MIPA 1, XI IPS, XII Keagamaan"
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  required
                  autoFocus
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Gunakan format nama rombel yang jelas, misalnya: X MIPA 1, XI IPS 2, XII Keagamaan.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Keterangan Jurusan / Wali Kelas
                </label>
                <input
                  type="text"
                  value={editingClass?.description || ''}
                  onChange={(e) => setEditingClass((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Contoh: Peminatan Keagamaan · Wali Kelas: Ustadz H. Ahmad"
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowClassModal(false);
                    setEditingClass(null);
                  }}
                  disabled={isSavingClass}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSavingClass}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg cursor-pointer shadow-xs flex items-center gap-1.5"
                >
                  {isSavingClass ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <span>{editingClass?.id ? 'Perbarui Rombel Kelas' : 'Simpan Rombel Kelas'}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Tambah / Ubah Akun Guru */}
      {showTeacherModal && editingTeacher && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <KeyRound className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-900 text-base">
                  {editingTeacher.id ? 'Ubah Data Akun Guru' : 'Tambah Akun Guru Baru'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isSavingTeacher) {
                    setShowTeacherModal(false);
                    setEditingTeacher(null);
                  }
                }}
                disabled={isSavingTeacher}
                className="text-xs font-semibold text-slate-400 hover:text-slate-600 cursor-pointer disabled:opacity-50"
              >
                Tutup
              </button>
            </div>

            <form onSubmit={handleSaveTeacher} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nama Lengkap Guru & Gelar <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={editingTeacher.fullName}
                  onChange={(e) => {
                    const newFullName = e.target.value;
                    setEditingTeacher((prev) =>
                      prev ? { ...prev, fullName: newFullName } : prev
                    );
                  }}
                  placeholder="Contoh: Ustadz H. Ahmad, S.Pd.I"
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  required
                  autoFocus
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Username Login / NIP / NUPTK <span className="text-rose-500">*</span>
                  </label>
                  {!editingTeacher.id && (
                    <button
                      type="button"
                      onClick={() => {
                        const base = (editingTeacher.fullName || '')
                          .toLowerCase()
                          .replace(/[^a-z0-9\s]/g, '')
                          .trim()
                          .split(/\s+/)
                          .filter((w) => !['ustadz', 'ustadzah', 'h', 'hj', 'drs', 'dra', 'spd', 'spdi', 'mpd'].includes(w))
                          .slice(0, 2)
                          .join('_');
                        const generated = base ? `guru_${base}` : `guru_${Math.floor(100 + Math.random() * 900)}`;
                        setEditingTeacher((prev) => (prev ? { ...prev, username: generated } : prev));
                      }}
                      className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer"
                    >
                      Buat Username Otomatis
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={editingTeacher.username}
                  onChange={(e) =>
                    setEditingTeacher((prev) =>
                      prev ? { ...prev, username: e.target.value.replace(/\s+/g, '') } : prev
                    )
                  }
                  placeholder="Contoh: guru_fikih atau 198603122019031001"
                  className="w-full text-xs font-mono px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  required
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Digunakan guru saat login ke aplikasi (tanpa spasi).
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {editingTeacher.id ? 'Kata Sandi Baru (Kosongkan jika tidak diubah)' : 'Kata Sandi Login'}
                </label>
                <input
                  type="text"
                  value={editingTeacher.password || ''}
                  onChange={(e) =>
                    setEditingTeacher((prev) =>
                      prev ? { ...prev, password: e.target.value } : prev
                    )
                  }
                  placeholder={editingTeacher.id ? 'Biarkan kosong jika kata sandi tetap' : 'Default: Guru123!'}
                  className="w-full text-xs font-mono px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  {editingTeacher.id
                    ? 'Isi hanya jika Anda ingin mengganti kata sandi akun guru ini.'
                    : 'Jika dikosongkan, kata sandi otomatis diatur ke Guru123!'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Mata Pelajaran yang Diampu Guru Ini
                </label>
                {subjects.length === 0 ? (
                  <p className="text-[11px] text-slate-400 italic">
                    Belum ada mata pelajaran terdaftar.
                  </p>
                ) : (
                  <div className="max-h-44 overflow-y-auto p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                    {subjects.map((s) => {
                      const currentIds =
                        editingTeacher.subjectIds !== undefined
                          ? editingTeacher.subjectIds
                          : editingTeacher.subjectId
                          ? [editingTeacher.subjectId]
                          : [];
                      const isChecked = currentIds.includes(s.id);
                      return (
                        <label
                          key={s.id}
                          className={`flex items-center justify-between gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                            isChecked
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-semibold'
                              : 'bg-white border-slate-200/80 text-slate-700 hover:bg-slate-100/70'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const nextIds = e.target.checked
                                  ? [...currentIds, s.id]
                                  : currentIds.filter((id) => id !== s.id);
                                setEditingTeacher((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        subjectIds: nextIds,
                                        subjectId: nextIds[0] || '',
                                      }
                                    : prev
                                );
                              }}
                              className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-500"
                            />
                            <span className="truncate">{s.name}</span>
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">
                              {s.code}
                            </span>
                          </div>
                          {s.teacherName && (
                            <span className="text-[10px] text-slate-400 truncate max-w-[110px]">
                              {s.teacherName}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
                <p className="text-[10px] text-slate-500 mt-1">
                  Centang satu atau lebih mata pelajaran. Saat login, akun guru ini hanya akan memuat mata pelajaran yang dicentang di atas.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowTeacherModal(false);
                    setEditingTeacher(null);
                  }}
                  disabled={isSavingTeacher}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSavingTeacher}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg cursor-pointer shadow-xs flex items-center gap-1.5"
                >
                  {isSavingTeacher ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <span>{editingTeacher.id ? 'Perbarui Akun Guru' : 'Simpan Akun Guru'}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Questions Modal */}
      <UploadQuestionsModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        subjects={visibleSubjects}
        classes={classes}
        defaultSubjectId={
          uploadTargetSubjectId && visibleSubjects.some((s) => s.id === uploadTargetSubjectId)
            ? uploadTargetSubjectId
            : selectedSubjectFilter !== 'ALL' && visibleSubjects.some((s) => s.id === selectedSubjectFilter)
            ? selectedSubjectFilter
            : visibleSubjects[0]?.id || ''
        }
        onSuccess={(count, targetSubjId) => {
          const subjName = subjects.find((s) => s.id === targetSubjId)?.name;
          showToast(
            'success',
            `Berhasil mengimpor ${count} butir soal ke mata pelajaran ${subjName ? `"${subjName}"` : 'bank soal'}.`
          );
          if (targetSubjId) {
            setSelectedSubjectFilter(targetSubjId);
          }
          loadAllData();
        }}
      />

      {/* In-App Confirmation Modal (Replaces blocked window.confirm in iframe sandbox) */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`p-2.5 rounded-xl shrink-0 ${
                  confirmModal.isDestructive
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-amber-100 text-amber-700'
                }`}
              >
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-slate-900 text-base">{confirmModal.title}</h3>
                <p className="text-xs text-slate-600 leading-relaxed">{confirmModal.message}</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={executeConfirmAction}
                className={`px-4 py-2 text-xs font-bold text-white rounded-xl shadow-xs transition-colors cursor-pointer ${
                  confirmModal.isDestructive
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-emerald-700 hover:bg-emerald-800'
                }`}
              >
                {confirmModal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification Banner */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md animate-in fade-in slide-in-from-bottom-5 duration-300">
          <div
            className={`flex items-start gap-3 p-4 rounded-xl shadow-xl border ${
              toast.type === 'success'
                ? 'bg-emerald-900 text-white border-emerald-700'
                : toast.type === 'error'
                ? 'bg-rose-900 text-white border-rose-700'
                : 'bg-slate-900 text-white border-slate-700'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            ) : toast.type === 'error' ? (
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 text-xs">
              <p className="font-semibold leading-relaxed">{toast.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-white/60 hover:text-white text-xs font-bold px-1 cursor-pointer"
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
