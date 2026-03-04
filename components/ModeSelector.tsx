'use client';

import React from 'react';
import { ControlMode } from './ARSession';

interface ModeSelectorProps {
  mode: ControlMode;
  onModeChange: (mode: ControlMode) => void;
}

export default function ModeSelector({ mode, onModeChange }: ModeSelectorProps) {
  const modeCue: Record<ControlMode, string> = {
    move: 'Only translation is enabled',
    rotate: 'Only rotation is enabled',
    resize: 'Only resizing is enabled',
  };

  const modes: { key: ControlMode; label: string; icon: React.ReactNode }[] = [
    {
      key: 'move',
      label: 'Move',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {/* 4-way arrow icon */}
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5v14M8 8l-3 4 3 4M16 8l3 4-3 4M8 8l4-3 4 3M8 16l4 3 4-3" />
        </svg>
      ),
    },
    {
      key: 'rotate',
      label: 'Rotate',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {/* Rotate icon */}
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      ),
    },
    {
      key: 'resize',
      label: 'Resize',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {/* Expand/resize icon */}
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
        </svg>
      ),
    },
  ];

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50">
      <div className="flex gap-3 bg-black/70 backdrop-blur-sm rounded-2xl p-2 shadow-lg">
        {modes.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => onModeChange(key)}
            onTouchEnd={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onModeChange(key);
            }}
            className={`flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all min-w-[72px] ${
              mode === key
                ? 'bg-blue-500 text-white'
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
            style={{ touchAction: 'manipulation' }}
          >
            {icon}
            <span className="text-xs font-medium">{label}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 text-center text-[11px] font-medium text-white/80 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-1">
        {modeCue[mode]}
      </div>
    </div>
  );
}
