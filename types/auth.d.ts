// Global Auth-related types and module augmentations

// User roles shared across the app
export type UserRole = "user" | "admin";

// Augment next-auth Session shape
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      accessToken?: string;
    } & DefaultSession["user"];
  }
}

// Augment Auth.js adapter user
declare module "@auth/core/adapters" {
  interface AdapterUser {
    id: string;
    email: string;
    emailVerified: Date | null;
    role: UserRole;
  }
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      accessToken?: string;
    } & DefaultSession["user"]
  }
}

export interface JWT {
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpires?: number;
  error?: string;
  sub?: string;
  [key: string]: unknown;
}