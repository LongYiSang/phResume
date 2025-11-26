"use client";

import { Type, Image as ImageIcon, Minus, LayoutTemplate, FolderOpen, Settings, User } from "lucide-react";

type DockProps = {
  onAddText: () => void;
  onAddImage: () => void;
  onAddDivider: () => void;
  onOpenTemplates: () => void;
  onOpenMyResumes: () => void;
  onOpenSettings: () => void;
  onLogout?: () => void;
  disabled?: boolean;
  templatesActive?: boolean;
  savedActive?: boolean;
  assetsActive?: boolean;
  settingsActive?: boolean;
};

export default function Dock({
  onAddText,
  onAddImage,
  onAddDivider,
  onOpenTemplates,
  onOpenMyResumes,
  onOpenSettings,
  onLogout,
  disabled,
  templatesActive,
  savedActive,
  assetsActive,
  settingsActive,
}: DockProps) {
  return (
    <div className="bg-white/80 backdrop-blur-xl border border-white/50 rounded-[32px] shadow-soft px-3 py-6 flex flex-col gap-6 transition-all duration-300 hover:shadow-card z-50">
      <div className="w-12 h-12 bg-gradient-to-br from-kawaii-pink to-kawaii-purple rounded-2xl flex items-center justify-center shadow-lg shadow-kawaii-pink/30 mx-auto">
        <span className="text-white font-bold text-xl">Cv</span>
      </div>

      <div className="flex flex-col gap-3">
        <div className="text-[10px] font-bold text-center text-kawaii-text/40 uppercase tracking-wider">Add</div>
        <DockButton icon={<Type size={22} />} label="Text" onClick={onAddText} disabled={disabled} colorClass="text-kawaii-blue" />
        <DockButton
          icon={<ImageIcon size={22} />}
          label="Image"
          onClick={onAddImage}
          disabled={disabled}
          colorClass="text-kawaii-mint"
          isActive={Boolean(assetsActive)}
        />
        <DockButton icon={<Minus size={22} />} label="Line" onClick={onAddDivider} disabled={disabled} colorClass="text-kawaii-yellow" />
      </div>

      <div className="w-full h-px bg-kawaii-pinkLight" />

      <div className="flex flex-col gap-3">
        <div className="text-[10px] font-bold text-center text-kawaii-text/40 uppercase tracking-wider">Library</div>
        <DockGhostButton
          icon={<LayoutTemplate size={20} />}
          label="Templates"
          onClick={onOpenTemplates}
          isActive={Boolean(templatesActive)}
        />
        <DockGhostButton icon={<FolderOpen size={20} />} label="Saved" onClick={onOpenMyResumes} isActive={Boolean(savedActive)} />
        <DockGhostButton icon={<Settings size={20} />} label="Settings" onClick={onOpenSettings} isActive={Boolean(settingsActive)} />
      </div>

      <div className="w-full h-px bg-kawaii-pinkLight" />

      <div className="flex flex-col gap-3">
        <div className="text-[10px] font-bold text-center text-kawaii-text/40 uppercase tracking-wider">Me</div>
        <DockUserButton onLogout={onLogout} />
      </div>
    </div>
  );
}

function DockButton({
  icon,
  label,
  onClick,
  disabled,
  colorClass,
  isActive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  colorClass: string;
  isActive?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={isActive}
      className="group relative flex flex-col items-center justify-center w-14 h-14 mx-auto transition-all duration-200 active:scale-95 disabled:opacity-50"
    >
      <div
        className={`relative z-10 flex items-center justify-center w-10 h-10 rounded-xl bg-white shadow-sm transition-all duration-300 ease-out group-hover:-translate-y-1 group-hover:shadow-md group-hover:scale-105 ${
          isActive ? "ring-2 ring-kawaii-mint/60" : ""
        }`}
      >
        <span className={colorClass}>{icon}</span>
      </div>
      <span className="pointer-events-none text-[9px] font-bold text-kawaii-text/70 mt-1 opacity-0 translate-y-1 scale-95 transition-all duration-300 ease-out group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100">
        {label}
      </span>
    </button>
  );
}

function DockGhostButton({
  icon,
  label,
  onClick,
  isActive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  isActive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={`group relative flex flex-col items-center justify-center w-14 h-14 mx-auto transition-all duration-200 active:scale-95 ${
        isActive ? "text-kawaii-purple" : ""
      }`}
    >
      <div
        className={`relative z-10 flex items-center justify-center w-10 h-10 rounded-xl bg-white shadow-sm transition-all duration-300 ease-out group-hover:-translate-y-1 group-hover:shadow-md group-hover:scale-105 text-kawaii-purple ${
          isActive ? "ring-2 ring-kawaii-purple/40" : ""
        }`}
      >
        {icon}
      </div>
      <span
        className={`pointer-events-none text-[9px] font-bold text-kawaii-text/70 mt-1 opacity-0 translate-y-1 scale-95 transition-all duration-300 ease-out group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100`}
      >
        {label}
      </span>
    </button>
  );
}

function DockUserButton({ onLogout }: { onLogout?: () => void }) {
  return (
    <div className="group relative flex flex-col items-center justify-center w-14 h-14 mx-auto">
      {/* 主按钮 */}
      <button
        type="button"
        className="relative z-10 flex items-center justify-center w-10 h-10 rounded-xl bg-white shadow-sm transition-all duration-300 ease-out group-hover:shadow-md group-hover:scale-105 text-kawaii-purple hover:bg-kawaii-pinkLight/20"
      >
        <User size={20} />
      </button>

      {/* 悬浮菜单 */}
      <div className="absolute left-full top-0 ml-3 opacity-0 invisible -translate-x-2 group-hover:opacity-100 group-hover:visible group-hover:translate-x-0 transition-all duration-300 ease-out z-50">
        <div className="bg-white/90 backdrop-blur-md border border-white/60 rounded-xl shadow-card p-2 min-w-[120px] flex flex-col gap-1">
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-sm font-medium text-kawaii-text/80 hover:bg-kawaii-pinkLight/30 hover:text-kawaii-purple rounded-lg transition-colors"
            onClick={() => {
              // 预留个人中心跳转
            }}
          >
            个人中心
          </button>
          <div className="h-px bg-kawaii-text/5 w-full my-0.5" />
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-sm font-medium text-red-400 hover:bg-red-50 hover:text-red-500 rounded-lg transition-colors"
            onClick={onLogout}
          >
            退出登录
          </button>
        </div>
        {/* 连接桥，防止鼠标从按钮移到菜单时消失 */}
        <div className="absolute right-full top-0 h-full w-3" />
      </div>
    </div>
  );
}

