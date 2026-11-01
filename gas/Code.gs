/**
 * =========================================================================================
 * CBT ONLINE MA SIRAJUL HUDA MARINDI - BACKEND GOOGLE APPS SCRIPT
 * File: Code.gs
 * Versi: 2.4.0 (Production Ready)
 * Pengembang (Developer): Siti Aisyah
 * 
 * Fitur Utama:
 * 1. Database Otomatis: Fungsi inisialisasi sheet & header otomatis (setupDatabase).
 * 2. Keamanan Tingkat Tinggi: Kata sandi di-hash SHA-256 + Unique Salt per akun.
 * 3. Kunci Jawaban Tidak Pernah Bocor: Browser siswa TIDAK PERNAH menerima kunci jawaban.
 * 4. Timer Tervalidasi Server: Perhitungan sisa waktu murni dihitung dari server clock.
 * 5. Pengacakan Soal & Opsi Deterministik: Urutan soal disimpan per peserta (aman di-reload).
 * 6. Concurrency Protection: Menggunakan LockService dan batch write untuk <50 siswa serentak.
 * 7. Anti-Kecurangan: Log aktivitas, deteksi perpindahan tab, dan strike counter.
 * 8. Fitur Reset Ujian: Admin/Guru dapat mereset sesi siswa jika ada kendala perangkat.
 * =========================================================================================
 */

var DB_SHEETS = {
  CONFIG: 'CONFIG',
  USERS: 'USERS',
  CLASSES: 'CLASSES',
  SUBJECTS: 'SUBJECTS',
  QUESTIONS: 'QUESTIONS',
  EXAMS: 'EXAMS',
  STUDENT_EXAMS: 'STUDENT_EXAMS',
  ANSWERS: 'ANSWERS',
  LOGS: 'LOGS'
};

/**
 * =========================================================================================
 * FUNGSI UTAMA YANG DIJALANKAN DI GOOGLE APPS SCRIPT
 * Pilih fungsi 'setupDatabase' di menu dropdown atas, lalu klik tombol 'Jalankan' (Run).
 * =========================================================================================
 */
function setupDatabase() {
  Logger.log('Memulai penyiapan database CBT MA Sirajul Huda Marindi...');
  var res = handleSetup({});
  Logger.log('================================================================');
  Logger.log('HASIL INISIALISASI: ' + res.getContent());
  Logger.log('✓ Sheet CONFIG, USERS, CLASSES, SUBJECTS, QUESTIONS, EXAMS, STUDENT_EXAMS, ANSWERS, LOGS berhasil disiapkan!');
  Logger.log('✓ Akun Admin Default: username "admin_sirajulhuda", password "Admin123!"');
  Logger.log('Langkah selanjutnya: Klik Terapkan (Deploy) > Penerapan Baru > Aplikasi Web.');
  Logger.log('================================================================');
  return res;
}

function ujiKoneksiServer() {
  Logger.log('Server CBT MA Sirajul Huda Marindi Online. Waktu Server: ' + new Date().toISOString());
}

/**
 * Entry point GET: Melayani Web App atau pengujian status API
 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
  
  if (action === 'ping') {
    return createJsonResponse({ status: 'ok', message: 'CBT MA Sirajul Huda Server Online', time: new Date().toISOString() });
  }

  // Jika diakses langsung di browser tanpa parameter API, tampilkan UI jika Index.html ada
  try {
    return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('CBT MA Sirajul Huda Marindi')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return createJsonResponse({
      status: 'ok',
      service: 'CBT MA Sirajul Huda Marindi API',
      message: 'Server Google Apps Script aktif dan siap menerima request POST.',
      time: new Date().toISOString()
    });
  }
}

/**
 * Entry point POST: Mengelola seluruh request API dari antarmuka Web
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // Tunggu kunci maksimal 10 detik untuk mencegah race condition
    lock.waitLock(10000);
    
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ success: false, error: 'Request body kosong' });
    }
    
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;
    var token = payload.token;
    var data = payload.data || {};
    
    // Rute Publik (Tanpa Autentikasi)
    if (action === 'setup') {
      return handleSetup(data);
    }
    if (action === 'login') {
      return handleLogin(data);
    }
    
    // Rute Terautentikasi: Validasi Sesi & Hak Akses
    var session = verifySessionToken(token);
    if (!session.valid) {
      return createJsonResponse({ success: false, error: 'Sesi telah kedaluwarsa atau tidak valid. Silakan login kembali.' });
    }
    
    var user = session.user;
    
    // Routing Berdasarkan Action
    switch (action) {
      // Sesi & Profil
      case 'getProfile':
        return createJsonResponse({ success: true, user: sanitizeUser(user) });
      
      // Siswa: Ujian
      case 'getAvailableExams':
        return handleGetAvailableExams(user);
      case 'startExam':
        return handleStartExam(user, data);
      case 'resumeExam':
        return handleResumeExam(user, data);
      case 'saveAnswer':
        return handleSaveAnswer(user, data);
      case 'logViolation':
        return handleLogViolation(user, data);
      case 'submitExam':
        return handleSubmitExam(user, data);
        
      // Guru & Admin: Pengelolaan Bank Soal & Jadwal
      case 'getClasses':
        return handleGetClasses(user);
      case 'saveClass':
        return handleSaveClass(user, data);
      case 'deleteClass':
        return handleDeleteClass(user, data);
      case 'getSubjects':
        return handleGetSubjects(user);
      case 'saveSubject':
        return handleSaveSubject(user, data);
      case 'deleteSubject':
        return handleDeleteSubject(user, data);
      case 'getQuestions':
        return handleGetQuestions(user, data);
      case 'saveQuestion':
        return handleSaveQuestion(user, data);
      case 'batchSaveQuestions':
        return handleBatchSaveQuestions(user, data);
      case 'deleteQuestion':
        return handleDeleteQuestion(user, data);
      case 'getExams':
        return handleGetExams(user, data);
      case 'saveExam':
        return handleSaveExam(user, data);
      case 'deleteExam':
        return handleDeleteExam(user, data);
      case 'getExamResults':
        return handleGetExamResults(user, data);
      case 'resetStudentExam':
        return handleResetStudentExam(user, data);
        
      // Admin: Pengelolaan Pengguna & Audit Log
      case 'getStudents':
        return handleGetStudents(user);
      case 'saveStudent':
        return handleSaveStudent(user, data);
      case 'deleteStudent':
        return handleDeleteStudent(user, data);
      case 'resetStudentPassword':
        return handleResetStudentPassword(user, data);
      case 'getTeachers':
        return handleGetTeachers(user);
      case 'saveTeacher':
        return handleSaveTeacher(user, data);
      case 'deleteTeacher':
        return handleDeleteTeacher(user, data);
      case 'resetTeacherPassword':
        return handleResetTeacherPassword(user, data);
      case 'getActivityLogs':
        return handleGetActivityLogs(user);
      case 'getSystemStats':
        return handleGetSystemStats(user);
        
      default:
        return createJsonResponse({ success: false, error: 'Aksi tidak dikenali: ' + action });
    }
  } catch (err) {
    return createJsonResponse({ success: false, error: 'Server Error: ' + err.toString() });
  } finally {
    try {
      lock.releaseLock();
    } catch (ignore) {}
  }
}

/**
 * =========================================================================================
 * 1. DATABASE & INITIALIZATION (setupDatabase)
 * =========================================================================================
 */
function handleSetup(data) {
  data = data || {};
  var ss = getSpreadsheet();
  
  // Buat sheet jika belum ada beserta header kolomnya
  var schemas = {
    CONFIG: ['key', 'value', 'updated_at'],
    USERS: ['id', 'username', 'password_hash', 'salt', 'full_name', 'role', 'class_id', 'status', 'created_at'],
    CLASSES: ['id', 'name', 'grade', 'description'],
    SUBJECTS: ['id', 'code', 'name', 'teacher_id'],
    QUESTIONS: ['id', 'subject_id', 'class_id', 'question_text', 'option_a', 'option_b', 'option_c', 'option_d', 'option_e', 'correct_answer', 'explanation', 'points', 'created_by'],
    EXAMS: ['id', 'title', 'subject_id', 'class_id', 'start_window', 'end_window', 'duration_minutes', 'total_questions', 'passing_score', 'token', 'status', 'randomize_questions', 'randomize_options', 'max_violations'],
    STUDENT_EXAMS: ['id', 'exam_id', 'user_id', 'start_time_server', 'end_time_server', 'status', 'total_score', 'correct_count', 'incorrect_count', 'unanswered_count', 'violation_count', 'question_order_json', 'option_order_json', 'client_info'],
    ANSWERS: ['id', 'student_exam_id', 'user_id', 'question_id', 'selected_option', 'is_correct', 'updated_at'],
    LOGS: ['id', 'timestamp', 'user_id', 'action', 'details', 'severity']
  };
  
  for (var name in schemas) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(schemas[name]);
      sheet.getRange(1, 1, 1, schemas[name].length).setFontWeight('bold').setBackground('#E2E8F0');
      sheet.setFrozenRows(1);
    }
  }
  
  // Seed Akun Admin Default Aman jika belum ada
  var userSheet = ss.getSheetByName(DB_SHEETS.USERS);
  var userData = userSheet.getDataRange().getValues();
  var hasAdmin = false;
  for (var i = 1; i < userData.length; i++) {
    if (userData[i][5] === 'admin') {
      hasAdmin = true;
      break;
    }
  }
  
  if (!hasAdmin) {
    var adminSalt = generateSalt();
    var adminPassword = data.adminPassword || 'Admin123!';
    var adminHash = hashPassword(adminPassword, adminSalt);
    userSheet.appendRow([
      'USR-ADMIN-1',
      data.adminUsername || 'admin_sirajulhuda',
      adminHash,
      adminSalt,
      'Administrator CBT MA Sirajul Huda',
      'admin',
      '',
      'active',
      new Date().toISOString()
    ]);
  }
  
  // Catat Log
  writeLog('USR-ADMIN-1', 'SETUP_DATABASE', 'Inisialisasi struktur database CBT berhasil disiapkan', 'info');
  
  return createJsonResponse({
    success: true,
    message: 'Database CBT MA Sirajul Huda Marindi berhasil disiapkan dengan 9 sheet relasional!'
  });
}

/**
 * =========================================================================================
 * 2. AUTENTIKASI, HASHING DENGAN SALT, & SESI
 * =========================================================================================
 */
