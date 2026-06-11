import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBar } from './StatusBar';

describe('StatusBar', () => {
  it('renders the product brand and current status region', () => {
    render(<StatusBar status="idle" />);

    expect(screen.getByText('J.A.R.V.I.S')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders tool execution detail', () => {
    render(<StatusBar status="tooling" detail="terminal" />);

    expect(screen.getByRole('status')).toHaveTextContent(
      '도구 실행 중: terminal',
    );
  });
});
