import React, { useState } from "react";
import { useFinance } from "../../context/FinanceContext";
import type { Transaction } from "../../types/finance";
import { AccountLedgerModal } from "../transactions/AccountLedgerModal";
import { AddTransactionModal } from "../transactions/AddTransactionModal";
import { CsvImportModal } from "../modals/CsvImportModal";
import {
  CreditCard,
  Building,
  RefreshCw,
  Plus,
  Receipt,
  RotateCcw,
  CheckCircle,
  ExternalLink,
  ShieldCheck,
  Trash2,
  X,
  Sparkles,
  Smartphone,
  Check,
  Database,
  Download,
  Upload,
  HardDrive,
  FileSpreadsheet,
  ChevronRight,
} from "lucide-react";

const PRESET_BANKS = [
  { name: "카카오뱅크", color: "#FEE500", textColor: "#000000" },
  { name: "신한은행", color: "#0046FF", textColor: "#ffffff" },
  { name: "KB국민은행", color: "#FFBC00", textColor: "#000000" },
  { name: "토스뱅크", color: "#0064FF", textColor: "#ffffff" },
  { name: "우리은행", color: "#0078D7", textColor: "#ffffff" },
  { name: "하나은행", color: "#008485", textColor: "#ffffff" },
  { name: "NH농협은행", color: "#00A859", textColor: "#ffffff" },
  { name: "IBK기업은행", color: "#1D428A", textColor: "#ffffff" },
  { name: "새마을금고", color: "#009639", textColor: "#ffffff" },
];

const PRESET_CARDS = [
  { name: "현대카드", color: "#000000", textColor: "#ffffff" },
  { name: "신한카드", color: "#0046FF", textColor: "#ffffff" },
  { name: "삼성카드", color: "#0C4DA2", textColor: "#ffffff" },
  { name: "KB국민카드", color: "#FFBC00", textColor: "#000000" },
  { name: "롯데카드", color: "#ED1C24", textColor: "#ffffff" },
  { name: "우리카드", color: "#0078D7", textColor: "#ffffff" },
  { name: "하나카드", color: "#008485", textColor: "#ffffff" },
  { name: "BC카드", color: "#E02020", textColor: "#ffffff" },
  { name: "토스페이카드", color: "#0064FF", textColor: "#ffffff" },
];

