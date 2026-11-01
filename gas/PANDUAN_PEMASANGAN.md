# PANDUAN LENGKAP PEMASANGAN & PENGUJIAN CBT MA SIRAJUL HUDA MARINDI

Aplikasi Ujian Semester Online Berbasis Web & Google Apps Script (GAS) dengan Database Google Sheets.
**Pengembang (Developer)**: Siti Aisyah

---

## 1. Persiapan Awal
1. Buka [Google Sheets](https://sheets.new) di browser Anda.
2. Beri nama spreadsheet: `Database CBT MA Sirajul Huda Marindi`.
3. Buka menu **Ekstensi (Extensions)** > **Apps Script**.
4. Ganti nama project Apps Script menjadi `CBT Backend Sirajul Huda`.

---

## 2. Pemasangan Kode Backend (Code.gs)
1. Hapus seluruh isi file default `Code.gs`.
2. Salin seluruh isi file `gas/Code.gs` dari aplikasi ini, lalu tempelkan ke editor Apps Script.
3. Klik tombol **Simpan (Ikon Disket / Ctrl + S)**.

---

## 3. Inisialisasi Database Otomatis (setupDatabase)
1. Di bilah atas editor Apps Script, pada pilihan dropdown fungsi (sebelah tombol 'Debug'), pilih fungsi:
   `handleSetup` (atau buat fungsi pembantu: `function inisialisasi() { handleSetup({}); }` lalu jalankan).
2. Klik tombol **Jalankan (Run)**.
3. Google akan meminta **Tinjau Izin (Review Permissions)**:
   - Pilih akun Google Anda.
   - Klik **Tingkat Lanjut (Advanced)** > **Buka CBT Backend Sirajul Huda (tidak aman)**.
   - Klik **Izinkan (Allow)**.
4. Periksa kembali tab spreadsheet Google Sheets Anda. Sistem akan secara otomatis membuat 9 sheet lengkap dengan header dan format warna:
   - `CONFIG`
   - `USERS` (Otomatis dibuatkan akun admin pertama)
   - `CLASSES`
   - `SUBJECTS`
   - `QUESTIONS`
   - `EXAMS`
   - `STUDENT_EXAMS`
   - `ANSWERS`
   - `LOGS`

---

## 4. Akun Default Pertama (Aman dengan Salt & SHA-256)
- **Username Admin**: `admin_sirajulhuda`
- **Kata Sandi Default**: `Admin123!`
- Kata sandi di-hash menggunakan algoritma SHA-256 dipadu garam acak unik 16-karakter (*Salt*). Tidak ada teks biasa (*plain text*) yang tersimpan di spreadsheet!

---

## 5. Deployment sebagai Web App
1. Di editor Apps Script, klik tombol biru **Terapkan (Deploy)** di pojok kanan atas > **Penerapan Baru (New deployment)**.
2. Klik ikon gerigi (Pilih jenis / Select type) > pilih **Aplikasi Web (Web app)**.
3. Isi konfigurasi berikut:
   - **Deskripsi**: `Versi 1.0 Production CBT`
   - **Jalankan sebagai (Execute as)**: `Saya (email Anda)`
   - **Yang memiliki akses (Who has access)**: `Siapa saja (Anyone)`
     *(PENTING: Harus 'Anyone' agar browser HP siswa dan laptop guru dapat mengirim jawaban tanpa login akun Google pribadi siswa)*.
4. Klik **Terapkan (Deploy)**.
5. Salin URL Aplikasi Web yang muncul, berformat:
   `https://script.google.com/macros/s/AKfycbx.../exec`
6. Masukkan URL tersebut ke aplikasi ini pada menu **Pusat Integrasi Google Apps Script** > **Hubungkan ke Google Sheets Saya**.

---

## 6. Validasi Kapasitas (< 50 Siswa Serentak)
Google Apps Script memiliki kuota eksekusi dan batasan konkurensi:
- **LockService**: Kode ini menggunakan `LockService.getScriptLock()` dengan timeout 10 detik agar tidak terjadi konflik data saat siswa mengumpulkan jawaban bersamaan.
- **Auto-Save Queue**: Sistem di sisi browser menyimpan jawaban dengan jeda aman (*debounce*) dan status visual (*Tersimpan / Menyimpan / Gagal coba ulang*).
- **Rekomendasi Ujian 50 Siswa**:
  1. Bagikan token ujian secara bertahap dalam rentang 1-2 menit (jangan 50 siswa menekan tombol 'Mulai Ujian' tepat di detik ke-0 yang sama) untuk menghindari *burst lock contention*.
  2. Gunakan durasi auto-save minimal 5-10 detik.
  3. Kunci jawaban tidak pernah dikirimkan ke HP siswa. Semua penilaian dihitung di server saat tombol submit ditekan.

---

## 7. Fitur Keamanan & Anti-Kecurangan
1. **Audio Alarm**: Suara sirine peringatan berbunyi otomatis saat siswa membuka tab lain atau meminimalisir browser.
2. **Copy-Paste Block**: Teks soal tidak dapat disalin atau diblokir.
3. **Session Recovery**: Jika browser tertutup atau baterai habis, siswa dapat membuka kembali dan melanjutkan ujian tanpa kehilangan urutan soal atau sisa waktu.
4. **Reset Sesi Ujian**: Pengawas dapat mereset status ujian siswa dari Dashboard Guru jika terjadi masalah teknis.
