import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, Plugin} from 'vite';

interface SharedDbState {
  config?: Record<string, any>;
  users?: any[];
  classes?: any[];
  subjects?: any[];
  questions?: any[];
  exams?: any[];
  sessions?: any[];
  logs?: any[];
  deletedIds?: Record<string, boolean>;
  updatedAt?: string;
}

function cbtSharedBackendPlugin(): Plugin {
  const dbFilePath = path.resolve(import.meta.dirname, '.cbt-shared-db.json');

  const readState = (): SharedDbState => {
    try {
      if (fs.existsSync(dbFilePath)) {
        const raw = fs.readFileSync(dbFilePath, 'utf-8');
        return JSON.parse(raw) || {};
      }
    } catch {
      // ignore read errors
    }
    return {};
  };

  const writeState = (state: SharedDbState) => {
    try {
      fs.writeFileSync(dbFilePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch {
      // ignore write errors
    }
  };

  const mergeById = (existing: any[] = [], incoming: any[] = [], deleted: Record<string, boolean> = {}, keyField = 'id') => {
    const map = new Map<string, any>();
    const isItemDeleted = (item: any) => {
      const k = String(item?.[keyField] || '');
      if (!k || deleted[k]) return true;
      if (item?.subjectId && deleted[String(item.subjectId)]) return true;
      if (item?.subjectId && deleted[`subj_q:${String(item.subjectId)}`] && item?.questionText !== undefined) return true;
      return false;
    };
    for (const item of existing) {
      if (!isItemDeleted(item)) {
        map.set(String(item[keyField]), item);
      }
    }
    for (const item of incoming) {
      if (!isItemDeleted(item)) {
        const k = String(item[keyField]);
        const prev = map.get(k);
        map.set(k, prev ? { ...prev, ...item } : item);
      }
    }
    return Array.from(map.values());
  };

  const resolveMergedRole = (u: any): 'admin' | 'guru' | 'siswa' => {
    const idStr = String(u?.id || '').trim().toUpperCase();
    const unameStr = String(u?.username || '').trim().toLowerCase();
    const classIdStr = String(u?.classId || '').trim();
    const rawRole = String(u?.role || '').trim().toLowerCase();

    if (
      idStr.startsWith('USR-ADMIN') ||
      unameStr === 'admin_sirajulhuda' ||
      rawRole === 'admin' ||
      rawRole === 'administrator' ||
      rawRole === 'proktor'
    ) {
      return 'admin';
    }
    if (
      idStr.startsWith('USR-SISWA') ||
      unameStr.startsWith('siswa_') ||
      classIdStr !== '' ||
      (/^\d{4,14}$/.test(unameStr) && !unameStr.startsWith('19') && !unameStr.startsWith('20'))
    ) {
      return 'siswa';
    }
    if (rawRole === 'guru' || rawRole === 'teacher' || rawRole === 'pengawas' || rawRole === 'staff') {
      return 'guru';
    }
    return 'siswa';
  };

  const mergeUsers = (existing: any[] = [], incoming: any[] = [], deleted: Record<string, boolean> = {}) => {
    const byId = new Map<string, any>();
    const usernameToId = new Map<string, string>();

    const normUser = (u: string) => String(u || '').trim().toLowerCase();
    const stripZero = (u: string) => {
      const t = normUser(u);
      return /^0+\d+$/.test(t) ? t.replace(/^0+/, '') : t;
    };
    const isDeletedUser = (u: any) => {
      if (!u || !u.id) return true;
      if (deleted[String(u.id)]) return true;
      const nu = normUser(u.username);
      const sz = stripZero(u.username);
      if (nu && (deleted[`uname:${nu}`] || deleted[`USR-SISWA-${nu}`] || deleted[`USR-GURU-${nu}`])) return true;
      if (sz && deleted[`uname:${sz}`]) return true;
      return false;
    };

    for (const u of existing) {
      if (isDeletedUser(u)) continue;
      const sanitized = { ...u, role: resolveMergedRole(u) };
      byId.set(String(sanitized.id), sanitized);
      if (sanitized.username) usernameToId.set(normUser(sanitized.username), String(sanitized.id));
    }

    for (const u of incoming) {
      if (isDeletedUser(u)) continue;
      const uKey = normUser(u.username);
      const existingIdByUsername = uKey ? usernameToId.get(uKey) : undefined;
      const targetId = existingIdByUsername || String(u.id);
      if (deleted[targetId]) continue;
      const prev = byId.get(targetId);
      const rawMerged = prev
        ? {
            ...prev,
            ...u,
            id: targetId,
            classId: u.classId || prev.classId || '',
            passwordHash: u.passwordHash || prev.passwordHash,
            salt: u.salt || prev.salt,
          }
        : { ...u, id: targetId };
      const finalRole = resolveMergedRole(rawMerged);
      const cleanId =
        finalRole === 'siswa' && String(rawMerged.id).toUpperCase().startsWith('USR-GURU')
          ? `USR-SISWA-${String(rawMerged.username || '').trim()}`
          : String(rawMerged.id);
      if (deleted[cleanId]) continue;
      const merged = { ...rawMerged, id: cleanId, role: finalRole };
      if (cleanId !== targetId) {
        byId.delete(targetId);
      }
      byId.set(cleanId, merged);
      if (uKey) usernameToId.set(uKey, cleanId);
    }

    return Array.from(byId.values());
  };

  const readJsonBody = (req: any): Promise<any> =>
    new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk: any) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          resolve({});
        }
      });
      req.on('error', () => resolve({}));
    });

  const attachMiddlewares = (middlewares: any) => {
    middlewares.use('/api/shared-state', async (req: any, res: any, next: any) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

      if (req.method === 'GET') {
        const state = readState();
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, state }));
        return;
      }

      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        const current = readState();
        const deletedIds: Record<string, boolean> = {
          ...(current.deletedIds || {}),
          ...(body.deletedIds || {}),
        };
        if (Array.isArray(body.unmarkDeletedIds)) {
          for (const k of body.unmarkDeletedIds) {
            delete deletedIds[String(k)];
          }
        }

        const currentConfig = current.config || {};
        const incomingConfig = body.config || {};
        const mergedConfig = {
          ...currentConfig,
          ...incomingConfig,
          // Preserve non-empty gasWebAppUrl across devices unless explicitly cleared
          gasWebAppUrl:
            body.clearGas === true
              ? ''
              : incomingConfig.gasWebAppUrl?.trim() || currentConfig.gasWebAppUrl?.trim() || '',
          useLiveGas:
            body.clearGas === true
              ? false
              : Boolean(
                  (incomingConfig.gasWebAppUrl?.trim() && incomingConfig.useLiveGas !== false) ||
                    (currentConfig.gasWebAppUrl?.trim() && currentConfig.useLiveGas)
                ),
        };

        const nextState: SharedDbState = {
          config: mergedConfig,
          users: mergeUsers(current.users, body.users, deletedIds),
          classes: mergeById(current.classes, body.classes, deletedIds, 'id'),
          subjects: mergeById(current.subjects, body.subjects, deletedIds, 'id'),
          questions: mergeById(current.questions, body.questions, deletedIds, 'id'),
          exams: mergeById(current.exams, body.exams, deletedIds, 'id'),
          sessions: mergeById(current.sessions, body.sessions, deletedIds, 'id'),
          logs: mergeById(current.logs, body.logs, deletedIds, 'id').slice(-200),
          deletedIds,
          updatedAt: new Date().toISOString(),
        };

        writeState(nextState);
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, state: nextState }));
        return;
      }

      next();
    });

    middlewares.use('/api/gas-proxy', async (req: any, res: any, next: any) => {
      if (req.method !== 'POST') {
        next();
        return;
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      const body = await readJsonBody(req);
      const targetUrl = String(body.url || '').trim();
      const method = String(body.method || 'POST').toUpperCase();
      const payload = body.payload;

      if (!targetUrl || !targetUrl.startsWith('https://script.google.com/')) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: 'URL Google Apps Script tidak valid.' }));
        return;
      }

      try {
        const response = await fetch(targetUrl, {
          method,
          redirect: 'follow',
          headers:
            method === 'POST'
              ? { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json' }
              : { Accept: 'application/json' },
          body: method === 'POST' ? JSON.stringify(payload || {}) : undefined,
        });
        const text = await response.text();
        try {
          const json = JSON.parse(text);
          res.statusCode = 200;
          res.end(JSON.stringify(json));
        } catch {
          res.statusCode = 200;
          res.end(JSON.stringify({ success: false, error: 'Respons GAS bukan JSON yang valid.', raw: text.slice(0, 300) }));
        }
      } catch (err: any) {
        res.statusCode = 200;
        res.end(JSON.stringify({ success: false, error: err?.message || 'Gagal menghubungi server Google Apps Script.' }));
      }
    });
  };

  return {
    name: 'cbt-shared-backend',
    configureServer(server) {
      attachMiddlewares(server.middlewares);
    },
    configurePreviewServer(server) {
      attachMiddlewares(server.middlewares);
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), cbtSharedBackendPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