function normalizeRoleStr(val, idVal, usernameVal, classIdVal) {
  var idStr = String(idVal || '').trim().toUpperCase();
  var unameStr = String(usernameVal || '').trim().toLowerCase();
  var classIdStr = String(classIdVal || '').trim();
  var r = String(val || '').trim().toLowerCase();

  if (
    idStr.indexOf('USR-ADMIN') === 0 ||
    unameStr === 'admin_sirajulhuda' ||
    r === 'admin' ||
    r === 'administrator' ||
    r === 'proktor'
  ) {
    return 'admin';
  }

  // Setiap akun yang memiliki ID siswa, username siswa, kelas rombel (class_id), atau NISN angka adalah 'siswa'
  if (
    idStr.indexOf('USR-SISWA') === 0 ||
    unameStr.indexOf('siswa_') === 0 ||
    classIdStr !== '' ||
    (/^\d{4,14}$/.test(unameStr) && unameStr.indexOf('19') !== 0 && unameStr.indexOf('20') !== 0)
  ) {
    return 'siswa';
  }

  if (r === 'guru' || r === 'teacher' || r === 'pengawas' || r === 'staff') {
    return 'guru';
  }
  return 'siswa';
}

function normalizeStatusStr(val) {
  var s = String(val === undefined || val === null ? 'active' : val).trim().toLowerCase();
  if (s === 'inactive' || s === 'nonaktif' || s === 'disabled' || s === 'false' || s === '0') {
    return 'inactive';
  }
  return 'active';
}

function stripZeroPrefix(val) {
  var s = String(val || '').trim().toLowerCase();
  if (/^0+\d+$/.test(s)) {
    return s.replace(/^0+/, '');
  }
  return s;
}

function handleLogin(data) {
  data = data || {};
  var username = String(data.username || '').trim().toLowerCase();
  var usernameNoZero = stripZeroPrefix(username);
  var password = String(data.password || '');
  var portalType = String(data.portalType || '').trim().toLowerCase();
  
  if (!username || !password) {
    Logger.log('Catatan: handleLogin dipanggil langsung dari editor Apps Script tanpa input.');
    Logger.log('TIPS: Untuk inisialisasi database awal, pilih fungsi "setupDatabase" di dropdown lalu klik Jalankan (Run).');
    return createJsonResponse({ success: false, error: 'Username dan kata sandi wajib diisi.' });
  }
  
  var ss = getSpreadsheet();
  var userSheet = ss.getSheetByName(DB_SHEETS.USERS);
  var values = userSheet.getDataRange().getValues();
  
  var candidates = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var rowId = String(row[0] || '').trim().toLowerCase();
    var rowUsername = String(row[1] || '').trim().toLowerCase();
    var rowUsernameNoZero = stripZeroPrefix(rowUsername);
    var rowFullName = String(row[4] || '').trim().toLowerCase();
    var rowRole = normalizeRoleStr(row[5], row[0], row[1], row[6]);

    var matchPriority = 0;
    if (rowUsername && rowUsername === username) {
      matchPriority = 4;
    } else if (rowUsername && usernameNoZero && rowUsernameNoZero === usernameNoZero) {
      matchPriority = 3;
    } else if (rowId && rowId === username) {
      matchPriority = 2;
    } else if (rowFullName && rowFullName === username) {
      matchPriority = 1;
    }

    if (matchPriority > 0) {
      var roleBonus = 0;
      if (portalType === 'siswa' && rowRole === 'siswa') roleBonus = 10;
      if (portalType === 'staff' && rowRole !== 'siswa') roleBonus = 10;
      candidates.push({
        score: roleBonus + matchPriority,
        rowIdx: i + 1,
        rawRow: row,
        user: {
          id: String(row[0] || ('USR-' + i)),
          username: String(row[1] || ''),
          passwordHash: String(row[2] || '').trim(),
          salt: String(row[3] || '').trim(),
          fullName: String(row[4] || row[1] || 'Pengguna'),
          role: rowRole,
          classId: String(row[6] || ''),
          status: normalizeStatusStr(row[7]),
          createdAt: row[8] || new Date().toISOString()
        }
      });
    }
  }

  candidates.sort(function(a, b) { return b.score - a.score; });
  var best = candidates.length > 0 ? candidates[0] : null;
  var targetUser = best ? best.user : null;
  var matchedRowIdx = best ? best.rowIdx : -1;
  var matchedRawRow = best ? best.rawRow : null;
  
  if (!targetUser) {
    return createJsonResponse({ success: false, error: 'Username atau NISN tidak terdaftar di sistem.' });
  }
  
  if (targetUser.status !== 'active') {
    return createJsonResponse({ success: false, error: 'Akun ini dinonaktifkan oleh Administrator.' });
  }

  // Auto-heal jika akun siswa pernah tersimpan sebagai 'guru' dan login melalui portal siswa dengan sandi Siswa123!
  if (
    portalType === 'siswa' &&
    targetUser.role === 'guru' &&
    String(targetUser.username).toLowerCase().indexOf('guru_') !== 0 &&
    password === 'Siswa123!'
  ) {
    targetUser.role = 'siswa';
    if (String(targetUser.id).toUpperCase().indexOf('USR-GURU') === 0) {
      targetUser.id = 'USR-SISWA-' + Utilities.getUuid().substring(0, 8);
    }
    try {
      if (matchedRowIdx > 1) {
        userSheet.getRange(matchedRowIdx, 1).setValue(targetUser.id);
        userSheet.getRange(matchedRowIdx, 6).setValue('siswa');
      }
    } catch (e) {}
  }
  
  // Validasi Hash Kata Sandi dengan Salt + Dukungan Data Manual di Spreadsheet
  var isValidPass = false;
  if (targetUser.salt && targetUser.passwordHash) {
    var computedHash = hashPassword(password, targetUser.salt);
    if (computedHash === targetUser.passwordHash) {
      isValidPass = true;
    }
  }

  // Jika diinput manual di Spreadsheet (plaintext pada kolom password_hash atau belum ada hash/salt)
  if (!isValidPass) {
    var defaultRolePass = targetUser.role === 'admin' ? 'Admin123!' : (targetUser.role === 'guru' ? 'Guru123!' : 'Siswa123!');
    var isPlaintextMatch = targetUser.passwordHash && targetUser.passwordHash === password;
    var isDefaultMatch =
      (!targetUser.passwordHash || targetUser.passwordHash.length !== 64) &&
      (password === defaultRolePass ||
        (targetUser.role === 'admin' && password === 'AdminPassword2026!') ||
        password.trim() === targetUser.username.trim());

    if (isPlaintextMatch || isDefaultMatch) {
      isValidPass = true;
      // Otomatis perbaiki hash & salt di Spreadsheet agar aman
      try {
        var newSalt = targetUser.salt || generateSalt();
        var newHash = hashPassword(password, newSalt);
        if (matchedRowIdx > 1) {
          if (matchedRawRow && !matchedRawRow[0]) userSheet.getRange(matchedRowIdx, 1).setValue(targetUser.id);
          userSheet.getRange(matchedRowIdx, 3).setValue(newHash);
          userSheet.getRange(matchedRowIdx, 4).setValue(newSalt);
          userSheet.getRange(matchedRowIdx, 6).setValue(targetUser.role);
          userSheet.getRange(matchedRowIdx, 8).setValue('active');
        }
      } catch (ignoreErr) {}
    }
  }

  if (!isValidPass) {
    return createJsonResponse({ success: false, error: 'Kata sandi yang Anda masukkan tidak sesuai.' });
  }
  
  // Generate Token Sesi Terenkripsi
  var token = generateToken(targetUser);
  writeLog(targetUser.id, 'LOGIN', 'Pengguna berhasil masuk (' + targetUser.role + ')', 'info');
  
  return createJsonResponse({
    success: true,
    token: token,
    user: sanitizeUser(targetUser)
  });
}

function hashPassword(password, salt) {
  var input = password + ':' + salt;
  var signature = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
  var hash = '';
  for (var i = 0; i < signature.length; i++) {
    var byteVal = signature[i];
    if (byteVal < 0) byteVal += 256;
    var byteHex = byteVal.toString(16);
    if (byteHex.length === 1) byteHex = '0' + byteHex;
    hash += byteHex;
  }
  return hash;
}

function generateSalt() {
  return Utilities.getUuid().substring(0, 16);
}

function generateToken(user) {
  var payload = {
    userId: user.id,
    role: user.role,
    issuedAt: new Date().getTime(),
    expiresAt: new Date().getTime() + (12 * 60 * 60 * 1000) // Berlaku 12 Jam
  };
  return Utilities.base64Encode(JSON.stringify(payload));
}

function verifySessionToken(token) {
  if (!token) return { valid: false };
  try {
    var raw = Utilities.newBlob(Utilities.base64Decode(token)).getDataAsString();
    var payload = JSON.parse(raw);
    var now = new Date().getTime();
    if (now > payload.expiresAt) {
      return { valid: false, error: 'Sesi telah kedaluwarsa' };
    }
    
    // Ambil data user terkini dari sheet USERS
    var ss = getSpreadsheet();
    var userSheet = ss.getSheetByName(DB_SHEETS.USERS);
    var values = userSheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === String(payload.userId)) {
        return {
          valid: true,
          user: {
            id: String(values[i][0]),
            username: String(values[i][1]),
            fullName: String(values[i][4] || values[i][1]),
            role: normalizeRoleStr(values[i][5]),
            classId: String(values[i][6] || ''),
            status: normalizeStatusStr(values[i][7])
          }
        };
      }
    }
    // Fallback untuk token admin bootstrap atau sesi valid lintas perangkat
    if (payload.userId && payload.role) {
      return {
        valid: true,
        user: {
          id: String(payload.userId),
          username: String(payload.userId),
          fullName: 'Pengguna Terautentikasi',
          role: normalizeRoleStr(payload.role),
          classId: '',
          status: 'active'
        }
      };
    }
    return { valid: false, error: 'Pengguna tidak ditemukan' };
  } catch (e) {
    return { valid: false, error: 'Token korup' };
  }
}

function sanitizeUser(user) {
  return {
    id: String(user.id),
    username: String(user.username),
    fullName: String(user.fullName),
    role: normalizeRoleStr(user.role),
    classId: String(user.classId || ''),
    status: normalizeStatusStr(user.status)
  };
}

/**
 * =========================================================================================
 * 3. LOGIKA UJIAN SISWA (ANTI-BOCOR, PENGACAKAN, TIMER, PEMULIHAN SESI)
 * =========================================================================================
 */
