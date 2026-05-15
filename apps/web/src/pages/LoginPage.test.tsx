import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import LoginPage from './LoginPage';
import { makeAuthValue, renderWithProviders } from '@/test-utils';

describe('LoginPage', () => {
  it('renderina prisijungimo formą su demo paskyromis', () => {
    renderWithProviders(<LoginPage />, {
      authValue: makeAuthValue({ user: null }),
    });

    expect(
      screen.getByRole('heading', { name: /prisijunkite prie finansai/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Vartotojo vardas')).toBeInTheDocument();
    expect(screen.getByLabelText('Slaptažodis')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /prisijungti/i }),
    ).toBeInTheDocument();

    expect(screen.getByText(/demo paskyros/i)).toBeInTheDocument();
  });

  it('kviečia login() su įvestais duomenimis', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<LoginPage />, {
      authValue: makeAuthValue({ user: null, login }),
    });

    fireEvent.change(screen.getByLabelText('Vartotojo vardas'), {
      target: { value: 'demo' },
    });
    fireEvent.change(screen.getByLabelText('Slaptažodis'), {
      target: { value: 'demo' },
    });
    fireEvent.click(screen.getByRole('button', { name: /prisijungti/i }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('demo', 'demo');
    });
  });

  it('parodo validacijos klaidas, kai laukai tušti', async () => {
    renderWithProviders(<LoginPage />, {
      authValue: makeAuthValue({ user: null }),
    });

    fireEvent.click(screen.getByRole('button', { name: /prisijungti/i }));

    expect(
      await screen.findByText(/įveskite vartotojo vardą/i),
    ).toBeInTheDocument();
    expect(await screen.findByText(/įveskite slaptažodį/i)).toBeInTheDocument();
  });
});
