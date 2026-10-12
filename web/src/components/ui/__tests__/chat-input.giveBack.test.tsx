/**
 * Text the user wrote elsewhere (an edit whose message is gone) comes back to
 * the composer without costing what is typed there.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act, screen } from '@testing-library/react';
import { createRef } from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ChatInput, { type ChatInputHandle } from '../chat-input';

vi.mock('@/pages/ChatAgent/utils/api', () => ({
  getSkills: vi.fn().mockResolvedValue([]),
  getModelMetadata: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/hooks/usePreferences', () => ({
  usePreferences: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('../use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

function renderInput() {
  const ref = createRef<ChatInputHandle>();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ChatInput ref={ref} onSend={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const box = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement;
  return { ref, box };
}

describe('ChatInput — giveBack', () => {
  it('fills an empty composer', () => {
    const { ref, box } = renderInput();
    act(() => ref.current!.giveBack('the edited question'));
    expect(box.value).toBe('the edited question');
  });

  it('keeps what is typed and puts the text after it', () => {
    const { ref, box } = renderInput();
    fireEvent.change(box, { target: { value: 'a new question  ' } });
    act(() => ref.current!.giveBack('the edited question'));
    expect(box.value).toBe('a new question\n\nthe edited question');
  });

  it('does not add the same text twice', () => {
    const { ref, box } = renderInput();
    act(() => ref.current!.giveBack('the edited question'));
    act(() => ref.current!.giveBack('the edited question'));
    expect(box.value).toBe('the edited question');
  });
});
