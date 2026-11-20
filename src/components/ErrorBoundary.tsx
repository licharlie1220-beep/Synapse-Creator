import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let displayMessage = error.message || '工作台渲染发生异常';
    try {
      const parsed = JSON.parse(error.message) as { error?: string; operationType?: string };
      if (parsed && parsed.error) {
        displayMessage = `操作权限或同步异常（${parsed.operationType || 'unknown'}）：${parsed.error}`;
      }
    } catch {
      // Plain error message
    }
    return { hasError: true, message: displayMessage };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('ErrorBoundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-[#1D1F22] p-6 text-[#E6E1DA]">
          <div className="w-full max-w-md rounded-xl border border-[#C48B88]/35 bg-[#24272B] p-6 shadow-2xl">
            <div className="flex items-center gap-2.5 text-[#D19A97]">
              <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
              <h2 className="text-base font-semibold">工作台遇到异常</h2>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[#B7B1A8] break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#B89882] px-4 py-2 text-xs font-semibold text-[#1B1715] hover:bg-[#C5A792] transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>刷新恢复工作台</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
