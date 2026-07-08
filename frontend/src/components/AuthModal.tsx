import React, { useState, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';

type AuthTab = 'login' | 'register';

export const AuthModal: React.FC = () => {
  const isOpen = useAuthStore((s) => s.isAuthOpen);
  const setAuthOpen = useAuthStore((s) => s.setAuthOpen);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const isSubmitting = useAuthStore((s) => s.isSubmitting);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [tab, setTab] = useState<AuthTab>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const switchTab = useCallback((t: AuthTab) => {
    setTab(t);
    clearError();
    setUsername('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
  }, [clearError]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;

    if (tab === 'register') {
      if (!email.trim()) return;
      if (password !== confirmPassword) {
        useAuthStore.setState({ error: 'Passwords do not match' });
        return;
      }
      if (password.length < 6) {
        useAuthStore.setState({ error: 'Password must be at least 6 characters' });
        return;
      }
      await register(username.trim(), email.trim(), password);
    } else {
      await login(username.trim(), password);
    }
  }, [tab, username, email, password, confirmPassword, login, register]);

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/60 z-50 backdrop-blur-sm"
        onClick={() => setAuthOpen(false)}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-[400px] bg-chamber border border-border rounded-xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 h-13 border-b border-border">
            <div className="flex items-center gap-2.5">
              <svg className="w-[18px] h-[18px] text-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
              <span className="font-display text-sm font-semibold text-white tracking-wide lowercase">
                council
              </span>
            </div>
            <button
              onClick={() => setAuthOpen(false)}
              className="w-6 h-6 flex items-center justify-center text-ghost hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border">
            <button
              onClick={() => switchTab('login')}
              className={`flex-1 h-10 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                tab === 'login'
                  ? 'text-pulse border-b-2 border-pulse'
                  : 'text-ghost hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => switchTab('register')}
              className={`flex-1 h-10 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                tab === 'register'
                  ? 'text-pulse border-b-2 border-pulse'
                  : 'text-ghost hover:text-white'
              }`}
            >
              Register
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
            {/* Username */}
            <div>
              <label className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                autoFocus
                className="w-full mt-1 h-9 px-3 text-[13px] bg-void border border-border rounded-md text-white placeholder:text-muted outline-none focus:border-pulse focus:shadow-[0_0_0_1px_#6366F1] transition-colors"
              />
            </div>

            {/* Email (register only) */}
            {tab === 'register' && (
              <div>
                <label className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full mt-1 h-9 px-3 text-[13px] bg-void border border-border rounded-md text-white placeholder:text-muted outline-none focus:border-pulse focus:shadow-[0_0_0_1px_#6366F1] transition-colors"
                />
              </div>
            )}

            {/* Password */}
            <div>
              <label className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={tab === 'register' ? 'At least 6 characters' : 'Enter your password'}
                className="w-full mt-1 h-9 px-3 text-[13px] bg-void border border-border rounded-md text-white placeholder:text-muted outline-none focus:border-pulse focus:shadow-[0_0_0_1px_#6366F1] transition-colors"
              />
            </div>

            {/* Confirm password (register only) */}
            {tab === 'register' && (
              <div>
                <label className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your password"
                  className="w-full mt-1 h-9 px-3 text-[13px] bg-void border border-border rounded-md text-white placeholder:text-muted outline-none focus:border-pulse focus:shadow-[0_0_0_1px_#6366F1] transition-colors"
                />
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 px-3 py-2 bg-red-400/10 border border-red-400/20 rounded-md">
                <svg className="w-3.5 h-3.5 text-red-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                <span className="text-[11px] text-red-300">{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={
                isSubmitting ||
                !username.trim() ||
                !password ||
                (tab === 'register' && (!email.trim() || !confirmPassword))
              }
              className="w-full h-10 text-[12px] font-semibold text-white bg-pulse rounded-md hover:bg-[#5558E6] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting
                ? 'Please wait...'
                : tab === 'login'
                  ? 'Sign In'
                  : 'Create Account'}
            </button>

            {/* Hint for register tab */}
            {tab === 'register' && (
              <p className="text-[10px] text-ghost text-center">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => switchTab('login')}
                  className="text-pulse hover:underline"
                >
                  Sign in
                </button>
              </p>
            )}
          </form>
        </div>
      </div>
    </>
  );
};
