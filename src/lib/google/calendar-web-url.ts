const GOOGLE_CALENDAR_HOME = 'https://calendar.google.com/calendar/u/0/r';
const GOOGLE_ACCOUNT_CHOOSER = 'https://accounts.google.com/AccountChooser';

export function buildGoogleCalendarAccountUrl(email: string, continueUrl = GOOGLE_CALENDAR_HOME): string {
  const normalizedEmail = email.trim();
  if (!isSafeEmail(normalizedEmail)) return GOOGLE_CALENDAR_HOME;

  let target: URL;
  try {
    target = new URL(continueUrl);
  } catch {
    target = new URL(GOOGLE_CALENDAR_HOME);
  }

  if (target.protocol !== 'https:' || target.hostname !== 'calendar.google.com') {
    target = new URL(GOOGLE_CALENDAR_HOME);
  }

  const chooser = new URL(GOOGLE_ACCOUNT_CHOOSER);
  chooser.searchParams.set('Email', normalizedEmail);
  chooser.searchParams.set('continue', target.toString());
  return chooser.toString();
}

function isSafeEmail(value: string): boolean {
  return value.length > 3 && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