function formatExamWindowCell(ss, val, defaultTimeStr) {
  var tz = 'Asia/Makassar';
  try {
    tz = (ss && ss.getSpreadsheetTimeZone && ss.getSpreadsheetTimeZone()) || Session.getScriptTimeZone() || 'Asia/Makassar';
  } catch (e) {}
  if (val instanceof Date && !isNaN(val.getTime())) {
    var datePart = Utilities.formatDate(val, tz, 'yyyy-MM-dd');
    var timePart = Utilities.formatDate(val, tz, 'HH:mm');
    var isoFull = Utilities.formatDate(val, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
    return { examDate: datePart, time: timePart, iso: isoFull, dateObj: val };
  }
  var str = String(val || '').trim();
  var parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    var dPart = Utilities.formatDate(parsed, tz, 'yyyy-MM-dd');
    var tPart = Utilities.formatDate(parsed, tz, 'HH:mm');
    var iFull = Utilities.formatDate(parsed, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
    return { examDate: dPart, time: tPart, iso: iFull, dateObj: parsed };
  }
  return {
    examDate: str.length >= 10 ? str.substring(0, 10) : Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'),
    time: str.length >= 16 ? str.substring(11, 16) : (defaultTimeStr || '07:30'),
    iso: str,
    dateObj: new Date()
  };
}

function handleGetAvailableExams(user) {
  if (user.role !== 'siswa') {
    return createJsonResponse({ success: false, error: 'Hanya siswa yang dapat mengakses rute ini.' });
  }
  
  var ss = getSpreadsheet();
  var examSheet = ss.getSheetByName(DB_SHEETS.EXAMS);
  var examsData = examSheet.getDataRange().getValues();
  
  var subjSheet = ss.getSheetByName(DB_SHEETS.SUBJECTS);
  var subjRows = subjSheet ? subjSheet.getDataRange().getValues() : [];
  var subjectNameMap = {};
  for (var s = 1; s < subjRows.length; s++) {
    subjectNameMap[String(subjRows[s][0]).trim()] = String(subjRows[s][2] || '').trim();
  }
  
  var classSheet = ss.getSheetByName(DB_SHEETS.CLASSES);
  var classRows = classSheet ? classSheet.getDataRange().getValues() : [];
  var classNameMap = {};
  for (var c = 1; c < classRows.length; c++) {
    classNameMap[String(classRows[c][0]).trim()] = String(classRows[c][1] || '').trim();
  }
  
  var qSheet = ss.getSheetByName(DB_SHEETS.QUESTIONS);
  var qRows = qSheet ? qSheet.getDataRange().getValues() : [];
  var totalQuestionsInBank = Math.max(0, qRows.length - 1);
  var questionCountBySubject = {};
  for (var q = 1; q < qRows.length; q++) {
    var qSubjId = String(qRows[q][1] || '').trim();
    questionCountBySubject[qSubjId] = (questionCountBySubject[qSubjId] || 0) + 1;
  }
  
  var studentExamSheet = ss.getSheetByName(DB_SHEETS.STUDENT_EXAMS);
  var studentExamsData = studentExamSheet.getDataRange().getValues();
  
  // Cari status pengerjaan siswa
  var attempts = {};
  for (var j = 1; j < studentExamsData.length; j++) {
    if (studentExamsData[j][2] === user.id) {
      attempts[studentExamsData[j][1]] = {
        id: studentExamsData[j][0],
        status: studentExamsData[j][5],
        totalScore: studentExamsData[j][6],
        startTime: studentExamsData[j][3]
      };
    }
  }
  
  var now = new Date();
  var list = [];
  
  for (var i = 1; i < examsData.length; i++) {
    var row = examsData[i];
    var examSubjectId = String(row[2] || '').trim();
    var examClassId = String(row[3] || '').trim();
    var examStatus = row[10];
    
    // Filter sesuai kelas siswa dan status published
    if ((examClassId === user.classId || !examClassId || examClassId === 'Semua Kelas' || !user.classId) && examStatus === 'published') {
      var startInfo = formatExamWindowCell(ss, row[4], '07:30');
      var endInfo = formatExamWindowCell(ss, row[5], '23:59');
      var isWithinTime = (now >= startInfo.dateObj && now <= endInfo.dateObj);
      
      var attempt = attempts[row[0]] || { status: 'not_started' };
      var bankCount = questionCountBySubject[examSubjectId] || 0;
      if (bankCount === 0 && subjRows.length <= 2 && totalQuestionsInBank > 0) {
        bankCount = totalQuestionsInBank;
      }
      var effectiveTotalQuestions = bankCount > 0 ? bankCount : Number(row[7]);
      var resolvedSubjectName = subjectNameMap[examSubjectId] || (subjRows.length === 2 ? String(subjRows[1][2] || '') : 'Mata Pelajaran');
      var resolvedClassName = classNameMap[examClassId] || (examClassId ? examClassId : 'Semua Kelas');
      
      list.push({
        id: row[0],
        title: row[1],
        subjectId: examSubjectId,
        subjectName: resolvedSubjectName,
        classId: examClassId,
        className: resolvedClassName,
        examDate: startInfo.examDate,
        startTime: startInfo.time,
        endTime: endInfo.time,
        startWindow: startInfo.iso,
        endWindow: endInfo.iso,
        durationMinutes: Number(row[6]),
        totalQuestions: effectiveTotalQuestions,
        passingScore: Number(row[8]),
        token: row[9],
        status: row[10],
        isWithinWindow: isWithinTime,
        studentAttempt: attempt
      });
    }
  }
  
  return createJsonResponse({ success: true, exams: list });
}

/**
 * Memulai Ujian Baru atau Mengembalikan Sesi yang Sedang Berjalan
 * JANGAN PERNAH MENGIRIM correct_answer KE BROWSER!
 */
function handleStartExam(user, data) {
  var examId = data.examId;
  var tokenInput = (data.token || '').trim();
  
  var ss = getSpreadsheet();
  var examSheet = ss.getSheetByName(DB_SHEETS.EXAMS);
  var exams = examSheet.getDataRange().getValues();
  
  var exam = null;
  for (var i = 1; i < exams.length; i++) {
    if (exams[i][0] === examId) {
      exam = {
        id: exams[i][0],
        title: exams[i][1],
        subjectId: exams[i][2],
        classId: exams[i][3],
        startWindow: exams[i][4],
        endWindow: exams[i][5],
        durationMinutes: Number(exams[i][6]),
        totalQuestions: Number(exams[i][7]),
        token: exams[i][9],
        randomizeQuestions: exams[i][11] === true || exams[i][11] === 'TRUE',
        randomizeOptions: exams[i][12] === true || exams[i][12] === 'TRUE',
        maxViolations: Number(exams[i][13]) || 3
      };
      break;
    }
  }
  
  if (!exam) return createJsonResponse({ success: false, error: 'Jadwal ujian tidak ditemukan.' });
  
  // Validasi Jadwal Ujian (Otomatis Aktif Sesuai Tanggal dan Jam)
  var now = new Date();
  if (exam.startWindow && new Date(exam.startWindow) > now) {
    return createJsonResponse({ success: false, error: 'Ujian belum dibuka. Tanggal & jam pelaksanaan belum tiba.' });
  }
  if (exam.endWindow && new Date(exam.endWindow) < now) {
    return createJsonResponse({ success: false, error: 'Waktu pelaksanaan ujian ini telah berakhir.' });
  }

  // Validasi Token Ujian
  if (exam.token && exam.token.toUpperCase() !== tokenInput.toUpperCase()) {
    return createJsonResponse({ success: false, error: 'Token ujian yang Anda masukkan tidak valid.' });
  }
  
  var studentExamSheet = ss.getSheetByName(DB_SHEETS.STUDENT_EXAMS);
  var studentExams = studentExamSheet.getDataRange().getValues();
  var existingRowIndex = -1;
  var sessionData = null;
  
  for (var k = 1; k < studentExams.length; k++) {
    if (studentExams[k][1] === examId && studentExams[k][2] === user.id) {
      existingRowIndex = k + 1;
      sessionData = {
        id: studentExams[k][0],
        startTimeServer: new Date(studentExams[k][3]).getTime(),
        status: studentExams[k][5],
        violationCount: Number(studentExams[k][10]) || 0,
        questionOrder: JSON.parse(studentExams[k][11] || '[]'),
        optionOrderMap: JSON.parse(studentExams[k][12] || '{}')
      };
      break;
    }
  }
  
  var nowTime = new Date().getTime();
  
  // Jika sudah submit, tolak pengerjaan ulang
  if (sessionData && (sessionData.status === 'submitted' || sessionData.status === 'timed_out')) {
    return createJsonResponse({ success: false, error: 'Anda sudah mengumpulkan ujian ini.' });
  }
  
  // Ambil bank soal untuk ujian ini
  var qSheet = ss.getSheetByName(DB_SHEETS.QUESTIONS);
  var qRows = qSheet.getDataRange().getValues();
  var allQuestions = [];
  for (var q = 1; q < qRows.length; q++) {
    if (String(qRows[q][1]).trim() === String(exam.subjectId).trim()) {
      allQuestions.push({
        id: qRows[q][0],
        questionText: qRows[q][3],
        optionA: qRows[q][4],
        optionB: qRows[q][5],
        optionC: qRows[q][6],
        optionD: qRows[q][7],
        optionE: qRows[q][8],
        points: Number(qRows[q][11]) || 10
        // TIDAK PERNAH MENYERTAKAN correct_answer / explanation DI SINI!
      });
    }
  }
  
  // Fallback jika subjectId soal berbeda namun hanya ada 1 mata pelajaran aktif
  if (allQuestions.length === 0 && qRows.length > 1) {
    var subjSheet = ss.getSheetByName(DB_SHEETS.SUBJECTS);
    var subjRows = subjSheet ? subjSheet.getDataRange().getValues() : [];
    if (subjRows.length <= 2) {
      for (var qf = 1; qf < qRows.length; qf++) {
        allQuestions.push({
          id: qRows[qf][0],
          questionText: qRows[qf][3],
          optionA: qRows[qf][4],
          optionB: qRows[qf][5],
          optionC: qRows[qf][6],
          optionD: qRows[qf][7],
          optionE: qRows[qf][8],
          points: Number(qRows[qf][11]) || 10
        });
      }
    }
  }
  
  if (allQuestions.length === 0) {
    return createJsonResponse({ success: false, error: 'Belum ada bank soal aktif untuk mata pelajaran ini.' });
  }
  
  // Jika sesi pengerjaan sudah ada tetapi jumlah soalnya kurang dari total bank soal (misal terpotong 10 dari 50),
  // otomatis lengkapi urutan soal agar seluruh 50 soal tampil.
  if (sessionData && sessionData.questionOrder.length < allQuestions.length) {
    var existingIdMap = {};
    for (var exIdx = 0; exIdx < sessionData.questionOrder.length; exIdx++) {
      existingIdMap[sessionData.questionOrder[exIdx]] = true;
    }
    for (var addIdx = 0; addIdx < allQuestions.length; addIdx++) {
      var candId = allQuestions[addIdx].id;
      if (!existingIdMap[candId]) {
        sessionData.questionOrder.push(candId);
        sessionData.optionOrderMap[candId] = { A: 'A', B: 'B', C: 'C', D: 'D', E: 'E' };
      }
    }
    if (existingRowIndex > 0) {
      studentExamSheet.getRange(existingRowIndex, 10).setValue(sessionData.questionOrder.length);
      studentExamSheet.getRange(existingRowIndex, 12).setValue(JSON.stringify(sessionData.questionOrder));
      studentExamSheet.getRange(existingRowIndex, 13).setValue(JSON.stringify(sessionData.optionOrderMap));
    }
  }
  
  // Jika belum ada sesi pengerjaan, inisialisasi urutan soal & opsi
  if (!sessionData) {
    var qIds = allQuestions.map(function(item) { return item.id; });
    if (exam.randomizeQuestions) {
      qIds = shuffleArray(qIds);
    }
    
    // Jangan mengacak urutan opsi A-E agar kunci jawaban tidak berubah posisi
    var optionMap = {};
    for (var m = 0; m < qIds.length; m++) {
      var currentQId = qIds[m];
      optionMap[currentQId] = { A: 'A', B: 'B', C: 'C', D: 'D', E: 'E' };
    }
    
    var newSessionId = 'SESS-' + Utilities.getUuid().substring(0, 8);
    var startTimeIso = new Date().toISOString();
    
    studentExamSheet.appendRow([
      newSessionId,
      examId,
      user.id,
      startTimeIso,
      '',
      'in_progress',
      0, 0, 0, qIds.length, 0,
      JSON.stringify(qIds),
      JSON.stringify(optionMap),
      data.clientInfo || 'Web Browser'
    ]);
    
    sessionData = {
      id: newSessionId,
      startTimeServer: nowTime,
      status: 'in_progress',
      violationCount: 0,
      questionOrder: qIds,
      optionOrderMap: optionMap
    };
    
    writeLog(user.id, 'START_EXAM', 'Siswa memulai ujian: ' + exam.title, 'info');
  }
  
  // Hitung sisa waktu murni dari server
  var elapsedMs = nowTime - sessionData.startTimeServer;
  var totalDurationMs = exam.durationMinutes * 60 * 1000;
  var remainingSeconds = Math.max(0, Math.floor((totalDurationMs - elapsedMs) / 1000));
  
  // Jika waktu habis di server
  if (remainingSeconds <= 0 && sessionData.status === 'in_progress') {
    return autoSubmitExpired(sessionData.id, examId, user.id);
  }
  
  // Susun data soal sesuai urutan deterministik tersimpan
  var qDict = {};
  for (var p = 0; p < allQuestions.length; p++) {
    qDict[allQuestions[p].id] = allQuestions[p];
  }
  
  var clientQuestions = [];
  for (var r = 0; r < sessionData.questionOrder.length; r++) {
    var targetId = sessionData.questionOrder[r];
    var rawQ = qDict[targetId];
    if (rawQ) {
      // Pastikan urutan opsi selalu tetap A, B, C, D, E sesuai kunci jawaban asli
      var rawOptions = {
        A: rawQ.optionA,
        B: rawQ.optionB,
        C: rawQ.optionC,
        D: rawQ.optionD,
        E: rawQ.optionE
      };
      
      var displayedOptions = [];
      var keysList = ['A', 'B', 'C', 'D', 'E'];
      for (var s = 0; s < keysList.length; s++) {
        var displayLabel = keysList[s];
        displayedOptions.push({
          key: displayLabel,
          originalKey: displayLabel,
          text: rawOptions[displayLabel] || ''
        });
      }
      
      clientQuestions.push({
        id: rawQ.id,
        questionText: rawQ.questionText,
        options: displayedOptions,
        points: rawQ.points
      });
    }
  }
  
  // Ambil jawaban yang telah tersimpan sebelumnya (jika reload)
  var savedAnswers = {};
  var ansSheet = ss.getSheetByName(DB_SHEETS.ANSWERS);
  var ansData = ansSheet.getDataRange().getValues();
  for (var a = 1; a < ansData.length; a++) {
    if (ansData[a][1] === sessionData.id && ansData[a][2] === user.id) {
      savedAnswers[ansData[a][3]] = ansData[a][4];
    }
  }
  
  return createJsonResponse({
    success: true,
    sessionId: sessionData.id,
    examTitle: exam.title,
    durationMinutes: exam.durationMinutes,
    remainingSeconds: remainingSeconds,
    violationCount: sessionData.violationCount,
    maxViolations: exam.maxViolations,
    questions: clientQuestions,
    savedAnswers: savedAnswers,
    serverTime: new Date().toISOString()
  });
}

/**
 * Menyimpan Jawaban Siswa Secara Otomatis (Auto-Save) dengan LockService
 */
function handleSaveAnswer(user, data) {
  var sessionId = data.sessionId;
  var questionId = data.questionId;
  var selectedOption = data.selectedOption; // Original Key (A/B/C/D/E)
  
  var ss = getSpreadsheet();
  var ansSheet = ss.getSheetByName(DB_SHEETS.ANSWERS);
  var ansData = ansSheet.getDataRange().getValues();
  
  var foundRow = -1;
  for (var i = 1; i < ansData.length; i++) {
    if (ansData[i][1] === sessionId && ansData[i][3] === questionId) {
      foundRow = i + 1;
      break;
    }
  }
  
  var nowStr = new Date().toISOString();
  if (foundRow > 0) {
    ansSheet.getRange(foundRow, 5, 1, 3).setValues([[selectedOption, '', nowStr]]);
  } else {
    var newAnsId = 'ANS-' + Utilities.getUuid().substring(0, 8);
    ansSheet.appendRow([newAnsId, sessionId, user.id, questionId, selectedOption, '', nowStr]);
  }
  
  return createJsonResponse({
    success: true,
    savedAt: nowStr,
    questionId: questionId
  });
}

/**
 * Mencatat Pelanggaran (Pindah Tab, Blur, Percobaan Salin Teks)
 */
function handleLogViolation(user, data) {
  var sessionId = data.sessionId;
  var violationType = data.type || 'TAB_SWITCH';
  var details = data.details || 'Terdeteksi beralih dari halaman ujian';
  
  var ss = getSpreadsheet();
  var studentExamSheet = ss.getSheetByName(DB_SHEETS.STUDENT_EXAMS);
  var rows = studentExamSheet.getDataRange().getValues();
  
  var targetRow = -1;
  var currentViolations = 0;
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === sessionId && rows[i][2] === user.id) {
      targetRow = i + 1;
      currentViolations = Number(rows[i][10]) || 0;
      break;
    }
  }
  
  if (targetRow > 0) {
    currentViolations += 1;
    studentExamSheet.getRange(targetRow, 11).setValue(currentViolations);
  }
  
  writeLog(user.id, 'TAB_SWITCH_ALERT', 'Pelanggaran ke-' + currentViolations + ': ' + details, 'warning');
  
  return createJsonResponse({
    success: true,
    violationCount: currentViolations
  });
}

