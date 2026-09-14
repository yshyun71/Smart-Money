import React from "react";

interface State {
  error: Error | null;
  info: string;
}

/**
 * Keeps a crash on screen instead of leaving a white page behind.
 *
 * React unmounts the whole tree when a render throws, and on a phone there is
 * no console to look in — so the message, and where it came from, has to be
 * shown where the app was.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  // The project has no React type definitions, so the base class carries none
  // of its own members through — these say what is inherited.
  declare props: { children: React.ReactNode };
  declare setState: (state: Partial<State>) => void;

  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error("[앱] 화면을 그리는 중 오류가 발생했습니다:", error, info);
    this.setState({ info: info.componentStack || "" });
  }

  private reload = () => {
    window.location.reload();
  };

  /** The usual cause on a PWA: half of an old build still cached. */
  private hardReload = async () => {
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch (error) {
      console.error("[앱] 캐시를 비우지 못했습니다:", error);
    }
    window.location.reload();
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const detail = [error.stack || `${error.name}: ${error.message}`, info]
      .filter(Boolean)
      .join("\n\n");

    return (
      <div className="min-h-dvh bg-slate-50 p-5 flex items-start justify-center">
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-sm p-5 space-y-3.5 mt-8">
          <div>
            <h1 className="text-sm font-bold text-slate-900">화면을 표시하지 못했습니다</h1>
            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
              기기에 저장된 가계부 데이터는 그대로 있습니다. 아래 내용을 캡처해 알려주시면
              원인을 찾을 수 있습니다.
            </p>
          </div>

          <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200/80">
            <div className="text-[11px] font-bold text-rose-800 break-words">
              {error.message || String(error)}
            </div>
          </div>

          <pre className="p-3 rounded-2xl bg-slate-900 text-slate-200 text-[9px] leading-relaxed overflow-auto max-h-64 whitespace-pre-wrap break-words">
            {detail}
          </pre>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={this.reload}
              className="py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
            >
              새로고침
            </button>
            <button
              type="button"
              onClick={this.hardReload}
              className="py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer"
            >
              캐시 비우고 다시 열기
            </button>
          </div>
        </div>
      </div>
    );
  }
}
