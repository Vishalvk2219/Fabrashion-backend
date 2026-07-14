import type { User, UserRole } from '@prisma/client';

/** Public user shape returned to the client (never includes passwordHash). */
export interface AuthUserDTO {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
}

export interface AuthResponseDTO {
  user: AuthUserDTO;
  accessToken: string;
  refreshToken: string;
}

export function toAuthUser(user: User): AuthUserDTO {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
  };
}
