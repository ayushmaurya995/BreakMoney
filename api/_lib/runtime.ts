import type { Request, Response } from 'express';

export class HttpsError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'HttpsError'; }
}
export function defineSecret(name: string) { return { value: () => process.env[name] ?? '' }; }
export function setGlobalOptions(_options: unknown) {}
export function onCall(optionsOrHandler: any, maybeHandler?: any) {
  const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler;
  return async (request: any) => handler(request);
}
export function onRequest(optionsOrHandler: any, maybeHandler?: any) {
  const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler;
  return async (request: Request & { rawBody?: Buffer }, response: Response) => handler(request, response);
}
