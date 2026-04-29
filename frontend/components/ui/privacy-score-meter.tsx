/**
 * frontend/components/ui/privacy-score-meter.tsx
 * Circular/Arc meter showing organization privacy health score.
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
        {/* Background Circle */}
        <svg className="h-full w-full transform -rotate-90">
          <circle
            cx="64"
            cy="64"
            r={radius}
            fill="transparent"
            stroke="currentColor"
            strokeWidth="8"
            className="text-white/5"
          />
          {/* Progress Circle */}
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
            transition={{ duration: 2, ease: "easeOut" }}
            strokeLinecap="round"
          />
          <defs>
            <linearGradient id="privacy-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#8b5cf6" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
          </defs>
        </svg>
        
        {/* Center Content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-white leading-none">{score}</span>
          <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest mt-1">Grade A</span>
        </div>
      </div>
      
      <div className="mt-4 flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
        <ShieldCheck className="h-3.5 w-3.5" />
        <span className="text-[10px] font-bold uppercase tracking-widest">Enterprise Privacy Active</span>
      </div>
    </div>
  );
}
