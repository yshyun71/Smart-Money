import React, { useState } from "react";
import { usePWAInstall, useOnlineStatus } from "../../hooks/usePWAInstall";
import {
  Smartphone,
  X,
  Copy,
  Check,
  CheckCircle,
  Download,
  QrCode,
} from "lucide-react";

/**
 * Install guide for the standalone mobile app: QR code, direct link and
 * per-browser steps. Shown when the browser cannot trigger a native install
 * prompt, and reachable from the header settings menu at any time.
 */
export const PWAInstallGuideModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [copied, setCopied] = useState(false);

  const directAppUrl = typeof window !== "undefined" ? window.location.origin : "";
  const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(directAppUrl);

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
    directAppUrl
  )}&bgcolor=ffffff&color=0f172a&margin=2`;

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(directAppUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch (e) {
      console.error("Failed to copy link", e);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl text-left animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                휴대폰에 '스마트 머니' 앱 설치하기
              </h3>
              <p className="text-[11px] text-slate-500">
                전용 단독 모바일 웹앱(PWA) 설치 안내
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Serving from localhost: the QR below points at this machine only */}
        {isLocalOrigin && (
          <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200/80 text-[11px] text-amber-900 leading-relaxed">
            지금은 <strong>개발 서버(localhost)</strong>에서 실행 중입니다. 아래 주소는 이 컴퓨터에서만
            열리므로 휴대폰에서는 접속되지 않습니다. 폰에 설치하려면 먼저 <strong>HTTPS 주소로 배포</strong>한 뒤
            그 주소에서 이 화면을 열어주세요.
          </div>
        )}

        {/* Native install prompt, when this browser can offer one */}
        {isInstalled ? (
          <div className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200/80 text-xs font-bold text-emerald-800 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>이 기기에는 이미 전용 앱으로 설치되어 있습니다.</span>
          </div>
        ) : isInstallable ? (
          <button
            onClick={() => {
              install();
              onClose();
            }}
            className="mt-3 w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-2xs transition active:scale-95"
          >
            <Download className="w-4 h-4" />
            <span>지금 바로 이 기기에 앱 설치</span>
          </button>
        ) : null}

        {/* QR Code & Direct Link */}
        <div className="mt-3 p-4 bg-slate-50 rounded-xl border border-slate-200/80 flex flex-col sm:flex-row items-center gap-4">
          <div className="w-32 h-32 bg-white p-2 rounded-xl border border-slate-200 shadow-2xs shrink-0 flex items-center justify-center">
            <img
              src={qrImageUrl}
              alt="QR Code"
              className="w-full h-full object-contain"
            />
          </div>

          <div className="flex-1 space-y-2 text-left w-full">
            <div className="text-xs font-bold text-slate-900 flex items-center gap-1">
              <QrCode className="w-3.5 h-3.5 text-emerald-600" />
              <span>스마트폰 카메라로 QR 스캔</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              휴대폰 카메라를 켜고 화면의 QR 코드를 비추면 즉시 전용 앱 화면으로 이동합니다.
            </p>

            <div className="pt-1">
              <button
                onClick={handleCopyLink}
                className="w-full py-2 px-3 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 flex items-center justify-center gap-1.5 shadow-2xs transition active:scale-95"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-700">전용 링크 복사 완료!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-500" />
                    <span>모바일 전용 URL 복사하기</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Step by step installation */}
        <div className="mt-4 space-y-2">
          <div className="text-xs font-bold text-slate-800">
            📱 안드로이드 크롬(Chrome)에서 설치 방법
          </div>
          <ol className="space-y-1.5 text-xs text-slate-600 pl-1 list-decimal list-inside leading-relaxed bg-slate-50/80 p-3 rounded-xl border border-slate-100">
            <li>
              복사한 전용 URL을 휴대폰 <strong>크롬(Chrome) 주소창</strong>에 붙여넣고 접속합니다.
            </li>
            <li>
              크롬 우측 상단의 <strong>점 세 개(⋮)</strong> 메뉴를 누릅니다.
            </li>
            <li>
              <strong>[홈 화면에 추가]</strong> 또는 <strong>[앱 설치]</strong>를 터치합니다.
            </li>
            <li className="font-semibold text-emerald-700">
              앱 이름이 <strong>'스마트 머니'</strong>로 표시되며 홈 화면에 앱 아이콘이 생성됩니다!
            </li>
          </ol>

          {/* Already Installed Note */}
          <div className="bg-amber-50/80 border border-amber-200/80 rounded-xl p-3 text-xs text-amber-900 leading-relaxed">
            <div className="font-bold flex items-center gap-1.5 text-amber-800 mb-1">
              <span>💡 메뉴에 '스마트 머니 열기'만 보이는 경우</span>
            </div>
            이미 기기에 '스마트 머니' 앱이 설치되어 있는 상태입니다.
            새로운 <strong>골드 코인 아이콘</strong>으로 갱신하시려면:
            <div className="mt-1.5 space-y-1 text-[11px] text-amber-800/90 pl-1">
              <div>1. <strong>[스마트 머니 열기]</strong> 클릭 후 앱 창 우측 상단 메뉴(⋮)에서 <strong>[앱 삭제]</strong> 선택 (또는 홈 화면에서 길게 눌러 삭제)</div>
              <div>2. 브라우저로 돌아와 <strong>새로고침</strong>하시면 다시 <strong>[앱 설치]</strong>가 나타납니다!</div>
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-2xs transition"
        >
          확인
        </button>
      </div>
    </div>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 flex items-center justify-center gap-2 rounded-xl bg-amber-500/95 backdrop-blur-sm px-3 py-2 text-xs font-medium text-white shadow-lg animate-pulse">
      <span className="h-2 w-2 rounded-full bg-white" />
      오프라인 모드 — 저장된 가계부 데이터를 불러왔습니다.
    </div>
  );
};

export const PWAHomeBanner: React.FC = () => {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [dismissed, setDismissed] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled || dismissed) return null;

  return (
    <>
      <div className="p-3.5 bg-gradient-to-r from-emerald-600 to-teal-700 text-white rounded-2xl shadow-sm flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <img
            src="/icon.svg"
            alt="스마트 머니"
            className="w-10 h-10 rounded-xl shadow-xs shrink-0 object-cover border border-white/20"
          />
          <div>
            <div className="text-xs font-bold flex items-center gap-1.5">
              <span>브라우저 없이 앱으로 설치</span>
              <span className="text-[9px] bg-white/25 px-1.5 py-0.5 rounded-full font-medium">
                추천
              </span>
            </div>
            <div className="text-[11px] text-emerald-100 mt-0.5">
              주소창 없는 전체 화면 모바일 전용 앱으로 실행
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => {
              if (isInstallable) {
                install();
              } else {
                setShowGuide(true);
              }
            }}
            className="px-3 py-1.5 bg-white text-emerald-800 hover:bg-emerald-50 rounded-xl text-xs font-bold transition active:scale-95 shadow-2xs whitespace-nowrap"
          >
            앱 설치
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="p-1 text-emerald-200 hover:text-white rounded-lg transition"
            title="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl text-left animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    휴대폰에서 '앱 설치' 메뉴 찾는 방법
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    기종별 브라우저 메뉴 위치 안내
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowGuide(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-3 space-y-3 text-xs text-slate-700">
              {/* Chrome guide */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1.5">
                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>Google Chrome(크롬) 브라우저 사용 시</span>
                </div>
                <div className="text-[11px] text-slate-600 pl-3.5 space-y-1 leading-relaxed">
                  <p>
                    1. 우측 상단 <strong>점 세 개(⋮)</strong>를 누릅니다.
                  </p>
                  <p>
                    2. 메뉴 중 <strong>[홈 화면에 추가]</strong> 또는 <strong>[설치 및 바로가기 만들기]</strong>를 터치합니다.
                  </p>
                  <p>
                    3. 팝업창에서 <strong>[설치]</strong> 버튼을 누르면 주소창 없는 전용 앱으로 등록됩니다.
                  </p>
                </div>
              </div>

              {/* Samsung Internet guide */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1.5">
                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span>삼성 인터넷(Galaxy 기본 브라우저) 사용 시</span>
                </div>
                <div className="text-[11px] text-slate-600 pl-3.5 space-y-1 leading-relaxed">
                  <p>
                    1. 주소창 우측의 <strong>다운로드(⬇) 아이콘</strong>을 누르거나, 우측 하단 <strong>메뉴(≡)</strong>를 누릅니다.
                  </p>
                  <p>
                    2. <strong>[+ 현재 페이지 추가] &gt; [홈 화면]</strong>을 터치합니다.
                  </p>
                </div>
              </div>

              {/* Notice */}
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200/80 text-[11px] text-amber-900 leading-relaxed">
                💡 <strong>알림:</strong> 만약 이전에 홈 화면에 추가해 둔 바로가기가 있다면, 기존 아이콘을 길게 눌러 <strong>[삭제]</strong>하신 후 다시 추가하셔야 브라우저 주소창 없는 신규 독립 앱으로 연결됩니다.
              </div>
            </div>

            <button
              onClick={() => setShowGuide(false)}
              className="mt-4 w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-2xs transition"
            >
              확인
            </button>
          </div>
        </div>
      )}
    </>
  );
};
