/**
 * AI chat panelės testai (Iter 17) — pasiūlymai, žinučių srautas, įvedimas.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatPanel } from './ChatPanel';

const noop = (): void => undefined;

describe('ChatPanel', () => {
  it('tuščiame pokalbyje rodo pasiūlymus; paspaudus — onSend', () => {
    const onSend = vi.fn();
    render(
      <ChatPanel
        messages={[]}
        busy={false}
        statusLabel={null}
        suggestions={['Rodyk biudžetą', 'Tik skaičiai']}
        onSend={onSend}
        onStop={noop}
      />,
    );
    fireEvent.click(screen.getByText('Rodyk biudžetą'));
    expect(onSend).toHaveBeenCalledWith('Rodyk biudžetą');
  });

  it('siunčia įvestą tekstą per Enter ir išvalo lauką', () => {
    const onSend = vi.fn();
    render(
      <ChatPanel
        messages={[]}
        busy={false}
        statusLabel={null}
        suggestions={[]}
        onSend={onSend}
        onStop={noop}
      />,
    );
    const input = screen.getByLabelText('Žinutė AI asistentui');
    fireEvent.change(input, { target: { value: 'Perpiešk vaizdą' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('Perpiešk vaizdą');
    expect((input as HTMLTextAreaElement).value).toBe('');
  });

  it('busy būsenoje rodo statusą ir Stop mygtuką, neleidžia siųsti', () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(
      <ChatPanel
        messages={[{ role: 'user', content: 'Labas' }]}
        busy
        statusLabel="Renkami duomenys…"
        suggestions={[]}
        onSend={onSend}
        onStop={onStop}
      />,
    );
    expect(screen.getByText('Renkami duomenys…')).toBeInTheDocument();
    const input = screen.getByLabelText('Žinutė AI asistentui');
    fireEvent.change(input, { target: { value: 'dar' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Stabdyti'));
    expect(onStop).toHaveBeenCalled();
  });

  it('rodo klaidos žinutę išskirtinai', () => {
    render(
      <ChatPanel
        messages={[
          { role: 'user', content: 'Labas' },
          { role: 'assistant', content: 'Nutrūko ryšys.', error: true },
        ]}
        busy={false}
        statusLabel={null}
        suggestions={[]}
        onSend={noop}
        onStop={noop}
      />,
    );
    expect(screen.getByText('Nutrūko ryšys.')).toBeInTheDocument();
  });
});
