/**
 * frontend/components/ui/privacy-stack.tsx
 * Monochrome stack of privacy layers — no color, all hierarchy.
 */
"use client";

import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Shield, Zap, Cpu, Database } from "lucide-react";

export interface PrivacyLayer {
  id: number;
  icon: React.ReactNode;
  label: string;
  sublabel: string;
}

export const PRIVACY_LAYERS: PrivacyLayer[] = [
  { id: 0, icon: <Database className="h-4 w-4" />, label: "Nillion nilDB",      sublabel: "%allot secret shares" },
  { id: 1, icon: <Cpu      className="h-4 w-4" />, label: "Nillion nilCC TEE",  sublabel: "Enclave computation" },
  { id: 2, icon: <Shield   className="h-4 w-4" />, label: "Groth16 ZK",         sublabel: "circom + snarkjs claim" },
  { id: 3, icon: <Zap      className="h-4 w-4" />, label: "MagicBlock Private", sublabel: "TEE split + delay routing" },
];

export function PrivacyStackVisualizer({ activeLayer }: { activeLayer?: number }) {
  return (
    <div className="flex flex-col gap-2 w-full max-w-[300px]">
      {PRIVACY_LAYERS.map((layer, i) => {
        const isActive = activeLayer === i;
        const isPast = activeLayer !== undefined && activeLayer > i;

        return (
          <motion.div
            key={layer.id}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0, scale: isActive ? 1.02 : 1 }}
            transition={{ delay: i * 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-md transition-colors duration-300",
              isActive
                ? "border-white/40 bg-white/[0.06]"
                : isPast
                  ? "border-white/15 bg-white/[0.03] opacity-70"
                  : "border-white/[0.06] bg-white/[0.02]",
            )}
          >
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg",
                isActive ? "bg-white text-black" : "bg-white/[0.04] text-white/60",
              )}
            >
              {layer.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn("text-[11px] font-semibold tracking-tight", isActive ? "text-white" : "text-white/70")}>
                {layer.label}
              </p>
              <p className="text-[9px] text-white/35 truncate uppercase tracking-[0.18em] font-medium">
                {layer.sublabel}
              </p>
            </div>
            {isActive && (
              <motion.div
                className="h-1.5 w-1.5 rounded-full bg-white"
                animate={{ scale: [1, 1.6, 1], opacity: [1, 0.4, 1] }}
                transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
              />
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
