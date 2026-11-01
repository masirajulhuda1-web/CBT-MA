import {
  User,
  ClassRoom,
  Subject,
  Question,
  StudentQuestion,
  Exam,
  StudentExamSession,
  AuditLog,
  AppConfig,
} from '../types';
import {
  INITIAL_CLASSES,
  INITIAL_SUBJECTS,
  INITIAL_USERS,
  INITIAL_QUESTIONS,
  INITIAL_EXAMS,
  INITIAL_AUDIT_LOGS,
} from './mockData';
import { hashPasswordWithSalt, generateRandomSalt, generateSessionToken, parseSessionToken } from './security';
import {
  getExamScheduleStatus,
  getLocalDateString,
  buildIsoWindowWithOffset,
  normalizeExamScheduleFields,
} from '../utils/dateUtils';

const STORAGE_KEYS = {
  USERS: 'cbt_shm_users',
  CLASSES: 'cbt_shm_classes',
  SUBJECTS: 'cbt_shm_subjects',
  QUESTIONS: 'cbt_shm_questions',
  EXAMS: 'cbt_shm_exams',
  SESSIONS: 'cbt_shm_sessions',
  ANSWERS: 'cbt_shm_answers',
  LOGS: 'cbt_shm_logs',
  CONFIG: 'cbt_shm_config',
  AUTH_TOKEN: 'cbt_shm_token',
  CURRENT_USER: 'cbt_shm_current_user',
  DELETED_IDS: 'cbt_shm_deleted_ids',
};

function normalizeUsernameOrNisn(val: unknown): string {
  return String(val || '').trim().toLowerCase();
}

function stripLeadingZeros(val: string): string {
  const trimmed = val.trim().toLowerCase();
  if (/^0+\d+$/.test(trimmed)) {
    return trimmed.replace(/^0+/, '');
  }
  return trimmed;
}

function normalizeRole(role: unknown): 'admin' | 'guru' | 'siswa' {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'admin' || r === 'administrator' || r === 'proktor') return 'admin';
  if (r === 'guru' || r === 'teacher' || r === 'pengawas' || r === 'staff') return 'guru';
  return 'siswa';
}

function resolveUserRole(u: Partial<User>): 'admin' | 'guru' | 'siswa' {
  const idStr = String(u.id || '').trim().toUpperCase();
  const unameStr = String(u.username || '').trim().toLowerCase();
  const classIdStr = String(u.classId || '').trim();
  const rawRole = String(u.role || '').trim().toLowerCase();

  if (
    idStr.startsWith('USR-ADMIN') ||
    unameStr === 'admin_sirajulhuda' ||
    rawRole === 'admin' ||
    rawRole === 'administrator' ||
    rawRole === 'proktor'
  ) {
    return 'admin';
  }

  // Accounts with student ID prefix, student username prefix, a Rombel classId, or numeric NISN
  // are ALWAYS students ('siswa'). Teachers never have a classId in this system.
  if (
    idStr.startsWith('USR-SISWA') ||
    unameStr.startsWith('siswa_') ||
    classIdStr !== '' ||
    (/^\d{4,14}$/.test(unameStr) && !unameStr.startsWith('19') && !unameStr.startsWith('20'))
  ) {
    return 'siswa';
  }

  return normalizeRole(u.role);
}

function normalizeStatus(status: unknown): 'active' | 'inactive' {
  const s = String(status ?? 'active').trim().toLowerCase();
  if (s === 'inactive' || s === 'nonaktif' || s === 'disabled' || s === 'false' || s === '0') {
    return 'inactive';
  }
  return 'active';
}

function findBestMatchingUser(
  users: User[],
  rawInput: string,
  portalType?: 'siswa' | 'staff'
): User | undefined {
  const input = normalizeUsernameOrNisn(rawInput);
  if (!input) return undefined;
  const inputNoZero = stripLeadingZeros(input);

  const normalizedUsers = users.map((u) => ({
    ...u,
    role: resolveUserRole(u),
  }));

  const preferredPool =
    portalType === 'siswa'
      ? normalizedUsers.filter((u) => u.role === 'siswa')
      : portalType === 'staff'
        ? normalizedUsers.filter((u) => u.role !== 'siswa')
        : normalizedUsers;

  const fallbackPool =
    portalType === 'siswa'
      ? normalizedUsers.filter((u) => u.role !== 'siswa')
      : portalType === 'staff'
        ? normalizedUsers.filter((u) => u.role === 'siswa')
        : [];

  const searchInPool = (pool: User[], allowFullName: boolean): User | undefined => {
    // Pass 1: Exact username match
    const exactUsername = pool.find((u) => normalizeUsernameOrNisn(u.username) === input);
    if (exactUsername) return exactUsername;

    // Pass 2: Leading-zero normalized NISN / username match
    if (inputNoZero) {
      const noZeroMatch = pool.find((u) => {
        const uNoZero = stripLeadingZeros(normalizeUsernameOrNisn(u.username));
        return Boolean(uNoZero && uNoZero === inputNoZero);
      });
      if (noZeroMatch) return noZeroMatch;
    }

    // Pass 3: Exact User ID match
    const exactId = pool.find((u) => normalizeUsernameOrNisn(u.id) === input);
    if (exactId) return exactId;

    if (allowFullName) {
      // Pass 4: Exact Full Name match
      const exactFullName = pool.find((u) => normalizeUsernameOrNisn(u.fullName) === input);
      if (exactFullName) return exactFullName;

      // Pass 5: Student NISN embedded in fullName (e.g. "M. Fahmi Ilham (NISN: 008129381)")
      const nisnInName = pool.find((u) => {
        if (u.role !== 'siswa') return false;
        const fn = normalizeUsernameOrNisn(u.fullName);
        return (
          fn.includes(`nisn: ${input}`) ||
          (inputNoZero && fn.includes(`nisn: 0${inputNoZero}`)) ||
          (inputNoZero && fn.includes(`nisn: 00${inputNoZero}`)) ||
          fn.startsWith(`${input} (`)
        );
      });
      if (nisnInName) return nisnInName;
    }

    return undefined;
  };

  return searchInPool(preferredPool, true) || searchInPool(fallbackPool, false);
}

class ApiService {
  private config: AppConfig;
  private syncPromise: Promise<void> | null = null;
  private inFlightServerSync: Promise<void> | null = null;
  private lastServerSyncAt = 0;
  private inFlightGasSync: Promise<User[]> | null = null;
  private lastGasSyncAt = 0;
  private inFlightGasReads = new Map<string, Promise<any>>();

  constructor() {
    this.config = this.loadConfig();
    this.initStorageIfEmpty();
    this.checkUrlParamsForGasConfig();
    // Trigger initial cross-device sync in background
    this.syncPromise = this.syncWithServer(true);
  }

