/**
 * frontend/components/ui/privacy-score-meter.tsx
 * Monochrome arc meter — score on a single white→fade gradient ring.
 */
"use client";

import React from "react";
import { motion } from "framer-motion";
import { ShieldCheck } from "lucide-react";

export function PrivacyScoreMeter({ score = 98 }: { score?: number }) {
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-32 w-32">
        <svg className="h-full w-full transform -rotate-90" viewBox="0 0 128 128">
          <circle cx="64" cy="64" r={radius} fill="transparent" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
          <motion.circle
            cx="64"
            cy="64"
            r={radius}
            fill="transparent"
            stroke="url(#privacy-gradient)"
            strokeWidth="8"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
            strokeLinecap="round"
          />
          <defs>
            <linearGradient id="privacy-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(255,255,255,1)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.35)" />
            </linearGradient>
          </defs>
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-[34px] font-semibold text-white leading-none tracking-[-0.03em]">{score}</span>
          <span className="text-[9px] font-semibold text-white/45 uppercase tracking-[0.25em] mt-1.5">Grade A</span>
        </div>
      </div>

      <div className="mt-5 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.10] text-white/85">
        <ShieldCheck className="h-3 w-3" />
        <span className="text-[9px] font-semibold uppercase tracking-[0.22em]">Enterprise Privacy Active</span>
      </div>
    </div>
  );
}
