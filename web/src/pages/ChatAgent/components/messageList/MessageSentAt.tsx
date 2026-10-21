import React from 'react';

/** A bubble's time arrives as a Date from the chat session, or as an ISO
 *  string or epoch from replayed history. */
function toDate(value: unknown): Date | null {
  // `new Date(null)` is the 1970 epoch, a valid date: a missing time must not read as one.
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Wed 22 Oct, 7:05 AM", with the year only when it isn't this one. */
function shortWhen(d: Date): string {
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** When a user message was sent, under its bubble, so a past run (a skill's
 *  included) can be placed in time without opening anything. */
export function MessageSentAt({ value }: { value: unknown }): React.ReactElement | null {
  const d = toDate(value);
  if (!d) return null;
  return (
    <time
      dateTime={d.toISOString()}
      title={d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })}
      className="mt-0.5 block text-right text-[11px] leading-none"
      style={{ color: 'var(--color-text-tertiary)' }}
    >
      {shortWhen(d)}
    </time>
  );
}
