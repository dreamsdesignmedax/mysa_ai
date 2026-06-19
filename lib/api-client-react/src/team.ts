import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions, UseQueryResult, QueryKey } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
export interface TeamMember {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: string;
  orgId: number;
  isVerified: boolean;
  createdAt: string;
}

export const getListTeamMembersUrl = () => "/api/team/members";

export const listTeamMembers = async (options?: RequestInit): Promise<TeamMember[]> => {
  return customFetch<TeamMember[]>(getListTeamMembersUrl(), { ...options });
};

export const getListTeamMembersQueryKey = () => ["listTeamMembers"] as const;

export function useListTeamMembers<
  TData = TeamMember[],
  TError = unknown,
>(options?: {
  query?: UseQueryOptions<TeamMember[], TError, TData>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryKey = getListTeamMembersQueryKey();
  const query = useQuery<TeamMember[], TError, TData>({
    queryKey,
    queryFn: () => listTeamMembers(),
    ...options?.query,
  }) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey };
}
