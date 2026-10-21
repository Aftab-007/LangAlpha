import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MessageSentAt } from '../MessageSentAt';

describe('MessageSentAt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 22, 12, 0));
  });
  afterEach(() => vi.useRealTimers());

  it.each([null, undefined, '', 'not a date'])('renders nothing for %p', (value) => {
    const { container } = render(<MessageSentAt value={value} />);
    expect(container.firstChild).toBeNull();
  });

  it('leaves the year out for a time this year', () => {
    const { container } = render(<MessageSentAt value={new Date(2026, 9, 21, 7, 5)} />);
    expect(container.querySelector('time')?.textContent).not.toContain('2026');
  });

  it('shows the year for an earlier year', () => {
    const { container } = render(<MessageSentAt value={new Date(2025, 9, 21, 7, 5)} />);
    expect(container.querySelector('time')?.textContent).toContain('2025');
  });

  it('reads an ISO string from replayed history and stamps dateTime', () => {
    const iso = new Date(2026, 9, 21, 7, 5).toISOString();
    const { container } = render(<MessageSentAt value={iso} />);
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe(iso);
  });
});
