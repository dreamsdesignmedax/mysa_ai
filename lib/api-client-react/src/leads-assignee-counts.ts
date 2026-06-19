import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions, UseQueryResult, QueryKey } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export const getLeadAssigneeCountsUrl = () => "/api/leads/assignee-counts";

export const fetchLeadAssigneeCounts = async (options?: RequestInit): Promise<Record<number, number>> => {
  return customFetch<Record<number, number>>(getLeadAssigneeCountsUrl(), { ...options });
};

export const getLeadAssigneeCountsQueryKey = () => ["leadAssigneeCounts"] as const;

export function useLeadAssigneeCounts<
  TData = Record<number, number>,
  TError = unknown,
>(options?: {
  query?: UseQueryOptions<Record<number, number>, TError, TData>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryKey = getLeadAssigneeCountsQueryKey();
  const query = useQuery<Record<number, number>, TError, TData>({
    queryKey,
    queryFn: () => fetchLeadAssigneeCounts(),
    ...options?.query,
  }) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey };
}
