// Single source of truth for auth storage keys. The AuthContext (write) and
// the API client (read) MUST use the exact same key + namespace, otherwise a
// mismatch silently surfaces as a logged-out state / 401.
//
// Token lives in the SECURE namespace (secureGet/secureSet).
export const AUTH_TOKEN_KEY = "sertex.auth.token";