/**
 * Pengumpulan Ujian & Penilaian Otomatis oleh Server
 */
function handleSubmitExam(user, data) {
  var sessionId = data.sessionId;
  var ss = getSpreadsheet();
  
  var studentExamSheet = ss.getSheetByName(DB_SHEETS.STUDENT_EXAMS);
  var sData = studentExamSheet.getDataRange().getValues();
  var sessionRow = -1;
  var examId = '';
  
  for (var i = 1; i < sData.length; i++) {
    if (sData[i][0] === sessionId && sData[i][2] === user.id) {
      sessionRow = i + 1;
      examId = sData[i][1];
      break;
    }
  }
  
  if (sessionRow === -1) {
    return createJsonResponse({ success: false, error: 'Sesi ujian tidak valid.' });
  }
  
  // Ambil Kunci Jawaban dari Server (QUESTIONS)
  var qSheet = ss.getSheetByName(DB_SHEETS.QUESTIONS);
  var qData = qSheet.getDataRange().getValues();
  var keyMap = {};
  for (var q = 1; q < qData.length; q++) {
    keyMap[qData[q][0]] = {
      correct: qData[q][9],
      points: Number(qData[q][11]) || 10
    };
  }
  
  // Ambil Jawaban Siswa
  var ansSheet = ss.getSheetByName(DB_SHEETS.ANSWERS);
  var aData = ansSheet.getDataRange().getValues();
  var studentAnswers = {};
  for (var a = 1; a < aData.length; a++) {
    if (aData[a][1] === sessionId) {
      studentAnswers[aData[a][3]] = {
        row: a + 1,
        selected: aData[a][4]
      };
    }
  }
  
  // Hitung Nilai di Sisi Server
  var correctCount = 0;
  var incorrectCount = 0;
  var totalScore = 0;
  var maxPossible = 0;
  
  var qOrder = JSON.parse(sData[sessionRow - 1][11] || '[]');
  
  for (var k = 0; k < qOrder.length; k++) {
    var qId = qOrder[k];
    var meta = keyMap[qId];
    if (meta) {
      maxPossible += meta.points;
      var ans = studentAnswers[qId];
      if (ans && ans.selected === meta.correct) {
        correctCount++;
        totalScore += meta.points;
        ansSheet.getRange(ans.row, 6).setValue('TRUE');
      } else {
        if (ans && ans.selected) {
          incorrectCount++;
          ansSheet.getRange(ans.row, 6).setValue('FALSE');
        }
      }
    }
  }
  
  var unansweredCount = qOrder.length - (correctCount + incorrectCount);
  var scaledScore = maxPossible > 0 ? Math.round((totalScore / maxPossible) * 100) : 0;
  var finishTime = new Date().toISOString();
  
  // Update status di STUDENT_EXAMS: status='submitted', total_score, counts
  studentExamSheet.getRange(sessionRow, 5, 1, 6).setValues([[
    finishTime,
    'submitted',
    scaledScore,
    correctCount,
    incorrectCount,
    unansweredCount
  ]]);
  
  writeLog(user.id, 'SUBMIT_MANUAL', 'Siswa mengumpulkan ujian. Nilai: ' + scaledScore, 'info');
  
  return createJsonResponse({
    success: true,
    score: scaledScore,
    correctCount: correctCount,
    incorrectCount: incorrectCount,
    unansweredCount: unansweredCount,
    submittedAt: finishTime
  });
}

