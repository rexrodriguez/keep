'use client';

import React from 'react';

export type TutorialStep = 'surface' | 'move' | 'rotate' | 'resize' | 'tip' | 'done' | 'complete';

interface TutorialOverlayProps {
  step: TutorialStep;
  onNext: () => void;
  onSkip: () => void;
}

const stepContent: Record<TutorialStep, { title: string; description: string; showNext: boolean; buttonText?: string }> = {
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
  tip: {
    title: 'Pro Tip',
    description: 'For greater accuracy, aim the reticle at the handle you want to manipulate before touching.',
    showNext: true,
  },
  done: {
    title: "You're Ready!",
    description: 'Try measuring a few different objects to get the hang of it. Practice makes perfect!',
    showNext: true,
    buttonText: 'Got it',
  },
  complete: {
    title: '',
    description: '',
    showNext: false,
  },
};

const TUTORIAL_STEPS: TutorialStep[] = ['surface', 'move', 'rotate', 'resize', 'tip', 'done'];

export default function TutorialOverlay({ step, onNext, onSkip }: TutorialOverlayProps) {
  if (step === 'complete') {
    return null;
  }

  const content = stepContent[step];

  const currentIndex = TUTORIAL_STEPS.indexOf(step);

  return (
    <div className="fixed inset-x-0 top-12 flex justify-center pointer-events-none z-50">
      <div className="bg-black/60 backdrop-blur-sm rounded-xl p-3 mx-4 max-w-xs pointer-events-auto shadow-lg border border-white/10">
        {/* Compact header with step indicator */}
        <div className="flex items-center gap-2 mb-2">
          <div className="flex gap-1">
            {TUTORIAL_STEPS.map((s, i) => (
              <div
                key={s}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  s === step
                    ? 'bg-blue-400'
                    : currentIndex > i
                    ? 'bg-blue-400/50'
                    : 'bg-white/20'
                }`}
              />
            ))}
          </div>
          <h3 className="text-white/90 font-medium text-sm flex-1">{content.title}</h3>
        </div>

        {/* Description */}
        <p className="text-white/60 text-xs mb-2 leading-relaxed">{content.description}</p>

        {/* Compact actions */}
        <div className="flex gap-2">
          <button
            onClick={onSkip}
            className="py-1.5 px-2 rounded-md text-xs font-medium text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            Skip
          </button>
          {content.showNext && (
            <button
              onClick={onNext}
              className="py-1.5 px-3 rounded-md text-xs font-medium bg-blue-500/80 text-white hover:bg-blue-500 transition-colors ml-auto"
            >
              {content.buttonText || 'Next'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
