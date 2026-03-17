import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const serverQueryKeys = {
  all: ["server"] as const,
  config: () => ["server", "config"] as const,
  sshHosts: () => ["server", "ssh-hosts"] as const,
};

export function serverConfigQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.config(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getConfig();
    },
    staleTime: Infinity,
  });
}

export function serverSshHostsQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.sshHosts(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.listSshHosts();
    },
    staleTime: 30_000,
  });
}
