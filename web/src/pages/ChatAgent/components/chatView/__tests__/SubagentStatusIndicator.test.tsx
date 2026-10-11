import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SubagentStatusIndicator from '../SubagentStatusIndicator';

describe('SubagentStatusIndicator', () => {
  it('counts a single tool call in the singular', () => {
    render(<SubagentStatusIndicator status="completed" currentTool="" toolCalls={1} />);
    expect(screen.getByText('Completed (1 tool call)')).toBeInTheDocument();
  });

  it('counts several in the plural', () => {
    render(<SubagentStatusIndicator status="completed" currentTool="" toolCalls={3} />);
    expect(screen.getByText('Completed (3 tool calls)')).toBeInTheDocument();
  });
});
