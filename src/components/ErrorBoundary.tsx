import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/** ErrorBoundary 在 I18nProvider 外面，无法用 useI18n，直接读 localStorage 做双语 */
function isZh(): boolean {
  try {
    const saved = localStorage.getItem('cpm-lang');
    if (saved === 'zh') return true;
    if (saved === 'en') return false;
    return navigator.language.startsWith('zh');
  } catch {
    return false;
  }
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const zh = isZh();

      return (
        <div className="h-screen flex items-center justify-center bg-background">
          <div className="max-w-md text-center space-y-4 p-8">
            <h2 className="text-lg font-semibold text-foreground">
              {zh ? '出了点问题' : 'Something went wrong'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {this.state.error?.message || (zh ? '页面渲染时发生了未知错误' : 'An unknown error occurred while rendering the page')}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {zh ? '刷新页面' : 'Reload Page'}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
