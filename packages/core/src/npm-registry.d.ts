declare module "npm-package-arg" {
  export interface Result {
    name?: string;
    rawSpec?: string;
    type: string;
  }

  export default function npa(spec: string): Result;
}

declare module "pacote" {
  export interface Options {
    cache?: string;
    integrity?: string;
  }

  export interface Manifest {
    name: string;
    version: string;
    _resolved: string;
    _integrity?: string;
  }

  export interface ExtractResult {
    from: string;
    resolved: string;
    integrity?: string;
  }

  export function manifest(spec: string, options?: Options): Promise<Manifest>;
  export function extract(spec: string, target: string, options?: Options): Promise<ExtractResult>;

  const pacote: {
    manifest: typeof manifest;
    extract: typeof extract;
  };

  export default pacote;
}
