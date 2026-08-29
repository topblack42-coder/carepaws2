import React, { useState } from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { api } from '../utils/api';

jest.mock('../utils/api', () => {
  const actual = jest.requireActual('../utils/api');
  return {
    ...actual,
    api: { post: jest.fn(), get: jest.fn() },
  };
});

function TestLoginButton() {
  const { login } = useAuth();
  const [err, setErr] = useState<string | null>(null);

  return (
    <>
      <button
        onClick={async () => {
          try {
            // Using dummy creds — api.post is mocked to return a response
            // with missing tokens in this test.
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            await login('test@example.com', 'password123');
          } catch (e) {
            setErr(e instanceof Error ? e.message : 'error');
          }
        }}
      >
        login
      </button>
      {err ? <div>{err}</div> : null}
    </>
  );
}

describe('Auth response validation', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('throws when login response is missing tokens', async () => {
    // api.post will return a login response missing accessToken/refreshToken
    (api.post as jest.Mock).mockResolvedValue({ data: { data: { user: { id: 'u1', displayName: 'T', email: 't@example.com' } } } });

    render(
      <AuthProvider>
        <TestLoginButton />
      </AuthProvider>
    );

    fireEvent.click(screen.getByText('login'));

    await waitFor(() => {
      expect(screen.getByText('Authentication response missing tokens.')).toBeTruthy();
    });
  });
});
