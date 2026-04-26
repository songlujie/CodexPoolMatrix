/// <reference types="vite/client" />

interface DesktopApiResponse {
  ok: boolean;
  status: number;
  data: unknown;
}

interface DesktopApiRequest {
  path: string;
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
  query?: Record<string, string>;
}

interface Window {
  codexPoolDesktop?: {
    isElectron: boolean;
    request: (payload: DesktopApiRequest) => Promise<DesktopApiResponse>;
  };
}
