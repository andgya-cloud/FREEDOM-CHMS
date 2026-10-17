/** Turns Firebase errors into plain English for staff. */
export function friendlyError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  const message = (err as { message?: string })?.message ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'That email and password do not match. Check them and try again.';
    case 'auth/user-disabled':
      return 'This account has been switched off. Ask the pastor.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'No internet connection. The first sign-in on a device needs internet.';
    case 'permission-denied':
    case 'functions/permission-denied':
      return 'You do not have permission to do that.';
    case 'unavailable':
    case 'functions/unavailable':
    case 'functions/internal':
      return navigator.onLine ? 'Something went wrong on the server. Try again.' : 'This needs an internet connection.';
  }
  if (code.startsWith('functions/') && message) return message;
  return message || 'Something went wrong. Try again.';
}
