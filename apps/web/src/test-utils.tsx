/**
 * Test helpers — wrap'ina komponentus su QueryClient + MemoryRouter +
 * AuthContext (su mock'inta state'u).
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AuthUser } from '@biip-finansai/shared';
import { AuthContext, type AuthContextValue } from '@/lib/auth';

export const TEST_AUTH_USER: AuthUser = {
  id: 1,
  username: 'demo',
  fullName: 'Demo Vartotojas',
  email: 'demo@am.lt',
  role: 'admin',
};

export function makeAuthValue(
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  return {
    user: TEST_AUTH_USER,
    loading: false,
    login: async () => undefined,
    logout: async () => undefined,
    ...overrides,
  };
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  authValue?: AuthContextValue;
  initialRoute?: string;
  routePath?: string;
}

export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult & { queryClient: QueryClient } {
  const queryClient = makeQueryClient();
  const authValue = options.authValue ?? makeAuthValue();
  const initialRoute = options.initialRoute ?? '/';

  function Wrapper({ children }: { children: React.ReactNode }): JSX.Element {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialRoute]}>
          <AuthContext.Provider value={authValue}>
            {options.routePath ? (
              <Routes>
                <Route path={options.routePath} element={children} />
              </Routes>
            ) : (
              children
            )}
          </AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  const result = render(ui, { wrapper: Wrapper, ...options });
  return { ...result, queryClient };
}
