import type {
  EnvironmentFileLocation,
  ProjectEnvironmentConfig,
  ProjectId,
  ProjectSearchEntriesResult,
} from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const projectQueryKeys = {
  all: ["projects"] as const,
  searchEntries: (projectId: ProjectId | null, query: string, limit: number) =>
    ["projects", "search-entries", projectId, query, limit] as const,
  environmentConfig: (projectId: ProjectId | null, fileLocation: EnvironmentFileLocation) =>
    ["projects", "environment-config", projectId, fileLocation] as const,
};

const DEFAULT_SEARCH_ENTRIES_LIMIT = 80;
const DEFAULT_SEARCH_ENTRIES_STALE_TIME = 15_000;
const EMPTY_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};
const EMPTY_ENVIRONMENT_CONFIG: ProjectEnvironmentConfig = {
  version: 1,
  defaults: {
    selectedEnvironmentId: null,
  },
  environments: [],
};

export function projectSearchEntriesQueryOptions(input: {
  projectId: ProjectId | null;
  query: string;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  return queryOptions({
    queryKey: projectQueryKeys.searchEntries(input.projectId, input.query, limit),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.projectId) {
        throw new Error("Workspace entry search is unavailable.");
      }
      return api.projects.searchEntries({
        projectId: input.projectId,
        query: input.query,
        limit,
      });
    },
    enabled: (input.enabled ?? true) && input.projectId !== null && input.query.length > 0,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
  });
}

export function projectEnvironmentConfigQueryOptions(input: {
  projectId: ProjectId | null;
  fileLocation: EnvironmentFileLocation;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.environmentConfig(input.projectId, input.fileLocation),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.projectId) {
        throw new Error("Environment configuration is unavailable.");
      }
      const result = await api.projects.readEnvironmentConfig({
        projectId: input.projectId,
        fileLocation: input.fileLocation,
      });
      return result.config ?? EMPTY_ENVIRONMENT_CONFIG;
    },
    enabled: (input.enabled ?? true) && input.projectId !== null,
    staleTime: 5_000,
  });
}
