/**
 * frontend/components/ui/privacy-stack.tsx
 * Animated vertical stack of privacy layers for Civitas V2.
 */
"use client";

import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Shield, Lock, Zap, Cpu, Database } from "lucide-react";

export interface PrivacyLayer {
  id: number;
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  color: string;
  glow: string;
}

export const PRIVACY_LAYERS: PrivacyLayer[] = [
  { 
    id: 0, 
    icon: <Database className="h-4 w-4" />, 
    label: "Nillion nilDB", 
    sublabel: "%allot secret shares", 
    color: "text-violet-400",
    glow: "shadow-[0_0_15px_rgba(139,92,246,0.3)] border-violet-500/30 bg-violet-500/5"
  },
  { 
    id: 1, 
    icon: <Cpu className="h-4 w-4" />, 
    label: "Nillion nilCC TEE", 
    sublabel: "Enclave computation", 
    color: "text-purple-400",
    glow: "shadow-[0_0_15px_rgba(168,85,247,0.3)] border-purple-500/30 bg-purple-500/5"
  },
  { 
    id: 2, 
    icon: <Shield className="h-4 w-4" />, 
    label: "Noir UltraHonk ZK", 
    sublabel: "Anonymous claiming", 
    color: "text-blue-400",
    glow: "shadow-[0_0_15px_rgba(59,130,246,0.3)] border-blue-500/30 bg-blue-500/5"
  },
  { 
    id: 3, 
    icon: <Zap className="h-4 w-4" />, 
    label: "MagicBlock Private Pay", 
    sublabel: "Sealed amount transfer", 
    color: "text-amber-400",
    glow: "shadow-[0_0_15px_rgba(245,158,11,0.3)] border-amber-500/30 bg-amber-500/5"
  },
  { 
    id: 4, 
    icon: <Lock className="h-4 w-4" />, 
    label: "Cloak Pool", 
    sublabel: "Unlinkable settlement", 
    color: "text-emerald-400",
    glow: "shadow-[0_0_15px_rgba(16,185,129,0.3)] border-emerald-500/30 bg-emerald-500/5"
  },
];

export function PrivacyStackVisualizer({ activeLayer }: { activeLayer?: number }) {
  return (
    <div className="flex flex-col gap-2 w-full max-w-[280px]">
      {PRIVACY_LAYERS.map((layer, i) => {
        const isActive = activeLayer === i;
        const isPast = activeLayer !== undefined && activeLayer > i;
        
        return (
          <motion.div
            key={layer.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ 
              opacity: 1, 
              x: 0,
              scale: isActive ? 1.02 : 1,
            }}
            transition={{ delay: i * 0.1 }}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-300 backdrop-blur-md",
              isActive 
                ? cn("border-opacity-100", layer.glow) 
                : isPast 
                  ? "border-white/10 bg-white/[0.05] opacity-60"
                  : "border-white/5 bg-white/[0.02] opacity-40"
            )}
          >
            <div className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg bg-white/5",
              isActive ? layer.color : "text-white/40"
            )}>
              {layer.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn(
                "text-[11px] font-bold tracking-tight transition-colors",
                isActive ? "text-white" : "text-white/40"
              )}>
                {layer.label}
              </p>
              <p className="text-[9px] text-white/30 truncate uppercase tracking-widest font-medium">
                {layer.sublabel}
              </p>
            </div>
            {isActive && (
              <motion.div
                className={cn("h-1.5 w-1.5 rounded-full", layer.color.replace("text-", "bg-"))}
                animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
              />
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
