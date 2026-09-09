'use client';

import { useEffect, useRef } from 'react';
import { readBrowserConnection } from '../lib/browser-connection';

type ClaimedJob = {
  id: string;
  document_id: string;
  expected_revision: number | null;
  command: Record<string, unknown>;
  revision: number;
  project: Record<string, unknown>;
};

type StudioApi = {
  handle: (command: Record<string, unknown>) => Promise<any>;
  run: (command: Record<string, unknown>) => Promise<any>;
  snapshot: () => any;
  loadSnapshot: (snapshot: any) => void;
  getSummary?: () => any;
  detectLibrary?: () => Promise<boolean>;
  cancel?: () => void;
};

declare global {
  interface Window {
    CorvoLibrary?: any;
    CorvoQuizStudio?: StudioApi;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function LocalQuizRendererClient() {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const busy = useRef(false);
  const stopped = useRef(false);
  const owner = useRef(`local:${crypto.randomUUID()}`);
  const currentJob = useRef<ClaimedJob | null>(null);

  async function request(path: string, body: any, media = false): Promise<any> {
    const connection = readBrowserConnection();
    if (!connection) throw Error('BROWSER_CONNECTION_MISSING');
    if (media) {
      const upload = await request('rpc', { op: 'upload-start', payload: { mime: body.type || 'application/octet-stream', size: body.size } });
      const parts: Array<{ partNumber: number; etag: string }> = [];
      try {
        for (let offset = 0; offset < body.size; offset += 8 * 1024 * 1024) {
          const part = parts.length + 1;
          const response = await fetch(connection.coreUrl.replace(/\/$/, '') + '/quiz/upload/' + upload.id + '/' + part, {
            method: 'PUT',
            headers: { 'x-corvo-app-key': connection.appKey, 'content-type': 'application/octet-stream' },
            body: body.slice(offset, offset + 8 * 1024 * 1024),
          });
          const value = await response.json();
          if (!response.ok || value.ok === false) throw Error(value.error || 'MEDIA_UPLOAD_FAILED');
          parts.push({ partNumber: value.partNumber, etag: value.etag });
        }
        return await request('rpc', { op: 'upload-finish', payload: { id: upload.id, parts } });
      } catch (error) {
        await request('rpc', { op: 'upload-abort', payload: { id: upload.id } }).catch(() => undefined);
        throw error;
      }
    }
    const serialized = JSON.stringify(body);
    const large = serialized.length > 3_000_000;
    const response = await fetch(large ? connection.coreUrl.replace(/\/$/, '') + '/quiz/' + path : '/api/core-proxy/quiz/' + path, {
      method: 'POST',
      headers: {
        ...(large ? {} : { 'x-corvo-core-url': connection.coreUrl }),
        'x-corvo-app-key': connection.appKey,
        'content-type': 'application/json',
      },
      body: serialized,
      cache: 'no-store',
    });
    const value = await response.json();
    if (!response.ok || value.ok === false) throw Error(value.error || 'QUIZ_RPC_FAILED');
    return value;
  }

  const rpc = (op: string, payload: Record<string, unknown> = {}) => request('rpc', { op, payload });

  function installBridge() {
    const target = frame.current?.contentWindow as (Window & { CorvoLibrary?: any; CorvoQuizStudio?: StudioApi }) | null;
    if (!target) return;
    target.CorvoLibrary = {
      serverAudio: false,
      getConnection: () => {
        const connection = readBrowserConnection();
        return {
          connection_label: 'Librarynew local renderer',
          core_url: connection?.coreUrl || '',
          mcp_url: connection?.coreUrl ? connection.coreUrl.replace(/\/$/, '') + '/mcp' : '',
          push: true,
          local_renderer: true,
        };
      },
      registerQuizStudio: () => {},
      quizRequest: async (op: string, payload: any) => {
        if (op === 'asset.resolve') return rpc(op, payload || {});
        if (op === 'media.upload') return request('media', payload?.blob, true);
        if (['quiz.state.push', 'quiz.visual.publish'].includes(op)) return { ok: true };
        if (op === 'quiz.placement.read') throw Error('PLACEMENT_NOT_AVAILABLE_IN_LOCAL_RENDERER');
        throw Error('UNSUPPORTED_HOST_OPERATION:' + op);
      },
    };
  }

  async function waitForStudio(): Promise<StudioApi | null> {
    const started = Date.now();
    while (!stopped.current && Date.now() - started < 45000) {
      const target = frame.current?.contentWindow as (Window & { CorvoQuizStudio?: StudioApi }) | null;
      if (target?.CorvoQuizStudio?.snapshot) {
        installBridge();
        await target.CorvoQuizStudio.detectLibrary?.().catch(() => false);
        return target.CorvoQuizStudio;
      }
      await sleep(250);
    }
    return null;
  }

  async function runClaimedJob(job: ClaimedJob) {
    const studio = await waitForStudio();
    if (!studio) throw Error('QUIZ_EDITOR_LOAD_TIMEOUT');
    if (job.expected_revision !== null && job.expected_revision !== job.revision) {
      return await rpc('complete', { owner: owner.current, job_id: job.id, revision: job.revision, result: { ok: false, error: 'REVISION_CONFLICT', renderer: 'LOCAL_BROWSER' } });
    }
    let cancelled = false;
    let heartbeatTimer: number | undefined;
    try {
      studio.loadSnapshot(job.project);
      const heartbeat = async () => {
        const state = await rpc('heartbeat', { owner: owner.current, job_id: job.id }).catch(() => null);
        if (state?.cancel) {
          cancelled = true;
          try { studio.cancel?.(); } catch {}
        }
      };
      await heartbeat();
      heartbeatTimer = window.setInterval(() => { void heartbeat(); }, 25000);
      const result = await (studio.handle || studio.run)(job.command);
      if (!result?.ok) {
        return await rpc('complete', { owner: owner.current, job_id: job.id, revision: job.revision, result: { ...result, renderer: 'LOCAL_BROWSER' } });
      }
      const moduleUrl = '/quiz-studio/host-client.js';
      const { externalize } = await import(/* webpackIgnore: true */ moduleUrl);
      const project = await externalize(studio.snapshot(), (blob: Blob) => request('media', blob, true));
      const summary = studio.getSummary ? studio.getSummary() : undefined;
      const finalResult = cancelled ? { ok: false, error: 'CANCEL_REQUESTED', renderer: 'LOCAL_BROWSER' } : { ...result, renderer: 'LOCAL_BROWSER' };
      return await rpc('complete', { owner: owner.current, job_id: job.id, revision: job.revision, result: finalResult, project, summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return await rpc('complete', { owner: owner.current, job_id: job.id, revision: job.revision, result: { ok: false, error: message, renderer: 'LOCAL_BROWSER' } });
    } finally {
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
    }
  }

  useEffect(() => {
    let loopTimer: number | undefined;
    const loop = async () => {
      if (stopped.current) return;
      if (busy.current) {
        loopTimer = window.setTimeout(() => void loop(), 1200);
        return;
      }
      const connection = readBrowserConnection();
      if (!connection) {
        loopTimer = window.setTimeout(() => void loop(), 2500);
        return;
      }
      try {
        const target = frame.current?.contentWindow as (Window & { CorvoQuizStudio?: StudioApi }) | null;
        if (!target?.CorvoQuizStudio?.snapshot) {
          installBridge();
          loopTimer = window.setTimeout(() => void loop(), 1000);
          return;
        }
        installBridge();
        await target.CorvoQuizStudio.detectLibrary?.().catch(() => false);
        const claimed = await rpc('claim', { owner: owner.current });
        if (claimed?.job) {
          busy.current = true;
          currentJob.current = claimed.job as ClaimedJob;
          try {
            await runClaimedJob(currentJob.current);
          } finally {
            currentJob.current = null;
            busy.current = false;
          }
          loopTimer = window.setTimeout(() => void loop(), 100);
          return;
        }
      } catch {
        // Silent retry; this worker is auxiliary and must never break the UI.
      }
      loopTimer = window.setTimeout(() => void loop(), 2000);
    };
    loopTimer = window.setTimeout(() => void loop(), 1200);
    return () => {
      stopped.current = true;
      if (loopTimer) window.clearTimeout(loopTimer);
      try {
        const target = frame.current?.contentWindow as (Window & { CorvoLibrary?: any }) | null;
        if (target?.CorvoLibrary) delete target.CorvoLibrary;
      } catch {}
    };
  }, []);

  return <iframe ref={frame} title="Local Quiz Renderer" src="/quiz-studio/index.html?local_renderer=1" aria-hidden style={{ position: 'fixed', inset: 0, width: 0, height: 0, border: 0, opacity: 0, pointerEvents: 'none' }} />;
}
