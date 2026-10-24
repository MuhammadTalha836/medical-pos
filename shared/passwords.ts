// One password rule for every staff password: create, edit, reset, profile and change-password.
// (The setup wizard asks for a longer Admin password.)
export const PASSWORD_MIN = 6;
export const PASSWORD_MIN_MESSAGE = `Password must be at least ${PASSWORD_MIN} characters long`;

export const isValidPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length >= PASSWORD_MIN;
