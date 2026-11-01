export type UserRole = 'admin' | 'guru' | 'siswa';

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  classId?: string;
  className?: string;
  status: 'active' | 'inactive';
  passwordHash?: string;
  salt?: string;
  createdAt: string;
}

export interface ClassRoom {
  id: string;
  name: string; // e.g., 'X MIPA', 'XI IPS', 'XII Keagamaan'
  grade: 'X' | 'XI' | 'XII';
  description?: string;
}

export interface Subject {
  id: string;
  code: string;
  name: string; // e.g., 'Fikih', 'Al-Qur\'an Hadis', 'Bahasa Arab', 'Matematika'
  teacherId?: string;
  teacherName?: string;
}

export interface Question {
  id: string;
  subjectId: string;
  classId: string;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  optionE: string;
  correctAnswer?: 'A' | 'B' | 'C' | 'D' | 'E'; // Only available on server/admin/guru, NEVER sent to student
  explanation?: string;
  points: number;
  createdBy: string;
}

// Student sanitized question (without correct answer)
export interface StudentQuestion {
  id: string;
  questionText: string;
  options: {
    key: 'A' | 'B' | 'C' | 'D' | 'E';
    originalKey: 'A' | 'B' | 'C' | 'D' | 'E';
    text: string;
  }[];
  points: number;
}

export interface Exam {
  id: string;
  title: string;
  subjectId: string;
  subjectName: string;
  classId: string;
  className: string;
  examDate?: string;   // 'YYYY-MM-DD'
  startTime?: string;  // 'HH:mm'
  endTime?: string;    // 'HH:mm'
  startWindow: string; // ISO date string
  endWindow: string;   // ISO date string
  durationMinutes: number;
  totalQuestions: number;
  passingScore: number;
  token: string;
  status: 'draft' | 'published' | 'finished';
  randomizeQuestions: boolean;
  randomizeOptions: boolean;
  maxViolations: number;
  allowReview: boolean;
}

export type ExamAttemptStatus = 'not_started' | 'in_progress' | 'submitted' | 'timed_out' | 'reset';

export interface StudentExamSession {
  id: string;
  examId: string;
  userId: string;
  studentName: string;
  className: string;
  startTimeServer: string;
  endTimeServer?: string;
  status: ExamAttemptStatus;
  totalScore?: number;
  correctCount?: number;
  incorrectCount?: number;
  unansweredCount?: number;
  violationCount: number;
  clientIpOrAgent?: string;
  questionOrder: string[]; // List of question IDs
  optionOrderMap: Record<string, Record<string, string>>; // questionId -> { shuffledKey: originalKey }
  answers: Record<string, string>; // questionId -> selected original option key
  doubtful: Record<string, boolean>; // questionId -> is marked doubtful
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action:
    | 'LOGIN'
    | 'START_EXAM'
    | 'ANSWER_SAVE'
    | 'TAB_SWITCH_ALERT'
    | 'COPY_ATTEMPT'
    | 'SUBMIT_MANUAL'
    | 'SUBMIT_AUTO_TIMEOUT'
    | 'SUBMIT_VIOLATION'
    | 'RESET_EXAM'
    | 'CREATE_QUESTION'
    | 'UPDATE_EXAM'
    | 'SAVE_SUBJECT'
    | 'DELETE_SUBJECT'
    | (string & {});
  details: string;
  severity: 'info' | 'warning' | 'danger';
}

export interface AppConfig {
  schoolName: string;
  schoolSubName: string;
  semester: string;
  academicYear: string;
  gasWebAppUrl: string;
  useLiveGas: boolean;
  autoSaveIntervalSeconds: number;
  maxViolationsAllowed: number;
}
