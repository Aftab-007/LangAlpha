import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '@/i18n';
import { PageIntroModal } from '../engine/PageIntroModal';
import { INTRO_VISUALS, loadIntroScenes } from '../engine/introScenes';
import { PAGE_INTROS, type PageIntroDef } from '../registry';

const intro: PageIntroDef = {
  id: 'chat',
  matchRoute: () => true,
  steps: [
    { id: 's1', visual: 'workspaceGrid' },
    { id: 's2', visual: 'chiefOfStaffAnswer' },
    { id: 's3', visual: 'ptcSandbox' },
  ],
};

// The modal waits for its intro's scenes; with every scene in, it renders at once.
// Its copy comes from the `intros` namespace, which test/setup.ts hands over
// with the rest; these steps have none, so their keys render as written.
beforeAll(() => loadIntroScenes(INTRO_VISUALS));

describe('PageIntroModal', () => {
  it('renders the first step with progress and the illustration panel', () => {
    render(<PageIntroModal intro={intro} onClose={vi.fn()} />);
    expect(screen.getByText('chat.s1.title')).toBeInTheDocument();
    expect(screen.getByText('chat.s1.body')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Step 1' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('intro-illustration')).toBeInTheDocument();
    // no Back on the first step
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    // Opening focus sits on Continue, so Enter walks the tour.
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus();
  });

  // step copy swaps behind an exit animation — await the incoming title
  it('Continue advances through steps and Back returns', async () => {
    render(<PageIntroModal intro={intro} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('chat.s2.title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Step 2' })).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('chat.s1.title')).toBeInTheDocument();
  });

  it('step dots jump directly to a stage', async () => {
    render(<PageIntroModal intro={intro} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Step 3' }));
    expect(await screen.findByText('chat.s3.title')).toBeInTheDocument();
  });

  it('intermediate steps never close — only the last CTA does', () => {
    const onClose = vi.fn();
    render(<PageIntroModal intro={intro} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start exploring' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // When every step anchors its visual right (the thread intro), the visual
  // panel takes the LEFT half: copy gets sm:order-2, illustration sm:order-1.
  it('a fully right-anchored intro puts the visual panel first', () => {
    const rightIntro: PageIntroDef = {
      id: 'thread',
      matchRoute: () => true,
      steps: [
        { id: 'a', visual: 'filePanel' },
        { id: 'b', visual: 'memory' },
      ],
    };
    render(<PageIntroModal intro={rightIntro} onClose={vi.fn()} />);
    expect(screen.getByTestId('intro-illustration').className).toMatch(/sm:order-1/);
  });

  // Every scene of the thread intro, the last one included, is drawn on a
  // thread page whose controls sit on the right; one step anchored elsewhere
  // would swap the whole intro's sides.
  it('the thread intro, as registered, puts the visual panel first', () => {
    const thread = PAGE_INTROS.find((i) => i.id === 'thread')!;
    render(<PageIntroModal intro={thread} onClose={vi.fn()} />);
    expect(screen.getByTestId('intro-illustration').className).toMatch(/sm:order-1/);
  });

  it("reads the steps' copy from the intros namespace", () => {
    const market = PAGE_INTROS.find((i) => i.id === 'market')!;
    render(<PageIntroModal intro={market} onClose={vi.fn()} />);
    expect(screen.getByText(i18n.t('market.ask.title', { ns: 'intros' }))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('market.ask.body', { ns: 'intros' }))).toBeInTheDocument();
    expect(screen.queryByText('market.ask.title')).toBeNull();
  });

  it('shows nothing when its copy did not load, rather than raw keys', () => {
    const lng = i18n.language;
    const copy = i18n.getResourceBundle(lng, 'intros');
    i18n.removeResourceBundle(lng, 'intros');
    try {
      const market = PAGE_INTROS.find((i) => i.id === 'market')!;
      render(<PageIntroModal intro={market} onClose={vi.fn()} />);
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      i18n.addResourceBundle(lng, 'intros', copy);
    }
  });

  it('left-anchored intros keep the copy panel first', () => {
    render(<PageIntroModal intro={intro} onClose={vi.fn()} />);
    expect(screen.getByTestId('intro-illustration').className).not.toMatch(/sm:order-1/);
  });

  it('the dialog X closes at any step — every close path marks seen', () => {
    const onClose = vi.fn();
    render(<PageIntroModal intro={intro} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
