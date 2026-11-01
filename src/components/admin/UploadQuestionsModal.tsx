import React, { useState, useEffect } from 'react';
import { Subject, ClassRoom, Question } from '../../types';
import { apiService } from '../../services/apiService';
import {
  Upload,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  X,
  KeyRound,
  RefreshCw,
} from 'lucide-react';

interface UploadQuestionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  subjects: Subject[];
  classes: ClassRoom[];
  defaultSubjectId?: string;
  onSuccess: (count: number, targetSubjectId?: string) => void;
}

interface ColumnOptionInfo {
  index: number;
  label: string;
  sampleValues: string;
  validKeyCount: number;
}

export const UploadQuestionsModal: React.FC<UploadQuestionsModalProps> = ({
  isOpen,
  onClose,
  subjects,
  classes,
  defaultSubjectId,
  onSuccess,
}) => {
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(
    defaultSubjectId || subjects[0]?.id || ''
  );
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [uploadTab, setUploadTab] = useState<'paste' | 'file'>('file');
  const [rawText, setRawText] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [parsedQuestions, setParsedQuestions] = useState<Partial<Question>[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Opsi timpa soal lama agar soal lama yang kuncinya "A" otomatis tergantikan
  const [replaceExisting, setReplaceExisting] = useState<boolean>(true);

  // Diagnostik kolom & pemilihan manual kolom kunci jawaban jika diperlukan
  const [columnOptions, setColumnOptions] = useState<ColumnOptionInfo[]>([]);
  const [detectedKeyCol, setDetectedKeyCol] = useState<number | null>(null);
  const [manualKeyCol, setManualKeyCol] = useState<number | null>(null);

  // Saat modal dibuka atau daftar mata pelajaran diperbarui, pastikan selectedSubjectId selalu valid sesuai mata pelajaran yang terdaftar
  useEffect(() => {
    if (subjects.length === 0) return;

    if (isOpen && defaultSubjectId && subjects.some((s) => s.id === defaultSubjectId)) {
      setSelectedSubjectId(defaultSubjectId);
      setParsedQuestions((prev) => prev.map((q) => ({ ...q, subjectId: defaultSubjectId })));
      return;
    }

    const isCurrentValid =
      Boolean(selectedSubjectId) && subjects.some((s) => s.id === selectedSubjectId);
    if (!isCurrentValid) {
      const validId =
        defaultSubjectId && subjects.some((s) => s.id === defaultSubjectId)
          ? defaultSubjectId
          : subjects[0].id;
      setSelectedSubjectId(validId);
      setParsedQuestions((prev) => prev.map((q) => ({ ...q, subjectId: validId })));
    }
  }, [isOpen, subjects, defaultSubjectId, selectedSubjectId]);

  if (!isOpen) return null;

  // Pembersih tanda kutip, spasi, dan karakter BOM/non-breaking space
  const cleanCellText = (val: string): string => {
    if (!val) return '';
    let s = val.replace(/[\uFEFF\u00A0\u200B]/g, ' ').trim();
    // Kupas tanda kutip berulang di awal/akhir seperti `"B"`, `'B'`, ` "B" `, `""B""`
    while (
      (s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'")) ||
      (s.startsWith('“') && s.endsWith('”'))
    ) {
      s = s.substring(1, s.length - 1).trim();
    }
    // Jika masih ada kutip tunggal di awal atau akhir akibat spasi sebelum kutip
    s = s.replace(/^["'“”]+|["'“”]+$/g, '').trim();
    return s;
  };

  // Cek apakah sebuah sel secara ketat merepresentasikan huruf kunci jawaban (A-E) atau angka (1-5)
  const parseStrictKeyLetter = (
    rawVal: string,
    allowNumeric = false
  ): 'A' | 'B' | 'C' | 'D' | 'E' | null => {
    const cleaned = cleanCellText(rawVal);
    if (!cleaned) return null;
    const upper = cleaned.toUpperCase();

    // 1. Huruf tunggal langsung A, B, C, D, E
    if (['A', 'B', 'C', 'D', 'E'].includes(upper)) {
      return upper as 'A' | 'B' | 'C' | 'D' | 'E';
    }

    // 2. Huruf dengan tanda titik/kurung: "A.", "(B)", "[C]", "{D}", "a)"
    const punctMatch = upper.match(/^[\(\[\{]?([A-E])[\)\]\}\.\-:]?$/);
    if (punctMatch && punctMatch[1]) {
      return punctMatch[1] as 'A' | 'B' | 'C' | 'D' | 'E';
    }

    // 3. Berawalan kata Kunci / Jawaban / Pilihan / Opsi / Option: "Kunci: C", "Jawaban B", "Option_D", "Pilihan E"
    const prefixMatch = upper.match(
      /^(?:KUNCI\s*JAWABAN|KUNCI|JAWABAN\s*BENAR|JAWABAN|JAWAB|PILIHAN|OPSI|OPTION|ANSWER\s*KEY|ANSWER|KEY)[_\s:=\-]*[\(\[\{]?([A-E])[\)\]\}\.]?$/i
    );
    if (prefixMatch && prefixMatch[1]) {
      return prefixMatch[1].toUpperCase() as 'A' | 'B' | 'C' | 'D' | 'E';
    }

    // 4. Jika mengizinkan angka 1-5 (1=A, 2=B, 3=C, 4=D, 5=E)
    if (allowNumeric) {
      const numMap: Record<string, 'A' | 'B' | 'C' | 'D' | 'E'> = {
        '1': 'A',
        '2': 'B',
        '3': 'C',
        '4': 'D',
        '5': 'E',
      };
      if (numMap[upper]) return numMap[upper];
    }

    return null;
  };

  // Ekstraksi kunci jawaban lengkap (termasuk pencocokan teks opsi & awalan "B. Teks")
  const extractAnswerKey = (
    rawVal: string,
    opts: { A: string; B: string; C: string; D: string; E: string },
    allowNumeric = false
  ): 'A' | 'B' | 'C' | 'D' | 'E' | null => {
    const strict = parseStrictKeyLetter(rawVal, allowNumeric);
    if (strict) return strict;

    const cleaned = cleanCellText(rawVal);
    if (!cleaned) return null;
    const upper = cleaned.toUpperCase();

    // Jika berformat "B. Shalat" atau "C) Zakat" atau "D - Puasa"
    const leadingLetterMatch = upper.match(/^[\(\[]?([A-E])[\.\)\]\-:]\s+.+/);
    if (leadingLetterMatch && leadingLetterMatch[1]) {
      return leadingLetterMatch[1] as 'A' | 'B' | 'C' | 'D' | 'E';
    }

    // Cocokkan dengan teks pilihan A-E jika kolom kunci berisi teks jawaban
    const norm = (s: string) =>
      cleanCellText(s)
        .toLowerCase()
        .replace(/^[\(\[]?[a-e][\.\)\]\-:]\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    const targetText = norm(cleaned);
    if (targetText.length > 0) {
      for (const k of ['A', 'B', 'C', 'D', 'E'] as const) {
        if (opts[k] && norm(opts[k]) === targetText) {
          return k;
        }
      }
    }

    return null;
  };

  // Tokenizer CSV/TSV yang mendukung tanda kutip multiline dan deteksi pemisah otomatis
  const tokenizeCsvToRows = (rawContent: string): string[][] => {
    const content = rawContent.replace(/^\uFEFF/, '');
    if (!content.trim()) return [];

    // Deteksi delimiter terbaik (; vs \t vs ,) dari beberapa baris pertama
    const sampleLines = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(0, 10);

    const countDelimiterOutsideQuotes = (line: string, delim: string) => {
      let inQuotes = false;
      let count = 0;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === delim && !inQuotes) {
          count++;
        }
      }
      return count;
    };

    const scoreDelim = (delim: string) => {
      const counts = sampleLines.map((l) => countDelimiterOutsideQuotes(l, delim));
      const validLines = counts.filter((c) => c >= 5).length;
      const total = counts.reduce((a, b) => a + b, 0);
      return { validLines, total };
    };

    const semiScore = scoreDelim(';');
    const tabScore = scoreDelim('\t');
    const commaScore = scoreDelim(',');

    let delimiter = ';';
    if (tabScore.validLines > semiScore.validLines && tabScore.validLines >= commaScore.validLines) {
      delimiter = '\t';
    } else if (commaScore.validLines > semiScore.validLines) {
      delimiter = ',';
    } else if (semiScore.validLines === 0 && commaScore.total > semiScore.total) {
      delimiter = ',';
    }

    // Parse seluruh teks dengan state machine yang menghormati tanda kutip ""
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
      const ch = content[i];
      const nextCh = content[i + 1];

      if (ch === '"') {
        if (inQuotes && nextCh === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        currentRow.push(cleanCellText(currentCell));
        currentCell = '';
      } else if ((ch === '\r' || ch === '\n') && !inQuotes) {
        if (ch === '\r' && nextCh === '\n') {
          i++;
        }
        currentRow.push(cleanCellText(currentCell));
        currentCell = '';
        // Hapus kolom kosong di ujung kanan baris
        while (currentRow.length > 0 && currentRow[currentRow.length - 1] === '') {
          currentRow.pop();
        }
        if (currentRow.some((cell) => cell !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
      } else {
        currentCell += ch;
      }
    }

    if (currentCell !== '' || currentRow.length > 0) {
      currentRow.push(cleanCellText(currentCell));
      while (currentRow.length > 0 && currentRow[currentRow.length - 1] === '') {
        currentRow.pop();
      }
      if (currentRow.some((cell) => cell !== '')) {
        rows.push(currentRow);
      }
    }

    return rows;
  };

  // Download Sample CSV Template
  const handleDownloadTemplate = () => {
    const csvContent =
      '\uFEFF' +
      'Teks Soal;Pilihan A;Pilihan B;Pilihan C;Pilihan D;Pilihan E;Kunci Jawaban;Poin;Pembahasan\n' +
      'Hukum menuntut ilmu bagi setiap muslim menurut syariat Islam adalah...;Fardhu Ain;Fardhu Kifayah;Sunnah Muakkad;Mubah;Makruh;A;10;Menuntut ilmu agama yang pokok hukumnya adalah Fardhu Ain bagi setiap muslim.\n' +
      'Rukun Islam yang ketiga adalah menunaikan...;Syahadat;Shalat;Zakat;Puasa Ramadhan;Ibadah Haji;C;10;Urutan rukun Islam: 1. Syahadat, 2. Shalat, 3. Zakat, 4. Puasa, 5. Haji.\n' +
      'Najis yang cara mensucikannya cukup dengan memercikkan air pada bagian yang terkena disebut najis...;Mukhaffafah;Mutawassithah;Mughalladhah;Hukmiyah;Ainiyah;A;10;Najis mukhaffafah adalah najis ringan seperti air kencing bayi laki-laki yang belum makan selain ASI.';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'Template_Bank_Soal_CBT_Sirajul_Huda.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Pre-load demo sample text
  const handleLoadSample = () => {
    const sample = `Hukum menuntut ilmu bagi setiap muslim menurut syariat Islam adalah...;Fardhu Ain;Fardhu Kifayah;Sunnah Muakkad;Mubah;Makruh;A;10;Menuntut ilmu pokok adalah fardhu ain
Rukun Islam yang ketiga adalah menunaikan...;Syahadat;Shalat;Zakat;Puasa Ramadhan;Ibadah Haji;C;10;Zakat adalah rukun Islam ke-3
Najis yang cara mensucikannya cukup dipercikkan air adalah...;Mukhaffafah;Mutawassithah;Mughalladhah;Hukmiyah;Ainiyah;B;10;Najis mutawassithah adalah najis sedang`;
    setManualKeyCol(null);
    setRawText(sample);
    parseCsv(sample, null);
  };

  // Fungsi utama pengurai CSV dengan profil statistik kolom & deteksi kunci jawaban otomatis
  const parseCsv = (text: string, forcedKeyColIndex: number | null = manualKeyCol) => {
    setParseError(null);
    if (!text.trim()) {
      setParsedQuestions([]);
      setColumnOptions([]);
      setDetectedKeyCol(null);
      return;
    }

    const allRows = tokenizeCsvToRows(text);
    if (allRows.length === 0) {
      setParsedQuestions([]);
      return;
    }

    // 1. Cek apakah baris pertama adalah baris Header
    const firstRow = allRows[0];
    const firstRowJoined = firstRow.join(' ').toLowerCase();
    const firstColLower = (firstRow[0] || '').toLowerCase();

    const hasHeader =
      allRows.length > 1 &&
      (firstRowJoined.includes('soal') ||
        firstRowJoined.includes('pertanyaan') ||
        firstRowJoined.includes('question') ||
        firstRowJoined.includes('pilihan') ||
        firstRowJoined.includes('opsi') ||
        firstRowJoined.includes('option') ||
        firstRowJoined.includes('kunci') ||
        firstRowJoined.includes('jawaban') ||
        firstRowJoined.includes('answer') ||
        firstColLower === 'no' ||
        firstColLower === 'no.' ||
        firstColLower === 'nomor');

    const headerRow = hasHeader ? firstRow : null;
    const dataRows = hasHeader ? allRows.slice(1) : allRows;

    if (dataRows.length === 0) {
      setParseError('File hanya berisi baris judul (header) tanpa data soal.');
      setParsedQuestions([]);
      return;
    }

    // 2. Hitung jumlah kolom standar (modus panjang baris) untuk menangani baris yang memiliki koma ekstra
    const lengthCounts: Record<number, number> = {};
    let maxColCount = 0;
    for (const r of dataRows) {
      if (r.length >= 5) {
        lengthCounts[r.length] = (lengthCounts[r.length] || 0) + 1;
        if (r.length > maxColCount) maxColCount = r.length;
      }
    }
    let modalColCount = dataRows[0]?.length || 7;
    let bestFreq = 0;
    for (const [lenStr, freq] of Object.entries(lengthCounts)) {
      if (freq > bestFreq) {
        bestFreq = freq;
        modalColCount = Number(lenStr);
      }
    }

    // 3. Profil setiap kolom berdasarkan baris yang memiliki panjang normal (modalColCount)
    const normalRows = dataRows.filter((r) => r.length === modalColCount);
    const samplePool = normalRows.length > 0 ? normalRows : dataRows;

    const colInfos: ColumnOptionInfo[] = [];
    const letterKeyScore: number[] = [];
    const letterVariety: Set<string>[] = [];
    const numericKeyScore: number[] = [];
    const numericVariety: Set<string>[] = [];

    for (let c = 0; c < modalColCount; c++) {
      let lScore = 0;
      const lSet = new Set<string>();
      let nScore = 0;
      const nSet = new Set<string>();
      let allNumeric1to5 = true;

      for (const r of samplePool) {
        const val = r[c] || '';
        const lk = parseStrictKeyLetter(val, false);
        if (lk) {
          lScore++;
          lSet.add(lk);
        }
        const nk = parseStrictKeyLetter(val, true);
        if (nk && /^[1-5]$/.test(cleanCellText(val))) {
          nScore++;
          nSet.add(nk);
        } else if (cleanCellText(val) !== '') {
          allNumeric1to5 = false;
        }
      }

      letterKeyScore[c] = lScore;
      letterVariety[c] = lSet;
      numericKeyScore[c] = allNumeric1to5 ? nScore : 0;
      numericVariety[c] = nSet;

      const samples = samplePool
        .slice(0, 4)
        .map((r) => r[c] || '-')
        .join(', ');
      const headerLabel = headerRow && headerRow[c] ? `"${headerRow[c]}"` : `Kolom ${c + 1}`;
      colInfos.push({
        index: c,
        label: `Kolom ${c + 1}${headerRow && headerRow[c] ? ` (${headerRow[c]})` : ''}`,
        sampleValues: samples.length > 38 ? samples.substring(0, 38) + '...' : samples,
        validKeyCount: lScore,
      });
    }

    setColumnOptions(colInfos);

    // 4. Tentukan posisi Kolom Pertanyaan (questionCol)
    let questionCol = -1;
    if (headerRow) {
      questionCol = headerRow.findIndex((h) => {
        const hl = h.toLowerCase();
        return (
          hl === 'soal' ||
          hl === 'teks soal' ||
          hl === 'pertanyaan' ||
          hl === 'butir soal' ||
          hl === 'question' ||
          hl === 'question_text' ||
          hl.includes('teks soal') ||
          hl.includes('pertanyaan')
        );
      });
    }

    if (questionCol === -1) {
      // Cek apakah kolom ke-0 adalah nomor urut (1, 2, 3...)
      const col0IsNumber =
        (headerRow && /^(no|no\.|nomor|id|urut)$/i.test(headerRow[0] || '')) ||
        samplePool.filter((r) => /^\(?[0-9]+[\.\)]?$/.test(r[0] || '')).length >=
          Math.ceil(samplePool.length * 0.6);

      questionCol = col0IsNumber ? 1 : 0;
    }

    // 5. Tentukan posisi Kolom Kunci Jawaban (keyCol)
    let autoKeyCol = -1;

    // Cek dari nama Header terlebih dahulu
    if (headerRow) {
      const hKeyIdx = headerRow.findIndex((h, idx) => {
        if (idx <= questionCol + 2) return false;
        const hl = h.toLowerCase().trim();
        return (
          hl === 'kunci' ||
          hl === 'kunci jawaban' ||
          hl === 'kunci_jawaban' ||
          hl === 'jawaban' ||
          hl === 'jawaban benar' ||
          hl === 'jawaban_benar' ||
          hl === 'correct_answer' ||
          hl === 'correct answer' ||
          hl === 'answer' ||
          hl === 'key' ||
          hl.includes('kunci')
        );
      });
      if (hKeyIdx !== -1) {
        autoKeyCol = hKeyIdx;
      }
    }

    // Cari kolom dengan skor huruf kunci A-E tertinggi setelah kolom opsi (c >= questionCol + 4)
    let bestStatisticalCol = -1;
    let bestStatisticalScore = -1;
    for (let c = Math.max(3, questionCol + 4); c < modalColCount; c++) {
      const score = letterKeyScore[c] || 0;
      const variety = letterVariety[c]?.size || 0;
      // Prioritaskan kolom yang mayoritas barisnya adalah A-E dan punya variasi kunci (bukan hanya 1 huruf jika memungkinkan)
      const weightedScore = score * 10 + (variety >= 2 ? 25 : 0);
      if (score >= Math.ceil(samplePool.length * 0.4) && weightedScore > bestStatisticalScore) {
        bestStatisticalScore = weightedScore;
        bestStatisticalCol = c;
      }
    }

    // Jika kolom dari header tidak berisi huruf A-E sama sekali tetapi ada kolom statistik yang valid, gunakan kolom statistik!
    if (bestStatisticalCol !== -1) {
      if (
        autoKeyCol === -1 ||
        (letterKeyScore[autoKeyCol] || 0) < (letterKeyScore[bestStatisticalCol] || 0)
      ) {
        autoKeyCol = bestStatisticalCol;
      }
    }

    // Jika masih belum ketemu, cek apakah ada kolom angka 1-5 (1=A..5=E)
    let useNumericKey = false;
    if (autoKeyCol === -1) {
      for (let c = Math.max(3, questionCol + 4); c < modalColCount; c++) {
        if (
          numericKeyScore[c] >= Math.ceil(samplePool.length * 0.7) &&
          (numericVariety[c]?.size || 0) >= 2
        ) {
          autoKeyCol = c;
          useNumericKey = true;
          break;
        }
      }
    }

    // Fallback ke posisi standar setelah Opsi E (questionCol + 6) atau Opsi D (questionCol + 5)
    if (autoKeyCol === -1) {
      autoKeyCol =
        modalColCount >= questionCol + 7
          ? questionCol + 6
          : Math.min(modalColCount - 1, questionCol + 5);
    }

    setDetectedKeyCol(autoKeyCol);
    const activeKeyCol = forcedKeyColIndex !== null ? forcedKeyColIndex : autoKeyCol;

    // 6. Tentukan apakah terdapat 4 opsi (A-D) atau 5 opsi (A-E)
    const hasOnlyFourOptions = activeKeyCol === questionCol + 5;

    // 7. Ekstrak setiap baris soal
    const results: Partial<Question>[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (row.length < 5) continue;

      // Hitung pergeseran (delta) jika baris ini memiliki koma ekstra yang tidak dikutip di dalam teks soal
      const extraCols = Math.max(0, row.length - modalColCount);

      // Cek apakah dengan menggeser sebesar extraCols kita mendapatkan kunci jawaban yang valid
      let rowShift = 0;
      if (extraCols > 0 && activeKeyCol + extraCols < row.length) {
        const keyWithoutShift = parseStrictKeyLetter(row[activeKeyCol] || '', useNumericKey);
        const keyWithShift = parseStrictKeyLetter(
          row[activeKeyCol + extraCols] || '',
          useNumericKey
        );
        if (!keyWithoutShift && keyWithShift) {
          rowShift = extraCols;
        }
      }

      // Gabungkan kembali teks soal jika terpecah oleh koma ekstra
      const questionText =
        rowShift > 0
          ? row.slice(questionCol, questionCol + 1 + rowShift).join(', ')
          : row[questionCol] || '';

      const optStart = questionCol + 1 + rowShift;
      let optionA = row[optStart] || '';
      let optionB = row[optStart + 1] || '';
      let optionC = row[optStart + 2] || '';
      let optionD = row[optStart + 3] || '';
      let optionE = hasOnlyFourOptions ? '-' : row[optStart + 4] || '';

      // Cek jika ada tanda bintang '*' penanda jawaban benar pada teks opsi (misal: "*Fardhu Ain")
      let starredKey: 'A' | 'B' | 'C' | 'D' | 'E' | null = null;
      const checkAndStripStar = (
        text: string,
        letter: 'A' | 'B' | 'C' | 'D' | 'E'
      ): string => {
        const t = text.trim();
        if (t.startsWith('*') && t.length > 1) {
          starredKey = letter;
          return t.substring(1).trim();
        }
        if (t.endsWith('*') && t.length > 1) {
          starredKey = letter;
          return t.substring(0, t.length - 1).trim();
        }
        return t;
      };

      optionA = checkAndStripStar(optionA, 'A');
      optionB = checkAndStripStar(optionB, 'B');
      optionC = checkAndStripStar(optionC, 'C');
      optionD = checkAndStripStar(optionD, 'D');
      if (!hasOnlyFourOptions) {
        optionE = checkAndStripStar(optionE, 'E');
      }

      // Bersihkan awalan "A. ", "B. " pada teks opsi jika sudah ada di CSV agar tidak dobel "A. A. ..."
      const stripOptionPrefix = (txt: string, letter: string) =>
        txt.replace(new RegExp(`^[\\(\\[]?${letter}[\\.\\)\\]\\-]\\s+`, 'i'), '').trim();

      optionA = stripOptionPrefix(optionA, 'A');
      optionB = stripOptionPrefix(optionB, 'B');
      optionC = stripOptionPrefix(optionC, 'C');
      optionD = stripOptionPrefix(optionD, 'D');
      if (!hasOnlyFourOptions && optionE !== '-') {
        optionE = stripOptionPrefix(optionE, 'E');
      }

      const optionsObj = {
        A: optionA,
        B: optionB,
        C: optionC,
        D: optionD,
        E: optionE,
      };

      const targetKeyCell = row[activeKeyCol + rowShift] || '';
      let detectedKey = extractAnswerKey(
        targetKeyCell,
        optionsObj,
        useNumericKey || forcedKeyColIndex !== null
      );

      // Jika di kolom utama tidak ditemukan kunci yang valid, pindai seluruh kolom setelah opsi (dari kanan ke kiri)
      if (!detectedKey && forcedKeyColIndex === null) {
        const minKeySearchIdx = hasOnlyFourOptions ? optStart + 4 : optStart + 5;
        for (let scanIdx = row.length - 1; scanIdx >= minKeySearchIdx; scanIdx--) {
          const candidate = extractAnswerKey(row[scanIdx] || '', optionsObj, false);
          if (candidate) {
            detectedKey = candidate;
            break;
          }
        }
      }

      if (!detectedKey && starredKey) {
        detectedKey = starredKey;
      }

      const finalKey: 'A' | 'B' | 'C' | 'D' | 'E' = detectedKey || 'A';

      // Cari poin dan pembahasan pada kolom setelah opsi & kunci
      const afterOptionsStart = hasOnlyFourOptions ? optStart + 4 : optStart + 5;
      let points = 10;
      let explanation = '';

      for (let extraIdx = afterOptionsStart; extraIdx < row.length; extraIdx++) {
        if (extraIdx === activeKeyCol + rowShift) continue;
        const cellVal = row[extraIdx] || '';
        if (!cellVal) continue;
        if (/^[0-9]+(\.[0-9]+)?$/.test(cellVal) && Number(cellVal) > 0 && Number(cellVal) <= 100) {
          points = Number(cellVal);
        } else if (!parseStrictKeyLetter(cellVal, false) && cellVal.length > 2) {
          explanation = cellVal;
        }
      }

      if (questionText && optionA && optionB) {
        results.push({
          subjectId: selectedSubjectId,
          classId: selectedClassId,
          questionText,
          optionA,
          optionB,
          optionC,
          optionD,
          optionE,
          correctAnswer: finalKey,
          points,
          explanation,
        });
      }
    }

    if (results.length === 0) {
      setParseError(
        'Format baris tidak sesuai. Pastikan file CSV memiliki kolom Teks Soal, Pilihan A-E (atau A-D), dan Kunci Jawaban.'
      );
    }

    setParsedQuestions(results);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setManualKeyCol(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = String(event.target?.result || '');
      setRawText(content);
      parseCsv(content, null);
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleImport = async () => {
    if (parsedQuestions.length === 0) {
      setParseError('Tidak ada soal valid untuk diimpor.');
      return;
    }

    const effectiveSubjectId =
      selectedSubjectId && subjects.some((s) => s.id === selectedSubjectId)
        ? selectedSubjectId
        : defaultSubjectId && subjects.some((s) => s.id === defaultSubjectId)
        ? defaultSubjectId
        : subjects[0]?.id || selectedSubjectId;

    if (!effectiveSubjectId) {
      setParseError('Pilih atau tambahkan Mata Pelajaran tujuan terlebih dahulu.');
      return;
    }

    setIsSubmitting(true);
    try {
      const formatted = parsedQuestions.map((q) => ({
        ...q,
        subjectId: effectiveSubjectId,
        classId: selectedClassId,
      }));

      // Jika replaceExisting dicentang dan ada soal yatim di 'SUBJ-FIQ-10' (saat SUBJ-FIQ-10 sudah tidak ada di daftar mapel), bersihkan juga
      if (
        replaceExisting &&
        effectiveSubjectId !== 'SUBJ-FIQ-10' &&
        !subjects.some((s) => s.id === 'SUBJ-FIQ-10')
      ) {
        await apiService.deleteQuestionsBySubject('SUBJ-FIQ-10');
      }

      const res = await apiService.batchSaveQuestions(formatted, {
        replaceExisting,
        subjectId: effectiveSubjectId,
      });
      if (res.success) {
        onSuccess(formatted.length, effectiveSubjectId);
        onClose();
      } else {
        setParseError(res.error || 'Gagal menyimpan soal.');
      }
    } catch {
      setParseError('Terjadi kesalahan saat mengunggah soal.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Hitung distribusi kunci jawaban A, B, C, D, E dari hasil penguraian
  const keyCounts: Record<'A' | 'B' | 'C' | 'D' | 'E', number> = {
    A: 0,
    B: 0,
    C: 0,
    D: 0,
    E: 0,
  };
  parsedQuestions.forEach((q) => {
    const k = (q.correctAnswer || 'A') as 'A' | 'B' | 'C' | 'D' | 'E';
    if (keyCounts[k] !== undefined) keyCounts[k]++;
  });

  const allKeysAreA = parsedQuestions.length > 3 && keyCounts.A === parsedQuestions.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 my-8 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-100">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base leading-tight">
                Impor & Unggah Bank Soal Massal
              </h3>
              <p className="text-xs text-slate-500">
                Deteksi otomatis kolom Kunci Jawaban (A–E) dari file CSV / Excel Anda
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto space-y-4 flex-1 pr-1">
          {/* Target Metadata Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tujuan Mata Pelajaran
              </label>
              <select
                value={selectedSubjectId}
                onChange={(e) => {
                  setSelectedSubjectId(e.target.value);
                  setParsedQuestions((prev) =>
                    prev.map((q) => ({ ...q, subjectId: e.target.value }))
                  );
                }}
                className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Target Kelas (Opsional)
              </label>
              <select
                value={selectedClassId}
                onChange={(e) => {
                  setSelectedClassId(e.target.value);
                  setParsedQuestions((prev) =>
                    prev.map((q) => ({ ...q, classId: e.target.value }))
                  );
                }}
                className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                <option value="">Semua Kelas</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Checkbox Ganti Soal Lama */}
            <div className="sm:col-span-2 pt-1 border-t border-slate-200/80">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                />
                <div className="text-xs">
                  <span className="font-bold text-slate-800">
                    Hapus & ganti soal lama pada mata pelajaran ini saat mengimpor
                  </span>
                  <p className="text-[11px] text-slate-500">
                    Direkomendasikan agar soal yang pernah diunggah sebelumnya (yang kuncinya salah/semua A) otomatis digantikan dengan data CSV terbaru ini.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Quick Helpers & Template Downloads */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-emerald-700" />
                <span>Unduh Template CSV</span>
              </button>

              <button
                type="button"
                onClick={handleLoadSample}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-200 transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span>Muat Contoh Data</span>
              </button>
            </div>

            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-[11px] font-semibold text-slate-600">
              <button
                type="button"
                onClick={() => setUploadTab('file')}
                className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                  uploadTab === 'file' ? 'bg-white text-slate-900 shadow-xs' : 'hover:text-slate-900'
                }`}
              >
                Unggah File CSV
              </button>
              <button
                type="button"
                onClick={() => setUploadTab('paste')}
                className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                  uploadTab === 'paste' ? 'bg-white text-slate-900 shadow-xs' : 'hover:text-slate-900'
                }`}
              >
                Tempel Teks
              </button>
            </div>
          </div>

          {/* Input Method: File Upload or Paste */}
          {uploadTab === 'file' ? (
            <div className="p-5 border-2 border-dashed border-slate-200 rounded-xl text-center space-y-2 hover:border-emerald-400 transition-colors bg-slate-50/50">
              <FileSpreadsheet className="w-8 h-8 text-emerald-600 mx-auto" />
              <div>
                <label className="cursor-pointer text-xs font-bold text-emerald-700 hover:text-emerald-800 underline">
                  <span>Pilih File CSV / Excel (.csv, .txt)</span>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
                <p className="text-[11px] text-slate-500 mt-1">
                  {fileName
                    ? `File aktif: ${fileName}`
                    : 'Mendukung pemisah titik koma (;), koma (,), maupun tab dari Excel'}
                </p>
              </div>
            </div>
          ) : (
            <div>
              <textarea
                rows={5}
                value={rawText}
                onChange={(e) => {
                  setRawText(e.target.value);
                  parseCsv(e.target.value, manualKeyCol);
                }}
                placeholder="Format: Teks Soal;Pilihan A;Pilihan B;Pilihan C;Pilihan D;Pilihan E;Kunci(A-E);Poin;Pembahasan"
                className="w-full text-xs px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          )}

          {parseError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Panel Diagnostik Kunci Jawaban & Pemilihan Kolom CSV */}
          {parsedQuestions.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div
                className={`p-3.5 rounded-xl border space-y-2.5 ${
                  allKeysAreA
                    ? 'bg-amber-50/90 border-amber-300 text-amber-950'
                    : 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <KeyRound
                      className={`w-4 h-4 shrink-0 ${
                        allKeysAreA ? 'text-amber-700' : 'text-emerald-700'
                      }`}
                    />
                    <span className="text-xs font-bold">
                      Sebaran Kunci Jawaban Terbaca ({parsedQuestions.length} Soal):
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                    {(['A', 'B', 'C', 'D', 'E'] as const).map((letter) => (
                      <span
                        key={letter}
                        className={`px-2 py-0.5 rounded-md border ${
                          keyCounts[letter] > 0
                            ? 'bg-white border-emerald-300 text-emerald-800 shadow-2xs'
                            : 'bg-slate-100/80 border-slate-200 text-slate-400'
                        }`}
                      >
                        Kunci {letter}: {keyCounts[letter]} soal
                      </span>
                    ))}
                  </div>
                </div>

                {columnOptions.length > 0 && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-emerald-200/60 text-xs">
                    <label className="font-semibold text-slate-700 shrink-0">
                      Kolom Kunci Jawaban pada CSV:
                    </label>
                    <select
                      value={manualKeyCol !== null ? manualKeyCol : detectedKeyCol ?? ''}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setManualKeyCol(val);
                        parseCsv(rawText, val);
                      }}
                      className="w-full sm:w-auto max-w-md text-xs px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-medium text-slate-800"
                    >
                      {columnOptions.map((col) => (
                        <option key={col.index} value={col.index}>
                          {col.label} — Isi: [{col.sampleValues}]
                          {col.index === detectedKeyCol ? ' (Otomatis Terdeteksi)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {allKeysAreA && (
                  <p className="text-[11px] text-amber-800 font-medium">
                    ⚠️ Perhatian: Semua soal terbaca memiliki kunci &quot;A&quot;. Jika di file CSV Anda kunci jawabannya bukan semua A, silakan pilih kolom yang berisi huruf kunci jawaban pada dropdown <strong>&quot;Kolom Kunci Jawaban pada CSV&quot;</strong> di atas.
                  </p>
                )}
              </div>

              {/* Parsed Preview Table */}
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Pratinjau Soal & Kunci Jawaban ({parsedQuestions.length} Soal)</span>
                </span>
                <span className="text-[11px] text-slate-500">
                  Target: {subjects.find((s) => s.id === selectedSubjectId)?.name}
                </span>
              </div>

              <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs">
                {parsedQuestions.map((q, idx) => (
                  <div key={idx} className="p-3 bg-white space-y-1.5 hover:bg-slate-50">
                    <div className="flex items-center justify-between gap-2 font-semibold text-slate-900">
                      <span className="truncate flex-1">
                        {idx + 1}. {q.questionText}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[11px] font-semibold text-emerald-800">Kunci:</span>
                        <select
                          value={q.correctAnswer || 'A'}
                          onChange={(e) => {
                            const newKey = e.target.value as 'A' | 'B' | 'C' | 'D' | 'E';
                            setParsedQuestions((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, correctAnswer: newKey } : item
                              )
                            );
                          }}
                          className="font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300 text-[11px] cursor-pointer focus:outline-none"
                        >
                          {(['A', 'B', 'C', 'D', 'E'] as const).map((k) => (
                            <option key={k} value={k}>
                              Pilihan {k}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[11px]">
                      {(['A', 'B', 'C', 'D', 'E'] as const).map((letter) => {
                        const optKey = `option${letter}` as keyof Question;
                        const isKey = q.correctAnswer === letter;
                        return (
                          <span
                            key={letter}
                            onClick={() => {
                              setParsedQuestions((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, correctAnswer: letter } : item
                                )
                              );
                            }}
                            title={`Klik untuk menjadikan Pilihan ${letter} sebagai kunci jawaban`}
                            className={`truncate px-1.5 py-0.5 rounded border cursor-pointer transition-colors ${
                              isKey
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-900 font-bold'
                                : 'bg-slate-50/70 border-transparent text-slate-500 hover:bg-slate-100'
                            }`}
                          >
                            {letter}. {String(q[optKey] || '-')}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={isSubmitting || parsedQuestions.length === 0}
            className="px-5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 rounded-xl transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Menyimpan...</span>
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5" />
                <span>
                  {replaceExisting
                    ? `Ganti & Simpan ${parsedQuestions.length} Soal ke Bank`
                    : `Tambahkan ${parsedQuestions.length} Soal ke Bank`}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