export const ConnectedAssetsView: React.FC<{
  onOpenSMSModal: () => void;
}> = ({ onOpenSMSModal }) => {
  const {
    accounts,
    allTransactions,
    syncAccounts,
    isSyncing,
    lastSyncTime,
    resetToSample,
    resetToClean,
    exportDatabaseFile,
    importDatabaseFile,
    refreshDbData,
    dbStats,
    addAccount,
    deleteAccount,
  } = useFinance();

  // Add Account / Card Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [accType, setAccType] = useState<"BANK" | "CARD">("CARD");
  const [selectedPreset, setSelectedPreset] = useState("현대카드");
  const [customInstName, setCustomInstName] = useState("");
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [initialAmount, setInitialAmount] = useState("");
  const [syncMode, setSyncMode] = useState<"SMS" | "OPEN_BANKING">("OPEN_BANKING");
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Per-account ledger, CSV import and manual entry
  const [ledgerAccountId, setLedgerAccountId] = useState<string | null>(null);
  const [csvAccountId, setCsvAccountId] = useState<string | null>(null);
  const [txModal, setTxModal] = useState<{
    open: boolean;
    editing: Transaction | null;
    accountId?: string;
  }>({ open: false, editing: null });

  const bankAccounts = accounts.filter((a) => a.type === "BANK");
  const cardAccounts = accounts.filter((a) => a.type === "CARD");

  const totalBankBalance = bankAccounts.reduce(
    (sum, a) => sum + a.balanceOrBilled,
    0
  );
  const totalCardBilled = cardAccounts.reduce(
    (sum, a) => sum + a.balanceOrBilled,
    0
  );

  const handleOpenAddModal = (defaultType: "BANK" | "CARD" = "CARD") => {
    setAccType(defaultType);
    if (defaultType === "CARD") {
      setSelectedPreset("현대카드");
      setName("현대카드 M");
      setIdentifier("카드 뒷자리 4518");
      setInitialAmount("450000");
    } else {
      setSelectedPreset("카카오뱅크");
      setName("카카오뱅크 생활비 통장");
      setIdentifier("3333-01-xxxx");
      setInitialAmount("1500000");
    }
    setCustomInstName("");
    setShowAddModal(true);
  };

  const handlePresetSelect = (presetName: string) => {
    setSelectedPreset(presetName);
    if (accType === "CARD") {
      setName(`${presetName} 주사용`);
    } else {
      setName(`${presetName} 입출금`);
    }
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const inst =
      selectedPreset === "직접 입력" ? customInstName.trim() : selectedPreset;
    if (!inst) {
      alert("금융기관 또는 카드사 이름을 입력해주세요.");
      return;
    }

    const currentPresets = accType === "BANK" ? PRESET_BANKS : PRESET_CARDS;
    const presetObj = currentPresets.find((p) => p.name === inst);
    const color = presetObj ? presetObj.color : "#10B981";

    addAccount({
      name: name.trim() || `${inst} ${accType === "BANK" ? "계좌" : "카드"}`,
      type: accType,
      institution: inst,
      identifier: identifier.trim() || (accType === "BANK" ? "xxxx-xx-xxxx" : "xxxx-xxxx"),
      balanceOrBilled: Math.max(0, parseInt(initialAmount.replace(/[^0-9]/g, ""), 10) || 0),
      color,
      isAutoSyncEnabled: true,
    });

    setShowAddModal(false);
    setFeedbackMsg(`'${inst}' ${accType === "BANK" ? "계좌" : "카드"}가 성공적으로 등록 및 연동되었습니다!`);
    setTimeout(() => setFeedbackMsg(null), 3500);
  };

  const handleDelete = (id: string, accName: string) => {
    if (confirm(`'${accName}' 연동을 해제하고 삭제하시겠습니까?`)) {
      deleteAccount(id);
    }
  };

  return (
    <div className="space-y-4 pt-1">
      {/* Success Feedback Notification */}
      {feedbackMsg && (
        <div className="bg-emerald-600 text-white rounded-2xl p-3.5 shadow-md flex items-center gap-2 text-xs font-bold animate-in fade-in slide-in-from-top-2">
          <CheckCircle className="w-4 h-4 shrink-0 text-emerald-200" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* Top Banner with Primary Add Buttons */}
      <div className="bg-white rounded-3xl p-5 border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">
              연동된 자산 (카드 & 통장)
            </h2>
            <p className="text-[11px] text-slate-500">
              카드·통장 내역을 엑셀·CSV로 가져와 카드별로 관리합니다
            </p>
          </div>

          <button
            onClick={syncAccounts}
            disabled={isSyncing}
            className="flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-xl text-xs font-bold transition disabled:opacity-50 active:scale-95"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin" : ""}`}
            />
            <span>{isSyncing ? "새로고침 중..." : "새로고침"}</span>
          </button>
        </div>

        {/* Primary action: bring a statement in */}
        <button
          onClick={() => setCsvAccountId(accounts[0]?.id ?? "")}
          disabled={accounts.length === 0}
          className="w-full flex items-center justify-between gap-2 p-3.5 rounded-2xl bg-slate-900 hover:bg-slate-800 active:scale-98 text-white transition disabled:opacity-40 shadow-xs"
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <FileSpreadsheet className="w-5 h-5 text-emerald-400 shrink-0" />
            <span className="text-left min-w-0">
              <span className="block text-xs font-bold">카드내역 · 통장내역 가져오기</span>
              <span className="block text-[10px] text-slate-400">
                은행·카드사에서 받은 .xls · .xlsx · .csv 파일을 올리세요
              </span>
            </span>
          </span>
          <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
        </button>

        {/* Big Action Buttons to Register New Card or Bank Account */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            id="register-card-btn"
            onClick={() => handleOpenAddModal("CARD")}
            className="flex items-center justify-center gap-2 p-3 rounded-2xl bg-amber-500 hover:bg-amber-600 active:scale-98 text-white font-bold text-xs shadow-xs transition"
          >
            <Plus className="w-4 h-4" />
            <span>신용·체크카드 등록</span>
          </button>

          <button
            id="register-bank-btn"
            onClick={() => handleOpenAddModal("BANK")}
            className="flex items-center justify-center gap-2 p-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white font-bold text-xs shadow-xs transition"
          >
            <Plus className="w-4 h-4" />
            <span>통장 계좌 등록</span>
          </button>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1 text-emerald-600 font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>기기 안에서만 처리됩니다</span>
          </div>
          <span>마지막 갱신: {lastSyncTime}</span>
        </div>
      </div>

      {/* Quick Summary Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-indigo-50/70 rounded-2xl p-3.5 border border-indigo-100 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] font-bold text-indigo-900 mb-1">
            <div className="flex items-center gap-1.5">
              <Building className="w-3.5 h-3.5 text-indigo-600" />
              <span>통장 계좌 총 잔액</span>
            </div>
            <span className="text-[10px] bg-indigo-200/60 text-indigo-800 px-1.5 py-0.2 rounded-full font-bold">
              {bankAccounts.length}개
            </span>
          </div>
          <div className="text-base font-black text-indigo-950 mt-1">
            {totalBankBalance.toLocaleString()}원
          </div>
          <span className="text-[10px] text-indigo-600 mt-1">
            실시간 출금 가능액
          </span>
        </div>

        <div className="bg-amber-50/70 rounded-2xl p-3.5 border border-amber-100 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] font-bold text-amber-900 mb-1">
            <div className="flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5 text-amber-600" />
              <span>카드 결제 예정액</span>
            </div>
            <span className="text-[10px] bg-amber-200/60 text-amber-800 px-1.5 py-0.2 rounded-full font-bold">
              {cardAccounts.length}개
            </span>
          </div>
          <div className="text-base font-black text-amber-950 mt-1">
            {totalCardBilled.toLocaleString()}원
          </div>
          <span className="text-[10px] text-amber-700 mt-1">
            이번 달 총 청구 예정
          </span>
        </div>
      </div>

      {/* SMS Fast Parser Action Card */}
      <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white rounded-3xl p-4 shadow-sm flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <Smartphone className="w-4 h-4 text-emerald-200" />
            <h3 className="text-xs font-bold">결제 문자(SMS) 자동 인식 등록</h3>
          </div>
          <p className="text-[11px] text-emerald-100">
            카드 결제 및 은행 입출금 문자를 복사해 붙여넣으면 즉시 가계부에 등록됩니다.
          </p>
        </div>
        <button
          onClick={onOpenSMSModal}
          className="px-3.5 py-2 rounded-xl bg-white text-emerald-800 text-xs font-bold hover:bg-emerald-50 active:scale-95 transition shrink-0 shadow-2xs ml-3"
        >
          문자 등록
        </button>
      </div>

      {/* Bank Accounts Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
            <Building className="w-4 h-4 text-indigo-600" />
            <span>은행 입출금 계좌 ({bankAccounts.length}개)</span>
          </div>
          <button
            onClick={() => handleOpenAddModal("BANK")}
            className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-0.5"
          >
            <Plus className="w-3 h-3" />
            <span>계좌 추가</span>
          </button>
        </div>

        <div className="space-y-2">
          {bankAccounts.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
              등록된 은행 계좌가 없습니다. [계좌 추가] 버튼을 눌러 등록해주세요.
            </div>
          ) : (
            bankAccounts.map((acc) => (
              <div
                key={acc.id}
                onClick={() => setLedgerAccountId(acc.id)}
                className="p-3.5 bg-white rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between hover:border-emerald-400 hover:bg-emerald-50/30 transition cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-2xs"
                    style={{ backgroundColor: acc.color }}
                  >
                    {acc.institution.substring(0, 2)}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-900">
                        {acc.name}
                      </span>
                      <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md font-semibold">
                        {allTransactions.filter((t) => t.accountId === acc.id).length}건
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {acc.institution} • {acc.identifier}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm font-black text-slate-900">
                      {acc.balanceOrBilled.toLocaleString()}원
                    </div>
                    <div className="text-[10px] text-slate-400">계좌 잔액</div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(acc.id, acc.name);
                    }}
                    title="계좌 연동 삭제"
                    className="p-1.5 text-slate-300 hover:text-rose-500 rounded-lg transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Credit/Debit Cards Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
            <CreditCard className="w-4 h-4 text-amber-600" />
            <span>신용 / 체크카드 ({cardAccounts.length}개)</span>
          </div>
          <button
            onClick={() => handleOpenAddModal("CARD")}
            className="text-[11px] font-bold text-amber-600 hover:text-amber-700 flex items-center gap-0.5"
          >
            <Plus className="w-3 h-3" />
            <span>카드 추가</span>
          </button>
        </div>

        <div className="space-y-2">
          {cardAccounts.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
              등록된 카드가 없습니다. [카드 추가] 버튼을 눌러 등록해주세요.
            </div>
          ) : (
            cardAccounts.map((acc) => (
              <div
                key={acc.id}
                onClick={() => setLedgerAccountId(acc.id)}
                className="p-3.5 bg-white rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between hover:border-emerald-400 hover:bg-emerald-50/30 transition cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-2xs"
                    style={{ backgroundColor: acc.color }}
                  >
                    {acc.institution.substring(0, 2)}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-900">
                        {acc.name}
                      </span>
                      <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md font-semibold">
                        {allTransactions.filter((t) => t.accountId === acc.id).length}건
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {acc.institution} • {acc.identifier}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm font-black text-slate-900">
                      {acc.balanceOrBilled.toLocaleString()}원
                    </div>
                    <div className="text-[10px] text-slate-400">이번 달 청구예정</div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(acc.id, acc.name);
                    }}
                    title="카드 연동 삭제"
                    className="p-1.5 text-slate-300 hover:text-rose-500 rounded-lg transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* SQLite Database Management Section */}
      <div className="p-4 bg-slate-900 text-white rounded-2xl shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold flex items-center gap-1.5">
                <span>기기 내 SQLite 데이터베이스</span>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-mono px-1.5 py-0.5 rounded-full">
                  v{dbStats?.schemaVersion ?? "-"}
                </span>
              </div>
              <div className="text-[10px] text-slate-400">
                내 가계부만 표시 · 앱을 갱신해도 데이터는 유지됩니다
              </div>
            </div>
          </div>

          <button
            onClick={() => refreshDbData()}
            title="DB 상태 새로고침"
            className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* DB Metrics Grid */}
        <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-800 text-center">
          <div className="p-2 bg-slate-800/60 rounded-xl">
            <div className="text-[10px] text-slate-400">저장 크기</div>
            <div className="text-xs font-mono font-bold text-slate-100">
              {dbStats?.sizeBytes
                ? `${(dbStats.sizeBytes / 1024).toFixed(1)} KB`
                : "-"}
            </div>
          </div>
          <div className="p-2 bg-slate-800/60 rounded-xl">
            <div className="text-[10px] text-slate-400">연동 자산/계좌</div>
            <div className="text-xs font-mono font-bold text-slate-100">
              {dbStats?.userAccounts ?? accounts.length}개
            </div>
          </div>
          <div className="p-2 bg-slate-800/60 rounded-xl">
            <div className="text-[10px] text-slate-400">저장된 거래내역</div>
            <div className="text-xs font-mono font-bold text-slate-100">
              {dbStats?.userTransactions ?? 0}건
            </div>
          </div>
        </div>

        {/* Database Actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={exportDatabaseFile}
            className="flex-1 min-w-[120px] py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition active:scale-95 shadow-2xs"
          >
            <Download className="w-3.5 h-3.5" />
            <span>백업 파일 내려받기</span>
          </button>

          <label className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium flex items-center justify-center gap-1 transition cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>백업 복원</span>
            <input
              type="file"
              accept=".db,.sqlite,application/x-sqlite3"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (
                  !confirm(
                    "이 기기의 현재 가계부를 백업 파일 내용으로 덮어씁니다. 계속할까요?"
                  )
                ) {
                  return;
                }
                try {
                  await importDatabaseFile(file);
                  alert("백업을 복원했습니다.");
                } catch (error) {
                  console.error(error);
                  alert("백업 파일을 읽지 못했습니다. 올바른 .db 파일인지 확인해주세요.");
                }
              }}
            />
          </label>

          <button
            onClick={() => {
              if (
                confirm(
                  "이 기기의 가계부를 비우시겠습니까?\n기본 카테고리만 남고 카드/계좌 및 거래내역이 삭제됩니다."
                )
              ) {
                resetToClean();
              }
            }}
            className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium flex items-center justify-center gap-1 transition"
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>배포용 클린 DB</span>
          </button>

          <button
            onClick={() => {
              if (confirm("초기 샘플 데이터로 복원하시겠습니까?")) {
                resetToSample();
              }
            }}
            className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium flex items-center justify-center gap-1 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>샘플 복원</span>
          </button>
        </div>
      </div>

      {/* Register Account / Card Modal Dialog */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div
                  className={`w-7 h-7 rounded-xl flex items-center justify-center text-white ${
                    accType === "CARD" ? "bg-amber-500" : "bg-indigo-600"
                  }`}
                >
                  {accType === "CARD" ? (
                    <CreditCard className="w-4 h-4" />
                  ) : (
                    <Building className="w-4 h-4" />
                  )}
                </div>
                <h3 className="text-sm font-bold text-slate-900">
                  {accType === "CARD" ? "새 카드 등록 및 연동" : "새 통장 계좌 등록 및 연동"}
                </h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-4">
              {/* Type Switcher Tab */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1.5">
                  구분 선택
                </label>
                <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-2xl">
                  <button
                    type="button"
                    onClick={() => {
                      setAccType("CARD");
                      setSelectedPreset("현대카드");
                      setName("현대카드");
                    }}
                    className={`py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      accType === "CARD"
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5 text-amber-500" />
                    <span>신용 / 체크카드</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAccType("BANK");
                      setSelectedPreset("카카오뱅크");
                      setName("카카오뱅크");
                    }}
                    className={`py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      accType === "BANK"
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <Building className="w-3.5 h-3.5 text-indigo-600" />
                    <span>은행 통장 계좌</span>
                  </button>
                </div>
              </div>

              {/* Presets Grid */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1.5">
                  {accType === "CARD" ? "카드사 선택" : "은행 선택"}
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(accType === "CARD" ? PRESET_CARDS : PRESET_BANKS).map((preset) => {
                    const isSel = selectedPreset === preset.name;
                    return (
                      <button
                        type="button"
                        key={preset.name}
                        onClick={() => handlePresetSelect(preset.name)}
                        className={`p-2 rounded-xl text-xs font-semibold border text-center transition flex items-center justify-center gap-1.5 ${
                          isSel
                            ? "border-emerald-600 bg-emerald-50 text-emerald-900 font-bold ring-1 ring-emerald-600"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: preset.color }}
                        />
                        <span className="truncate text-[11px]">{preset.name}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setSelectedPreset("직접 입력")}
                    className={`p-2 rounded-xl text-xs border text-center transition text-[11px] font-medium ${
                      selectedPreset === "직접 입력"
                        ? "border-emerald-600 bg-emerald-50 text-emerald-900 font-bold ring-1 ring-emerald-600"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    직접 입력
                  </button>
                </div>

                {selectedPreset === "직접 입력" && (
                  <input
                    type="text"
                    required
                    placeholder={accType === "CARD" ? "카드사 이름 (예: 비씨카드)" : "은행 이름 (예: 케이뱅크)"}
                    value={customInstName}
                    onChange={(e) => setCustomInstName(e.target.value)}
                    className="mt-2 w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-emerald-600"
                  />
                )}
              </div>

              {/* Account / Card Name */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1">
                  별칭 / 카드명
                </label>
                <input
                  type="text"
                  required
                  placeholder="예: 현대카드 M, 급여통장, 생활비 체크카드"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 focus:outline-emerald-600 font-medium"
                />
              </div>

              {/* Identifier */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1">
                  {accType === "CARD" ? "카드 번호 (식별용)" : "계좌 번호 (식별용)"}
                </label>
                <input
                  type="text"
                  placeholder={
                    accType === "CARD"
                      ? "예: 카드 뒷자리 4자리 (4518) 또는 1234-****"
                      : "예: 3333-01-xxxx"
                  }
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 focus:outline-emerald-600"
                />
              </div>

              {/* Initial Balance or Billed Amount */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1">
                  {accType === "CARD" ? "이번 달 결제 예정액 (원)" : "현재 계좌 잔액 (원)"}
                </label>
                <input
                  type="text"
                  placeholder="0"
                  value={initialAmount}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, "");
                    setInitialAmount(val ? Number(val).toLocaleString() : "");
                  }}
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 focus:outline-emerald-600 font-bold"
                />
              </div>

              {/* Sync Mode */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                <div className="flex items-center gap-1.5 text-emerald-700 text-xs font-bold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>자동 연동 설정</span>
                </div>
                <p className="text-[10px] text-slate-500">
                  결제 승인 SMS 문자 수신 시 자동으로 이 카드/계좌의 내역으로 인식하여 지출이 분류됩니다.
                </p>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white text-xs font-bold shadow-xs transition"
                >
                  등록 및 연동 완료
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Per-account ledger */}
      <AccountLedgerModal
        isOpen={Boolean(ledgerAccountId)}
        accountId={ledgerAccountId || ""}
        onClose={() => setLedgerAccountId(null)}
        onEdit={(tx) => setTxModal({ open: true, editing: tx })}
        onAdd={() =>
          setTxModal({
            open: true,
            editing: null,
            accountId: ledgerAccountId || undefined,
          })
        }
        onImport={() => setCsvAccountId(ledgerAccountId)}
      />

      {/* Add or edit a single entry */}
      <AddTransactionModal
        isOpen={txModal.open}
        editing={txModal.editing}
        defaultAccountId={txModal.accountId}
        onClose={() => setTxModal({ open: false, editing: null })}
      />

      {/* Statement import */}
      <CsvImportModal
        isOpen={csvAccountId !== null}
        defaultAccountId={csvAccountId || undefined}
        onClose={() => setCsvAccountId(null)}
      />
    </div>
  );
};
