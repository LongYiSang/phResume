"use client";

import { Type, Image as ImageIcon, Minus, LayoutTemplate, FolderOpen } from "lucide-react";

type DockProps = {
  onAddText: () => void;
  onAddImage: () => void;
  onAddDivider: () => void;
  onOpenTemplates: () => void;
  onOpenMyResumes: () => void;
  disabled?: boolean;
  templatesActive?: boolean;
  savedActive?: boolean;
};

export default function Dock({ onAddText, onAddImage, onAddDivider, onOpenTemplates, onOpenMyResumes, disabled, templatesActive, savedActive }: DockProps) {
  return (
    <div className="bg-white/80 backdrop-blur-xl border border-white/50 rounded-[32px] shadow-soft px-3 py-6 flex flex-col gap-6 transition-all duration-300 hover:shadow-card">
      <div className="w-12 h-12 bg-gradient-to-br from-kawaii-pink to-kawaii-purple rounded-2xl flex items-center justify-center shadow-lg shadow-kawaii-pink/30 mx-auto">
        <span className="text-white font-bold text-xl">Cv</span>
      </div>

      <div className="flex flex-col gap-3">
        <div className="text-[10px] font-bold text-center text-kawaii-text/40 uppercase tracking-wider">Add</div>
        <DockButton icon={<Type size={22} />} label="Text" onClick={onAddText} disabled={disabled} colorClass="text-kawaii-blue" />
        <DockButton icon={<ImageIcon size={22} />} label="Image" onClick={onAddImage} disabled={disabled} colorClass="text-kawaii-mint" />
        <DockButton icon={<Minus size={22} />} label="Line" onClick={onAddDivider} disabled={disabled} colorClass="text-kawaii-yellow" />
      </div>

      <div className="w-full h-px bg-kawaii-pinkLight" />

      <div className="flex flex-col gap-3">
        <div className="text-[10px] font-bold text-center text-kawaii-text/40 uppercase tracking-wider">Library</div>
        <DockGhostButton icon={<LayoutTemplate size={20} />} label="Templates" onClick={onOpenTemplates} isActive={Boolean(templatesActive)} />
        <DockGhostButton icon={<FolderOpen size={20} />} label="Saved" onClick={onOpenMyResumes} isActive={Boolean(savedActive)} />
      </div>
    </div>
  );
}

function DockButton({ icon, label, onClick, disabled, colorClass }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; colorClass: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group relative flex flex-col items-center justify-center w-14 h-14 mx-auto transition-all duration-200 active:scale-95 disabled:opacity-50"
    >
      <div className="relative z-10 flex items-center justify-center w-10 h-10 rounded-xl bg-white shadow-sm transition-all duration-300 ease-out group-hover:-translate-y-1 group-hover:shadow-md group-hover:scale-105">
        <span className={colorClass}>{icon}</span>
      </div>
      <span className="pointer-events-none text-[9px] font-bold text-kawaii-text/70 mt-1 opacity-0 translate-y-1 scale-95 transition-all duration-300 ease-out group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100">
        {label}
      </span>
    </button>
  );
}

function DockGhostButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col items-center justify-center w-14 h-14 mx-auto transition-all duration-200 active:scale-95"
    >
      <div className={`relative z-10 flex items-center justify-center w-10 h-10 rounded-xl bg-white shadow-sm transition-all duration-300 ease-out group-hover:-translate-y-1 group-hover:shadow-md group-hover:scale-105 text-kawaii-purple`}>
        {icon}
      </div>
      <span className={`pointer-events-none text-[9px] font-bold text-kawaii-text/70 mt-1 opacity-0 translate-y-1 scale-95 transition-all duration-300 ease-out group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100`}>
        {label}
      </span>
    </button>
  );
}