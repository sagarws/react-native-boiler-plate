export class ApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;

  constructor(message: string, params: { status: number; url: string; body?: unknown }) {
    super(message);
    this.name = 'ApiError';
    this.status = params.status;
    this.url = params.url;
    this.body = params.body;
  }
}

export class NetworkError extends Error {
  readonly url: string;

  constructor(message: string, url: string) {
    super(message);
    this.name = 'NetworkError';
    this.url = url;
  }
}

export class TimeoutError extends Error {
  readonly url: string;

  constructor(url: string) {
    super(`Request timed out: ${url}`);
    this.name = 'TimeoutError';
    this.url = url;
  }
}
