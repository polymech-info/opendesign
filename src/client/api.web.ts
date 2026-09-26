import { installOpfsFetch, opfsApi } from "./opfs/store";

installOpfsFetch();

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  return opfsApi<T>(method, path, body);
}
