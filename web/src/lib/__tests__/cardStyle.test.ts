import { beforeEach, describe, expect, it } from 'vitest';
import { applyCardStyle, getCardStyle, setCardStyle } from '../cardStyle';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-card-style');
});

describe('card style', () => {
  it('reads Balanced when nothing, or something unknown, is stored', () => {
    expect(getCardStyle()).toBe('balanced');
    localStorage.setItem('cardStyle', 'classic');
    expect(getCardStyle()).toBe('balanced');
  });

  it('keeps a choice for the next load and stamps it on the root', () => {
    setCardStyle('quiet');
    expect(getCardStyle()).toBe('quiet');
    expect(document.documentElement.dataset.cardStyle).toBe('quiet');
  });

  it('stamps nothing for Terminal, whose look is the stylesheets themselves', () => {
    applyCardStyle('balanced');
    applyCardStyle('terminal');
    expect(document.documentElement.hasAttribute('data-card-style')).toBe(false);
  });
});