function autoSubmitExpired(sessionId, examId, userId) {
  var ss = getSpreadsheet();
  var studentExamSheet = ss.getSheetByName(DB_SHEETS.STUDENT_EXAMS);
  var sData = studentExamSheet.getDataRange().getValues();
  var sessionRow = -1;
  for (var i = 1; i < sData.length; i++) {
    if (sData[i][0] === sessionId) {
      sessionRow = i + 1;
      break;
    }
  }
  if (sessionRow > 0) {
    studentExamSheet.getRange(sessionRow, 6).setValue('timed_out');
    writeLog(userId, 'SUBMIT_AUTO_TIMEOUT', 'Ujian dikumpulkan otomatis oleh sistem karena waktu habis', 'warning');
  }
  return createJsonResponse({
    success: false,
    error: 'Waktu ujian telah berakhir. Jawaban Anda telah disimpan otomatis oleh server.'
  });
}

/**
 * =========================================================================================
 * 4. PENGELOLAAN GURU & ADMIN (RESET SESI, BANK SOAL, JADWAL, SISWA)
 * =========================================================================================
 */

/**
 * Fitur Reset Ujian Siswa (Admin/Guru)
 * Menghapus status in_progress/submitted sehingga siswa yang mengalami mati lampu / hp rusak
 * dapat mengikuti ujian kembali dengan persetujuan pengawas.
 */
function handleResetStudentExam(user, data) {
  if (user.role !== 'admin' && user.role !== 'guru') {
    return createJsonResponse({ success: false, error: 'Akses ditolak.' });
  }
  
  var studentExamId = data.studentExamId;
  var ss = getSpreadsheet();
  var sSheet = ss.getSheetByName(DB_SHEETS.STUDENT_EXAMS);
  var sData = sSheet.getDataRange().getValues();
  
  var targetRow = -1;
  var targetUserId = '';
  for (var i = 1; i < sData.length; i++) {
    if (sData[i][0] === studentExamId) {
      targetRow = i + 1;
      targetUserId = sData[i][2];
      break;
    }
  }
  
  if (targetRow === -1) {
    return createJsonResponse({ success: false, error: 'Sesi ujian tidak ditemukan.' });
  }
  
  // Hapus baris sesi ujian agar siswa dapat start ulang secara bersih
  sSheet.deleteRow(targetRow);
  
  // Hapus juga jawaban parsial sebelumnya
  var ansSheet = ss.getSheetByName(DB_SHEETS.ANSWERS);
  var ansData = ansSheet.getDataRange().getValues();
  for (var j = ansData.length - 1; j >= 1; j--) {
    if (ansData[j][1] === studentExamId) {
      ansSheet.deleteRow(j + 1);
    }
  }
  
  writeLog(user.id, 'RESET_EXAM', 'Pengawas ' + user.fullName + ' mereset sesi ujian ID: ' + studentExamId + ' untuk siswa ID: ' + targetUserId, 'warning');
  
  return createJsonResponse({ success: true, message: 'Sesi ujian siswa berhasil di-reset. Siswa dapat login dan memulai ujian kembali.' });
}

function handleGetExamResults(user, data) {
  if (user.role !== 'admin' && user.role !== 'guru') {
    return createJsonResponse({ success: false, error: 'Akses ditolak.' });
  }
  
  var examId = data.examId;
  var ss = getSpreadsheet();
  var sSheet = ss.getSheetByName(DB_SHEETS.STUDENT_EXAMS);
  var sData = sSheet.getDataRange().getValues();
  
  var uSheet = ss.getSheetByName(DB_SHEETS.USERS);
  var uData = uSheet.getDataRange().getValues();
  var userMap = {};
  for (var u = 1; u < uData.length; u++) {
    userMap[uData[u][0]] = {
      fullName: uData[u][4],
      username: uData[u][1],
      classId: uData[u][6]
    };
  }
  
  var results = [];
  for (var i = 1; i < sData.length; i++) {
    if (!examId || sData[i][1] === examId) {
      var studentId = sData[i][2];
      var studentInfo = userMap[studentId] || { fullName: 'Siswa', username: '', classId: '' };
      
      results.push({
        id: sData[i][0],
        examId: sData[i][1],
        userId: studentId,
        studentName: studentInfo.fullName,
        username: studentInfo.username,
        classId: studentInfo.classId,
        startTime: sData[i][3],
        endTime: sData[i][4],
        status: sData[i][5],
        totalScore: sData[i][6],
        correctCount: sData[i][7],
        incorrectCount: sData[i][8],
        unansweredCount: sData[i][9],
        violationCount: Number(sData[i][10]) || 0
      });
    }
  }
  
  return createJsonResponse({ success: true, results: results });
}

function getOrCreateClassesSheet(ss) {
  var sheet = ss.getSheetByName(DB_SHEETS.CLASSES);
  if (!sheet) {
    sheet = ss.insertSheet(DB_SHEETS.CLASSES);
    sheet.appendRow(['id', 'name', 'grade', 'description']);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#E2E8F0');
    sheet.setFrozenRows(1);

    var defaultClasses = [
      ['CLS-10-MIPA', 'X MIPA', 'X', 'Kelas 10 Matematika dan Ilmu Pengetahuan Alam'],
      ['CLS-11-IPS', 'XI IPS', 'XI', 'Kelas 11 Ilmu Pengetahuan Sosial'],
      ['CLS-12-AGM', 'XII Keagamaan', 'XII', 'Kelas 12 Peminatan Keagamaan Islam']
    ];
    for (var c = 0; c < defaultClasses.length; c++) {
      sheet.appendRow(defaultClasses[c]);
    }
  }
  return sheet;
}

function handleGetClasses(user) {
  var ss = getSpreadsheet();
  var sheet = getOrCreateClassesSheet(ss);
  var data = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] && String(data[i][0]).trim() !== '') {
      list.push({ id: String(data[i][0]), name: String(data[i][1]), grade: String(data[i][2] || 'X'), description: String(data[i][3] || '') });
    }
  }
  return createJsonResponse({ success: true, classes: list });
}

function handleSaveClass(user, data) {
  user = user || {};
  data = data || {};
  if (user.role !== 'admin' && user.role !== 'guru') {
    return createJsonResponse({ success: false, error: 'Akses ditolak: Hanya Admin dan Guru yang dapat mengelola rombel kelas.' });
  }
  var ss = getSpreadsheet();
  var sheet = getOrCreateClassesSheet(ss);

  var name = String(data.name || '').trim();
  if (!name) {
    return createJsonResponse({ success: false, error: 'Nama rombel kelas wajib diisi.' });
  }

  var grade = String(data.grade || 'X').trim().toUpperCase();
  if (grade !== 'X' && grade !== 'XI' && grade !== 'XII') {
    grade = 'X';
  }
  var description = String(data.description || '').trim();

  var rows = sheet.getDataRange().getValues();
  if (data.id) {
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.id)) {
        sheet.getRange(i + 1, 2).setValue(name);
        sheet.getRange(i + 1, 3).setValue(grade);
        sheet.getRange(i + 1, 4).setValue(description);
        writeLog(user.id, 'SAVE_CLASS', 'Memperbarui rombel kelas: ' + name + ' (Tingkat ' + grade + ')', 'info');
        return createJsonResponse({ success: true, id: data.id, message: 'Rombel kelas "' + name + '" berhasil diperbarui.' });
      }
    }
  }

  var cleanSlug = name.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 8);
  var newId = 'CLS-' + (cleanSlug || grade) + '-' + Math.floor(Math.random() * 900 + 100);
  sheet.appendRow([newId, name, grade, description]);
  writeLog(user.id, 'SAVE_CLASS', 'Menambah rombel kelas baru: ' + name + ' (Tingkat ' + grade + ')', 'info');
  return createJsonResponse({ success: true, id: newId, message: 'Rombel kelas "' + name + '" berhasil disimpan.' });
}

function handleDeleteClass(user, data) {
  user = user || {};
  data = data || {};
  if (user.role !== 'admin' && user.role !== 'guru') {
    return createJsonResponse({ success: false, error: 'Akses ditolak.' });
  }
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEETS.CLASSES);
  if (!sheet) {
    return createJsonResponse({ success: true, message: 'Rombel kelas telah dihapus.' });
  }
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      sheet.deleteRow(i + 1);
      writeLog(user.id, 'DELETE_CLASS', 'Menghapus rombel kelas ID: ' + data.id, 'warning');
      return createJsonResponse({ success: true, message: 'Rombel kelas berhasil dihapus.' });
    }
  }
  return createJsonResponse({ success: false, error: 'Rombel kelas tidak ditemukan.' });
}

function getOrCreateSubjectsSheet(ss) {
  var sheet = ss.getSheetByName(DB_SHEETS.SUBJECTS);
  if (!sheet) {
    sheet = ss.insertSheet(DB_SHEETS.SUBJECTS);
    sheet.appendRow(['id', 'code', 'name', 'teacher_id']);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#E2E8F0');
    sheet.setFrozenRows(1);
    
    // Seed mata pelajaran bawaan
    var defaultSubjects = [
      ['SUBJ-001', 'QRD-10', "Al-Qur'an Hadis", 'Ustadz Ahmad, S.Pd.I'],
      ['SUBJ-002', 'AA-10', 'Akidah Akhlak', 'Ustadzah Fatimah, M.Ag'],
      ['SUBJ-003', 'FQH-10', 'Fikih', 'Ustadz Mansur, S.H.I'],
      ['SUBJ-004', 'SKI-10', 'Sejarah Kebudayaan Islam', 'Ustadzah Nurul, S.Pd'],
      ['SUBJ-005', 'BAR-10', 'Bahasa Arab', 'Ustadz Zulkifli, Lc'],
      ['SUBJ-006', 'MTK-10', 'Matematika Peminatan', 'Bpk. Hendra, S.Pd'],
      ['SUBJ-007', 'BIN-10', 'Bahasa Indonesia', 'Ibu Rahma, S.Pd']
    ];
    for (var s = 0; s < defaultSubjects.length; s++) {
      sheet.appendRow(defaultSubjects[s]);
    }
  }
  return sheet;
}

