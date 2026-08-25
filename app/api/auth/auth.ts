import NextAuth, { type NextAuthConfig } from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import Google from "next-auth/providers/google";
import { OAuth2Client } from 'google-auth-library';
import { JWT } from '@/types/auth';
import { persistGoogleAccount } from '@/lib/auth/google-token';
import { isEmailAllowed, warnIfOpen } from '@/lib/auth/allowlist';

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    if (!token.refreshToken) {
      throw new Error('No refresh token available');
    }

    const oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'postmessage'
    );

    // Set the refresh token
    oauth2Client.setCredentials({
      refresh_token: token.refreshToken
    });

    // Get a new access token
    const tokenResponse = await oauth2Client.getAccessToken();
    
    if (!tokenResponse.token) {
      throw new Error('Failed to refresh token: No access token received');
    }

    // Get the expiry date (default to 1 hour from now if not provided)
    const expiryDate = tokenResponse.res?.data?.expires_in 
      ? Date.now() + (tokenResponse.res.data.expires_in * 1000)
      : Date.now() + 3600 * 1000;

    return {
      ...token,
      accessToken: tokenResponse.token,
      accessTokenExpires: expiryDate,
      refreshToken: token.refreshToken, // Keep the original refresh token
    };
  } catch (error) {
    console.error('Error refreshing access token:', error);
    // Drop the token rather than carrying it forward. Spreading `...token` kept
    // the old access token on the session, and everything downstream reads
    // "there is a token" — so a dead refresh token reached the calendar tools as
    // a 401 from Google, i.e. "could not read your calendar", instead of as the
    // one thing that is true and repairable: Google access has ended. Nothing is
    // lost by dropping it; this branch is only reached once the token has
    // already expired.
    return {
      ...token,
      accessToken: undefined,
      accessTokenExpires: 0,
      error: 'RefreshAccessTokenError',
    };
  }
}

const authOptions: NextAuthConfig = {
  adapter: DrizzleAdapter(db) as any,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
          scope: [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/calendar.events',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
          ].join(' ')
        }
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true, // Trust the host header in production (Vercel, etc.)
  session: {
    strategy: "jwt",
  },
  callbacks: {
    /**
     * The one place an account is created. Runs before the adapter writes a
     * user row, so a refused address leaves nothing behind.
     *
     * Note what this does *not* do: sessions are JWTs and are never checked
     * against the database again, so adding someone to the list lets them in
     * immediately, while removing them only stops the next sign-in. Evicting a
     * live session means rotating NEXTAUTH_SECRET.
     */
    async signIn({ user, profile }) {
      const allowed = process.env.ALLOWED_EMAILS;
      warnIfOpen(allowed);

      const email = profile?.email ?? user?.email;
      if (isEmailAllowed(email, allowed)) return true;

      console.warn(`[auth] sign-in refused for ${email ?? 'an account with no email'}`);
      return false;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        if (token.accessToken) {
          session.user.accessToken = token.accessToken as string;
        }
      }
      return session;
    },
    async jwt({ token, account, user }) {
      // Initial sign in
      if (account && user) {
        // Mirror the tokens into the `account` row. Session-less callers —
        // the Telegram webhook, cron jobs — have no cookie to read and mint
        // their Google access from the stored refresh token instead.
        await persistGoogleAccount({
          providerAccountId: account.providerAccountId,
          refreshToken: account.refresh_token as string | undefined,
          accessToken: account.access_token as string | undefined,
          expiresAt: account.expires_at as number | undefined,
          scope: account.scope as string | undefined,
        });

        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: account.expires_at ? account.expires_at * 1000 : Date.now() + 3600 * 1000,
          sub: user.id,
        };
      }

      // Return previous token if the access token has not expired yet
      if (token.accessTokenExpires && Date.now() < (token.accessTokenExpires as number)) {
        return token;
      }

      // Access token has expired, try to update it
      return refreshAccessToken(token);
    },
  },
  pages: {
    signIn: "/signin",
  },
  debug: process.env.NODE_ENV === "development",
};

export const { handlers, auth, signIn, signOut } = NextAuth(authOptions);

export { authOptions };