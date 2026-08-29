declare namespace JSX {
  interface IntrinsicElements { [elemName: string]: any }
}

declare namespace React {
  type ReactNode = unknown;
}

declare module "react" {
  export type SetStateAction<S> = S | ((prevState: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export interface ChangeEvent<T = Element> { target: T; currentTarget: T; }
  export interface FormEvent<T = Element> { preventDefault(): void; currentTarget: T; target: EventTarget; }
  export function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly unknown[]): T;
}

declare module "react/jsx-runtime" {
  export const Fragment: unknown;
  export function jsx(type: unknown, props: unknown, key?: unknown): unknown;
  export function jsxs(type: unknown, props: unknown, key?: unknown): unknown;
}

declare module "next" {
  export interface Metadata { [key: string]: unknown }
  export interface NextConfig { [key: string]: unknown }
}

declare module "next/server" {
  export class NextResponse extends Response {
    constructor(body?: BodyInit | null, init?: ResponseInit);
    static json<T>(body: T, init?: ResponseInit): NextResponse;
  }
  export class NextRequest extends Request {
    nextUrl: URL;
  }
}

declare const Buffer: { byteLength(value: string | ArrayBuffer | ArrayBufferView): number };
declare const process: { env: Record<string, string | undefined>; cwd(): string };

declare module "node:crypto" {
  export function randomBytes(size: number): { toString(encoding: string): string };
  export function createHash(algorithm: string): { update(value: string | ArrayBuffer | ArrayBufferView): any; digest(encoding: string): string };
}
declare module "node:fs/promises" {
  export function readFile(path: string | URL, options?: unknown): Promise<any>;
  export function readdir(path: string | URL): Promise<string[]>;
}
declare module "node:zlib" {
  export function gunzipSync(value: any): { toString(encoding?: string): string };
}
declare module "node:path" {
  const value: { join(...parts: string[]): string };
  export default value;
}