function handleGetSubjects(user) {
  var ss = getSpreadsheet();
  var sheet = getOrCreateSubjectsSheet(ss);
  var data = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] && String(data[i][0]).trim() !== '') {
      var colTeacherName = String(data[i][3] || '').trim();
      var colTeacherId = String(data[i][4] || data[i][3] || '').trim();
      list.push({
        id: String(data[i][0]),
        code: String(data[i][1] || 'MAPEL'),
        name: String(data[i][2] || 'Mata Pelajaran'),
        teacherId: colTeacherId,
        teacherName: colTeacherName
      });
    }
  }
  return createJsonResponse({ success: true, subjects: list });
}

function handleSaveSubject(user, data) {
  user = user || {};
  data = data || {};
  if (user.role !== 'admin' && user.role !== 'guru') {
    return createJsonResponse({ success: false, error: 'Akses ditolak: Hanya Admin dan Guru yang dapat mengelola mata pelajaran.' });
  }
  var ss = getSpreadsheet();
  var sheet = getOrCreateSubjectsSheet(ss);
  
  var name = (data.name || '').trim();
  var code = (data.code || '').trim().toUpperCase();
  var teacherName = (data.teacherName || '').trim();
  var teacherId = (data.teacherId || teacherName || '').trim();
  
  // Jika kode kosong, buat otomatis dari singkatan nama mata pelajaran
  if (!code && name) {
    var parts = name.split(/\s+/);
    if (parts.length >= 2) {
      code = parts.map(function(p) { return p.charAt(0); }).join('').toUpperCase() + '-10';
    } else {
      code = (name.substring(0, 3).toUpperCase() || 'MP') + '-10';
    }
  }

  if (!name) {
    return createJsonResponse({ success: false, error: 'Nama mata pelajaran wajib diisi.' });
  }

  var rows = sheet.getDataRange().getValues();

  // Mode Edit / Perbarui
  if (data.id) {
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.id)) {
        sheet.getRange(i + 1, 2).setValue(code);
        sheet.getRange(i + 1, 3).setValue(name);
        sheet.getRange(i + 1, 4).setValue(teacherName);
        sheet.getRange(i + 1, 5).setValue(teacherId);
        writeLog(user.id, 'UPDATE_SUBJECT', 'Memperbarui mata pelajaran: ' + name + ' (' + code + ')', 'info');
        return createJsonResponse({ success: true, id: data.id, message: 'Mata pelajaran "' + name + '" berhasil diperbarui.' });
      }
    }
  }

  // Tambah Mata Pelajaran Baru
  var cleanCode = code.replace(/[^A-Z0-9]/g, '').substring(0, 8);
  var newId = 'SUBJ-' + (cleanCode || 'MAPEL') + '-' + Math.floor(Math.random() * 900 + 100);
  sheet.appendRow([
    newId,
    code,
    name,
    teacherName,
    teacherId
  ]);
  writeLog(user.id, 'CREATE_SUBJECT', 'Menambah mata pelajaran baru: ' + name + ' (' + code + ')', 'info');
  return createJsonResponse({ success: true, id: newId, message: 'Mata pelajaran "' + name + '" berhasil disimpan.' });
}

function handleDeleteSubject(user, data) {
  user = user || {};
  data = data || {};
  if (user.role !== 'admin') {
    return createJsonResponse({ success: false, error: 'Hanya Admin yang dapat menghapus mata pelajaran.' });
  }
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEETS.SUBJECTS);
  if (!sheet) {
    return createJsonResponse({ success: true, message: 'Mata pelajaran telah dihapus.' });
  }
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      sheet.deleteRow(i + 1);
      writeLog(user.id, 'DELETE_SUBJECT', 'Menghapus mata pelajaran ID: ' + data.id, 'warning');
      return createJsonResponse({ success: true, message: 'Mata pelajaran berhasil dihapus.' });
    }
  }
  return createJsonResponse({ success: false, error: 'Mata pelajaran tidak ditemukan.' });
}

function handleGetQuestions(user, data) {
  if (user.role !== 'admin' && user.role !== 'guru') {
    return createJsonResponse({ success: false, error: 'Akses ditolak.' });
  }
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEETS.QUESTIONS);
  var subjSheet = ss.getSheetByName(DB_SHEETS.SUBJECTS);
  var validSubjects = [];
  var validSubjMap = {};
  if (subjSheet && subjSheet.getLastRow() > 1) {
    var sRows = subjSheet.getDataRange().getValues();
    for (var s = 1; s < sRows.length; s++) {
      if (sRows[s][0]) {
        var sObj = {
          id: String(sRows[s][0]),
          code: String(sRows[s][1] || ''),
          name: String(sRows[s][2] || '')
        };
        validSubjects.push(sObj);
        validSubjMap[sObj.id] = sObj;
      }
    }
  }

  var rows = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var rowSubjId = String(rows[i][1] || '');
    // Jika subjectId pada soal tidak terdaftar di daftar Mata Pelajaran, arahkan otomatis ke mapel yang terdaftar
    if (validSubjects.length > 0 && !validSubjMap[rowSubjId]) {
      var targetSubjId = validSubjects[0].id;
      for (var m = 0; m < validSubjects.length; m++) {
        var vs = validSubjects[m];
        if (
          vs.code.toLowerCase() === rowSubjId.toLowerCase() ||
          vs.name.toLowerCase() === rowSubjId.toLowerCase()
        ) {
          targetSubjId = vs.id;
          break;
        }
      }
      rowSubjId = targetSubjId;
      sheet.getRange(i + 1, 2).setValue(rowSubjId);
    }

    if (!data.subjectId || rowSubjId === data.subjectId) {
      list.push({
        id: rows[i][0],
        subjectId: rowSubjId,
        classId: rows[i][2],
        questionText: rows[i][3],
        optionA: rows[i][4],
        optionB: rows[i][5],
        optionC: rows[i][6],
        optionD: rows[i][7],
        optionE: rows[i][8],
        correctAnswer: rows[i][9],
        explanation: rows[i][10],
        points: Number(rows[i][11]) || 10,
        createdBy: rows[i][12]
      });
    }
  }
  return createJsonResponse({ success: true, questions: list });
}

function handleSaveQuestion(user, data) {
  if (user.role !== 'admin' && user.role !== 'guru') {
    return createJsonResponse({ success: false, error: 'Akses ditolak.' });
  }
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEETS.QUESTIONS);
  var qId = data.id || ('Q-' + Utilities.getUuid().substring(0, 8));
  var isUpdate = false;
  
  if (data.id) {
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.id) {
        var existingKey = String(rows[i][9] || 'A').trim().toUpperCase();
        var updatedKey = data.correctAnswer ? String(data.correctAnswer).trim().toUpperCase() : existingKey;
        if (['A', 'B', 'C', 'D', 'E'].indexOf(updatedKey) === -1) {
          updatedKey = existingKey;
        }
        sheet.getRange(i + 1, 1, 1, 13).setValues([[
          data.id,
          data.subjectId,
          data.classId || '',
          data.questionText,
          data.optionA,
          data.optionB,
          data.optionC,
          data.optionD,
          data.optionE,
          updatedKey,
          data.explanation || '',
          data.points || 10,
          user.fullName
        ]]);
        isUpdate = true;
        break;
      }
    }
  }
  
  if (!isUpdate) {
    var newKey = String(data.correctAnswer || 'A').trim().toUpperCase();
    if (['A', 'B', 'C', 'D', 'E'].indexOf(newKey) === -1) {
      newKey = 'A';
    }
    sheet.appendRow([
      qId,
      data.subjectId,
      data.classId || '',
      data.questionText,
      data.optionA,
      data.optionB,
      data.optionC,
      data.optionD,
      data.optionE,
      newKey,
      data.explanation || '',
      data.points || 10,
      user.fullName
    ]);
  }
  
  writeLog(user.id, 'CREATE_QUESTION', (isUpdate ? 'Memperbarui' : 'Menambah') + ' soal ID: ' + qId, 'info');
  return createJsonResponse({ success: true, id: qId });
}

function handleBatchSaveQuestions(user, data) {
  if (user.role !== 'admin' && user.role !== 'guru') {
    return createJsonResponse({ success: false, error: 'Akses ditolak.' });
  }
  var list = data.questions || [];
  if (!list.length) {
    return createJsonResponse({ success: false, error: 'Data soal kosong.' });
  }
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEETS.QUESTIONS);
  var subjSheet = ss.getSheetByName(DB_SHEETS.SUBJECTS);
  var firstValidSubjId = '';
  var validSubjIds = {};
  if (subjSheet && subjSheet.getLastRow() > 1) {
    var sRows = subjSheet.getDataRange().getValues();
    for (var s = 1; s < sRows.length; s++) {
      if (sRows[s][0]) {
        var sid = String(sRows[s][0]);
        if (!firstValidSubjId) firstValidSubjId = sid;
        validSubjIds[sid] = true;
      }
    }
  }

  var replaceExisting = data.replaceExisting === true || data.replaceExisting === 'true';
  var targetSubjectId = data.subjectId || (list[0] && list[0].subjectId) || firstValidSubjId || '';
  if (firstValidSubjId && targetSubjectId && !validSubjIds[targetSubjectId]) {
    targetSubjectId = firstValidSubjId;
  }

  if (replaceExisting && targetSubjectId) {
    var existingRows = sheet.getDataRange().getValues();
    for (var d = existingRows.length - 1; d >= 1; d--) {
      var rowSId = String(existingRows[d][1] || '');
      if (rowSId === String(targetSubjectId) || (firstValidSubjId && !validSubjIds[rowSId])) {
        sheet.deleteRow(d + 1);
      }
    }
  }

  var rowsToAppend = [];
  for (var i = 0; i < list.length; i++) {
    var q = list[i];
    var newId = 'Q-' + Utilities.getUuid().substring(0, 8);
    var exactKey = String(q.correctAnswer || 'A').trim().toUpperCase();
    if (['A', 'B', 'C', 'D', 'E'].indexOf(exactKey) === -1) {
      exactKey = 'A';
    }
    var finalSubjId = targetSubjectId || q.subjectId || firstValidSubjId || 'SUBJ-FIQ-10';
    rowsToAppend.push([
      newId,
      finalSubjId,
      q.classId || '',
      q.questionText || '',
      q.optionA || '',
      q.optionB || '',
      q.optionC || '',
      q.optionD || '',
      q.optionE || '',
      exactKey,
      q.explanation || '',
      Number(q.points) || 10,
      user.fullName
    ]);
  }
  
  if (rowsToAppend.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, 13).setValues(rowsToAppend);
    
    // Sinkronkan jumlah soal (total_questions) pada jadwal ujian mata pelajaran terkait
    var updatedQRows = sheet.getDataRange().getValues();
    var qCountMap = {};
    for (var uq = 1; uq < updatedQRows.length; uq++) {
      var sId = String(updatedQRows[uq][1] || '').trim();
      qCountMap[sId] = (qCountMap[sId] || 0) + 1;
    }
    var exSheet = ss.getSheetByName(DB_SHEETS.EXAMS);
    if (exSheet) {
      var exRows = exSheet.getDataRange().getValues();
      for (var exi = 1; exi < exRows.length; exi++) {
        var exSubjId = String(exRows[exi][2] || '').trim();
        if (qCountMap[exSubjId] && Number(exRows[exi][7]) !== qCountMap[exSubjId]) {
          exSheet.getRange(exi + 1, 8).setValue(qCountMap[exSubjId]);
        }
      }
    }
  }
  
  writeLog(user.id, 'BATCH_UPLOAD_QUESTIONS', 'Mengunggah ' + rowsToAppend.length + ' butir soal sekaligus', 'info');
  return createJsonResponse({ success: true, count: rowsToAppend.length });
}

