import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InputBar } from './InputBar';

function renderInputBar(
  props: Partial<Parameters<typeof InputBar>[0]> = {},
) {
  const onSend = vi.fn();
  const onStop = vi.fn();
  const onNewConversation = vi.fn();
  const result = render(
    <InputBar
      canSend
      streaming={false}
      onSend={onSend}
      onStop={onStop}
      onNewConversation={onNewConversation}
      {...props}
    />,
  );

  return {
    ...result,
    onSend,
    onStop,
    onNewConversation,
    input: result.getByRole('textbox'),
    submitButton: result.container.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement,
  };
}

describe('InputBar', () => {
  it('disables the send button until a command is entered', async () => {
    const user = userEvent.setup();
    const { input, submitButton } = renderInputBar();

    expect(submitButton).toBeDisabled();

    await user.type(input, 'show build status');

    expect(submitButton).toBeEnabled();
  });

  it('sends the trimmed command and clears the input', async () => {
    const user = userEvent.setup();
    const { input, submitButton, onSend } = renderInputBar();

    await user.type(input, '  show build status  ');
    await user.click(submitButton);

    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith('show build status');
    expect(input).toHaveValue('');
  });

  it('shows the stop button while streaming and calls onStop', async () => {
    const user = userEvent.setup();
    const { container, onStop } = renderInputBar({ streaming: true });
    const stopButton = container.querySelector(
      'button.stop',
    ) as HTMLButtonElement;

    expect(
      container.querySelector('button[type="submit"]'),
    ).not.toBeInTheDocument();

    await user.click(stopButton);

    expect(onStop).toHaveBeenCalledOnce();
  });

  it('starts a new conversation from the command bar', async () => {
    const user = userEvent.setup();
    const { onNewConversation } = renderInputBar();

    await user.click(screen.getByRole('button', { name: '새 대화' }));

    expect(onNewConversation).toHaveBeenCalledOnce();
  });
});
