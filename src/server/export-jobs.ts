import { randomUUID } from "node:crypto";

export type ExportResult = { png: Buffer; logs: string[] };

type Job = {
  resolve: (result: ExportResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  logs: string[];
  onLog?: (line: string) => void;
};

const jobs = new Map<string, Job>();

export function isExportToken(token: string) {
  return /^[a-zA-Z0-9_-]{8,80}$/.test(token);
}

export function createExportJob(timeoutMs = 90_000, onLog?: (line: string) => void) {
  const token = randomUUID();
  const promise = new Promise<ExportResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      const job = jobs.get(token);
      jobs.delete(token);
      reject(new Error("export timed out waiting for the browser"));
      void job;
    }, timeoutMs);
    jobs.set(token, { resolve, reject, timer, logs: [], onLog });
  });
  return { token, promise };
}

export function appendExportLog(token: string, line: string) {
  const job = jobs.get(token);
  if (!job) return false;
  const text = line.replace(/\s+/g, " ").trim();
  if (!text) return true;
  job.logs.push(text);
  job.onLog?.(text);
  return true;
}

export function completeExportJob(token: string, png: Buffer) {
  const job = jobs.get(token);
  if (!job) return false;
  clearTimeout(job.timer);
  jobs.delete(token);
  job.resolve({ png, logs: job.logs });
  return true;
}

export function failExportJob(token: string, err: Error) {
  const job = jobs.get(token);
  if (!job) return false;
  clearTimeout(job.timer);
  jobs.delete(token);
  job.reject(err);
  return true;
}