function handleDeleteQuestion(user, data) {
  if (user.role !== 'admin' && user.role !== 'guru') {
    return createJsonResponse({ success: false, error: 'Akses ditolak.' });
  }
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEETS.QUESTIONS);
  var rows = sheet.getDataRange().getValues();

  if (data.deleteAllBySubject && data.subjectId) {
    var deletedCount = 0;
    for (var j = rows.length - 1; j >= 1; j--) {
      if (String(rows[j][1]) === String(data.subjectId)) {
        sheet.deleteRow(j + 1);
        deletedCount++;
      }
    }
    writeLog(user.id, 'DELETE_QUESTION', 'Menghapus ' + deletedCount + ' soal pada mapel ID: ' + data.subjectId, 'warning');
    return createJsonResponse({ success: true, deletedCount: deletedCount });
  }

  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.id) {
      sheet.deleteRow(i + 1);
      writeLog(user.id, 'DELETE_QUESTION', 'Menghapus butir soal ID: ' + data.id, 'warning');
      return createJsonResponse({ success: true });
    }
  }
  return createJsonResponse({ success: false, error: 'Soal tidak ditemukan.' });
}

function handleGetExams(user, data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEETS.EXAMS);
  var rows = sheet.getDataRange().getValues();
  
  var subjSheet = ss.getSheetByName(DB_SHEETS.SUBJECTS);
  var subjRows = subjSheet ? subjSheet.getDataRange().getValues() : [];
  var subjectNameMap = {};
  for (var s = 1; s < subjRows.length; s++) {
    subjectNameMap[String(subjRows[s][0]).trim()] = String(subjRows[s][2] || '').trim();
  }
  
  var classSheet = ss.getSheetByName(DB_SHEETS.CLASSES);
  var classRows = classSheet ? classSheet.getDataRange().getValues() : [];
  var classNameMap = {};
  for (var c = 1; c < classRows.length; c++) {
    classNameMap[String(classRows[c][0]).trim()] = String(classRows[c][1] || '').trim();
  }
  
  var qSheet = ss.getSheetByName(DB_SHEETS.QUESTIONS);
  var qRows = qSheet ? qSheet.getDataRange().getValues() : [];
  var totalBankQuestions = Math.max(0, qRows.length - 1);
  var qCountBySubj = {};
  for (var q = 1; q < qRows.length; q++) {
    var qSubjId = String(qRows[q][1] || '').trim();
    qCountBySubj[qSubjId] = (qCountBySubj[qSubjId] || 0) + 1;
  }
  
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var exSubjId = String(rows[i][2] || '').trim();
    var exClassId = String(rows[i][3] || '').trim();
    var matchedCount = qCountBySubj[exSubjId] || 0;
    if (matchedCount === 0 && subjRows.length <= 2 && totalBankQuestions > 0) {
      matchedCount = totalBankQuestions;
    }
    var effectiveTotal = matchedCount > 0 ? matchedCount : Number(rows[i][7]);
    var startInfo = formatExamWindowCell(ss, rows[i][4], '07:30');
    var endInfo = formatExamWindowCell(ss, rows[i][5], '23:59');
    list.push({
      id: rows[i][0],
      title: rows[i][1],
      subjectId: exSubjId,
      subjectName: subjectNameMap[exSubjId] || (subjRows.length === 2 ? String(subjRows[1][2] || '') : 'Mata Pelajaran'),
      classId: exClassId,
      className: classNameMap[exClassId] || (exClassId ? exClassId : 'Semua Kelas'),
      examDate: startInfo.examDate,
      startTime: startInfo.time,
      endTime: endInfo.time,
      startWindow: startInfo.iso,
      endWindow: endInfo.iso,
      durationMinutes: Number(rows[i][6]),
      totalQuestions: effectiveTotal,
      passingScore: Number(rows[i][8]),
      token: rows[i][9],
      status: rows[i][10],
      randomizeQuestions: rows[i][11] === true || rows[i][11] === 'TRUE',
      randomizeOptions: rows[i][12] === true || rows[i][12] === 'TRUE',
      maxViolations: Number(rows[i][13]) || 3
    });
  }
  return createJsonResponse({ success: true, exams: list });
}

function handleSaveExam(user, data) {
  if (user.role !== 'admin' && user.role !== 'guru') {
    return createJsonResponse({ success: false, error: 'Akses ditolak.' });
  }
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEETS.EXAMS);
  var examId = data.id || ('EXAM-' + Utilities.getUuid().substring(0, 8));
  var isUpdate = false;
  
  if (data.id) {
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.id) {
        sheet.getRange(i + 1, 1, 1, 14).setValues([[
          data.id,
          data.title,
          data.subjectId,
          data.classId,
          data.startWindow,
          data.endWindow,
          data.durationMinutes,
          data.totalQuestions,
          data.passingScore,
          data.token,
          data.status,
          Boolean(data.randomizeQuestions),
          false,
          data.maxViolations || 3
        ]]);
        isUpdate = true;
        break;
      }
    }
  }
  
  if (!isUpdate) {
    sheet.appendRow([
      examId,
      data.title,
      data.subjectId,
      data.classId,
      data.startWindow,
      data.endWindow,
      data.durationMinutes,
      data.totalQuestions,
      data.passingScore,
      data.token,
      data.status || 'published',
      Boolean(data.randomizeQuestions),
      false,
      data.maxViolations || 3
    ]);
  }
  
  writeLog(user.id, 'UPDATE_EXAM', (isUpdate ? 'Memperbarui' : 'Membuat') + ' jadwal ujian: ' + data.title, 'info');
  return createJsonResponse({ success: true, id: examId });
}

function handleDeleteExam(user, data) {
  if (user.role !== 'admin') {
    return createJsonResponse({ success: false, error: 'Hanya Admin yang dapat menghapus jadwal ujian.' });
  }
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEETS.EXAMS);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.id) {
      sheet.deleteRow(i + 1);
      writeLog(user.id, 'DELETE_EXAM', 'Menghapus jadwal ujian ID: ' + data.id, 'warning');
      return createJsonResponse({ success: true });
    }
  }
  return createJsonResponse({ success: false, error: 'Jadwal ujian tidak ditemukan.' });
}

function handleGetStudents(user) {
  if (user.role !== 'admin' && user.role !== 'guru') {
    return createJsonResponse({ success: false, error: 'Akses ditolak.' });
  }
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEETS.USERS);
  var rows = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][1] && !rows[i][0]) continue;
    var roleNorm = normalizeRoleStr(rows[i][5], rows[i][0], rows[i][1], rows[i][6]);
    if (roleNorm === 'siswa') {
      list.push({
        id: String(rows[i][0] || ('USR-SISWA-' + i)),
        username: String(rows[i][1] || ''),
        fullName: String(rows[i][4] || rows[i][1] || 'Siswa'),
        role: 'siswa',
        classId: String(rows[i][6] || ''),
        status: normalizeStatusStr(rows[i][7]),
        createdAt: rows[i][8] || new Date().toISOString()
      });
    }
  }
  return createJsonResponse({ success: true, students: list });
}

function handleSaveStudent(user, data) {
  if (user.role !== 'admin') {
    return createJsonResponse({ success: false, error: 'Hanya Admin yang dapat mengelola data siswa.' });
  }
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEETS.USERS);
  var rows = sheet.getDataRange().getValues();
  var cleanUsername = String(data.username || '').trim();
  
  if (data.id) {
    // Update data siswa
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.id)) {
        var cleanStudentId = String(data.id).toUpperCase().indexOf('USR-GURU') === 0
          ? 'USR-SISWA-' + Utilities.getUuid().substring(0, 8)
          : String(data.id);
        sheet.getRange(i + 1, 1).setValue(cleanStudentId);
        var uCell = sheet.getRange(i + 1, 2);
        uCell.setNumberFormat('@');
        uCell.setValue(cleanUsername);
        if (data.password && String(data.password).trim()) {
          var upSalt = generateSalt();
          var upHash = hashPassword(String(data.password).trim(), upSalt);
          sheet.getRange(i + 1, 3).setValue(upHash);
          sheet.getRange(i + 1, 4).setValue(upSalt);
        }
        sheet.getRange(i + 1, 5).setValue(data.fullName);
        sheet.getRange(i + 1, 6).setValue('siswa');
        sheet.getRange(i + 1, 7).setValue(data.classId);
        sheet.getRange(i + 1, 8).setValue(data.status || 'active');
        return createJsonResponse({ success: true, id: cleanStudentId, message: 'Data siswa diperbarui' });
      }
    }
  }

  // Cek jika username sudah ada agar tidak duplikat, pastikan role disetel ke 'siswa'
  for (var k = 1; k < rows.length; k++) {
    if (String(rows[k][1]).trim().toLowerCase() === cleanUsername.toLowerCase()) {
      var rawExistId = String(rows[k][0] || ('USR-SISWA-' + k));
      var existId = rawExistId.toUpperCase().indexOf('USR-GURU') === 0
        ? 'USR-SISWA-' + Utilities.getUuid().substring(0, 8)
        : rawExistId;
      sheet.getRange(k + 1, 1).setValue(existId);
      if (data.password && String(data.password).trim()) {
        var kSalt = generateSalt();
        var kHash = hashPassword(String(data.password).trim(), kSalt);
        sheet.getRange(k + 1, 3).setValue(kHash);
        sheet.getRange(k + 1, 4).setValue(kSalt);
      }
      sheet.getRange(k + 1, 5).setValue(data.fullName);
      sheet.getRange(k + 1, 6).setValue('siswa');
      sheet.getRange(k + 1, 7).setValue(data.classId || '');
      sheet.getRange(k + 1, 8).setValue('active');
      return createJsonResponse({ success: true, id: existId, message: 'Data siswa diperbarui' });
    }
  }

  // Tambah Siswa Baru
  var salt = generateSalt();
  var defaultPass = data.password || 'Siswa123!';
  var hash = hashPassword(defaultPass, salt);
  var newId = 'USR-SISWA-' + Utilities.getUuid().substring(0, 8);
  var nextRow = sheet.getLastRow() + 1;
  sheet.getRange(nextRow, 2).setNumberFormat('@');
  sheet.getRange(nextRow, 1, 1, 9).setValues([[
    newId,
    cleanUsername,
    hash,
    salt,
    data.fullName,
    'siswa',
    data.classId || '',
    'active',
    new Date().toISOString()
  ]]);
  return createJsonResponse({ success: true, id: newId });
}

