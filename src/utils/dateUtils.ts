/**
 * Date and schedule helpers for MA Sirajul Huda Marindi CBT
 */

const INDO_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const INDO_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

/**
 * Returns YYYY-MM-DD in the browser's local timezone (avoids UTC date shift from toISOString).
 */
export function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Normalizes a time string to 24-hour HH:mm format.
 * Also handles "08:00 PM" / "8:00 AM" if ever passed.
 */
export function normalizeTimeHHMM(rawTime: unknown, fallback: string = '07:30'): string {
  if (!rawTime) return fallback;
  const str = String(rawTime).trim();
  if (!str) return fallback;

  const ampmMatch = str.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hour = Number(ampmMatch[1]);
    const minute = Number(ampmMatch[2]);
    const period = ampmMatch[3].toUpperCase();
    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const hhmmMatch = str.match(/^(\d{1,2})[:.](\d{2})/);
  if (hhmmMatch) {
    const hour = Math.min(23, Math.max(0, Number(hhmmMatch[1])));
    const minute = Math.min(59, Math.max(0, Number(hhmmMatch[2])));
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  return fallback;
}

/**
 * Builds an ISO-8601 datetime string with the explicit local timezone offset
 * (e.g. "2026-10-31T20:00:59+08:00") so Google Sheets, GAS, and Browsers
 * all parse the exact same local instant without UTC shift.
 */
export function buildIsoWindowWithOffset(
  examDate: string,
  timeStr: string,
  seconds: string = '00'
): string {
  const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test((examDate || '').trim())
    ? examDate.trim()
    : getLocalDateString();
  const cleanTime = normalizeTimeHHMM(timeStr, seconds === '59' ? '23:59' : '07:30');
  const [hh, mm] = cleanTime.split(':').map(Number);
  const [y, m, d] = cleanDate.split('-').map(Number);
  const localDate = new Date(y, m - 1, d, hh || 0, mm || 0, Number(seconds) || 0);
  const tzOffsetMin = -localDate.getTimezoneOffset();
  const sign = tzOffsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(tzOffsetMin);
  const offH = String(Math.floor(absMin / 60)).padStart(2, '0');
  const offM = String(absMin % 60).padStart(2, '0');
  return `${cleanDate}T${cleanTime}:${seconds}${sign}${offH}:${offM}`;
}

/**
 * Parses a startWindow or endWindow value (including UTC ISO strings ending in 'Z'
 * returned by Google Sheets Date serialization, e.g. "2026-10-31T12:00:59.000Z")
 * into local { examDate: "YYYY-MM-DD", time: "HH:mm", dateObj: Date }.
 */
export function parseWindowToLocalParts(
  windowInput: unknown
): { examDate: string; time: string; dateObj: Date } | null {
  if (!windowInput) return null;
  const raw = String(windowInput).trim();
  if (!raw) return null;

  // 1. Local ISO string without 'Z' or timezone offset (e.g. "2026-10-31T20:00:59" or "2026-10-31 20:00")
  const plainLocalMatch = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );
  if (plainLocalMatch) {
    const [, y, m, d, hh, mm, ss] = plainLocalMatch;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    const hour = Number(hh);
    const minute = Number(mm);
    const second = Number(ss || '0');
    const dateObj = new Date(year, month - 1, day, hour, minute, second);
    if (!isNaN(dateObj.getTime())) {
      return {
        examDate: `${y}-${m}-${d}`,
        time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        dateObj,
      };
    }
  }

  // 2. ISO string with 'Z' or explicit timezone offset (e.g. "2026-10-31T12:00:59.000Z" from GAS)
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    const examDate = getLocalDateString(parsed);
    const time = `${String(parsed.getHours()).padStart(2, '0')}:${String(
      parsed.getMinutes()
    ).padStart(2, '0')}`;
    return { examDate, time, dateObj: parsed };
  }

  return null;
}

/**
 * Normalizes exam schedule fields (examDate, startTime, endTime, startWindow, endWindow)
 * and automatically heals any time/date that was previously corrupted by slicing
 * a UTC '.000Z' string with .substring(11, 16) (which shifted 20:00 WITA -> 12:00 UTC).
 */
