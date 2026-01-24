'use client';

import React from 'react';

export type TutorialStep = 'surface' | 'move' | 'rotate' | 'resize' | 'complete';

interface TutorialOverlayProps {
  step: TutorialStep;
  onNext: () => void;
  onSkip: () => void;
}

const stepContent: Record<TutorialStep, { title: string; description: string; showNext: boolean }> = {
  surface: {
    title: 'Find a Flat Surface',
    description: 'Point your camera at the floor until the reticle appears, then tap to place a box.',
    showNext: false, // Auto-advances when box is placed
  },
  move: {
    title: 'Move the Box',
    description: 'Touch and drag the lower corner handles to move the box around.',
    showNext: true,
  },
  rotate: {
    title: 'Rotate the Box',
    description: 'Touch and drag the upper corner handles to rotate the box.',
    showNext: true,
  },
  resize: {
    title: 'Resize the Box',
    description: 'Touch and drag the arrow handles on each face to resize length, width, and height.',
    showNext: true,
  },
  complete: {
    title: '',
    description: '',
    showNext: false,
  },
};

export default function TutorialOverlay({ step, onNext, onSkip }: TutorialOverlayProps) {
  if (step === 'complete') {
    return null;
  }

  const content = stepContent[step];

  return (
    <div className="fixed inset-x-0 top-16 flex justify-center pointer-events-none z-50">
      <div className="bg-black/90 backdrop-blur-md rounded-2xl p-4 mx-4 max-w-sm pointer-events-auto shadow-xl border border-white/10">
        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex gap-1">
            {['surface', 'move', 'rotate', 'resize'].map((s, i) => (
              <div
                key={s}
                className={`w-2 h-2 rounded-full transition-colors ${
                  s === step
                    ? 'bg-blue-500'
                    : ['surface', 'move', 'rotate', 'resize'].indexOf(step) > i
                    ? 'bg-blue-500/50'
                    : 'bg-white/20'
                }`}
              />
            ))}
          </div>
          <span className="text-white/40 text-xs ml-auto">
            Step {['surface', 'move', 'rotate', 'resize'].indexOf(step) + 1} of 4
          </span>
        </div>

        {/* Content */}
        <h3 className="text-white font-semibold text-lg mb-1">{content.title}</h3>
        <p className="text-white/70 text-sm mb-4">{content.description}</p>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onSkip}
            className="flex-1 py-2 px-3 rounded-lg text-sm font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            Skip Tutorial
          </button>
          {content.showNext && (
            <button
              onClick={onNext}
              className="flex-1 py-2 px-3 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
