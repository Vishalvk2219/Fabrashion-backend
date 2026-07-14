/** Standard paginated envelope: `{ data, meta }`. */
export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export function paginate<T>(data: T[], total: number, page: number, limit: number): Paginated<T> {
  return { data, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}