export function normalizeExamScheduleFields(
  rawExam: {
    examDate?: string;
    startTime?: string;
    endTime?: string;
    startWindow?: string;
    endWindow?: string;
  },
  fallbackExam?: {
    examDate?: string;
    startTime?: string;
    endTime?: string;
    startWindow?: string;
    endWindow?: string;
  }
): {
  examDate: string;
  startTime: string;
  endTime: string;
  startWindow: string;
  endWindow: string;
} {
  const startWinRaw = String(rawExam.startWindow || fallbackExam?.startWindow || '').trim();
  const endWinRaw = String(rawExam.endWindow || fallbackExam?.endWindow || '').trim();

  const parsedStart = parseWindowToLocalParts(startWinRaw);
  const parsedEnd = parseWindowToLocalParts(endWinRaw);

  const isUtcSliceCorrupted = (
    candidateTime: string | undefined,
    winRaw: string,
    parsedLocalTime: string | undefined
  ): boolean => {
    if (!candidateTime) return true;
    if (!winRaw || !parsedLocalTime) return false;
    // If winRaw is a UTC ISO string (ends with Z) and candidateTime equals the raw UTC substring
    // while the actual local time is different (e.g. "12:00" vs "20:00"), it was corrupted by .substring(11, 16)
    if (/Z$/i.test(winRaw) && winRaw.includes('T')) {
      const utcSlice = winRaw.substring(11, 16);
      if (candidateTime === utcSlice && parsedLocalTime !== utcSlice) {
        return true;
      }
    }
    return false;
  };

  const isUtcDateSliceCorrupted = (
    candidateDate: string | undefined,
    winRaw: string,
    parsedLocalDate: string | undefined
  ): boolean => {
    if (!candidateDate || !/^\d{4}-\d{2}-\d{2}$/.test(candidateDate)) return true;
    if (!winRaw || !parsedLocalDate) return false;
    if (/Z$/i.test(winRaw) && winRaw.length >= 10) {
      const utcDateSlice = winRaw.substring(0, 10);
      if (candidateDate === utcDateSlice && parsedLocalDate !== utcDateSlice) {
        return true;
      }
    }
    return false;
  };

  // Determine examDate
  let examDate = '';
  if (rawExam.examDate && !isUtcDateSliceCorrupted(rawExam.examDate, startWinRaw, parsedStart?.examDate)) {
    examDate = rawExam.examDate;
  } else if (parsedStart?.examDate) {
    examDate = parsedStart.examDate;
  } else if (parsedEnd?.examDate) {
    examDate = parsedEnd.examDate;
  } else if (fallbackExam?.examDate && !isUtcDateSliceCorrupted(fallbackExam.examDate, startWinRaw, parsedStart?.examDate)) {
    examDate = fallbackExam.examDate;
  } else {
    examDate = getLocalDateString();
  }

  // Determine startTime
  let startTime = '';
  if (rawExam.startTime && !isUtcSliceCorrupted(rawExam.startTime, startWinRaw, parsedStart?.time)) {
    startTime = normalizeTimeHHMM(rawExam.startTime, '07:30');
  } else if (parsedStart?.time) {
    startTime = parsedStart.time;
  } else if (fallbackExam?.startTime && !isUtcSliceCorrupted(fallbackExam.startTime, startWinRaw, parsedStart?.time)) {
    startTime = normalizeTimeHHMM(fallbackExam.startTime, '07:30');
  } else {
    startTime = '07:30';
  }

  // Determine endTime
  let endTime = '';
  if (rawExam.endTime && !isUtcSliceCorrupted(rawExam.endTime, endWinRaw, parsedEnd?.time)) {
    endTime = normalizeTimeHHMM(rawExam.endTime, '23:59');
  } else if (parsedEnd?.time) {
    endTime = parsedEnd.time;
  } else if (fallbackExam?.endTime && !isUtcSliceCorrupted(fallbackExam.endTime, endWinRaw, parsedEnd?.time)) {
    endTime = normalizeTimeHHMM(fallbackExam.endTime, '23:59');
  } else {
    endTime = '23:59';
  }

  const startWindow = buildIsoWindowWithOffset(examDate, startTime, '00');
  const endWindow = buildIsoWindowWithOffset(examDate, endTime, '59');

  return {
    examDate,
    startTime,
    endTime,
    startWindow,
    endWindow,
  };
}

export function formatIndoDate(dateInput: string | Date | undefined): string {
  if (!dateInput) return '-';
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    // Always parse YYYY-MM-DD as local midnight (never UTC midnight)
    const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymdMatch) {
      const year = Number(ymdMatch[1]);
      const month = Number(ymdMatch[2]);
      const day = Number(ymdMatch[3]);
      const localD = new Date(year, month - 1, day);
      if (!isNaN(localD.getTime())) {
        return `${INDO_DAYS[localD.getDay()]}, ${day} ${INDO_MONTHS[month - 1]} ${year}`;
      }
    }
    const parsedWin = parseWindowToLocalParts(trimmed);
    if (parsedWin) {
      const d = parsedWin.dateObj;
      return `${INDO_DAYS[d.getDay()]}, ${d.getDate()} ${INDO_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    }
  }

  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) {
    return String(dateInput);
  }
  const dayName = INDO_DAYS[d.getDay()];
  const day = d.getDate();
  const month = INDO_MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return `${dayName}, ${day} ${month} ${year}`;
}

export function formatIndoShortDate(dateInput: string | Date | undefined): string {
  if (!dateInput) return '-';
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    const [year, month, day] = dateInput.trim().split('-').map(Number);
    return `${String(day).padStart(2, '0')} ${INDO_MONTHS[month - 1].substring(0, 3)} ${year}`;
  }
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return String(dateInput);
  const day = String(d.getDate()).padStart(2, '0');
  const month = INDO_MONTHS[d.getMonth()].substring(0, 3);
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

export function formatIndoTime(timeOrIso: string | undefined): string {
  if (!timeOrIso) return '-';
  const trimmed = timeOrIso.trim();
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return `${normalizeTimeHHMM(trimmed)} WIB`;
  }
  const parsed = parseWindowToLocalParts(trimmed);
  if (parsed) {
    return `${parsed.time} WIB`;
  }
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return timeOrIso;
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes} WIB`;
}