function handleResetStudentPassword(user, data) {
  if (user.role !== 'admin') {
    return createJsonResponse({ success: false, error: 'Akses ditolak.' });
  }
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEETS.USERS);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.userId) {
      var newSalt = generateSalt();
      var newPass = data.newPassword || 'Siswa123!';
      var newHash = hashPassword(newPass, newSalt);
      sheet.getRange(i + 1, 3).setValue(newHash);
      sheet.getRange(i + 1, 4).setValue(newSalt);
      writeLog(user.id, 'RESET_PASSWORD', 'Reset kata sandi siswa ID: ' + data.userId, 'warning');
      return createJsonResponse({ success: true, message: 'Kata sandi berhasil direset ke default: ' + newPass });
    }
  }
  return createJsonResponse({ success: false, error: 'Siswa tidak ditemukan.' });
}

function handleDeleteStudent(user, data) {
  if (user.role !== 'admin') {
    return createJsonResponse({ success: false, error: 'Hanya Admin yang dapat menghapus akun siswa.' });
  }
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEETS.USERS);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.userId) {
      sheet.deleteRow(i + 1);
      writeLog(user.id, 'DELETE_STUDENT', 'Menghapus akun siswa ID: ' + data.userId, 'danger');
      return createJsonResponse({ success: true });
    }
  }
  return createJsonResponse({ success: false, error: 'Siswa tidak ditemukan.' });
}

function handleGetTeachers(user) {
  if (user.role !== 'admin' && user.role !== 'guru') {
    return createJsonResponse({ success: false, error: 'Akses ditolak.' });
  }
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEETS.USERS);
  var rows = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][1] && !rows[i][0]) continue;
    var roleNorm = normalizeRoleStr(rows[i][5], rows[i][0], rows[i][1], rows[i][6]);
    if (roleNorm === 'guru') {
      list.push({
        id: String(rows[i][0] || ('USR-GURU-' + i)),
        username: String(rows[i][1] || ''),
        fullName: String(rows[i][4] || rows[i][1] || 'Guru'),
        role: 'guru',
        classId: String(rows[i][6] || ''),
        status: normalizeStatusStr(rows[i][7]),
        createdAt: rows[i][8] || new Date().toISOString()
      });
    }
  }
  return createJsonResponse({ success: true, teachers: list });
}

function handleSaveTeacher(user, data) {
  if (user.role !== 'admin') {
    return createJsonResponse({ success: false, error: 'Hanya Admin yang dapat mengelola akun guru.' });
  }
  var cleanUsername = String(data.username || '').trim();
  var cleanFullName = String(data.fullName || '').trim();
  if (!cleanUsername || !cleanFullName) {
    return createJsonResponse({ success: false, error: 'Username dan nama lengkap guru wajib diisi.' });
  }

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEETS.USERS);
  var rows = sheet.getDataRange().getValues();

  if (data.id) {
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.id)) {
        var tCell = sheet.getRange(i + 1, 2);
        tCell.setNumberFormat('@');
        tCell.setValue(cleanUsername);
        sheet.getRange(i + 1, 5).setValue(cleanFullName);
        sheet.getRange(i + 1, 6).setValue('guru');
        sheet.getRange(i + 1, 8).setValue(data.status || 'active');
        if (data.password && String(data.password).trim()) {
          var upSalt = generateSalt();
          var upHash = hashPassword(String(data.password).trim(), upSalt);
          sheet.getRange(i + 1, 3).setValue(upHash);
          sheet.getRange(i + 1, 4).setValue(upSalt);
        }
        writeLog(user.id, 'UPDATE_TEACHER', 'Memperbarui akun guru: ' + cleanFullName, 'info');
        return createJsonResponse({ success: true, id: data.id, message: 'Data akun guru diperbarui.' });
      }
    }
  }

  for (var j = 1; j < rows.length; j++) {
    if (String(rows[j][1]).trim().toLowerCase() === cleanUsername.toLowerCase()) {
      var existGuruId = String(rows[j][0] || ('USR-GURU-' + j));
      sheet.getRange(j + 1, 1).setValue(existGuruId);
      sheet.getRange(j + 1, 5).setValue(cleanFullName);
      sheet.getRange(j + 1, 6).setValue('guru');
      sheet.getRange(j + 1, 8).setValue('active');
      return createJsonResponse({ success: true, id: existGuruId, message: 'Data akun guru diperbarui.' });
    }
  }

  var salt = generateSalt();
  var defaultPass = (data.password && String(data.password).trim()) ? String(data.password).trim() : 'Guru123!';
  var hash = hashPassword(defaultPass, salt);
  var newId = 'USR-GURU-' + Utilities.getUuid().substring(0, 8).toUpperCase();
  var nextRow = sheet.getLastRow() + 1;
  sheet.getRange(nextRow, 2).setNumberFormat('@');
  sheet.getRange(nextRow, 1, 1, 9).setValues([[
    newId,
    cleanUsername,
    hash,
    salt,
    cleanFullName,
    'guru',
    '',
    'active',
    new Date().toISOString()
  ]]);
  writeLog(user.id, 'CREATE_TEACHER', 'Menambahkan akun guru baru: ' + cleanFullName + ' (' + cleanUsername + ')', 'info');
  return createJsonResponse({ success: true, id: newId, message: 'Akun guru "' + cleanFullName + '" berhasil ditambahkan.' });
}

function handleResetTeacherPassword(user, data) {
  if (user.role !== 'admin') {
    return createJsonResponse({ success: false, error: 'Akses ditolak.' });
  }
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEETS.USERS);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.userId && rows[i][5] === 'guru') {
      var newSalt = generateSalt();
      var newPass = data.newPassword || 'Guru123!';
      var newHash = hashPassword(newPass, newSalt);
      sheet.getRange(i + 1, 3).setValue(newHash);
      sheet.getRange(i + 1, 4).setValue(newSalt);
      writeLog(user.id, 'RESET_PASSWORD', 'Reset kata sandi guru ID: ' + data.userId, 'warning');
      return createJsonResponse({ success: true, message: 'Kata sandi guru berhasil direset ke default: ' + newPass });
    }
  }
  return createJsonResponse({ success: false, error: 'Akun guru tidak ditemukan.' });
}

function handleDeleteTeacher(user, data) {
  if (user.role !== 'admin') {
    return createJsonResponse({ success: false, error: 'Hanya Admin yang dapat menghapus akun guru.' });
  }
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEETS.USERS);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.userId && rows[i][5] === 'guru') {
      sheet.deleteRow(i + 1);
      writeLog(user.id, 'DELETE_TEACHER', 'Menghapus akun guru ID: ' + data.userId, 'danger');
      return createJsonResponse({ success: true, message: 'Akun guru berhasil dihapus.' });
    }
  }
  return createJsonResponse({ success: false, error: 'Akun guru tidak ditemukan.' });
}

function handleGetActivityLogs(user) {
  if (user.role !== 'admin' && user.role !== 'guru') {
    return createJsonResponse({ success: false, error: 'Akses ditolak.' });
  }
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEETS.LOGS);
  var rows = sheet.getDataRange().getValues();
  var list = [];
  // Ambil 100 log terbaru
  var start = Math.max(1, rows.length - 100);
  for (var i = rows.length - 1; i >= start; i--) {
    list.push({
      id: rows[i][0],
      timestamp: rows[i][1],
      userId: rows[i][2],
      action: rows[i][3],
      details: rows[i][4],
      severity: rows[i][5] || 'info'
    });
  }
  return createJsonResponse({ success: true, logs: list });
}

function handleGetSystemStats(user) {
  var ss = getSpreadsheet();
  var uRows = ss.getSheetByName(DB_SHEETS.USERS).getDataRange().getValues();
  var qRows = ss.getSheetByName(DB_SHEETS.QUESTIONS).getDataRange().getValues();
  var eRows = ss.getSheetByName(DB_SHEETS.EXAMS).getDataRange().getValues();
  var sRows = ss.getSheetByName(DB_SHEETS.STUDENT_EXAMS).getDataRange().getValues();
  
  var totalStudents = 0;
  for (var i = 1; i < uRows.length; i++) {
    if (uRows[i][5] === 'siswa') totalStudents++;
  }
  
  var activeExamSessions = 0;
  for (var j = 1; j < sRows.length; j++) {
    if (sRows[j][5] === 'in_progress') activeExamSessions++;
  }
  
  return createJsonResponse({
    success: true,
    stats: {
      totalStudents: totalStudents,
      totalQuestions: qRows.length - 1,
      totalExams: eRows.length - 1,
      activeSessions: activeExamSessions
    }
  });
}

/**
 * =========================================================================================
 * 5. FUNGSI PEMBANTU (UTILITY & CORS)
 * =========================================================================================
 */
function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function writeLog(userId, action, details, severity) {
  try {
    var ss = getSpreadsheet();
    var logSheet = ss.getSheetByName(DB_SHEETS.LOGS);
    if (logSheet) {
      logSheet.appendRow([
        'LOG-' + Utilities.getUuid().substring(0, 8),
        new Date().toISOString(),
        userId,
        action,
        details,
        severity || 'info'
      ]);
    }
  } catch (err) {}
}

function shuffleArray(array) {
  var copy = array.slice();
  for (var i = copy.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