  private checkUrlParamsForGasConfig() {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const gasParam = (params.get('gas') || params.get('gas_url') || params.get('server') || '').trim();
      if (gasParam && gasParam.startsWith('https://script.google.com/')) {
        this.saveConfig({ gasWebAppUrl: gasParam, useLiveGas: true });
      }
    } catch {}
  }

  private loadConfig(): AppConfig {
    const defaults: AppConfig = {
      schoolName: 'MA Sirajul Huda Marindi',
      schoolSubName: 'Madrasah Aliyah Sirajul Huda Marindi',
      semester: 'Ganjil',
      academicYear: '2026/2027',
      gasWebAppUrl: '',
      useLiveGas: false,
      autoSaveIntervalSeconds: 5,
      maxViolationsAllowed: 3,
    };
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CONFIG);
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...defaults, ...parsed };
      }
    } catch {}
    return defaults;
  }

  public saveConfig(newConfig: Partial<AppConfig>) {
    this.config = { ...this.config, ...newConfig };
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(this.config));
    // Immediately broadcast updated config (e.g., gasWebAppUrl) to shared server so all other devices receive it
    void this.syncWithServer(true);
  }

  public getConfig(): AppConfig {
    return this.config;
  }

  private getDeletedIds(): Record<string, boolean> {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.DELETED_IDS) || '{}');
    } catch {
      return {};
    }
  }

  private markDeletedId(id: string) {
    if (!id) return;
    const deleted = this.getDeletedIds();
    deleted[id] = true;
    localStorage.setItem(STORAGE_KEYS.DELETED_IDS, JSON.stringify(deleted));
  }

  private markDeletedIds(ids: string[]) {
    if (!ids || ids.length === 0) return;
    const deleted = this.getDeletedIds();
    for (const id of ids) {
      if (id) deleted[id] = true;
    }
    localStorage.setItem(STORAGE_KEYS.DELETED_IDS, JSON.stringify(deleted));
  }

  private markDeletedUser(userId: string, username?: string) {
    const deleted = this.getDeletedIds();
    if (userId) deleted[userId] = true;
    if (username) {
      const norm = normalizeUsernameOrNisn(username);
      const noZero = stripLeadingZeros(username);
      if (norm) {
        deleted[`uname:${norm}`] = true;
        deleted[`USR-SISWA-${norm}`] = true;
        deleted[`USR-GURU-${norm}`] = true;
        deleted[`USR-SISWA-${username.trim()}`] = true;
        deleted[`USR-GURU-${username.trim()}`] = true;
      }
      if (noZero) {
        deleted[`uname:${noZero}`] = true;
      }
    }
    localStorage.setItem(STORAGE_KEYS.DELETED_IDS, JSON.stringify(deleted));
  }

  private unmarkDeletedIds(keys: string[]) {
    if (!keys || keys.length === 0) return;
    const deleted = this.getDeletedIds();
    let changed = false;
    for (const k of keys) {
      if (k && deleted[k]) {
        delete deleted[k];
        changed = true;
      }
    }
    if (changed) {
      localStorage.setItem(STORAGE_KEYS.DELETED_IDS, JSON.stringify(deleted));
    }
  }

  private isUserDeleted(u: Partial<User> | null | undefined, deletedIds?: Record<string, boolean>): boolean {
    if (!u || !u.id) return true;
    const del = deletedIds || this.getDeletedIds();
    if (del[u.id]) return true;
    if (u.username) {
      const norm = normalizeUsernameOrNisn(u.username);
      const noZero = stripLeadingZeros(u.username);
      if (norm && (del[`uname:${norm}`] || del[`USR-SISWA-${norm}`] || del[`USR-GURU-${norm}`])) return true;
      if (noZero && del[`uname:${noZero}`]) return true;
    }
    return false;
  }

  /**
   * Synchronize local state & GAS configuration with the shared server store
   * so any device (phone, tablet, laptop) automatically shares the same GAS URL and users.
   * Deduplicated & throttled so parallel read actions never cause a request storm.
   */
  public async syncWithServer(force = false, unmarkKeys?: string[]): Promise<void> {
    if (this.inFlightServerSync) {
      if (!force) {
        return this.inFlightServerSync;
      }
      try {
        await this.inFlightServerSync;
      } catch {}
    }
    if (!force && Date.now() - this.lastServerSyncAt < 1200) {
      return;
    }

    const doSync = async () => {
      try {
        const deletedIds = this.getDeletedIds();
        const localUsers: User[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]') as User[]
        ).filter((u) => !this.isUserDeleted(u, deletedIds));
        const localClasses: ClassRoom[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]') as ClassRoom[]
        ).filter((c) => c?.id && !deletedIds[c.id]);
        const localSubjects: Subject[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]') as Subject[]
        ).filter((s) => s?.id && !deletedIds[s.id]);
        const localQuestions: Question[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]') as Question[]
        ).filter(
          (q) =>
            q?.id &&
            !deletedIds[q.id] &&
            !deletedIds[q.subjectId] &&
            !deletedIds[`subj_q:${q.subjectId}`]
        );
        const localExams: Exam[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.EXAMS) || '[]') as Exam[]
        )
          .filter((ex) => ex?.id && !deletedIds[ex.id] && !deletedIds[ex.subjectId])
          .map((ex) => ({
            ...ex,
            ...normalizeExamScheduleFields(ex),
          }));
        const localSessions: StudentExamSession[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSIONS) || '[]') as StudentExamSession[]
        ).filter((s) => s?.id && !deletedIds[s.id]);
        const localLogs: AuditLog[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOGS) || '[]');

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);

        const res = await fetch('/api/shared-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            config: this.config,
            users: localUsers,
            classes: localClasses,
            subjects: localSubjects,
            questions: localQuestions,
            exams: localExams,
            sessions: localSessions,
            logs: localLogs,
            deletedIds,
            unmarkDeletedIds: unmarkKeys,
          }),
        });
        clearTimeout(timer);

        if (!res.ok) return;
        const json = await res.json();
        if (!json?.success || !json?.state) return;

        const state = json.state;
        // Always merge with the latest local deletedIds so deletions made while the request was in-flight are never lost
        const latestLocalDeleted = this.getDeletedIds();
        const mergedDeletedIds: Record<string, boolean> = {
          ...(state.deletedIds || {}),
          ...latestLocalDeleted,
        };
        if (unmarkKeys && unmarkKeys.length > 0) {
          for (const k of unmarkKeys) {
            delete mergedDeletedIds[k];
          }
        }
        localStorage.setItem(STORAGE_KEYS.DELETED_IDS, JSON.stringify(mergedDeletedIds));

        if (state.config) {
          const mergedConfig: AppConfig = {
            ...this.config,
            ...state.config,
            gasWebAppUrl: state.config.gasWebAppUrl || this.config.gasWebAppUrl || '',
            useLiveGas: Boolean(
              (state.config.gasWebAppUrl && state.config.useLiveGas !== false) ||
                (this.config.gasWebAppUrl && this.config.useLiveGas)
            ),
          };
          this.config = mergedConfig;
          localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(this.config));
        }
        if (Array.isArray(state.users)) {
          const cleanUsers = state.users.filter((u: User) => !this.isUserDeleted(u, mergedDeletedIds));
          if (cleanUsers.length > 0) {
            localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(cleanUsers));
          }
        }
        if (Array.isArray(state.classes)) {
          const cleanClasses = state.classes.filter((c: ClassRoom) => c?.id && !mergedDeletedIds[c.id]);
          localStorage.setItem(STORAGE_KEYS.CLASSES, JSON.stringify(cleanClasses));
        }
        if (Array.isArray(state.subjects)) {
          const cleanSubjects = state.subjects.filter((s: Subject) => s?.id && !mergedDeletedIds[s.id]);
          localStorage.setItem(STORAGE_KEYS.SUBJECTS, JSON.stringify(cleanSubjects));
        }
        if (Array.isArray(state.questions)) {
          const cleanQuestions = state.questions.filter(
            (q: Question) =>
              q?.id &&
              !mergedDeletedIds[q.id] &&
              !mergedDeletedIds[q.subjectId] &&
              !mergedDeletedIds[`subj_q:${q.subjectId}`]
          );
          localStorage.setItem(STORAGE_KEYS.QUESTIONS, JSON.stringify(cleanQuestions));
        }
        if (Array.isArray(state.exams)) {
          const normalizedStateExams = state.exams
            .filter((ex: Exam) => ex?.id && !mergedDeletedIds[ex.id] && !mergedDeletedIds[ex.subjectId])
            .map((ex: Exam) => ({
              ...ex,
              ...normalizeExamScheduleFields(ex),
            }));
          localStorage.setItem(STORAGE_KEYS.EXAMS, JSON.stringify(normalizedStateExams));
        }
        if (Array.isArray(state.sessions)) {
          const cleanSessions = state.sessions.filter(
            (s: StudentExamSession) => s?.id && !mergedDeletedIds[s.id]
          );
          localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(cleanSessions));
        }
        if (Array.isArray(state.logs) && state.logs.length > 0) {
          localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(state.logs));
        }
        this.lastServerSyncAt = Date.now();
      } catch {
        // Ignore if running in offline/static mode without /api/shared-state
      } finally {
        this.inFlightServerSync = null;
      }
    };

    this.inFlightServerSync = doSync();
    return this.inFlightServerSync;
  }

  /**
   * Call Google Apps Script endpoint via Server Proxy (avoids mobile CORS & redirect issues)
   * with direct browser fetch as fallback, request deduplication for reads, and timeout protection.
   */
  private async callGasEndpoint<T = any>(
    action: string,
    data: Record<string, unknown> = {},
    tokenOverride?: string | null,
    urlOverride?: string
  ): Promise<T | null> {
    const targetUrl = (urlOverride || this.config.gasWebAppUrl || '').trim();
    if (!targetUrl) return null;
    const token = tokenOverride !== undefined ? tokenOverride : this.getStoredToken();
    const payload = { action, token, data };

    const isReadOnly = action.startsWith('get');
    const dedupKey = isReadOnly ? `${targetUrl}::${action}::${token || ''}::${JSON.stringify(data)}` : '';
    if (isReadOnly && this.inFlightGasReads.has(dedupKey)) {
      return this.inFlightGasReads.get(dedupKey) as Promise<T | null>;
    }

    const executeFetch = async (): Promise<T | null> => {
      const timeoutMs = isReadOnly ? 9000 : 15000;

      // 1. Try server-side proxy first for reliable cross-device / mobile execution
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const proxyRes = await fetch('/api/gas-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ url: targetUrl, method: 'POST', payload }),
        });
        clearTimeout(timer);
        if (proxyRes.ok) {
          const proxyJson = await proxyRes.json();
          if (proxyJson && typeof proxyJson === 'object' && !proxyJson.raw) {
            return proxyJson as T;
          }
        }
      } catch {
        // Fallback to direct fetch below
      }

      // 2. Fallback to direct browser fetch
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(targetUrl, {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          signal: controller.signal,
          body: JSON.stringify(payload),
        });
        clearTimeout(timer);
        const json = await response.json();
        return json as T;
      } catch (err) {
        console.warn(`Gagal menghubungi GAS untuk aksi ${action}:`, err);
        return null;
      }
    };

    const promise = executeFetch().finally(() => {
      if (dedupKey) {
        this.inFlightGasReads.delete(dedupKey);
      }
    });

    if (dedupKey) {
      this.inFlightGasReads.set(dedupKey, promise);
    }
    return promise;
  }

  /**
   * Resolves the matching questions, subject metadata, class metadata, and actual question count
   * for a given exam so uploaded questions (e.g. 50 questions) are never truncated to the default 10.
   */
  private resolveExamAndQuestions(
    exam: Partial<Exam>,
    allQuestions: Question[],
    allSubjects: Subject[],
    allClasses: ClassRoom[]
  ): {
    effectiveSubjectId: string;
    effectiveSubjectName: string;
    effectiveClassName: string;
    effectiveTotalQuestions: number;
    matchedQuestions: Question[];
  } {
    const rawSubjId = String(exam.subjectId || '').trim();
    const rawSubjName = String(exam.subjectName || '').trim();

    let matchedSubj = allSubjects.find(
      (s) =>
        s.id === rawSubjId ||
        (rawSubjId && s.code.trim().toLowerCase() === rawSubjId.toLowerCase()) ||
        (rawSubjName &&
          rawSubjName.toLowerCase() !== 'mata pelajaran' &&
          s.name.trim().toLowerCase() === rawSubjName.toLowerCase())
    );
    if (!matchedSubj && allSubjects.length === 1) {
      matchedSubj = allSubjects[0];
    }

    const effectiveSubjectId = matchedSubj?.id || rawSubjId || allSubjects[0]?.id || '';
    const effectiveSubjectName =
      matchedSubj?.name ||
      (rawSubjName && rawSubjName !== 'Mata Pelajaran' ? rawSubjName : '') ||
      allSubjects[0]?.name ||
      'Mata Pelajaran';

    const matchedCls = allClasses.find((c) => c.id === exam.classId);
    const effectiveClassName =
      matchedCls?.name || exam.className || (exam.classId ? String(exam.classId) : 'Seluruh Kelas');

    const deletedIds = this.getDeletedIds();
    const validQuestions = allQuestions.filter(
      (q) =>
        q?.id &&
        !deletedIds[q.id] &&
        !deletedIds[q.subjectId] &&
        !deletedIds[`subj_q:${q.subjectId}`]
    );

    const isMockBuiltInQuestion = (q: Question) =>
      /^Q-FIQ-\d+$/i.test(String(q.id || '')) || /^Q-QHD-\d+$/i.test(String(q.id || ''));

    const uploadedQuestions = validQuestions.filter((q) => !isMockBuiltInQuestion(q));
    const questionPool = uploadedQuestions.length > 0 ? uploadedQuestions : validQuestions;

    let subjectQuestions = questionPool.filter(
      (q) => q.subjectId === effectiveSubjectId || (rawSubjId && q.subjectId === rawSubjId)
    );

    // If no questions matched by ID (e.g. questions were uploaded under an orphaned subject ID or single subject bank)
    // Only consider non-mock questions whose subjectId was NOT explicitly deleted
    if (subjectQuestions.length === 0 && uploadedQuestions.length > 0) {
      const validSubjIds = new Set(allSubjects.map((s) => s.id));
      const orphanedQuestions = uploadedQuestions.filter(
        (q) =>
          !validSubjIds.has(q.subjectId) &&
          !deletedIds[q.subjectId] &&
          !deletedIds[`subj_q:${q.subjectId}`]
      );
      if (orphanedQuestions.length > 0) {
        subjectQuestions = orphanedQuestions;
      } else if (allSubjects.length <= 1 && !deletedIds[`subj_q:${effectiveSubjectId}`]) {
        subjectQuestions = uploadedQuestions;
      }
    }

    // Fallback to validQuestions if questionPool yielded 0
    if (subjectQuestions.length === 0 && validQuestions.length > 0) {
      subjectQuestions = validQuestions.filter(
        (q) => q.subjectId === effectiveSubjectId || (rawSubjId && q.subjectId === rawSubjId)
      );
    }

    const classFiltered = subjectQuestions.filter(
      (q) => !q.classId || !exam.classId || q.classId === exam.classId
    );
    const matchedQuestions =
      classFiltered.length === subjectQuestions.length || classFiltered.length > 10
        ? classFiltered
        : subjectQuestions;

    const rawTotal = Number(exam.totalQuestions) || 0;
    const effectiveTotalQuestions =
      matchedQuestions.length > 0 ? matchedQuestions.length : rawTotal || 10;

    return {
      effectiveSubjectId,
      effectiveSubjectName,
      effectiveClassName,
      effectiveTotalQuestions,
      matchedQuestions,
    };
  }

  private mergeSheetUsersIntoLocal(rawStudents?: any[], rawTeachers?: any[]): User[] {
    const deletedIds = this.getDeletedIds();
    const localUsers: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
    const incomingSheetUsers: User[] = [];

    const studentUsernamesFromSheet = new Set<string>();
    for (const u of localUsers) {
      if (this.isUserDeleted(u, deletedIds)) continue;
      if (resolveUserRole(u) === 'siswa' && u.username) {
        studentUsernamesFromSheet.add(normalizeUsernameOrNisn(u.username));
        studentUsernamesFromSheet.add(stripLeadingZeros(u.username));
      }
    }
    if (Array.isArray(rawStudents)) {
      for (const s of rawStudents) {
        if (!s || (!s.username && !s.id)) continue;
        const cleanUname = String(s.username ?? '').trim();
        const rawId = String(s.id || `USR-SISWA-${cleanUname}`);
        if (this.isUserDeleted({ id: rawId, username: cleanUname }, deletedIds)) continue;
        if (cleanUname) {
          studentUsernamesFromSheet.add(normalizeUsernameOrNisn(cleanUname));
          studentUsernamesFromSheet.add(stripLeadingZeros(cleanUname));
        }
      }
    }

    if (Array.isArray(rawTeachers)) {
      for (const t of rawTeachers) {
        if (!t || (!t.username && !t.id)) continue;
        const cleanUname = String(t.username ?? '').trim();
        const tId = String(t.id || `USR-GURU-${cleanUname}`);
        if (this.isUserDeleted({ id: tId, username: cleanUname }, deletedIds)) continue;
        const tClassId = String(t.classId || '').trim();
        const isActuallyStudent =
          tId.toUpperCase().startsWith('USR-SISWA') ||
          tClassId !== '' ||
          (cleanUname &&
            (studentUsernamesFromSheet.has(normalizeUsernameOrNisn(cleanUname)) ||
              studentUsernamesFromSheet.has(stripLeadingZeros(cleanUname))));

        if (isActuallyStudent) {
          incomingSheetUsers.push({
            id: tId.toUpperCase().startsWith('USR-GURU') ? `USR-SISWA-${cleanUname}` : tId,
            username: cleanUname,
            fullName: String(t.fullName || cleanUname || 'Siswa').trim(),
            role: 'siswa',
            classId: tClassId,
            status: normalizeStatus(t.status),
            createdAt: String(t.createdAt || new Date().toISOString()),
          });
        } else {
          incomingSheetUsers.push({
            id: tId,
            username: cleanUname,
            fullName: String(t.fullName || cleanUname || 'Guru').trim(),
            role: resolveUserRole({ ...t, role: t.role || 'guru' }),
            classId: '',
            status: normalizeStatus(t.status),
            createdAt: String(t.createdAt || new Date().toISOString()),
          });
        }
      }
    }

    if (Array.isArray(rawStudents)) {
      for (const s of rawStudents) {
        if (!s || (!s.username && !s.id)) continue;
        const cleanUname = String(s.username ?? '').trim();
        const rawId = String(s.id || `USR-SISWA-${cleanUname}`);
        if (this.isUserDeleted({ id: rawId, username: cleanUname }, deletedIds)) continue;
        incomingSheetUsers.push({
          id: rawId.toUpperCase().startsWith('USR-GURU') ? `USR-SISWA-${cleanUname}` : rawId,
          username: cleanUname,
          fullName: String(s.fullName || cleanUname || 'Siswa').trim(),
          role: 'siswa',
          classId: String(s.classId || ''),
          status: normalizeStatus(s.status),
          createdAt: String(s.createdAt || new Date().toISOString()),
        });
      }
    }

    const mergedMap = new Map<string, User>();
    for (const u of localUsers) {
      if (!this.isUserDeleted(u, deletedIds)) {
        mergedMap.set(u.id, { ...u, role: resolveUserRole(u) });
      }
    }

    for (const sheetU of incomingSheetUsers) {
      if (this.isUserDeleted(sheetU, deletedIds)) continue;
      let existingEntry: User | undefined = mergedMap.get(sheetU.id);
      if (!existingEntry && sheetU.username) {
        for (const candidate of mergedMap.values()) {
          if (
            normalizeUsernameOrNisn(candidate.username) === normalizeUsernameOrNisn(sheetU.username) ||
            (stripLeadingZeros(candidate.username) &&
              stripLeadingZeros(candidate.username) === stripLeadingZeros(sheetU.username))
          ) {
            existingEntry = candidate;
            break;
          }
        }
      }

      if (existingEntry) {
        const preserveStudentRole =
          resolveUserRole(existingEntry) === 'siswa' &&
          (Boolean(existingEntry.classId) || String(existingEntry.id).toUpperCase().startsWith('USR-SISWA'));
        const effectiveRole = preserveStudentRole ? 'siswa' : resolveUserRole(sheetU);
        const effectiveId =
          effectiveRole === 'siswa' && String(sheetU.id).toUpperCase().startsWith('USR-GURU')
            ? existingEntry.id.toUpperCase().startsWith('USR-SISWA')
              ? existingEntry.id
              : `USR-SISWA-${sheetU.username}`
            : sheetU.id;

        if (this.isUserDeleted({ id: effectiveId, username: sheetU.username }, deletedIds)) {
          mergedMap.delete(existingEntry.id);
          continue;
        }

        mergedMap.delete(existingEntry.id);
        mergedMap.set(effectiveId, {
          ...existingEntry,
          ...sheetU,
          id: effectiveId,
          role: effectiveRole,
          classId: sheetU.classId || existingEntry.classId || '',
          passwordHash: existingEntry.passwordHash,
          salt: existingEntry.salt,
        });
      } else {
        mergedMap.set(sheetU.id, { ...sheetU, role: resolveUserRole(sheetU) });
      }
    }

    const finalUsers = Array.from(mergedMap.values());
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(finalUsers));
    return finalUsers;
  }

  /**
   * Pulls users (Students & Teachers), Classes, Subjects, Questions, and Exams from Google Spreadsheet
   * and merges them into localStorage + shared server state.
   * Deduplicated & throttled so concurrent callers share a single execution.
   */
  public async syncUsersFromGas(urlOverride?: string, force = false): Promise<User[]> {
    const targetUrl = (urlOverride || this.config.gasWebAppUrl || '').trim();
    if (!targetUrl) {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
    }

    if (!force && this.inFlightGasSync) {
      return this.inFlightGasSync;
    }
    if (!force && !urlOverride && Date.now() - this.lastGasSyncAt < 6000) {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
    }

    const doGasSync = async (): Promise<User[]> => {
      try {
        const adminToken = generateSessionToken('USR-ADMIN-1', 'admin');

        const [stRes, tchRes, clsRes, subjRes, qRes, exRes] = await Promise.all([
          this.callGasEndpoint<{ success: boolean; students?: any[] }>('getStudents', {}, adminToken, targetUrl),
          this.callGasEndpoint<{ success: boolean; teachers?: any[] }>('getTeachers', {}, adminToken, targetUrl),
          this.callGasEndpoint<{ success: boolean; classes?: any[] }>('getClasses', {}, adminToken, targetUrl),
          this.callGasEndpoint<{ success: boolean; subjects?: any[] }>('getSubjects', {}, adminToken, targetUrl),
          this.callGasEndpoint<{ success: boolean; questions?: any[] }>('getQuestions', {}, adminToken, targetUrl),
          this.callGasEndpoint<{ success: boolean; exams?: any[] }>('getExams', {}, adminToken, targetUrl),
        ]);

        const deletedIds = this.getDeletedIds();
        this.mergeSheetUsersIntoLocal(stRes?.students, tchRes?.teachers);

        if (clsRes?.success && Array.isArray(clsRes.classes)) {
          const sheetClasses: ClassRoom[] = clsRes.classes
            .filter((c: any) => c?.id && !deletedIds[c.id])
            .map((c: any) => ({
              id: String(c.id),
              name: String(c.name || ''),
              grade: (['X', 'XI', 'XII'].includes(String(c.grade).toUpperCase())
                ? String(c.grade).toUpperCase()
                : 'X') as 'X' | 'XI' | 'XII',
              description: String(c.description || ''),
            }));
          localStorage.setItem(STORAGE_KEYS.CLASSES, JSON.stringify(sheetClasses));
        }

        if (subjRes?.success && Array.isArray(subjRes.subjects)) {
          const sheetSubjects: Subject[] = subjRes.subjects
            .filter((s: any) => s?.id && !deletedIds[s.id])
            .map((s: any) => ({
              id: String(s.id),
              code: String(s.code || 'MAPEL'),
              name: String(s.name || 'Mata Pelajaran'),
              teacherId: String(s.teacherId || s.teacherName || ''),
              teacherName: String(s.teacherName || s.teacherId || ''),
            }));
          localStorage.setItem(STORAGE_KEYS.SUBJECTS, JSON.stringify(sheetSubjects));
        }

        const activeSubjects: Subject[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]');
        const activeClasses: ClassRoom[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]');

        if (qRes?.success && Array.isArray(qRes.questions)) {
          const validSubjIds = new Set(activeSubjects.map((s) => s.id));
          const sheetQuestions: Question[] = qRes.questions
            .filter(
              (q: any) =>
                q?.id &&
                !deletedIds[q.id] &&
                !deletedIds[String(q.subjectId || '')] &&
                !deletedIds[`subj_q:${String(q.subjectId || '')}`]
            )
            .map((q: any) => {
              let sId = String(q.subjectId || '');
              const isMockQuestion =
                /^Q-FIQ-\d+$/i.test(String(q.id || '')) || /^Q-QHD-\d+$/i.test(String(q.id || ''));
              if (activeSubjects.length > 0 && !validSubjIds.has(sId) && !deletedIds[sId] && !isMockQuestion) {
                sId = activeSubjects[0].id;
              }
              const rawKey = String(q.correctAnswer || 'A').trim().toUpperCase();
              const cleanKey: 'A' | 'B' | 'C' | 'D' | 'E' = ['A', 'B', 'C', 'D', 'E'].includes(rawKey)
                ? (rawKey as 'A' | 'B' | 'C' | 'D' | 'E')
                : 'A';
              return {
                id: String(q.id),
                subjectId: sId,
                classId: String(q.classId || ''),
                questionText: String(q.questionText || ''),
                optionA: String(q.optionA || ''),
                optionB: String(q.optionB || ''),
                optionC: String(q.optionC || ''),
                optionD: String(q.optionD || ''),
                optionE: String(q.optionE || ''),
                correctAnswer: cleanKey,
                explanation: String(q.explanation || ''),
                points: Number(q.points) || 10,
                createdBy: String(q.createdBy || 'Guru'),
              };
            })
            .filter((q) => !deletedIds[q.subjectId] && !deletedIds[`subj_q:${q.subjectId}`]);
          localStorage.setItem(STORAGE_KEYS.QUESTIONS, JSON.stringify(sheetQuestions));
        }

        const activeQuestions: Question[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]');

        if (exRes?.success && Array.isArray(exRes.exams)) {
          const localExams: Exam[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.EXAMS) || '[]');
          const localMap = new Map<string, Exam>(localExams.map((e) => [e.id, e]));
          const sheetExams: Exam[] = [];

          for (const e of exRes.exams) {
            if (!e?.id || deletedIds[e.id] || deletedIds[String(e.subjectId || '')]) continue;
            const prev = localMap.get(String(e.id));
            const normalizedSched = normalizeExamScheduleFields(e, prev);
            const resolved = this.resolveExamAndQuestions(
              { ...prev, ...e },
              activeQuestions,
              activeSubjects,
              activeClasses
            );
            const mergedExam: Exam = {
              ...prev,
              ...e,
              id: String(e.id),
              subjectId: resolved.effectiveSubjectId,
              subjectName: resolved.effectiveSubjectName,
              className: resolved.effectiveClassName,
              totalQuestions: resolved.effectiveTotalQuestions,
              examDate: normalizedSched.examDate,
              startTime: normalizedSched.startTime,
              endTime: normalizedSched.endTime,
              startWindow: normalizedSched.startWindow,
              endWindow: normalizedSched.endWindow,
            };
            sheetExams.push(mergedExam);
          }

          localStorage.setItem(STORAGE_KEYS.EXAMS, JSON.stringify(sheetExams));
        }

        this.lastGasSyncAt = Date.now();
        void this.syncWithServer(true);
        return JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
      } finally {
        this.inFlightGasSync = null;
      }
    };

    this.inFlightGasSync = doGasSync();
    return this.inFlightGasSync;
  }

  /**
   * Push locally created users, classes, and subjects to Google Spreadsheet so nothing is out of sync.
   */
  public async syncAllLocalDataToGas(urlOverride?: string): Promise<{ success: boolean; syncedUsers: number }> {
    const targetUrl = (urlOverride || this.config.gasWebAppUrl || '').trim();
    if (!targetUrl) return { success: false, syncedUsers: 0 };

    const bootstrapToken = this.getStoredToken() || generateSessionToken('USR-ADMIN-1', 'admin');
    const deletedIds = this.getDeletedIds();

    // First pull existing students & teachers from GAS so we don't duplicate
    const [stRes, tchRes] = await Promise.all([
      this.callGasEndpoint<{ success: boolean; students?: any[] }>('getStudents', {}, bootstrapToken, targetUrl),
      this.callGasEndpoint<{ success: boolean; teachers?: any[] }>('getTeachers', {}, bootstrapToken, targetUrl),
    ]);

    const existingUsernames = new Set<string>();
    if (stRes?.students) {
      stRes.students.forEach((s) => existingUsernames.add(stripLeadingZeros(String(s.username || ''))));
    }
    if (tchRes?.teachers) {
      tchRes.teachers.forEach((t) => existingUsernames.add(stripLeadingZeros(String(t.username || ''))));
    }

    const localUsers: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
    let syncedCount = 0;

    for (const u of localUsers) {
      if (this.isUserDeleted(u, deletedIds)) continue;
      const normKey = stripLeadingZeros(u.username || '');
      if (!normKey || existingUsernames.has(normKey)) continue;
      if (u.role === 'siswa') {
        await this.callGasEndpoint(
          'saveStudent',
          {
            username: u.username,
            fullName: u.fullName,
            classId: u.classId || '',
            password: 'Siswa123!',
          },
          bootstrapToken,
          targetUrl
        );
        existingUsernames.add(normKey);
        syncedCount++;
      } else if (u.role === 'guru') {
        await this.callGasEndpoint(
          'saveTeacher',
          {
            username: u.username,
            fullName: u.fullName,
            password: 'Guru123!',
          },
          bootstrapToken,
          targetUrl
        );
        existingUsernames.add(normKey);
        syncedCount++;
      }
    }

    await this.syncUsersFromGas(targetUrl);
    return { success: true, syncedUsers: syncedCount };
  }

  private initStorageIfEmpty() {
    const deletedIds = this.getDeletedIds();

    const storedClasses = localStorage.getItem(STORAGE_KEYS.CLASSES);
    if (!storedClasses) {
      localStorage.setItem(
        STORAGE_KEYS.CLASSES,
        JSON.stringify(INITIAL_CLASSES.filter((c) => !deletedIds[c.id]))
      );
    } else {
      try {
        const parsed: ClassRoom[] = JSON.parse(storedClasses);
        const filtered = parsed.filter((c) => c?.id && !deletedIds[c.id]);
        if (filtered.length !== parsed.length) {
          localStorage.setItem(STORAGE_KEYS.CLASSES, JSON.stringify(filtered));
        }
      } catch {}
    }

    const storedSubjects = localStorage.getItem(STORAGE_KEYS.SUBJECTS);
    if (!storedSubjects) {
      localStorage.setItem(
        STORAGE_KEYS.SUBJECTS,
        JSON.stringify(INITIAL_SUBJECTS.filter((s) => !deletedIds[s.id]))
      );
    } else {
      try {
        const parsed: Subject[] = JSON.parse(storedSubjects);
        const filtered = parsed.filter((s) => s?.id && !deletedIds[s.id]);
        if (filtered.length !== parsed.length) {
          localStorage.setItem(STORAGE_KEYS.SUBJECTS, JSON.stringify(filtered));
        }
      } catch {}
    }

    const storedUsers = localStorage.getItem(STORAGE_KEYS.USERS);
    if (!storedUsers) {
      localStorage.setItem(
        STORAGE_KEYS.USERS,
        JSON.stringify(INITIAL_USERS.filter((u) => !this.isUserDeleted(u, deletedIds)))
      );
    } else {
      try {
        let parsed: User[] = JSON.parse(storedUsers);
        const adminUser = parsed.find((u) => u.username === 'admin_sirajulhuda');
        if (adminUser && adminUser.passwordHash?.startsWith('c7c59ec5')) {
          localStorage.setItem(
            STORAGE_KEYS.USERS,
            JSON.stringify(INITIAL_USERS.filter((u) => !this.isUserDeleted(u, deletedIds)))
          );
        } else {
          let modified = false;
          const beforeLen = parsed.length;
          parsed = parsed.filter((u) => !this.isUserDeleted(u, deletedIds));
          if (parsed.length !== beforeLen) {
            modified = true;
          }
          // Always ensure the primary admin account exists so Admin is never locked out
          const defaultAdmin = INITIAL_USERS.find((u) => u.role === 'admin');
          if (
            defaultAdmin &&
            !parsed.some((u) => u.id === defaultAdmin.id || u.username === defaultAdmin.username)
          ) {
            parsed.unshift(defaultAdmin);
            modified = true;
          }
          // Heal roles and restore default teacher password hashes if accidentally overwritten
          for (const u of parsed) {
            const resolved = resolveUserRole(u);
            if (u.role !== resolved) {
              u.role = resolved;
              modified = true;
            }
            const defaultTeacher = INITIAL_USERS.find((iu) => iu.id === u.id && iu.role === 'guru');
            if (defaultTeacher && u.salt === defaultTeacher.salt && u.passwordHash !== defaultTeacher.passwordHash) {
              u.passwordHash = defaultTeacher.passwordHash;
              modified = true;
            }
          }
          if (modified) {
            localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(parsed));
          }
        }
      } catch {}
    }

    const storedQuestions = localStorage.getItem(STORAGE_KEYS.QUESTIONS);
    if (!storedQuestions) {
      localStorage.setItem(
        STORAGE_KEYS.QUESTIONS,
        JSON.stringify(
          INITIAL_QUESTIONS.filter(
            (q) => !deletedIds[q.id] && !deletedIds[q.subjectId] && !deletedIds[`subj_q:${q.subjectId}`]
          )
        )
      );
    } else {
      try {
        const parsed: Question[] = JSON.parse(storedQuestions);
        const filtered = parsed.filter(
          (q) =>
            q?.id &&
            !deletedIds[q.id] &&
            !deletedIds[q.subjectId] &&
            !deletedIds[`subj_q:${q.subjectId}`]
        );
        if (filtered.length !== parsed.length) {
          localStorage.setItem(STORAGE_KEYS.QUESTIONS, JSON.stringify(filtered));
        }
      } catch {}
    }

    const storedExams = localStorage.getItem(STORAGE_KEYS.EXAMS);
    if (!storedExams) {
      localStorage.setItem(
        STORAGE_KEYS.EXAMS,
        JSON.stringify(INITIAL_EXAMS.filter((e) => !deletedIds[e.id] && !deletedIds[e.subjectId]))
      );
    } else {
      try {
        let parsedExams: Exam[] = JSON.parse(storedExams);
        let modified = false;
        const beforeLen = parsedExams.length;
        parsedExams = parsedExams.filter(
          (ex) => ex?.id && !deletedIds[ex.id] && !deletedIds[ex.subjectId]
        );
        if (parsedExams.length !== beforeLen) {
          modified = true;
        }
        const todayStr = getLocalDateString();
        const tomorrowStr = getLocalDateString(new Date(Date.now() + 86400000));
        parsedExams.forEach((ex, idx) => {
          if (!ex.examDate && !ex.startWindow) {
            ex.examDate = idx === 0 ? todayStr : tomorrowStr;
            ex.startTime = idx === 0 ? '06:00' : '08:00';
            ex.endTime = idx === 0 ? '23:59' : '09:30';
            ex.startWindow = buildIsoWindowWithOffset(ex.examDate, ex.startTime, '00');
            ex.endWindow = buildIsoWindowWithOffset(ex.examDate, ex.endTime, '59');
            modified = true;
          } else {
            const norm = normalizeExamScheduleFields(ex);
            if (
              ex.examDate !== norm.examDate ||
              ex.startTime !== norm.startTime ||
              ex.endTime !== norm.endTime ||
              ex.startWindow !== norm.startWindow ||
              ex.endWindow !== norm.endWindow
            ) {
              ex.examDate = norm.examDate;
              ex.startTime = norm.startTime;
              ex.endTime = norm.endTime;
              ex.startWindow = norm.startWindow;
              ex.endWindow = norm.endWindow;
              modified = true;
            }
          }
          if (ex.randomizeOptions) {
            ex.randomizeOptions = false;
            modified = true;
          }
        });
        if (modified) {
          localStorage.setItem(STORAGE_KEYS.EXAMS, JSON.stringify(parsedExams));
        }
      } catch {}
    }
    // Pastikan sesi ujian yang tersimpan tidak mengacak posisi kunci jawaban A-E
    const storedSessions = localStorage.getItem(STORAGE_KEYS.SESSIONS);
    if (storedSessions) {
      try {
        const parsedSessions: StudentExamSession[] = JSON.parse(storedSessions);
        let sessModified = false;
        parsedSessions.forEach((sess) => {
          if (sess.optionOrderMap) {
            for (const qId of Object.keys(sess.optionOrderMap)) {
              const map = sess.optionOrderMap[qId];
              if (map && (map.A !== 'A' || map.B !== 'B' || map.C !== 'C' || map.D !== 'D' || map.E !== 'E')) {
                sess.optionOrderMap[qId] = { A: 'A', B: 'B', C: 'C', D: 'D', E: 'E' };
                sessModified = true;
              }
            }
          }
        });
        if (sessModified) {
          localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(parsedSessions));
        }
      } catch {}
    }
    if (!localStorage.getItem(STORAGE_KEYS.LOGS)) {
      localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(INITIAL_AUDIT_LOGS));
    }
  }

  // Token management
  public getStoredToken(): string | null {
    return localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
  }

  public setStoredToken(token: string | null) {
    if (token) {
      localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
    } else {
      localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
    }
  }

  public getStoredUser(): User | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  public setStoredUser(user: User | null) {
    if (user) {
      localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
    }
  }

  public logout() {
    this.setStoredToken(null);
    this.setStoredUser(null);
  }

  /**
   * Helper to execute GAS + Shared Server + Local Engine call
   */
  private async dispatch<T = any>(action: string, data: Record<string, unknown> = {}): Promise<T> {
    if (this.syncPromise) {
      try {
        await this.syncPromise;
      } catch {}
      this.syncPromise = null;
    }

    // Special comprehensive cross-device + Spreadsheet login flow
    if (action === 'login') {
      const portalType =
        data.portalType === 'siswa' || data.portalType === 'staff' ? data.portalType : undefined;
      const loginResult = await this.handleCrossDeviceLogin(
        String(data.username || ''),
        String(data.password || ''),
        portalType
      );
      return loginResult as unknown as T;
    }

    const token = this.getStoredToken();
    const isWriteAction = [
      'saveClass',
      'deleteClass',
      'saveSubject',
      'deleteSubject',
      'saveQuestion',
      'batchSaveQuestions',
      'deleteQuestion',
      'saveExam',
      'deleteExam',
      'saveStudent',
      'deleteStudent',
      'resetStudentPassword',
      'saveTeacher',
      'deleteTeacher',
      'resetTeacherPassword',
      'resetStudentExam',
    ].includes(action);

    const unmarkKeys: string[] = [];

    // Track deletions across devices so deleted items don't resurrect on merge
    if (action === 'deleteClass' || action === 'deleteExam') {
      if (data.id) this.markDeletedId(String(data.id));
    } else if (action === 'deleteSubject') {
      if (data.id) {
        const subjId = String(data.id);
        this.markDeletedId(subjId);
        this.markDeletedId(`subj_q:${subjId}`);
        // Also mark all questions belonging to this deleted subject as deleted so they never get reassigned
        try {
          const qs: Question[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]');
          qs.filter((q) => q.subjectId === subjId).forEach((q) => this.markDeletedId(q.id));
        } catch {}
      }
    } else if (action === 'deleteQuestion') {
      if (data.id) {
        this.markDeletedId(String(data.id));
      }
      if (data.deleteAllBySubject && data.subjectId) {
        const subjId = String(data.subjectId);
        this.markDeletedId(`subj_q:${subjId}`);
        try {
          const qs: Question[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]');
          qs.filter((q) => q.subjectId === subjId).forEach((q) => this.markDeletedId(q.id));
        } catch {}
      }
    } else if (action === 'deleteStudent' || action === 'deleteTeacher') {
      if (data.userId) {
        const uId = String(data.userId);
        let targetUname = String(data.username || '');
        try {
          const allU: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
          const found = allU.find((u) => u.id === uId);
          if (found?.username) targetUname = found.username;
        } catch {}
        this.markDeletedUser(uId, targetUname);
        if (targetUname) {
          data = { ...data, username: targetUname };
        }
      }
    } else if (action === 'resetStudentExam') {
      if (data.studentExamId) this.markDeletedId(String(data.studentExamId));
    } else if (action === 'saveQuestion' || action === 'batchSaveQuestions') {
      const targetSubjId = String(
        data.subjectId || ((data.questions as any[])?.[0]?.subjectId) || ''
      );
      if (targetSubjId) {
        const k = `subj_q:${targetSubjId}`;
        unmarkKeys.push(k);
        this.unmarkDeletedIds([k]);
      }
      if (data.id) {
        unmarkKeys.push(String(data.id));
        this.unmarkDeletedIds([String(data.id)]);
      }
    } else if (action === 'saveStudent' || action === 'saveTeacher') {
      const uname = String(data.username || '').trim();
      const norm = normalizeUsernameOrNisn(uname);
      const noZero = stripLeadingZeros(uname);
      const keysToClear = [
        data.id ? String(data.id) : '',
        norm ? `uname:${norm}` : '',
        norm ? `USR-SISWA-${norm}` : '',
        norm ? `USR-GURU-${norm}` : '',
        uname ? `USR-SISWA-${uname}` : '',
        uname ? `USR-GURU-${uname}` : '',
        noZero ? `uname:${noZero}` : '',
      ].filter(Boolean);
      unmarkKeys.push(...keysToClear);
      this.unmarkDeletedIds(keysToClear);
    } else if (action === 'saveClass' || action === 'saveSubject' || action === 'saveExam') {
      if (data.id) {
        unmarkKeys.push(String(data.id));
        this.unmarkDeletedIds([String(data.id)]);
      }
    }

    // If live GAS mode is enabled and a valid URL is provided
    if (this.config.useLiveGas && this.config.gasWebAppUrl) {
      const adminToken = generateSessionToken('USR-ADMIN-1', 'admin');

      if (isWriteAction) {
        let payloadToSend = { ...data };
        if (action === 'saveExam') {
          const allQuestions: Question[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]');
          const allSubjects: Subject[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]');
          const allClasses: ClassRoom[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]');
          const resolved = this.resolveExamAndQuestions(
            data as unknown as Partial<Exam>,
            allQuestions,
            allSubjects,
            allClasses
          );
          const examDate = String(data.examDate || getLocalDateString());
          const startTime = String(data.startTime || '07:30');
          const endTime = String(data.endTime || '23:59');
          const startWindow = buildIsoWindowWithOffset(examDate, startTime, '00');
          const endWindow = buildIsoWindowWithOffset(examDate, endTime, '59');
          payloadToSend = {
            ...data,
            subjectId: resolved.effectiveSubjectId,
            subjectName: resolved.effectiveSubjectName,
            className: resolved.effectiveClassName,
            totalQuestions: resolved.effectiveTotalQuestions,
            examDate,
            startTime,
            endTime,
            startWindow,
            endWindow,
          };
        }

        let gasRes = await this.callGasEndpoint<any>(action, payloadToSend, token);
        // Retry with adminToken if the user's current session token (e.g. a newly created Guru account) was rejected by an older Code.gs
        if (!gasRes || !gasRes.success) {
          gasRes = await this.callGasEndpoint<any>(action, payloadToSend, adminToken);
        }
        // When deleting a subject in GAS, also delete its questions in GAS so they don't become orphans
        if (action === 'deleteSubject' && payloadToSend.id) {
          void this.callGasEndpoint(
            'deleteQuestion',
            { subjectId: payloadToSend.id, deleteAllBySubject: true },
            adminToken
          );
        }
        // If saving a student and an older Code.gs matched a row with USR-GURU id, replace it cleanly in GAS
        if (action === 'saveStudent' && gasRes?.id && String(gasRes.id).toUpperCase().startsWith('USR-GURU')) {
          await this.callGasEndpoint('deleteTeacher', { userId: gasRes.id }, adminToken);
          await this.callGasEndpoint('deleteStudent', { userId: gasRes.id }, adminToken);
          gasRes = await this.callGasEndpoint<any>(action, payloadToSend, adminToken);
        }
        // Mirror write to local storage & shared server so all devices have instant access even if Code.gs is older
        const enrichedData =
          gasRes?.id && !(action === 'saveStudent' && String(gasRes.id).toUpperCase().startsWith('USR-GURU'))
            ? { ...payloadToSend, id: gasRes.id }
            : payloadToSend;
        const localRes = await this.executeMockAction(action, enrichedData, token);

        // If questions were uploaded/modified, also sync exams' totalQuestions in GAS
        if (action === 'batchSaveQuestions' || action === 'saveQuestion' || action === 'deleteQuestion') {
          const deletedIds = this.getDeletedIds();
          const allQuestions: Question[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]');
          const allSubjects: Subject[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]');
          const allClasses: ClassRoom[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]');
          const allExams: Exam[] = (
            JSON.parse(localStorage.getItem(STORAGE_KEYS.EXAMS) || '[]') as Exam[]
          ).filter((e) => e?.id && !deletedIds[e.id] && !deletedIds[e.subjectId]);
          for (const ex of allExams) {
            const resolved = this.resolveExamAndQuestions(ex, allQuestions, allSubjects, allClasses);
            if (ex.totalQuestions !== resolved.effectiveTotalQuestions || ex.subjectId !== resolved.effectiveSubjectId) {
              ex.totalQuestions = resolved.effectiveTotalQuestions;
              ex.subjectId = resolved.effectiveSubjectId;
              ex.subjectName = resolved.effectiveSubjectName;
              void this.callGasEndpoint('saveExam', ex as unknown as Record<string, unknown>, adminToken);
            }
          }
          localStorage.setItem(STORAGE_KEYS.EXAMS, JSON.stringify(allExams));
        }

        await this.syncWithServer(true, unmarkKeys);
        if (gasRes && gasRes.success) {
          return gasRes as T;
        }
        return localRes as T;
      }

      if (action === 'getAvailableExams') {
        const [, gasRes] = await Promise.all([
          this.syncWithServer(),
          this.callGasEndpoint<any>('getAvailableExams', data, token),
        ]);
        // Refresh full spreadsheet cache in background if stale without blocking student UI
        if (Date.now() - this.lastGasSyncAt > 15000) {
          void this.syncUsersFromGas();
        }

        const deletedIds = this.getDeletedIds();
        const allQuestions: Question[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]');
        const allSubjects: Subject[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]');
        const allClasses: ClassRoom[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]');
        const localExams: Exam[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.EXAMS) || '[]');
        const localExamMap = new Map<string, Exam>(localExams.map((e) => [e.id, e]));

        if (gasRes && gasRes.success && Array.isArray(gasRes.exams)) {
          const enrichedList = gasRes.exams
            .filter(
              (rawEx: any) =>
                rawEx?.id &&
                !deletedIds[String(rawEx.id)] &&
                !deletedIds[String(rawEx.subjectId || '')]
            )
            .map((rawEx: any) => {
              const localMatch = localExamMap.get(String(rawEx.id));
              const normalizedSched = normalizeExamScheduleFields(rawEx, localMatch);
              const mergedBase: Exam = {
                ...(localMatch || {}),
                ...rawEx,
                id: String(rawEx.id),
                token: rawEx.token || localMatch?.token || 'SHM2026',
                examDate: normalizedSched.examDate,
                startTime: normalizedSched.startTime,
                endTime: normalizedSched.endTime,
                startWindow: normalizedSched.startWindow,
                endWindow: normalizedSched.endWindow,
              };
              const resolved = this.resolveExamAndQuestions(mergedBase, allQuestions, allSubjects, allClasses);
              const schedule = getExamScheduleStatus(mergedBase);

              return {
                ...mergedBase,
                subjectId: resolved.effectiveSubjectId,
                subjectName: resolved.effectiveSubjectName,
                className: resolved.effectiveClassName,
                totalQuestions: resolved.effectiveTotalQuestions,
                isWithinWindow: schedule.isWithinWindow,
                scheduleStatus: schedule.status,
                scheduleLabel: schedule.label,
                scheduleDetails: schedule.details,
                scheduleBadgeClass: schedule.badgeClass,
              };
            });
          return { success: true, exams: enrichedList } as unknown as T;
        }
      }

      if (action === 'startExam') {
        await this.syncWithServer();
        await this.syncUsersFromGas();
        const examId = String(data.examId || '');
        const allQuestions: Question[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]');
        const allSubjects: Subject[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]');
        const allClasses: ClassRoom[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]');
        const allExams: Exam[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.EXAMS) || '[]');
        const targetExam = allExams.find((e) => e.id === examId);

        let expectedQuestions: Question[] = [];
        let isLocalScheduleActive = false;
        if (targetExam) {
          const normSched = normalizeExamScheduleFields(targetExam);
          targetExam.examDate = normSched.examDate;
          targetExam.startTime = normSched.startTime;
          targetExam.endTime = normSched.endTime;
          targetExam.startWindow = normSched.startWindow;
          targetExam.endWindow = normSched.endWindow;
          isLocalScheduleActive = getExamScheduleStatus(targetExam).isWithinWindow;

          const resolved = this.resolveExamAndQuestions(targetExam, allQuestions, allSubjects, allClasses);
          expectedQuestions = resolved.matchedQuestions;

          // Make sure EXAMS sheet in Google Spreadsheet has total_questions and accurate ISO window BEFORE starting exam
          if (expectedQuestions.length > 0) {
            await this.callGasEndpoint(
              'saveExam',
              {
                ...targetExam,
                subjectId: resolved.effectiveSubjectId,
                subjectName: resolved.effectiveSubjectName,
                className: resolved.effectiveClassName,
                totalQuestions: resolved.effectiveTotalQuestions,
                startWindow: normSched.startWindow,
                endWindow: normSched.endWindow,
              },
              adminToken
            );
          }
        }

        let gasRes = await this.callGasEndpoint<any>('startExam', data, token);

        // If the exam is active in local time, but GAS rejected startExam due to a Spreadsheet timezone mismatch,
        // heal the window in GAS to UTC ISO and retry startExam immediately
        if (
          gasRes &&
          !gasRes.success &&
          isLocalScheduleActive &&
          targetExam &&
          typeof gasRes.error === 'string' &&
          (gasRes.error.toLowerCase().includes('berakhir') || gasRes.error.toLowerCase().includes('belum dibuka'))
        ) {
          const safeStartIso = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
          const safeEndIso = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
          await this.callGasEndpoint(
            'saveExam',
            {
              ...targetExam,
              startWindow: safeStartIso,
              endWindow: safeEndIso,
            },
            adminToken
          );
          gasRes = await this.callGasEndpoint<any>('startExam', data, token);
        }

        // Auto-heal if GAS returned a truncated 10-question session (from before total_questions was updated to 50)
        if (
          gasRes &&
          gasRes.success &&
          Array.isArray(gasRes.questions) &&
          expectedQuestions.length > 0 &&
          gasRes.questions.length < expectedQuestions.length
        ) {
          const prevSavedAnswers = { ...(gasRes.savedAnswers || {}) };
          if (gasRes.sessionId) {
            await this.callGasEndpoint(
              'resetStudentExam',
              { studentExamId: gasRes.sessionId },
              adminToken
            );
          }
          const retryGas = await this.callGasEndpoint<any>('startExam', data, token);
          if (retryGas && retryGas.success && Array.isArray(retryGas.questions)) {
            gasRes = retryGas;
            gasRes.savedAnswers = { ...prevSavedAnswers, ...(gasRes.savedAnswers || {}) };
            if (gasRes.sessionId && Object.keys(prevSavedAnswers).length > 0) {
              for (const [qId, opt] of Object.entries(prevSavedAnswers)) {
                if (opt) {
                  void this.callGasEndpoint(
                    'saveAnswer',
                    { sessionId: gasRes.sessionId, questionId: qId, selectedOption: opt },
                    token
                  );
                }
              }
            }
          }

          // Fallback supplement if GAS still returned fewer questions (e.g., due to classId mismatch on some rows in QUESTIONS sheet)
          if (Array.isArray(gasRes.questions) && gasRes.questions.length < expectedQuestions.length) {
            const existingIds = new Set(gasRes.questions.map((q: any) => String(q.id)));
            for (const rawQ of expectedQuestions) {
              if (!existingIds.has(rawQ.id)) {
                const rawOptions: Record<string, string> = {
                  A: rawQ.optionA,
                  B: rawQ.optionB,
                  C: rawQ.optionC,
                  D: rawQ.optionD,
                  E: rawQ.optionE,
                };
                gasRes.questions.push({
                  id: rawQ.id,
                  questionText: rawQ.questionText,
                  options: (['A', 'B', 'C', 'D', 'E'] as const).map((k) => ({
                    key: k,
                    originalKey: k,
                    text: rawOptions[k] || '',
                  })),
                  points: rawQ.points || 10,
                });
              }
            }
          }
        }

        if (gasRes && gasRes.success) {
          return gasRes as T;
        }
      }

      // Read / Exam session actions
      let gasRes = await this.callGasEndpoint<any>(action, data, token);
      if ((!gasRes || !gasRes.success) && action.startsWith('get')) {
        gasRes = await this.callGasEndpoint<any>(action, data, adminToken);
      }

      if (gasRes && gasRes.success) {
        const deletedIds = this.getDeletedIds();
        if (action === 'getSubjects' && Array.isArray(gasRes.subjects)) {
          const cleanSubjs = gasRes.subjects.filter((s: any) => s?.id && !deletedIds[s.id]);
          localStorage.setItem(STORAGE_KEYS.SUBJECTS, JSON.stringify(cleanSubjs));
          return { success: true, subjects: cleanSubjs } as unknown as T;
        }
        if (action === 'getQuestions' && Array.isArray(gasRes.questions)) {
          const cleanQs = gasRes.questions.filter(
            (q: any) =>
              q?.id &&
              !deletedIds[q.id] &&
              !deletedIds[String(q.subjectId || '')] &&
              !deletedIds[`subj_q:${String(q.subjectId || '')}`]
          );
          if (!data.subjectId) {
            localStorage.setItem(STORAGE_KEYS.QUESTIONS, JSON.stringify(cleanQs));
          }
          return { success: true, questions: cleanQs } as unknown as T;
        }
        if (action === 'getClasses' && Array.isArray(gasRes.classes)) {
          const cleanClasses = gasRes.classes.filter((c: any) => c?.id && !deletedIds[c.id]);
          localStorage.setItem(STORAGE_KEYS.CLASSES, JSON.stringify(cleanClasses));
          return { success: true, classes: cleanClasses } as unknown as T;
        }
        if (action === 'getExams' && Array.isArray(gasRes.exams)) {
          await this.syncWithServer();
          const latestDeleted = this.getDeletedIds();
          const allQuestions: Question[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]');
          const allSubjects: Subject[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]');
          const allClasses: ClassRoom[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]');
          const localExams: Exam[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.EXAMS) || '[]');
          const localMap = new Map<string, Exam>(localExams.map((e) => [e.id, e]));

          const enrichedExams: Exam[] = gasRes.exams
            .filter(
              (e: any) =>
                e?.id &&
                !latestDeleted[e.id] &&
                !latestDeleted[String(e.subjectId || '')]
            )
            .map((e: any) => {
              const prev = localMap.get(String(e.id));
              const normalizedSched = normalizeExamScheduleFields(e, prev);
              const resolved = this.resolveExamAndQuestions(
                { ...prev, ...e },
                allQuestions,
                allSubjects,
                allClasses
              );
              return {
                ...prev,
                ...e,
                id: String(e.id),
                subjectId: resolved.effectiveSubjectId,
                subjectName: resolved.effectiveSubjectName,
                className: resolved.effectiveClassName,
                totalQuestions: resolved.effectiveTotalQuestions,
                examDate: normalizedSched.examDate,
                startTime: normalizedSched.startTime,
                endTime: normalizedSched.endTime,
                startWindow: normalizedSched.startWindow,
                endWindow: normalizedSched.endWindow,
              };
            });
          localStorage.setItem(STORAGE_KEYS.EXAMS, JSON.stringify(enrichedExams));
          return { success: true, exams: enrichedExams } as unknown as T;
        }
        // Directly merge students or teachers without firing 6 redundant syncUsersFromGas calls
        if (action === 'getStudents' && Array.isArray(gasRes.students)) {
          const allUsers = this.mergeSheetUsersIntoLocal(gasRes.students, undefined);
          const students = allUsers
            .filter((u) => !this.isUserDeleted(u) && resolveUserRole(u) === 'siswa')
            .map(({ passwordHash: _, salt: __, ...clean }) => ({ ...clean, role: 'siswa' as const }));
          return { success: true, students } as unknown as T;
        }
        if (action === 'getTeachers' && Array.isArray(gasRes.teachers)) {
          const allUsers = this.mergeSheetUsersIntoLocal(undefined, gasRes.teachers);
          const teachers = allUsers
            .filter((u) => !this.isUserDeleted(u) && resolveUserRole(u) === 'guru')
            .map(({ passwordHash: _, salt: __, ...clean }) => ({ ...clean, role: 'guru' as const }));
          return { success: true, teachers } as unknown as T;
        }
        if (action === 'getExamResults' && Array.isArray(gasRes.results)) {
          await this.syncWithServer();
          const latestDeleted = this.getDeletedIds();
          const localSessions: StudentExamSession[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSIONS) || '[]');
          const users: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
          const userMap = new Map(users.map((u) => [u.id, u]));
          const resultMap = new Map<string, any>();

          for (const s of localSessions) {
            if (!s?.id || latestDeleted[s.id] || latestDeleted[s.examId]) continue;
            if (data.examId && s.examId !== data.examId) continue;
            const u = userMap.get(s.userId);
            resultMap.set(s.id, {
              id: s.id,
              examId: s.examId,
              userId: s.userId,
              studentName: s.studentName || u?.fullName || 'Siswa',
              username: u?.username || '',
              classId: u?.classId || '',
              startTime: s.startTimeServer,
              endTime: s.endTimeServer,
              status: s.status,
              totalScore: s.totalScore ?? 0,
              correctCount: s.correctCount ?? 0,
              incorrectCount: s.incorrectCount ?? 0,
              unansweredCount: s.unansweredCount ?? 0,
              violationCount: s.violationCount ?? 0,
            });
          }

          for (const r of gasRes.results) {
            if (!r?.id || latestDeleted[r.id] || latestDeleted[String(r.examId || '')]) continue;
            if (data.examId && r.examId !== data.examId) continue;
            const u = userMap.get(r.userId);
            resultMap.set(String(r.id), {
              ...r,
              id: String(r.id),
              studentName: r.studentName && r.studentName !== 'Siswa' ? r.studentName : (u?.fullName || r.studentName || 'Siswa'),
              username: r.username || u?.username || '',
              classId: r.classId || u?.classId || '',
              totalScore: Number(r.totalScore) || 0,
              correctCount: Number(r.correctCount) || 0,
              incorrectCount: Number(r.incorrectCount) || 0,
              unansweredCount: Number(r.unansweredCount) || 0,
              violationCount: Number(r.violationCount) || 0,
            });
          }

          return { success: true, results: Array.from(resultMap.values()) } as unknown as T;
        }
        if (action === 'getSystemStats' && gasRes.stats) {
          const latestDeleted = this.getDeletedIds();
          const users: User[] = (
            JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]') as User[]
          ).filter((u) => !this.isUserDeleted(u, latestDeleted));
          const questions: Question[] = (
            JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]') as Question[]
          ).filter(
            (q) =>
              q?.id &&
              !latestDeleted[q.id] &&
              !latestDeleted[q.subjectId] &&
              !latestDeleted[`subj_q:${q.subjectId}`]
          );
          const exams: Exam[] = (
            JSON.parse(localStorage.getItem(STORAGE_KEYS.EXAMS) || '[]') as Exam[]
          ).filter((e) => e?.id && !latestDeleted[e.id] && !latestDeleted[e.subjectId]);
          const sessions: StudentExamSession[] = (
            JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSIONS) || '[]') as StudentExamSession[]
          ).filter((s) => s?.id && !latestDeleted[s.id]);
          const localActive = sessions.filter((s) => s.status === 'in_progress').length;
          return {
            success: true,
            stats: {
              totalStudents: users.filter((u) => resolveUserRole(u) === 'siswa').length,
              totalQuestions: questions.length,
              totalExams: exams.length,
              activeSessions: Math.max(Number(gasRes.stats.activeSessions) || 0, localActive),
            },
          } as unknown as T;
        }
        return gasRes as T;
      }
    }

    // Pull latest shared state from server before read actions
    if (!isWriteAction) {
      await this.syncWithServer();
    }

    // Local + Shared Server Execution
    const result = await this.executeMockAction(action, data, token);
    if (isWriteAction || action === 'startExam' || action === 'saveAnswer' || action === 'submitExam' || action === 'logViolation') {
      await this.syncWithServer(true, unmarkKeys);
    }
    return result as T;
  }

  /**
   * Comprehensive cross-device login handler:
   * 1. Syncs GAS URL & users from shared server (/api/shared-state)
   * 2. Authenticates against Google Apps Script Spreadsheet (with leading-zero NISN tolerance)
   * 3. Pulls latest USERS sheet from Spreadsheet (getStudents / getTeachers) if needed
   * 4. Falls back to shared server / local users so accounts saved in Spreadsheet or Admin panel always log in
   */
  private async handleCrossDeviceLogin(
    rawUsername: string,
    password: string,
    portalType?: 'siswa' | 'staff'
  ): Promise<{ success: boolean; token?: string; user?: User; error?: string }> {
    const cleanInput = rawUsername.trim();
    if (!cleanInput || !password) {
      return { success: false, error: 'Username dan kata sandi wajib diisi.' };
    }

    // Step 1: Always sync with server first so this device gets gasWebAppUrl & shared users
    await this.syncWithServer();

    const isLikelyStudentAccount = (u: Partial<User>, usedPass: string): boolean => {
      if (resolveUserRole(u) === 'siswa') return true;
      if (portalType !== 'siswa') return false;
      const uname = normalizeUsernameOrNisn(u.username);
      const uid = String(u.id || '').toUpperCase();
      // Never convert default admin or explicit guru_* accounts into students
      if (
        uname === 'admin_sirajulhuda' ||
        uid === 'USR-ADMIN-1' ||
        uid === 'USR-GURU-1' ||
        uid === 'USR-GURU-2' ||
        uname.startsWith('guru_')
      ) {
        return false;
      }
      // Check if local storage has this username registered as a student
      const localUsers: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
      const localStudentMatch = localUsers.find(
        (lu) =>
          resolveUserRole(lu) === 'siswa' &&
          (normalizeUsernameOrNisn(lu.username) === uname ||
            (stripLeadingZeros(uname) && stripLeadingZeros(lu.username) === stripLeadingZeros(uname)))
      );
      if (localStudentMatch) return true;

      // If logging in on the Student portal with the default student password 'Siswa123!', heal role to 'siswa'
      if (usedPass === 'Siswa123!') return true;

      // If the account is not linked as a teacher to any subject, and is logging in on Student portal
      const subjects: Subject[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]');
      const isLinkedTeacher = subjects.some(
        (s) =>
          (u.id && s.teacherId === u.id) ||
          (u.fullName && s.teacherName && s.teacherName.toLowerCase() === u.fullName.toLowerCase())
      );
      return !isLinkedTeacher;
    };

    // Step 2: If connected to Google Apps Script, attempt GAS login & Spreadsheet sync
    if (this.config.useLiveGas && this.config.gasWebAppUrl) {
      const candidateUsernames = [cleanInput];
      const stripped = stripLeadingZeros(cleanInput);
      if (stripped && stripped !== cleanInput.toLowerCase()) {
        candidateUsernames.push(stripped);
      } else if (/^\d+$/.test(cleanInput)) {
        candidateUsernames.push('0' + cleanInput, '00' + cleanInput);
      }

      for (const candidate of candidateUsernames) {
        const gasRes = await this.callGasEndpoint<{
          success: boolean;
          token?: string;
          user?: User;
          error?: string;
        }>('login', { username: candidate, password, portalType }, null);

        if (gasRes && gasRes.success && gasRes.user && gasRes.token) {
          const localUsers: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
          const localMatch = findBestMatchingUser(localUsers, candidate, portalType);
          const shouldBeSiswa = isLikelyStudentAccount(gasRes.user, password);
          const resolvedRole = shouldBeSiswa ? 'siswa' : resolveUserRole(gasRes.user);
          const classes: ClassRoom[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]');
          const resolvedClassId =
            String(gasRes.user.classId || localMatch?.classId || '') ||
            (resolvedRole === 'siswa' ? classes[0]?.id || 'CLS-10-MIPA' : '');

          // If GAS returned a teacher (e.g. due to fullName collision in an older Code.gs) while a local student matches, prefer the student
          if (portalType === 'siswa' && resolvedRole !== 'siswa' && localMatch && resolveUserRole(localMatch) === 'siswa') {
            break;
          }

          const normalizedUser: User = {
            ...gasRes.user,
            id:
              resolvedRole === 'siswa' && String(gasRes.user.id).toUpperCase().startsWith('USR-GURU')
                ? localMatch?.id && String(localMatch.id).toUpperCase().startsWith('USR-SISWA')
                  ? localMatch.id
                  : `USR-SISWA-${String(gasRes.user.username).trim()}`
                : String(gasRes.user.id),
            username: String(gasRes.user.username),
            fullName: String(gasRes.user.fullName || gasRes.user.username),
            role: resolvedRole,
            classId: resolvedClassId,
            status: normalizeStatus(gasRes.user.status),
            createdAt: String(gasRes.user.createdAt || new Date().toISOString()),
          };
          this.upsertLocalUser(normalizedUser);
          void this.syncWithServer();
          return {
            success: true,
            token: generateSessionToken(normalizedUser.id, normalizedUser.role),
            user: normalizedUser,
          };
        }
      }

      // Step 3: Pull latest users from the Google Spreadsheet (USERS sheet) in case:
      // - Google Sheets stripped leading zeros or changed formatting
      // - User typed their Full Name or ID
      // - User was added in Spreadsheet manually or before Code.gs update
      const syncedUsers = await this.syncUsersFromGas();
      const matchedSheetUser = findBestMatchingUser(syncedUsers, cleanInput, portalType);

      if (matchedSheetUser && String(matchedSheetUser.username).trim()) {
        const exactSheetUsername = String(matchedSheetUser.username).trim();
        if (!candidateUsernames.includes(exactSheetUsername)) {
          const retryGas = await this.callGasEndpoint<{
            success: boolean;
            token?: string;
            user?: User;
            error?: string;
          }>('login', { username: exactSheetUsername, password, portalType }, null);

          if (retryGas && retryGas.success && retryGas.user && retryGas.token) {
            const shouldBeSiswa = isLikelyStudentAccount(retryGas.user, password) || resolveUserRole(matchedSheetUser) === 'siswa';
            const resolvedRole = shouldBeSiswa ? 'siswa' : resolveUserRole(retryGas.user);
            const classes: ClassRoom[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]');
            const resolvedClassId =
              String(retryGas.user.classId || matchedSheetUser.classId || '') ||
              (resolvedRole === 'siswa' ? classes[0]?.id || 'CLS-10-MIPA' : '');

            const normalizedUser: User = {
              ...retryGas.user,
              id:
                resolvedRole === 'siswa' && String(retryGas.user.id).toUpperCase().startsWith('USR-GURU')
                  ? `USR-SISWA-${String(retryGas.user.username).trim()}`
                  : String(retryGas.user.id),
              username: String(retryGas.user.username),
              fullName: String(retryGas.user.fullName || retryGas.user.username),
              role: resolvedRole,
              classId: resolvedClassId,
              status: normalizeStatus(retryGas.user.status),
              createdAt: String(retryGas.user.createdAt || new Date().toISOString()),
            };
            this.upsertLocalUser(normalizedUser);
            void this.syncWithServer();
            return {
              success: true,
              token: generateSessionToken(normalizedUser.id, normalizedUser.role),
              user: normalizedUser,
            };
          }
        }
      }
    }

    // Step 4: Authenticate against synced local + server + Spreadsheet user records
    const localLoginRes = await this.executeMockAction(
      'login',
      { username: cleanInput, password, portalType },
      null
    );
    if (localLoginRes?.success && localLoginRes.user) {
      // Ensure user is also synced to server and GAS if active
      void this.syncWithServer();
      if (this.config.useLiveGas && this.config.gasWebAppUrl) {
        void this.syncAllLocalDataToGas();
      }
    }
    return localLoginRes;
  }

  private upsertLocalUser(user: User) {
    try {
      const users: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
      const idx = users.findIndex(
        (u) =>
          u.id === user.id ||
          normalizeUsernameOrNisn(u.username) === normalizeUsernameOrNisn(user.username)
      );
      if (idx >= 0) {
        users[idx] = { ...users[idx], ...user, role: resolveUserRole(user) };
      } else {
        users.push({ ...user, role: resolveUserRole(user) });
      }
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
    } catch {}
  }

  /**
   * Mock Engine simulating Google Apps Script backend behavior
   */
  private async executeMockAction(action: string, data: Record<string, unknown>, token: string | null): Promise<any> {

    // Public actions
    if (action === 'login') {
      const inputStr = String(data.username || '').trim();
      const password = String(data.password || '');
      const portalType =
        data.portalType === 'siswa' || data.portalType === 'staff' ? data.portalType : undefined;
      const users: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');

      // Match using portal-aware priority order (exact username -> leading-zero NISN -> id -> exact fullName)
      const matched = findBestMatchingUser(users, inputStr, portalType);
      const user = matched ? users.find((u) => u.id === matched.id || u.username === matched.username) : undefined;

      if (!user) {
        return { success: false, error: 'Username atau NISN tidak terdaftar di sistem.' };
      }

      user.role = resolveUserRole(user);
      user.status = normalizeStatus(user.status);

      // Auto-heal if a student account was previously mis-saved as 'guru' and logs in on the Student portal
      if (portalType === 'siswa' && user.role === 'guru') {
        const uname = normalizeUsernameOrNisn(user.username);
        const uid = String(user.id || '').toUpperCase();
        const isBuiltInTeacher =
          uid === 'USR-GURU-1' || uid === 'USR-GURU-2' || uname.startsWith('guru_');
        const subjects: Subject[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]');
        const isSubjectTeacher = subjects.some(
          (s) =>
            (user.id && s.teacherId === user.id) ||
            (user.fullName && s.teacherName && s.teacherName.toLowerCase() === user.fullName.toLowerCase())
        );
        if (!isBuiltInTeacher && (password === 'Siswa123!' || !isSubjectTeacher)) {
          user.role = 'siswa';
          if (uid.startsWith('USR-GURU-')) {
            user.id = 'USR-SISWA-' + Math.random().toString(36).substring(2, 8);
          }
          if (!user.classId) {
            const classes: ClassRoom[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]');
            user.classId = classes[0]?.id || 'CLS-10-MIPA';
          }
          localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
        }
      }

      if (user.status !== 'active') {
        return { success: false, error: 'Akun Anda dinonaktifkan oleh administrator.' };
      }

      // Check password with salt
      const computedHash = await hashPasswordWithSalt(password, user.salt || 'default_salt');
      let isMatch = Boolean(user.passwordHash && computedHash === user.passwordHash);

      // Support plaintext password in passwordHash (if imported/edited manually in Spreadsheet)
      if (!isMatch && user.passwordHash && user.passwordHash === password) {
        isMatch = true;
      }

      // Support accounts synced from Spreadsheet (where passwordHash is omitted by getStudents/getTeachers)
      // or default credentials auto-heal strictly scoped to the user's actual role
      if (!isMatch) {
        const roleDefaultPass =
          user.role === 'admin' ? 'Admin123!' : user.role === 'guru' ? 'Guru123!' : 'Siswa123!';
        const isDefaultPass =
          password === roleDefaultPass ||
          (user.role === 'admin' && password === 'AdminPassword2026!') ||
          (user.role === 'siswa' &&
            (password.trim() === String(user.username).trim() ||
              stripLeadingZeros(password) === stripLeadingZeros(String(user.username)))) ||
          (!user.passwordHash &&
            (password.trim() === String(user.username).trim() ||
              stripLeadingZeros(password) === stripLeadingZeros(String(user.username))));

        if (isDefaultPass) {
          user.salt = user.salt || 'default_salt';
          user.passwordHash = await hashPasswordWithSalt(password, user.salt);
          localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
          isMatch = true;
        }
      }

      if (!isMatch) {
        return { success: false, error: 'Kata sandi yang Anda masukkan salah. Periksa huruf besar/kecil.' };
      }

      const sessionToken = generateSessionToken(user.id, user.role);
      this.writeLog(user.id, user.fullName, 'LOGIN', `Pengguna berhasil login sebagai ${user.role}`, 'info');

      const safeUser = { ...user };
      delete safeUser.passwordHash;
      delete safeUser.salt;

      return { success: true, token: sessionToken, user: safeUser };
    }

    // Session validation
    if (!token) {
      return { success: false, error: 'Token sesi tidak ditemukan. Silakan login kembali.' };
    }
    const parsed = parseSessionToken(token);
    if (!parsed) {
      return { success: false, error: 'Sesi telah kedaluwarsa. Silakan login kembali.' };
    }

    const users: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
    const storedUser = this.getStoredUser();
    const currentUser =
      users.find((u) => u.id === parsed.userId) ||
      (storedUser && storedUser.id === parsed.userId ? storedUser : null) || {
        id: parsed.userId,
        username: parsed.userId,
        fullName: storedUser?.fullName || 'Pengguna',
        role: normalizeRole(parsed.role),
        status: 'active' as const,
        createdAt: new Date().toISOString(),
      };

    const deletedIds = this.getDeletedIds();

    // Mock Handlers
    switch (action) {
      case 'getAvailableExams': {
        const exams: Exam[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.EXAMS) || '[]') as Exam[]
        ).filter((e) => e?.id && !deletedIds[e.id] && (!e.subjectId || !deletedIds[e.subjectId]));
        const questions: Question[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]') as Question[]
        ).filter(
          (q) =>
            q?.id &&
            !deletedIds[q.id] &&
            (!q.subjectId || (!deletedIds[q.subjectId] && !deletedIds[`subj_q:${q.subjectId}`]))
        );
        const subjects: Subject[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]') as Subject[]
        ).filter((s) => s?.id && !deletedIds[s.id]);
        const classes: ClassRoom[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]') as ClassRoom[]
        ).filter((c) => c?.id && !deletedIds[c.id]);
        const sessions: StudentExamSession[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSIONS) || '[]') as StudentExamSession[]
        ).filter((s) => s?.id && !deletedIds[s.id]);
        const userSessions = sessions.filter((s) => s.userId === currentUser.id);

        const list = exams
          .filter((ex) => (ex.classId === currentUser.classId || !ex.classId || !currentUser.classId) && ex.status === 'published')
          .map((ex) => {
            const sess = userSessions.find((s) => s.examId === ex.id);
            const normalizedSched = normalizeExamScheduleFields(ex);
            const normalizedEx: Exam = {
              ...ex,
              examDate: normalizedSched.examDate,
              startTime: normalizedSched.startTime,
              endTime: normalizedSched.endTime,
              startWindow: normalizedSched.startWindow,
              endWindow: normalizedSched.endWindow,
            };
            const resolved = this.resolveExamAndQuestions(normalizedEx, questions, subjects, classes);
            const schedule = getExamScheduleStatus(normalizedEx);
            return {
              ...normalizedEx,
              subjectId: resolved.effectiveSubjectId,
              subjectName: resolved.effectiveSubjectName,
              className: resolved.effectiveClassName,
              totalQuestions: resolved.effectiveTotalQuestions,
              isWithinWindow: schedule.isWithinWindow,
              scheduleStatus: schedule.status,
              scheduleLabel: schedule.label,
              scheduleDetails: schedule.details,
              scheduleBadgeClass: schedule.badgeClass,
              studentAttempt: sess ? {
                id: sess.id,
                status: sess.status,
                totalScore: sess.totalScore,
                startTime: sess.startTimeServer,
              } : { status: 'not_started' },
            };
          });
        return { success: true, exams: list };
      }

      case 'startExam': {
        const examId = String(data.examId);
        const tokenInput = String(data.token || '').trim();
        const exams: Exam[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.EXAMS) || '[]') as Exam[]
        ).filter((e) => e?.id && !deletedIds[e.id] && (!e.subjectId || !deletedIds[e.subjectId]));
        const exam = exams.find((e) => e.id === examId);
        if (!exam) return { success: false, error: 'Ujian tidak ditemukan.' };

        // Server-Side Schedule Window Validation (Automatic Activation on Exam Date)
        const schedule = getExamScheduleStatus(exam);

        const sessions: StudentExamSession[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSIONS) || '[]') as StudentExamSession[]
        ).filter((s) => s?.id && !deletedIds[s.id]);
        let session = sessions.find((s) => s.examId === examId && s.userId === currentUser.id);

        if (session && (session.status === 'submitted' || session.status === 'timed_out')) {
          return { success: false, error: 'Anda sudah mengumpulkan ujian ini.' };
        }

        // If not already in-progress, reject if outside the active schedule window
        if (!session && !schedule.isWithinWindow) {
          return { success: false, error: schedule.details };
        }

        if (exam.token && exam.token.toUpperCase() !== tokenInput.toUpperCase()) {
          return { success: false, error: 'Token ujian yang Anda masukkan salah.' };
        }

        // Fetch questions for this exam using resolveExamAndQuestions so all 50 uploaded questions are included
        const questions: Question[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]') as Question[]
        ).filter(
          (q) =>
            q?.id &&
            !deletedIds[q.id] &&
            (!q.subjectId || (!deletedIds[q.subjectId] && !deletedIds[`subj_q:${q.subjectId}`]))
        );
        const subjects: Subject[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]') as Subject[]
        ).filter((s) => s?.id && !deletedIds[s.id]);
        const classes: ClassRoom[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]') as ClassRoom[]
        ).filter((c) => c?.id && !deletedIds[c.id]);
        const resolved = this.resolveExamAndQuestions(exam, questions, subjects, classes);
        const examQuestions = resolved.matchedQuestions;

        if (examQuestions.length === 0) {
          return { success: false, error: 'Bank soal untuk mata pelajaran ini belum tersedia.' };
        }

        // Update exam totalQuestions in storage if it was out of sync (e.g. 10 instead of 50)
        if (exam.totalQuestions !== examQuestions.length || exam.subjectId !== resolved.effectiveSubjectId) {
          exam.totalQuestions = examQuestions.length;
          exam.subjectId = resolved.effectiveSubjectId;
          exam.subjectName = resolved.effectiveSubjectName;
          localStorage.setItem(STORAGE_KEYS.EXAMS, JSON.stringify(exams));
        }

        if (!session) {
          // Initialize deterministic order using ALL matched questions in the subject bank
          let qIds = examQuestions.map((q) => q.id);
          if (exam.randomizeQuestions) {
            qIds = this.shuffle(qIds);
          }

          // Jangan mengacak opsi A-E agar kunci jawaban tetap sesuai (A tetap A, B tetap B, dst.)
          const optionMap: Record<string, Record<string, string>> = {};
          for (const qId of qIds) {
            optionMap[qId] = { A: 'A', B: 'B', C: 'C', D: 'D', E: 'E' };
          }

          session = {
            id: 'SESS-' + Math.random().toString(36).substring(2, 9),
            examId,
            userId: currentUser.id,
            studentName: currentUser.fullName,
            className: currentUser.className || '',
            startTimeServer: new Date().toISOString(),
            status: 'in_progress',
            violationCount: 0,
            questionOrder: qIds,
            optionOrderMap: optionMap,
            answers: {},
            doubtful: {},
          };

          sessions.push(session);
          localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
          this.writeLog(currentUser.id, currentUser.fullName, 'START_EXAM', `Memulai ujian: ${exam.title}`, 'info');
        } else if (session.questionOrder.length < examQuestions.length) {
          // Auto-heal existing in_progress session if it only had 10 questions before all 50 were synced
          const validExamQIds = new Set(examQuestions.map((q) => q.id));
          const keptIds = session.questionOrder.filter((id) => validExamQIds.has(id));
          const keptSet = new Set(keptIds);
          let additionalIds = examQuestions.map((q) => q.id).filter((id) => !keptSet.has(id));
          if (exam.randomizeQuestions) {
            additionalIds = this.shuffle(additionalIds);
          }
          const fullOrder = [...keptIds, ...additionalIds];
          session.questionOrder = fullOrder;
          if (!session.optionOrderMap) session.optionOrderMap = {};
          for (const qId of fullOrder) {
            session.optionOrderMap[qId] = { A: 'A', B: 'B', C: 'C', D: 'D', E: 'E' };
          }
          localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
        }

        // Calculate remaining seconds strictly from server start time
        const startMs = new Date(session.startTimeServer).getTime();
        const nowMs = Date.now();
        const elapsedSec = Math.floor((nowMs - startMs) / 1000);
        const totalDurationSec = exam.durationMinutes * 60;
        const remainingSeconds = Math.max(0, totalDurationSec - elapsedSec);

        // Sanitize questions: NEVER SEND CORRECT_ANSWER OR EXPLANATION TO CLIENT
        const qDict = new Map(examQuestions.map((q) => [q.id, q]));
        const clientQuestions: StudentQuestion[] = [];

        for (const qId of session.questionOrder) {
          const rawQ = qDict.get(qId);
          if (rawQ) {
            const mapping = session.optionOrderMap[qId] || { A: 'A', B: 'B', C: 'C', D: 'D', E: 'E' };
            const rawOptions: Record<string, string> = {
              A: rawQ.optionA,
              B: rawQ.optionB,
              C: rawQ.optionC,
              D: rawQ.optionD,
              E: rawQ.optionE,
            };

            const displayedOptions = (['A', 'B', 'C', 'D', 'E'] as const).map((displayLabel) => {
              const originalKey = (mapping[displayLabel] || displayLabel) as 'A' | 'B' | 'C' | 'D' | 'E';
              return {
                key: displayLabel,
                originalKey: originalKey,
                text: rawOptions[originalKey] || '',
              };
            });

            clientQuestions.push({
              id: rawQ.id,
              questionText: rawQ.questionText,
              options: displayedOptions,
              points: rawQ.points,
            });
          }
        }

        return {
          success: true,
          sessionId: session.id,
          examTitle: exam.title,
          durationMinutes: exam.durationMinutes,
          remainingSeconds,
          violationCount: session.violationCount,
          maxViolations: exam.maxViolations,
          questions: clientQuestions,
          savedAnswers: session.answers,
          doubtful: session.doubtful || {},
          serverTime: new Date().toISOString(),
        };
      }

      case 'saveAnswer': {
        const sessionId = String(data.sessionId);
        const questionId = String(data.questionId);
        const selectedOption = String(data.selectedOption); // original key
        const isDoubtful = Boolean(data.isDoubtful);

        const sessions: StudentExamSession[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSIONS) || '[]');
        const session = sessions.find((s) => s.id === sessionId && s.userId === currentUser.id);
        if (!session) return { success: false, error: 'Sesi ujian tidak valid.' };

        session.answers[questionId] = selectedOption;
        if (!session.doubtful) session.doubtful = {};
        session.doubtful[questionId] = isDoubtful;

        localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));

        return { success: true, savedAt: new Date().toISOString(), questionId };
      }

      case 'logViolation': {
        const sessionId = String(data.sessionId);
        const details = String(data.details || 'Beralih dari tab ujian');
        const sessions: StudentExamSession[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSIONS) || '[]');
        const session = sessions.find((s) => s.id === sessionId && s.userId === currentUser.id);

        let count = 1;
        if (session) {
          session.violationCount = (session.violationCount || 0) + 1;
          count = session.violationCount;
          localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
        }

        this.writeLog(currentUser.id, currentUser.fullName, 'TAB_SWITCH_ALERT', `Pelanggaran #${count}: ${details}`, 'warning');
        return { success: true, violationCount: count };
      }

      case 'submitExam': {
        const sessionId = String(data.sessionId);
        const sessions: StudentExamSession[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSIONS) || '[]');
        const session = sessions.find((s) => s.id === sessionId && s.userId === currentUser.id);
        if (!session) return { success: false, error: 'Sesi ujian tidak ditemukan.' };

        // Server-Side Grading
        const questions: Question[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]');
        const keyMap = new Map(questions.map((q) => [q.id, { correct: q.correctAnswer, points: q.points || 10 }]));

        let correctCount = 0;
        let incorrectCount = 0;
        let totalScore = 0;
        let maxPossible = 0;

        for (const qId of session.questionOrder) {
          const meta = keyMap.get(qId);
          if (meta) {
            maxPossible += meta.points;
            const chosen = session.answers[qId];
            if (chosen && chosen === meta.correct) {
              correctCount++;
              totalScore += meta.points;
            } else if (chosen) {
              incorrectCount++;
            }
          }
        }

        const unansweredCount = session.questionOrder.length - (correctCount + incorrectCount);
        const scaledScore = maxPossible > 0 ? Math.round((totalScore / maxPossible) * 100) : 0;

        session.status = 'submitted';
        session.endTimeServer = new Date().toISOString();
        session.totalScore = scaledScore;
        session.correctCount = correctCount;
        session.incorrectCount = incorrectCount;
        session.unansweredCount = unansweredCount;

        localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
        this.writeLog(currentUser.id, currentUser.fullName, 'SUBMIT_MANUAL', `Mengumpulkan ujian. Skor: ${scaledScore}`, 'info');

        return {
          success: true,
          score: scaledScore,
          correctCount,
          incorrectCount,
          unansweredCount,
          submittedAt: session.endTimeServer,
        };
      }

      // Teacher / Admin Handlers
      case 'getClasses': {
        const classes: ClassRoom[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]') as ClassRoom[]
        ).filter((c) => c?.id && !deletedIds[c.id]);
        return { success: true, classes };
      }

      case 'saveClass': {
        let classes: ClassRoom[] = [];
        try {
          classes = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]');
        } catch {}
        if (!Array.isArray(classes)) {
          classes = [];
        }

        const cData = data as unknown as Partial<ClassRoom>;
        const name = (cData.name || '').trim();
        if (!name) {
          return { success: false, error: 'Nama rombel kelas wajib diisi.' };
        }

        let grade: 'X' | 'XI' | 'XII' = 'X';
        const rawGrade = String(cData.grade || '').trim().toUpperCase();
        if (rawGrade === 'X' || rawGrade === 'XI' || rawGrade === 'XII') {
          grade = rawGrade;
        } else if (name.toUpperCase().startsWith('XII')) {
          grade = 'XII';
        } else if (name.toUpperCase().startsWith('XI')) {
          grade = 'XI';
        }

        const description = (cData.description || '').trim();
        let savedId = cData.id;

        if (cData.id && classes.some((c) => c.id === cData.id)) {
          const idx = classes.findIndex((c) => c.id === cData.id);
          classes[idx] = { ...classes[idx], name, grade, description };

          // Sinkronkan nama kelas pada data ujian & siswa terkait
          try {
            const exams: Exam[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.EXAMS) || '[]');
            let examsUpdated = false;
            exams.forEach((ex) => {
              if (ex.classId === cData.id) {
                ex.className = name;
                examsUpdated = true;
              }
            });
            if (examsUpdated) {
              localStorage.setItem(STORAGE_KEYS.EXAMS, JSON.stringify(exams));
            }
          } catch {}
        } else {
          const cleanSlug = name.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 8);
          savedId = cData.id || `CLS-${cleanSlug || grade}-${Math.floor(Math.random() * 900 + 100)}`;
          const newClass: ClassRoom = {
            id: savedId,
            name,
            grade,
            description,
          };
          classes.push(newClass);
        }

        if (savedId) this.unmarkDeletedIds([savedId]);
        localStorage.setItem(STORAGE_KEYS.CLASSES, JSON.stringify(classes));
        this.writeLog(currentUser.id, currentUser.fullName, 'SAVE_CLASS', `Menyimpan rombel kelas: ${name} (Tingkat ${grade})`, 'info');
        return { success: true, id: savedId, message: `Rombel kelas "${name}" berhasil disimpan.` };
      }

      case 'deleteClass': {
        let classes: ClassRoom[] = [];
        try {
          classes = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]');
        } catch {}
        const id = String(data.id);
        this.markDeletedId(id);
        classes = classes.filter((c) => c.id !== id);
        localStorage.setItem(STORAGE_KEYS.CLASSES, JSON.stringify(classes));
        this.writeLog(currentUser.id, currentUser.fullName, 'DELETE_CLASS', `Menghapus rombel kelas ID: ${id}`, 'warning');
        return { success: true, message: 'Rombel kelas berhasil dihapus.' };
      }

      case 'getSubjects': {
        const subjects: Subject[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]') as Subject[]
        ).filter((s) => s?.id && !deletedIds[s.id]);
        return { success: true, subjects };
      }

      case 'saveSubject': {
        let subjects: Subject[] = [];
        try {
          subjects = JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]');
        } catch {}
        if (!Array.isArray(subjects)) {
          subjects = [];
        }

        const sData = data as unknown as Partial<Subject>;
        const name = (sData.name || '').trim();
        let code = (sData.code || '').trim().toUpperCase();

        if (!name) {
          return { success: false, error: 'Nama mata pelajaran wajib diisi.' };
        }

        // Auto-generate code from name if omitted
        if (!code) {
          const parts = name.split(/\s+/).filter(Boolean);
          if (parts.length >= 2) {
            code = parts.map((p) => p.charAt(0)).join('').toUpperCase().substring(0, 4) + '-10';
          } else {
            code = (name.substring(0, 3).toUpperCase() || 'MP') + '-10';
          }
        }

        const teacherName = (sData.teacherName || sData.teacherId || '').trim();
        const users: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
        const matchedTeacher = users.find(
          (u) =>
            resolveUserRole(u) === 'guru' &&
            ((sData.teacherId && (u.id === sData.teacherId || u.username === sData.teacherId)) ||
              (teacherName &&
                (u.fullName.trim().toLowerCase() === teacherName.toLowerCase() ||
                  u.username.trim().toLowerCase() === teacherName.toLowerCase())))
        );
        const teacherId = (sData.teacherId || matchedTeacher?.id || teacherName || '').trim();
        let savedId = sData.id;

        if (sData.id && subjects.some((s) => s.id === sData.id)) {
          const idx = subjects.findIndex((s) => s.id === sData.id);
          subjects[idx] = {
            ...subjects[idx],
            code,
            name,
            teacherName: matchedTeacher?.fullName || teacherName,
            teacherId,
          };
        } else {
          const cleanCode = code.replace(/[^A-Z0-9]/g, '').substring(0, 8);
          savedId = sData.id || ('SUBJ-' + (cleanCode || 'MAPEL') + '-' + Math.floor(Math.random() * 900 + 100));
          const newSubj: Subject = {
            id: savedId,
            code,
            name,
            teacherName: matchedTeacher?.fullName || teacherName,
            teacherId,
          };
          subjects.push(newSubj);
        }

        if (savedId) this.unmarkDeletedIds([savedId, `subj_q:${savedId}`]);
        localStorage.setItem(STORAGE_KEYS.SUBJECTS, JSON.stringify(subjects));
        this.writeLog(currentUser.id, currentUser.fullName, 'SAVE_SUBJECT', `Menyimpan mata pelajaran: ${name} (${code})`, 'info');
        return { success: true, id: savedId, message: `Mata pelajaran "${name}" berhasil disimpan.` };
      }

      case 'deleteSubject': {
        let subjects: Subject[] = [];
        try {
          subjects = JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]');
        } catch {}
        const id = String(data.id);
        this.markDeletedIds([id, `subj_q:${id}`]);
        subjects = subjects.filter((s) => s.id !== id);
        localStorage.setItem(STORAGE_KEYS.SUBJECTS, JSON.stringify(subjects));

        // Hapus juga soal dan jadwal ujian yang terkait dengan mata pelajaran yang dihapus agar tidak muncul kembali
        try {
          const questions: Question[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]');
          const removedQIds = questions.filter((q) => q.subjectId === id).map((q) => q.id);
          if (removedQIds.length > 0) {
            this.markDeletedIds(removedQIds);
            localStorage.setItem(
              STORAGE_KEYS.QUESTIONS,
              JSON.stringify(questions.filter((q) => q.subjectId !== id))
            );
          }
        } catch {}

        try {
          const exams: Exam[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.EXAMS) || '[]');
          const removedExamIds = exams.filter((e) => e.subjectId === id).map((e) => e.id);
          if (removedExamIds.length > 0) {
            this.markDeletedIds(removedExamIds);
            localStorage.setItem(
              STORAGE_KEYS.EXAMS,
              JSON.stringify(exams.filter((e) => e.subjectId !== id))
            );
          }
        } catch {}

        this.writeLog(currentUser.id, currentUser.fullName, 'DELETE_SUBJECT', `Menghapus mata pelajaran ID: ${id}`, 'warning');
        return { success: true, message: 'Mata pelajaran berhasil dihapus.' };
      }

      case 'getQuestions': {
        const questions: Question[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]') as Question[]
        ).filter(
          (q) =>
            q?.id &&
            !deletedIds[q.id] &&
            (!q.subjectId || (!deletedIds[q.subjectId] && !deletedIds[`subj_q:${q.subjectId}`]))
        );
        return { success: true, questions };
      }

      case 'saveQuestion': {
        const questions: Question[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]');
        const qData = data as unknown as Question;
        const normalizeKey = (val: unknown, fallback: 'A' | 'B' | 'C' | 'D' | 'E' = 'A'): 'A' | 'B' | 'C' | 'D' | 'E' => {
          const cleaned = String(val || '').trim().toUpperCase();
          if (['A', 'B', 'C', 'D', 'E'].includes(cleaned)) {
            return cleaned as 'A' | 'B' | 'C' | 'D' | 'E';
          }
          return fallback;
        };

        if (qData.id && questions.some((q) => q.id === qData.id)) {
          const idx = questions.findIndex((q) => q.id === qData.id);
          if (idx >= 0) {
            const preservedKey = qData.correctAnswer
              ? normalizeKey(qData.correctAnswer, questions[idx].correctAnswer)
              : questions[idx].correctAnswer;
            questions[idx] = {
              ...questions[idx],
              ...qData,
              correctAnswer: preservedKey,
            };
          }
        } else {
          const newQ: Question = {
            ...qData,
            id: qData.id || 'Q-' + Math.random().toString(36).substring(2, 9),
            correctAnswer: normalizeKey(qData.correctAnswer, 'A'),
            createdBy: currentUser.fullName,
          };
          questions.push(newQ);
        }
        if (qData.subjectId) {
          this.unmarkDeletedIds([`subj_q:${qData.subjectId}`]);
        }
        localStorage.setItem(STORAGE_KEYS.QUESTIONS, JSON.stringify(questions));
        this.writeLog(currentUser.id, currentUser.fullName, 'CREATE_QUESTION', `Menyimpan butir soal untuk mata pelajaran`, 'info');
        return { success: true };
      }

      case 'batchSaveQuestions': {
        const rawList = (data.questions || []) as Partial<Question>[];
        const replaceExisting = Boolean(data.replaceExisting);
        const subjects: Subject[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]') as Subject[]
        ).filter((s) => s?.id && !deletedIds[s.id]);
        const targetSubjectId = String(
          data.subjectId || rawList[0]?.subjectId || subjects[0]?.id || ''
        );
        if (!Array.isArray(rawList) || rawList.length === 0) {
          return { success: false, error: 'Tidak ada data soal yang valid untuk disimpan.' };
        }
        if (targetSubjectId) {
          this.unmarkDeletedIds([`subj_q:${targetSubjectId}`]);
        }
        let questions: Question[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]');
        if (replaceExisting && targetSubjectId) {
          const validSubjIds = new Set(subjects.map((s) => s.id));
          const remaining: Question[] = [];
          for (const q of questions) {
            const isTarget = q.subjectId === targetSubjectId;
            const isOrphan = subjects.length > 0 && !validSubjIds.has(q.subjectId);
            if (isTarget || isOrphan) {
              this.markDeletedId(q.id);
            } else {
              remaining.push(q);
            }
          }
          questions = remaining;
        }
        rawList.forEach((q) => {
          const rawKey = String(q.correctAnswer || '').trim().toUpperCase();
          const exactKey: 'A' | 'B' | 'C' | 'D' | 'E' = ['A', 'B', 'C', 'D', 'E'].includes(rawKey)
            ? (rawKey as 'A' | 'B' | 'C' | 'D' | 'E')
            : 'A';
          questions.push({
            id: q.id || 'Q-' + Math.random().toString(36).substring(2, 9),
            subjectId: targetSubjectId || q.subjectId || subjects[0]?.id || 'SUBJ-FIQ-10',
            classId: q.classId || '',
            questionText: q.questionText || '',
            optionA: q.optionA || '',
            optionB: q.optionB || '',
            optionC: q.optionC || '',
            optionD: q.optionD || '',
            optionE: q.optionE || '',
            correctAnswer: exactKey,
            explanation: q.explanation || '',
            points: Number(q.points) || 10,
            createdBy: currentUser.fullName,
          });
        });
        localStorage.setItem(STORAGE_KEYS.QUESTIONS, JSON.stringify(questions));

        // Sinkronkan jumlah soal pada jadwal ujian yang menggunakan mata pelajaran ini
        try {
          const exams: Exam[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.EXAMS) || '[]');
          const classes: ClassRoom[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]');
          let examsUpdated = false;
          for (const ex of exams) {
            const resolved = this.resolveExamAndQuestions(ex, questions, subjects, classes);
            if (ex.totalQuestions !== resolved.effectiveTotalQuestions || ex.subjectId !== resolved.effectiveSubjectId) {
              ex.totalQuestions = resolved.effectiveTotalQuestions;
              ex.subjectId = resolved.effectiveSubjectId;
              ex.subjectName = resolved.effectiveSubjectName;
              examsUpdated = true;
            }
          }
          if (examsUpdated) {
            localStorage.setItem(STORAGE_KEYS.EXAMS, JSON.stringify(exams));
          }
        } catch {}

        this.writeLog(
          currentUser.id,
          currentUser.fullName,
          'CREATE_QUESTION',
          `${replaceExisting ? 'Mengganti & mengunggah' : 'Mengunggah'} ${rawList.length} butir soal ke bank soal`,
          'info'
        );
        return { success: true, count: rawList.length };
      }

      case 'deleteQuestion': {
        const qId = String(data.id || '');
        const subjectId = String(data.subjectId || '');
        let questions: Question[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]');
        if (data.deleteAllBySubject && subjectId) {
          this.markDeletedId(`subj_q:${subjectId}`);
          questions.filter((q) => q.subjectId === subjectId).forEach((q) => this.markDeletedId(q.id));
          questions = questions.filter((q) => q.subjectId !== subjectId);
        } else {
          this.markDeletedId(qId);
          questions = questions.filter((q) => q.id !== qId);
        }
        localStorage.setItem(STORAGE_KEYS.QUESTIONS, JSON.stringify(questions));
        return { success: true };
      }

      case 'getExams': {
        const exams: Exam[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.EXAMS) || '[]') as Exam[]
        ).filter((e) => e?.id && !deletedIds[e.id] && (!e.subjectId || !deletedIds[e.subjectId]));
        const questions: Question[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]') as Question[]
        ).filter(
          (q) =>
            q?.id &&
            !deletedIds[q.id] &&
            (!q.subjectId || (!deletedIds[q.subjectId] && !deletedIds[`subj_q:${q.subjectId}`]))
        );
        const subjects: Subject[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]') as Subject[]
        ).filter((s) => s?.id && !deletedIds[s.id]);
        const classes: ClassRoom[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]') as ClassRoom[]
        ).filter((c) => c?.id && !deletedIds[c.id]);
        const enriched = exams.map((ex) => {
          const normalizedSched = normalizeExamScheduleFields(ex);
          const resolved = this.resolveExamAndQuestions(ex, questions, subjects, classes);
          return {
            ...ex,
            subjectId: resolved.effectiveSubjectId,
            subjectName: resolved.effectiveSubjectName,
            className: resolved.effectiveClassName,
            totalQuestions: resolved.effectiveTotalQuestions,
            examDate: normalizedSched.examDate,
            startTime: normalizedSched.startTime,
            endTime: normalizedSched.endTime,
            startWindow: normalizedSched.startWindow,
            endWindow: normalizedSched.endWindow,
          };
        });
        return { success: true, exams: enriched };
      }

      case 'saveExam': {
        const exams: Exam[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.EXAMS) || '[]');
        const questions: Question[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]') as Question[]
        ).filter(
          (q) =>
            q?.id &&
            !deletedIds[q.id] &&
            (!q.subjectId || (!deletedIds[q.subjectId] && !deletedIds[`subj_q:${q.subjectId}`]))
        );
        const subjects: Subject[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]') as Subject[]
        ).filter((s) => s?.id && !deletedIds[s.id]);
        const classes: ClassRoom[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]') as ClassRoom[]
        ).filter((c) => c?.id && !deletedIds[c.id]);
        const eData = data as unknown as Exam;
        const examDate = eData.examDate || getLocalDateString();
        const startTime = eData.startTime || '07:30';
        const endTime = eData.endTime || '23:59';
        const startWindow = buildIsoWindowWithOffset(examDate, startTime, '00');
        const endWindow = buildIsoWindowWithOffset(examDate, endTime, '59');
        const resolved = this.resolveExamAndQuestions(eData, questions, subjects, classes);

        const normalizedExam: Exam = {
          ...eData,
          subjectId: resolved.effectiveSubjectId,
          subjectName: resolved.effectiveSubjectName,
          className: resolved.effectiveClassName,
          totalQuestions: resolved.effectiveTotalQuestions,
          examDate,
          startTime,
          endTime,
          startWindow,
          endWindow,
        };

        if (eData.id && exams.some((e) => e.id === eData.id)) {
          const idx = exams.findIndex((e) => e.id === eData.id);
          if (idx >= 0) exams[idx] = { ...exams[idx], ...normalizedExam };
        } else {
          exams.push({
            ...normalizedExam,
            id: eData.id || 'EXAM-' + Math.random().toString(36).substring(2, 9),
          });
        }
        if (eData.id) this.unmarkDeletedIds([eData.id]);
        localStorage.setItem(STORAGE_KEYS.EXAMS, JSON.stringify(exams));
        this.writeLog(currentUser.id, currentUser.fullName, 'UPDATE_EXAM', `Menyimpan jadwal ujian: ${eData.title} (${examDate} ${startTime}-${endTime})`, 'info');
        return { success: true };
      }

      case 'deleteExam': {
        const eId = String(data.id);
        this.markDeletedId(eId);
        let exams: Exam[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.EXAMS) || '[]');
        exams = exams.filter((e) => e.id !== eId);
        localStorage.setItem(STORAGE_KEYS.EXAMS, JSON.stringify(exams));
        return { success: true };
      }

      case 'getStudents': {
        const users: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
        const students = users
          .filter((u) => !this.isUserDeleted(u, deletedIds) && resolveUserRole(u) === 'siswa')
          .map((u) => {
            const safe = { ...u, role: 'siswa' as const };
            delete safe.passwordHash;
            delete safe.salt;
            return safe;
          });
        return { success: true, students };
      }

      case 'saveStudent': {
        const users: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
        const sData = data as unknown as { id?: string; username: string; fullName: string; classId: string; password?: string };
        const cleanUsername = String(sData.username || '').trim();
        const cleanFullName = String(sData.fullName || '').trim();

        const existingIdx = users.findIndex(
          (u) =>
            (sData.id && u.id === sData.id) ||
            (cleanUsername && normalizeUsernameOrNisn(u.username) === normalizeUsernameOrNisn(cleanUsername))
        );

        if (existingIdx >= 0) {
          const currentId = String(sData.id || users[existingIdx].id || '');
          users[existingIdx].id = currentId.toUpperCase().startsWith('USR-GURU')
            ? 'USR-SISWA-' + Math.random().toString(36).substring(2, 8)
            : currentId || 'USR-SISWA-' + Math.random().toString(36).substring(2, 8);
          users[existingIdx].username = cleanUsername;
          users[existingIdx].fullName = cleanFullName;
          users[existingIdx].classId = sData.classId;
          users[existingIdx].role = 'siswa';
          users[existingIdx].status = 'active';
          if (sData.password && sData.password.trim()) {
            const salt = generateRandomSalt();
            users[existingIdx].salt = salt;
            users[existingIdx].passwordHash = await hashPasswordWithSalt(sData.password.trim(), salt);
          }
          this.unmarkDeletedIds([
            users[existingIdx].id,
            `uname:${normalizeUsernameOrNisn(cleanUsername)}`,
            `uname:${stripLeadingZeros(cleanUsername)}`,
          ]);
          localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
          return { success: true, id: users[existingIdx].id };
        } else {
          const salt = generateRandomSalt();
          const hash = await hashPasswordWithSalt(sData.password || 'Siswa123!', salt);
          const rawNewId = String(sData.id || '');
          const cleanNewId =
            rawNewId && !rawNewId.toUpperCase().startsWith('USR-GURU')
              ? rawNewId
              : 'USR-SISWA-' + Math.random().toString(36).substring(2, 8);
          const newStudent: User = {
            id: cleanNewId,
            username: cleanUsername,
            fullName: cleanFullName,
            role: 'siswa',
            classId: sData.classId,
            status: 'active',
            salt,
            passwordHash: hash,
            createdAt: new Date().toISOString(),
          };
          users.push(newStudent);
          this.unmarkDeletedIds([
            cleanNewId,
            `uname:${normalizeUsernameOrNisn(cleanUsername)}`,
            `uname:${stripLeadingZeros(cleanUsername)}`,
          ]);
          localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
          return { success: true, id: newStudent.id };
        }
      }

      case 'deleteStudent': {
        const userId = String(data.userId || '');
        const targetUname = normalizeUsernameOrNisn(String(data.username || ''));
        let users: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
        const matched = users.filter(
          (u) => u.id === userId || (targetUname && normalizeUsernameOrNisn(u.username) === targetUname)
        );
        if (matched.length > 0) {
          matched.forEach((m) => this.markDeletedUser(m.id, m.username));
        } else {
          this.markDeletedUser(userId, targetUname);
        }
        users = users.filter(
          (u) => u.id !== userId && (!targetUname || normalizeUsernameOrNisn(u.username) !== targetUname)
        );
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
        return { success: true };
      }

      case 'resetStudentPassword': {
        const userId = String(data.userId);
        const users: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
        const target = users.find((u) => u.id === userId);
        if (!target) return { success: false, error: 'Siswa tidak ditemukan.' };

        const newSalt = generateRandomSalt();
        const defaultPass = 'Siswa123!';
        target.salt = newSalt;
        target.passwordHash = await hashPasswordWithSalt(defaultPass, newSalt);
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
        this.writeLog(currentUser.id, currentUser.fullName, 'RESET_EXAM', `Reset password siswa: ${target.fullName}`, 'warning');
        return { success: true, message: `Password berhasil direset ke: ${defaultPass}` };
      }

      case 'getTeachers': {
        const users: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
        const teachers = users
          .filter((u) => !this.isUserDeleted(u, deletedIds) && resolveUserRole(u) === 'guru')
          .map(({ passwordHash: _, salt: __, ...clean }) => ({ ...clean, role: 'guru' as const }));
        return { success: true, teachers };
      }

      case 'saveTeacher': {
        const tData = data as { id?: string; username: string; fullName: string; password?: string };
        const cleanUsername = (tData.username || '').trim();
        const cleanFullName = (tData.fullName || '').trim();

        if (!cleanUsername || !cleanFullName) {
          return { success: false, error: 'Username dan nama lengkap guru wajib diisi.' };
        }

        const users: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
        const existingByIdIdx = tData.id ? users.findIndex((u) => u.id === tData.id) : -1;
        const duplicate = users.find(
          (u) =>
            normalizeUsernameOrNisn(u.username) === normalizeUsernameOrNisn(cleanUsername) &&
            u.id !== tData.id &&
            u.role !== 'guru'
        );
        if (duplicate) {
          return {
            success: false,
            error: `Username "${cleanUsername}" sudah digunakan oleh akun lain (${duplicate.fullName}).`,
          };
        }

        const targetIdx =
          existingByIdIdx >= 0
            ? existingByIdIdx
            : users.findIndex(
                (u) =>
                  normalizeRole(u.role) === 'guru' &&
                  normalizeUsernameOrNisn(u.username) === normalizeUsernameOrNisn(cleanUsername)
              );

        if (targetIdx >= 0) {
          if (tData.id) users[targetIdx].id = tData.id;
          users[targetIdx].username = cleanUsername;
          users[targetIdx].fullName = cleanFullName;
          users[targetIdx].role = 'guru';
          users[targetIdx].status = 'active';
          if (tData.password && tData.password.trim()) {
            const salt = generateRandomSalt();
            users[targetIdx].salt = salt;
            users[targetIdx].passwordHash = await hashPasswordWithSalt(tData.password.trim(), salt);
          }
          this.unmarkDeletedIds([
            users[targetIdx].id,
            `uname:${normalizeUsernameOrNisn(cleanUsername)}`,
          ]);
          localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
          this.writeLog(
            currentUser.id,
            currentUser.fullName,
            'UPDATE_EXAM',
            `Memperbarui akun guru: ${cleanFullName} (${cleanUsername})`,
            'info'
          );
          return {
            success: true,
            id: users[targetIdx].id,
            message: `Data akun guru "${cleanFullName}" berhasil diperbarui.`,
          };
        } else {
          const salt = generateRandomSalt();
          const passToUse = tData.password && tData.password.trim() ? tData.password.trim() : 'Guru123!';
          const hash = await hashPasswordWithSalt(passToUse, salt);
          const newTeacher: User = {
            id: tData.id || 'USR-GURU-' + Math.random().toString(36).substring(2, 7).toUpperCase(),
            username: cleanUsername,
            fullName: cleanFullName,
            role: 'guru',
            status: 'active',
            salt,
            passwordHash: hash,
            createdAt: new Date().toISOString(),
          };
          users.push(newTeacher);
          this.unmarkDeletedIds([
            newTeacher.id,
            `uname:${normalizeUsernameOrNisn(cleanUsername)}`,
          ]);
          localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
          this.writeLog(
            currentUser.id,
            currentUser.fullName,
            'UPDATE_EXAM',
            `Menambahkan akun guru baru: ${cleanFullName} (${cleanUsername})`,
            'info'
          );
          return {
            success: true,
            id: newTeacher.id,
            message: `Akun guru "${cleanFullName}" berhasil ditambahkan.`,
          };
        }
      }

      case 'deleteTeacher': {
        const userId = String(data.userId || '');
        const targetUname = normalizeUsernameOrNisn(String(data.username || ''));
        let users: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
        const target = users.find(
          (u) =>
            (u.id === userId || (targetUname && normalizeUsernameOrNisn(u.username) === targetUname)) &&
            resolveUserRole(u) === 'guru'
        );
        this.markDeletedUser(target?.id || userId, target?.username || targetUname);
        users = users.filter(
          (u) => u.id !== userId && (!targetUname || normalizeUsernameOrNisn(u.username) !== targetUname)
        );
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
        if (target) {
          this.writeLog(
            currentUser.id,
            currentUser.fullName,
            'UPDATE_EXAM',
            `Menghapus akun guru: ${target.fullName} (${target.username})`,
            'warning'
          );
        }
        return { success: true, message: `Akun guru "${target?.fullName || userId}" berhasil dihapus.` };
      }

      case 'resetTeacherPassword': {
        const userId = String(data.userId);
        const users: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
        const target = users.find((u) => u.id === userId && u.role === 'guru');
        if (!target) return { success: false, error: 'Akun guru tidak ditemukan.' };

        const newSalt = generateRandomSalt();
        const defaultPass = 'Guru123!';
        target.salt = newSalt;
        target.passwordHash = await hashPasswordWithSalt(defaultPass, newSalt);
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
        this.writeLog(
          currentUser.id,
          currentUser.fullName,
          'RESET_EXAM',
          `Reset password guru: ${target.fullName}`,
          'warning'
        );
        return { success: true, message: `Password guru "${target.fullName}" berhasil direset ke: ${defaultPass}` };
      }

      case 'getExamResults': {
        const sessions: StudentExamSession[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSIONS) || '[]') as StudentExamSession[]
        ).filter((s) => s?.id && !deletedIds[s.id]);
        const users: User[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
        const userMap = new Map(users.map((u) => [u.id, u]));

        const results = sessions.map((s) => {
          const u = userMap.get(s.userId);
          return {
            id: s.id,
            examId: s.examId,
            userId: s.userId,
            studentName: s.studentName || u?.fullName || 'Siswa',
            username: u?.username || '',
            classId: u?.classId || '',
            startTime: s.startTimeServer,
            endTime: s.endTimeServer,
            status: s.status,
            totalScore: s.totalScore ?? 0,
            correctCount: s.correctCount ?? 0,
            incorrectCount: s.incorrectCount ?? 0,
            unansweredCount: s.unansweredCount ?? 0,
            violationCount: s.violationCount ?? 0,
          };
        });
        return { success: true, results };
      }

      case 'resetStudentExam': {
        const studentExamId = String(data.studentExamId);
        this.markDeletedId(studentExamId);
        let sessions: StudentExamSession[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSIONS) || '[]');
        const target = sessions.find((s) => s.id === studentExamId);
        sessions = sessions.filter((s) => s.id !== studentExamId);
        localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));

        this.writeLog(
          currentUser.id,
          currentUser.fullName,
          'RESET_EXAM',
          `Pengawas mereset sesi ujian untuk siswa: ${target?.studentName || studentExamId}`,
          'warning'
        );
        return { success: true, message: 'Sesi ujian siswa berhasil di-reset. Siswa dapat mengikuti ujian kembali.' };
      }

      case 'getActivityLogs': {
        const logs: AuditLog[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOGS) || '[]');
        return { success: true, logs: logs.slice(-100).reverse() };
      }

      case 'getSystemStats': {
        const users: User[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]') as User[]
        ).filter((u) => !this.isUserDeleted(u, deletedIds));
        const questions: Question[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]') as Question[]
        ).filter(
          (q) =>
            q?.id &&
            !deletedIds[q.id] &&
            (!q.subjectId || (!deletedIds[q.subjectId] && !deletedIds[`subj_q:${q.subjectId}`]))
        );
        const exams: Exam[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.EXAMS) || '[]') as Exam[]
        ).filter((e) => e?.id && !deletedIds[e.id] && (!e.subjectId || !deletedIds[e.subjectId]));
        const sessions: StudentExamSession[] = (
          JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSIONS) || '[]') as StudentExamSession[]
        ).filter((s) => s?.id && !deletedIds[s.id]);

        return {
          success: true,
          stats: {
            totalStudents: users.filter((u) => resolveUserRole(u) === 'siswa').length,
            totalQuestions: questions.length,
            totalExams: exams.length,
            activeSessions: sessions.filter((s) => s.status === 'in_progress').length,
          },
        };
      }

      default:
        return { success: false, error: 'Aksi tidak dikenal.' };
    }
  }

  private writeLog(userId: string, userName: string, action: AuditLog['action'], details: string, severity: AuditLog['severity'] = 'info') {
    const logs: AuditLog[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOGS) || '[]');
    const newLog: AuditLog = {
      id: 'LOG-' + Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      userId,
      userName,
      action,
      details,
      severity,
    };
    logs.push(newLog);
    localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(logs.slice(-200)));
  }

  private shuffle<T>(array: T[]): T[] {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // Public Service APIs
  public login(
    username: string,
    password: string,
    portalType?: 'siswa' | 'staff'
  ): Promise<{ success: boolean; token?: string; user?: User; error?: string }> {
    return this.dispatch('login', { username, password, portalType });
  }

  public getAvailableExams(): Promise<{ success: boolean; exams?: (Exam & { isWithinWindow: boolean; studentAttempt: { id?: string; status: string; totalScore?: number } })[]; error?: string }> {
    return this.dispatch('getAvailableExams');
  }

  public startExam(examId: string, token: string): Promise<{
    success: boolean;
    sessionId?: string;
    examTitle?: string;
    durationMinutes?: number;
    remainingSeconds?: number;
    violationCount?: number;
    maxViolations?: number;
    questions?: StudentQuestion[];
    savedAnswers?: Record<string, string>;
    doubtful?: Record<string, boolean>;
    serverTime?: string;
    error?: string;
  }> {
    return this.dispatch('startExam', { examId, token, clientInfo: navigator.userAgent });
  }

  public saveAnswer(sessionId: string, questionId: string, selectedOption: string, isDoubtful?: boolean): Promise<{ success: boolean; savedAt?: string; questionId?: string; error?: string }> {
    return this.dispatch('saveAnswer', {
      sessionId,
      questionId,
      selectedOption,
      isDoubtful,
    });
  }

  public logViolation(sessionId: string, details: string): Promise<{ success: boolean; violationCount?: number; error?: string }> {
    return this.dispatch('logViolation', {
      sessionId,
      details,
      type: 'TAB_SWITCH',
    });
  }

  public submitExam(sessionId: string): Promise<{
    success: boolean;
    score?: number;
    correctCount?: number;
    incorrectCount?: number;
    unansweredCount?: number;
    submittedAt?: string;
    error?: string;
  }> {
    return this.dispatch('submitExam', { sessionId });
  }

  public getClasses(): Promise<{ success: boolean; classes?: ClassRoom[]; error?: string }> {
    return this.dispatch('getClasses');
  }

  public saveClass(classRoom: Partial<ClassRoom>): Promise<{ success: boolean; id?: string; message?: string; error?: string }> {
    return this.dispatch('saveClass', classRoom as Record<string, unknown>);
  }

  public deleteClass(id: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.dispatch('deleteClass', { id });
  }

  public getSubjects(): Promise<{ success: boolean; subjects?: Subject[]; error?: string }> {
    return this.dispatch('getSubjects');
  }

  public saveSubject(subject: Partial<Subject>): Promise<{ success: boolean; id?: string; message?: string; error?: string }> {
    return this.dispatch('saveSubject', subject as Record<string, unknown>);
  }

  public deleteSubject(id: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.dispatch('deleteSubject', { id });
  }

  public getQuestions(subjectId?: string): Promise<{ success: boolean; questions?: Question[]; error?: string }> {
    return this.dispatch('getQuestions', { subjectId });
  }

  public saveQuestion(question: Partial<Question>): Promise<{ success: boolean; id?: string; error?: string }> {
    return this.dispatch('saveQuestion', question as Record<string, unknown>);
  }

  public batchSaveQuestions(
    questions: Partial<Question>[],
    options?: { replaceExisting?: boolean; subjectId?: string }
  ): Promise<{ success: boolean; count?: number; error?: string }> {
    return this.dispatch('batchSaveQuestions', {
      questions,
      replaceExisting: options?.replaceExisting,
      subjectId: options?.subjectId,
    });
  }

  public deleteQuestion(id: string): Promise<{ success: boolean; error?: string }> {
    return this.dispatch('deleteQuestion', { id });
  }

  public deleteQuestionsBySubject(subjectId: string): Promise<{ success: boolean; error?: string }> {
    return this.dispatch('deleteQuestion', { subjectId, deleteAllBySubject: true });
  }

  public isIdDeleted(id: string): boolean {
    if (!id) return false;
    const deleted = this.getDeletedIds();
    return Boolean(deleted[id] || deleted[`subj_q:${id}`]);
  }

  /**
   * Memindahkan / menyinkronkan soal yang memiliki subjectId yatim (misal SUBJ-FIQ-10)
   * ke ID mata pelajaran sasaran yang terdaftar di sistem & Google Spreadsheet.
   */
  public async reassignOrphanedQuestions(
    oldSubjectId: string,
    newSubjectId: string,
    movedQuestions: Question[]
  ): Promise<void> {
    if (!oldSubjectId || !newSubjectId || oldSubjectId === newSubjectId) return;
    if (this.isIdDeleted(oldSubjectId)) return;
    try {
      const localQuestions: Question[] = JSON.parse(
        localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]'
      );
      const updatedLocal = localQuestions.map((q) =>
        q.subjectId === oldSubjectId ? { ...q, subjectId: newSubjectId } : q
      );
      localStorage.setItem(STORAGE_KEYS.QUESTIONS, JSON.stringify(updatedLocal));

      if (this.config.useLiveGas && this.config.gasWebAppUrl && movedQuestions.length > 0) {
        const token = this.getStoredToken() || generateSessionToken('USR-ADMIN-1', 'admin');
        const formatted = movedQuestions.map((q) => ({ ...q, subjectId: newSubjectId }));
        await this.callGasEndpoint(
          'batchSaveQuestions',
          { questions: formatted, replaceExisting: false, subjectId: newSubjectId },
          token
        );
        await this.callGasEndpoint(
          'deleteQuestion',
          { subjectId: oldSubjectId, deleteAllBySubject: true },
          token
        );
      }

      await this.syncWithServer(true);
    } catch (err) {
      console.warn('Gagal memindahkan soal yatim ke mata pelajaran sasaran:', err);
    }
  }

  public getExams(): Promise<{ success: boolean; exams?: Exam[]; error?: string }> {
    return this.dispatch('getExams');
  }

  public saveExam(exam: Partial<Exam>): Promise<{ success: boolean; id?: string; error?: string }> {
    return this.dispatch('saveExam', exam as Record<string, unknown>);
  }

  public deleteExam(id: string): Promise<{ success: boolean; error?: string }> {
    return this.dispatch('deleteExam', { id });
  }

  public getStudents(): Promise<{ success: boolean; students?: User[]; error?: string }> {
    return this.dispatch('getStudents');
  }

  public saveStudent(student: { id?: string; username: string; fullName: string; classId: string; password?: string }): Promise<{ success: boolean; id?: string; message?: string; error?: string }> {
    return this.dispatch('saveStudent', student);
  }

  public deleteStudent(userId: string): Promise<{ success: boolean; error?: string }> {
    return this.dispatch('deleteStudent', { userId });
  }

  public resetStudentPassword(userId: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.dispatch('resetStudentPassword', { userId });
  }

  public getTeachers(): Promise<{ success: boolean; teachers?: User[]; error?: string }> {
    return this.dispatch('getTeachers');
  }

  public saveTeacher(teacher: { id?: string; username: string; fullName: string; password?: string }): Promise<{ success: boolean; id?: string; message?: string; error?: string }> {
    return this.dispatch('saveTeacher', teacher);
  }

  public deleteTeacher(userId: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.dispatch('deleteTeacher', { userId });
  }

  public resetTeacherPassword(userId: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.dispatch('resetTeacherPassword', { userId });
  }

  public getExamResults(examId?: string): Promise<{ success: boolean; results?: any[]; error?: string }> {
    return this.dispatch('getExamResults', { examId });
  }

  public resetStudentExam(studentExamId: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.dispatch('resetStudentExam', { studentExamId });
  }

  public getActivityLogs(): Promise<{ success: boolean; logs?: AuditLog[]; error?: string }> {
    return this.dispatch('getActivityLogs');
  }

  public getSystemStats(): Promise<{ success: boolean; stats?: { totalStudents: number; totalQuestions: number; totalExams: number; activeSessions: number }; error?: string }> {
    return this.dispatch('getSystemStats');
  }

  /**
   * Synchronously reads and normalizes local storage cache so Admin/Guru dashboard
   * renders immediately (0ms) without waiting for network round-trips.
   */
  public getCachedDashboardSnapshot(): {
    classes: ClassRoom[];
    subjects: Subject[];
    questions: Question[];
    exams: Exam[];
    students: User[];
    teachers: User[];
    results: any[];
    logs: AuditLog[];
    stats: { totalStudents: number; totalQuestions: number; totalExams: number; activeSessions: number };
  } {
    const deletedIds = this.getDeletedIds();
    const classes: ClassRoom[] = (
      JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]') as ClassRoom[]
    ).filter((c) => c?.id && !deletedIds[c.id]);
    const subjects: Subject[] = (
      JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]') as Subject[]
    ).filter((s) => s?.id && !deletedIds[s.id]);
    const questions: Question[] = (
      JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]') as Question[]
    ).filter(
      (q) =>
        q?.id &&
        !deletedIds[q.id] &&
        (!q.subjectId || (!deletedIds[q.subjectId] && !deletedIds[`subj_q:${q.subjectId}`]))
    );
    const rawExams: Exam[] = (
      JSON.parse(localStorage.getItem(STORAGE_KEYS.EXAMS) || '[]') as Exam[]
    ).filter((e) => e?.id && !deletedIds[e.id] && (!e.subjectId || !deletedIds[e.subjectId]));

    const exams: Exam[] = rawExams.map((ex) => {
      const normalizedSched = normalizeExamScheduleFields(ex);
      const resolved = this.resolveExamAndQuestions(ex, questions, subjects, classes);
      return {
        ...ex,
        subjectId: resolved.effectiveSubjectId,
        subjectName: resolved.effectiveSubjectName,
        className: resolved.effectiveClassName,
        totalQuestions: resolved.effectiveTotalQuestions,
        examDate: normalizedSched.examDate,
        startTime: normalizedSched.startTime,
        endTime: normalizedSched.endTime,
        startWindow: normalizedSched.startWindow,
        endWindow: normalizedSched.endWindow,
      };
    });

    const allUsers: User[] = (
      JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]') as User[]
    ).filter((u) => !this.isUserDeleted(u, deletedIds));

    const students: User[] = allUsers
      .filter((u) => resolveUserRole(u) === 'siswa')
      .map(({ passwordHash: _, salt: __, ...clean }) => ({ ...clean, role: 'siswa' as const }));
    const teachers: User[] = allUsers
      .filter((u) => resolveUserRole(u) === 'guru')
      .map(({ passwordHash: _, salt: __, ...clean }) => ({ ...clean, role: 'guru' as const }));

    const sessions: StudentExamSession[] = (
      JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSIONS) || '[]') as StudentExamSession[]
    ).filter((s) => s?.id && !deletedIds[s.id]);
    const userMap = new Map(allUsers.map((u) => [u.id, u]));

    const results = sessions.map((s) => {
      const u = userMap.get(s.userId);
      return {
        id: s.id,
        examId: s.examId,
        userId: s.userId,
        studentName: s.studentName || u?.fullName || 'Siswa',
        username: u?.username || '',
        classId: u?.classId || '',
        startTime: s.startTimeServer,
        endTime: s.endTimeServer,
        status: s.status,
        totalScore: s.totalScore ?? 0,
        correctCount: s.correctCount ?? 0,
        incorrectCount: s.incorrectCount ?? 0,
        unansweredCount: s.unansweredCount ?? 0,
        violationCount: s.violationCount ?? 0,
      };
    });

    const rawLogs: AuditLog[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOGS) || '[]');
    const logs = rawLogs.slice(-100).reverse();

    const stats = {
      totalStudents: students.length,
      totalQuestions: questions.length,
      totalExams: exams.length,
      activeSessions: results.filter((r) => r.status === 'in_progress').length,
    };

    return {
      classes,
      subjects,
      questions,
      exams,
      students,
      teachers,
      results,
      logs,
      stats,
    };
  }

  /**
   * Synchronously reads and normalizes available exams for a student from local storage
   * so StudentDashboard renders immediately (0ms) on mount.
   */
  public getCachedAvailableExams(
    user?: User | null
  ): (Exam & { isWithinWindow: boolean; studentAttempt: { id?: string; status: string; totalScore?: number } })[] {
    const currentUser = user || this.getStoredUser();
    if (!currentUser) return [];
    const deletedIds = this.getDeletedIds();
    const exams: Exam[] = (
      JSON.parse(localStorage.getItem(STORAGE_KEYS.EXAMS) || '[]') as Exam[]
    ).filter((e) => e?.id && !deletedIds[e.id] && (!e.subjectId || !deletedIds[e.subjectId]));
    const questions: Question[] = (
      JSON.parse(localStorage.getItem(STORAGE_KEYS.QUESTIONS) || '[]') as Question[]
    ).filter(
      (q) =>
        q?.id &&
        !deletedIds[q.id] &&
        (!q.subjectId || (!deletedIds[q.subjectId] && !deletedIds[`subj_q:${q.subjectId}`]))
    );
    const subjects: Subject[] = (
      JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]') as Subject[]
    ).filter((s) => s?.id && !deletedIds[s.id]);
    const classes: ClassRoom[] = (
      JSON.parse(localStorage.getItem(STORAGE_KEYS.CLASSES) || '[]') as ClassRoom[]
    ).filter((c) => c?.id && !deletedIds[c.id]);
    const sessions: StudentExamSession[] = (
      JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSIONS) || '[]') as StudentExamSession[]
    ).filter((s) => s?.id && !deletedIds[s.id]);
    const userSessions = sessions.filter((s) => s.userId === currentUser.id);

    return exams
      .filter((ex) => (ex.classId === currentUser.classId || !ex.classId || !currentUser.classId) && ex.status === 'published')
      .map((ex) => {
        const sess = userSessions.find((s) => s.examId === ex.id);
        const normalizedSched = normalizeExamScheduleFields(ex);
        const normalizedEx: Exam = {
          ...ex,
          examDate: normalizedSched.examDate,
          startTime: normalizedSched.startTime,
          endTime: normalizedSched.endTime,
          startWindow: normalizedSched.startWindow,
          endWindow: normalizedSched.endWindow,
        };
        const resolved = this.resolveExamAndQuestions(normalizedEx, questions, subjects, classes);
        const schedule = getExamScheduleStatus(normalizedEx);
        return {
          ...normalizedEx,
          subjectId: resolved.effectiveSubjectId,
          subjectName: resolved.effectiveSubjectName,
          className: resolved.effectiveClassName,
          totalQuestions: resolved.effectiveTotalQuestions,
          isWithinWindow: schedule.isWithinWindow,
          scheduleStatus: schedule.status,
          scheduleLabel: schedule.label,
          scheduleDetails: schedule.details,
          scheduleBadgeClass: schedule.badgeClass,
          studentAttempt: sess
            ? {
                id: sess.id,
                status: sess.status,
                totalScore: sess.totalScore,
                startTime: sess.startTimeServer,
              }
            : { status: 'not_started' },
        };
      });
  }

  public async pingGasEndpoint(url: string): Promise<boolean> {
    const cleanUrl = url.trim();
    if (!cleanUrl) return false;
    try {
      const proxyRes = await fetch('/api/gas-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `${cleanUrl}?action=ping`, method: 'GET' }),
      });
      if (proxyRes.ok) {
        const pData = await proxyRes.json();
        if (pData && pData.status === 'ok') {
          this.saveConfig({ gasWebAppUrl: cleanUrl, useLiveGas: true });
          void this.syncAllLocalDataToGas(cleanUrl);
          return true;
        }
      }
    } catch {}

    try {
      const res = await fetch(`${cleanUrl}?action=ping`, { redirect: 'follow' });
      const data = await res.json();
      if (data.status === 'ok') {
        this.saveConfig({ gasWebAppUrl: cleanUrl, useLiveGas: true });
        void this.syncAllLocalDataToGas(cleanUrl);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  public async setupGasDatabase(url: string): Promise<{ success: boolean; message?: string; error?: string }> {
    const cleanUrl = url.trim();
    try {
      const data = await this.callGasEndpoint<{ success: boolean; message?: string; error?: string }>(
        'setup',
        { adminUsername: 'admin_sirajulhuda', adminPassword: 'Admin123!' },
        null,
        cleanUrl
      );
      if (data && data.success) {
        this.saveConfig({ gasWebAppUrl: cleanUrl, useLiveGas: true });
        await this.syncAllLocalDataToGas(cleanUrl);
        return data;
      }
      return data || { success: false, error: 'Gagal menghubungi Web App Google Apps Script' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Gagal menghubungi Web App Google Apps Script' };
    }
  }
}

export const apiService = new ApiService();
