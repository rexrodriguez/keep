'use client';

import React, { useState } from 'react';
import { MeasuredItem } from '@/lib/types';

interface ItemListViewProps {
  items: MeasuredItem[];
  onDelete: (id: string) => void;
  onAddMore: () => void;
  onFindStorage: () => void;
}

export default function ItemListView({ items, onDelete, onAddMore, onFindStorage }: ItemListViewProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const totalCuFt = items.reduce((sum, item) =>
    sum + item.width_m * item.depth_m * item.height_m * 35.3147, 0);

  if (items.length === 0) {
    return (
      <div className="scrollable-page flex flex-col items-center justify-center min-h-screen bg-gray-900 px-6">
        <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-white mb-2">No items yet</h2>
        <p className="text-gray-400 text-sm mb-6 text-center">
          Measure your first item in AR to get started
        </p>
        <button
          onClick={onAddMore}
          className="py-3 px-8 rounded-xl font-medium bg-blue-500 text-white active:bg-blue-600 transition-colors"
        >
          Start Measuring
        </button>
      </div>
    );
  }

  return (
    <div className="scrollable-page flex flex-col min-h-screen bg-gray-900">
      {/* Header */}
      <div className="p-4 safe-area-top">
        <h1 className="text-xl font-bold text-white">Your Items</h1>
        <p className="text-gray-400 text-sm">{items.length} item{items.length !== 1 ? 's' : ''} measured</p>
      </div>

      {/* Scrollable item list */}
      <div className="flex-1 overflow-y-auto px-4 space-y-3">
        {items.map(item => {
          const isExpanded = expandedId === item.id;
          const wIn = Math.round(item.width_m * 39.3701);
          const dIn = Math.round(item.depth_m * 39.3701);
          const hIn = Math.round(item.height_m * 39.3701);
          const volCuFt = (item.width_m * item.depth_m * item.height_m * 35.3147).toFixed(1);

          return (
            <div key={item.id} className="bg-gray-800 rounded-xl overflow-hidden">
              {/* Main row - always visible */}
              <div
                className="flex items-center gap-3 p-3 cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
              >
                {item.thumbnail ? (
                  <img src={item.thumbnail} className="w-14 h-14 rounded-lg object-cover flex-shrink-0" alt="" />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-gray-700 flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-medium">{wIn}&quot; x {dIn}&quot; x {hIn}&quot;</div>
                  <div className="text-gray-400 text-xs">{volCuFt} cu ft</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                  className="text-gray-500 hover:text-red-400 p-2 flex-shrink-0"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-3 pb-3 border-t border-gray-700">
                  {item.thumbnail && (
                    <img src={item.thumbnail} className="w-full h-48 object-cover rounded-lg mt-3 mb-3" alt="" />
                  )}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-white font-bold">{wIn}&quot;</div>
                      <div className="text-gray-500 text-xs">Width</div>
                    </div>
                    <div>
                      <div className="text-white font-bold">{dIn}&quot;</div>
                      <div className="text-gray-500 text-xs">Depth</div>
                    </div>
                    <div>
                      <div className="text-white font-bold">{hIn}&quot;</div>
                      <div className="text-gray-500 text-xs">Height</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="p-4 safe-area-bottom bg-gray-900 border-t border-gray-800">
        <div className="text-gray-400 text-sm mb-3 text-center">
          Total: {totalCuFt.toFixed(1)} cu ft
        </div>
        <div className="flex gap-3">
          <button
            onClick={onAddMore}
            className="flex-1 py-3 px-4 rounded-xl font-medium bg-white/10 text-white active:bg-white/20 transition-colors"
          >
            Add More
          </button>
          <button
            onClick={onFindStorage}
            disabled={items.length === 0}
            className="flex-1 py-3 px-4 rounded-xl font-medium bg-blue-500 text-white active:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Find Storage
          </button>
        </div>
      </div>
    </div>
  );
}
