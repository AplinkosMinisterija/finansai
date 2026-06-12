/**
 * Sidebar suskleidimo (icon-rail) testai.
 */
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { Sidebar, type SidebarProps } from './Sidebar';

function renderSidebar(props: SidebarProps = {}): void {
  renderWithProviders(<Sidebar {...props} />);
}

describe('Sidebar collapse', () => {
  it('išskleistas: rodo etiketes ir suskleidimo mygtuką', () => {
    const onToggle = vi.fn();
    renderSidebar({ collapsed: false, onToggleCollapse: onToggle });
    expect(screen.getByText('Pradžia (AI)')).toBeInTheDocument();
    expect(screen.getByText('Prašymai')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Suskleisti meniu'));
    expect(onToggle).toHaveBeenCalled();
  });

  it('suskleistas: slepia etiketes, ikonos lieka su title tooltip', () => {
    const onToggle = vi.fn();
    renderSidebar({ collapsed: true, onToggleCollapse: onToggle });
    expect(screen.queryByText('Pradžia (AI)')).not.toBeInTheDocument();
    expect(screen.queryByText('Prašymai')).not.toBeInTheDocument();
    // Nuorodos lieka (title atributas vietoj etiketės).
    expect(screen.getByTitle('Pradžia (AI)')).toBeInTheDocument();
    expect(screen.getByTitle('Prašymai')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Išskleisti meniu'));
    expect(onToggle).toHaveBeenCalled();
  });

  it('be onToggleCollapse (mobile Sheet) — jokio toggle mygtuko', () => {
    renderSidebar({});
    expect(screen.queryByLabelText('Suskleisti meniu')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Išskleisti meniu')).not.toBeInTheDocument();
  });
});