export interface ScheduleStatusInfo {
  isWithinWindow: boolean;
  status: 'active' | 'upcoming' | 'expired' | 'draft';
  label: string;
  badgeClass: string;
  details: string;
  startDate: Date | null;
  endDate: Date | null;
  examDate: string;
  startTime: string;
  endTime: string;
}

export function getExamScheduleStatus(exam: {
  status?: string;
  startWindow?: string;
  endWindow?: string;
  examDate?: string;
  startTime?: string;
  endTime?: string;
}): ScheduleStatusInfo {
  const normalized = normalizeExamScheduleFields(exam);

  if (exam.status === 'draft') {
    return {
      isWithinWindow: false,
      status: 'draft',
      label: 'Draf',
      badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
      details: 'Jadwal belum dipublikasikan oleh guru/admin',
      startDate: null,
      endDate: null,
      examDate: normalized.examDate,
      startTime: normalized.startTime,
      endTime: normalized.endTime,
    };
  }

  const [sH, sM] = normalized.startTime.split(':').map(Number);
  const [eH, eM] = normalized.endTime.split(':').map(Number);
  const [year, month, day] = normalized.examDate.split('-').map(Number);

  const start = new Date(
    year,
    month - 1,
    day,
    Number.isFinite(sH) ? sH : 0,
    Number.isFinite(sM) ? sM : 0,
    0
  );
  const end = new Date(
    year,
    month - 1,
    day,
    Number.isFinite(eH) ? eH : 23,
    Number.isFinite(eM) ? eM : 59,
    59
  );

  // If end time is earlier than start time (e.g. overnight schedule), roll end date to next day
  if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end.getTime() < start.getTime()) {
    end.setDate(end.getDate() + 1);
  }

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return {
      isWithinWindow: true,
      status: 'active',
      label: 'Aktif Selalu',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      details: 'Ujian dapat dikerjakan kapan saja',
      startDate: null,
      endDate: null,
      examDate: normalized.examDate,
      startTime: normalized.startTime,
      endTime: normalized.endTime,
    };
  }

  const now = new Date().getTime();
  const startTimeMs = start.getTime();
  const endTimeMs = end.getTime();

  if (now < startTimeMs) {
    const diffMs = startTimeMs - now;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    let countdown = '';
    if (diffDays > 0) {
      countdown = `(Mulai ${diffDays} hari lagi)`;
    } else if (diffHours > 0) {
      countdown = `(Mulai ${diffHours} jam lagi)`;
    } else {
      const diffMins = Math.max(1, Math.floor(diffMs / (1000 * 60)));
      countdown = `(Mulai ${diffMins} menit lagi)`;
    }

    return {
      isWithinWindow: false,
      status: 'upcoming',
      label: 'Akan Datang',
      badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
      details: `Ujian dibuka pada ${formatIndoDate(normalized.examDate)} pukul ${formatIndoTime(normalized.startTime)} ${countdown}`,
      startDate: start,
      endDate: end,
      examDate: normalized.examDate,
      startTime: normalized.startTime,
      endTime: normalized.endTime,
    };
  }

  if (now > endTimeMs) {
    return {
      isWithinWindow: false,
      status: 'expired',
      label: 'Telah Berakhir',
      badgeClass: 'bg-slate-100 text-slate-500 border-slate-200',
      details: `Batas waktu pengerjaan berakhir pada ${formatIndoDate(end)} pukul ${formatIndoTime(normalized.endTime)}`,
      startDate: start,
      endDate: end,
      examDate: normalized.examDate,
      startTime: normalized.startTime,
      endTime: normalized.endTime,
    };
  }

  return {
    isWithinWindow: true,
    status: 'active',
    label: 'Sedang Aktif',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200 font-bold',
    details: `Tersedia saat ini hingga ${formatIndoDate(end)} pukul ${formatIndoTime(normalized.endTime)}`,
    startDate: start,
    endDate: end,
    examDate: normalized.examDate,
    startTime: normalized.startTime,
    endTime: normalized.endTime,
  };
}
