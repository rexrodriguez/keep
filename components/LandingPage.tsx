'use client';

import React, { useState } from 'react';

export default function LandingPage() {
  const [formState, setFormState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [formError, setFormError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  const scrollToFeatures = () => {
    document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
  };

  const scrollToContact = () => {
    document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormState('sending');
    setFormError('');

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Something went wrong.');
      }

      setFormState('sent');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong.');
      setFormState('error');
    }
  };

  return (
    <div className="min-h-screen bg-[#fafafa] text-gray-900">
      {/* Hero Section */}
      <section className="min-h-screen flex flex-col items-center justify-center px-6 py-16 relative overflow-hidden">
        {/* Subtle background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-transparent to-amber-50 opacity-70" />

        <div className="relative z-10 max-w-2xl mx-auto text-center">
          {/* Logo */}
          <div className="mx-auto mb-8">
            <img
              src="/keep.png"
              alt="Keep"
              className="h-20 w-auto mx-auto"
            />
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4 tracking-tight">
            Measure Anything.
            <br />
            <span className="text-blue-500">Store Everything.</span>
          </h1>

          {/* Subheadline */}
          <p className="text-lg sm:text-xl text-gray-600 mb-10 max-w-lg mx-auto leading-relaxed">
            Point your phone at any object to instantly measure its dimensions and find the perfect storage unit nearby.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={scrollToContact}
              className="px-8 py-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 hover:from-blue-600 hover:to-blue-700 transition-all duration-200"
            >
              Get in Touch
            </button>
            <button
              onClick={scrollToFeatures}
              className="px-8 py-4 border-2 border-gray-300 text-gray-700 font-semibold rounded-xl hover:border-gray-400 hover:bg-gray-50 transition-all duration-200"
            >
              See How It Works
            </button>
          </div>
        </div>

        {/* Visual - Video in phone frame */}
        <div className="relative z-10 mt-16 w-full max-w-xs mx-auto">
          <div className="relative bg-gray-900 rounded-[2.5rem] p-2 shadow-2xl">
            {/* Phone notch */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-6 bg-gray-900 rounded-b-2xl z-20" />

            {/* Screen with video */}
            <div className="relative rounded-[2rem] overflow-hidden">
              <video
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-auto"
                poster="/video-poster.jpg"
              >
                <source src="/video.mp4" type="video/mp4" />
              </video>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-6 bg-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">
            How It Works
          </h2>
          <p className="text-gray-600 text-center mb-12 max-w-lg mx-auto">
            Three simple steps to find your perfect storage unit
          </p>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="bg-gray-50 rounded-2xl p-6 hover:shadow-lg transition-shadow duration-200">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Intuitive 3D Sizing
              </h3>
              <p className="text-gray-600 text-sm leading-relaxed">
                Place a 3D box in AR and adjust it to match your object. Move, rotate, and resize until you get the perfect fit.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="bg-gray-50 rounded-2xl p-6 hover:shadow-lg transition-shadow duration-200">
              <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Perfect Fit Finder
              </h3>
              <p className="text-gray-600 text-sm leading-relaxed">
                Get matched with storage units that fit your items—no more guessing or wasted space.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="bg-gray-50 rounded-2xl p-6 hover:shadow-lg transition-shadow duration-200">
              <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Browser-Based AR
              </h3>
              <div className="text-gray-600 text-sm leading-relaxed space-y-1">
                <p><span className="font-medium text-gray-700">Android:</span> Chrome, Samsung Internet, Edge, or Opera</p>
                <p><span className="font-medium text-gray-700">iOS:</span> Download the free WebXR Viewer app</p>
              </div>
            </div>
          </div>

          {/* Contact Form */}
          <div id="contact" className="mt-16 max-w-md mx-auto">
            <h3 className="text-2xl font-bold text-center text-gray-900 mb-2">
              Interested?
            </h3>
            <p className="text-gray-600 text-center mb-6">
              Drop us a line and we&apos;ll keep you posted.
            </p>

            {formState === 'sent' ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
                <p className="text-green-800 font-medium">Thanks for reaching out!</p>
                <p className="text-green-600 text-sm mt-1">We&apos;ll get back to you soon.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <input
                  type="text"
                  placeholder="Name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <input
                  type="email"
                  placeholder="Email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <textarea
                  placeholder="Message (optional)"
                  rows={3}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
                {formState === 'error' && (
                  <p className="text-red-500 text-sm">{formError}</p>
                )}
                <button
                  type="submit"
                  disabled={formState === 'sending'}
                  className={`w-full py-4 rounded-xl font-semibold text-lg transition-all duration-200 ${
                    formState === 'sending'
                      ? 'bg-blue-400 text-white/70 cursor-not-allowed'
                      : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 hover:from-blue-600 hover:to-blue-700'
                  }`}
                >
                  {formState === 'sending' ? 'Sending...' : 'Send Message'}
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 bg-gray-100 border-t border-gray-200">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-gray-500 text-sm">
            &copy; 2026 Keep. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
