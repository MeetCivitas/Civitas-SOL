"use client"

import { useState } from "react"
import Link from "next/link"
import { useMockStore } from "@/lib/mock-store"
import { StatusBadge } from "@/components/ui/status-badge"
import { Lock, Eye, Calendar, ArrowRight, Inbox, Filter } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

const TABS = ["All", "Unopened", "Opened"]

export function EmployeeInbox() {
  const [activeTab, setActiveTab] = useState("All")
  const { notes, payrollRuns } = useMockStore()

  const employeeId = "emp_001"
  const myNotes = notes.filter((n: any) => n.recipientId === employeeId)

  const filteredNotes = activeTab === "All" ? myNotes : myNotes.filter((n: any) => n.status === activeTab)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-8"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-400 uppercase tracking-widest mb-1">Messages</p>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60 tracking-tight">
            Inbox
          </h1>
          <p className="text-white/50 mt-1">Your encrypted payroll notes and secure documents</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border border-white/10 bg-[#0a0a0a] p-1.5 w-fit">
          <div className="pl-3 pr-2 flex items-center text-white/30">
            <Filter className="h-4 w-4" />
          </div>
          {TABS.map((tab) => {
            const isActive = activeTab === tab
            const count = tab === "All" ? myNotes.length : myNotes.filter((n: any) => n.status === tab).length

            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`relative rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                  isActive ? "text-white" : "text-white/40 hover:text-white/80"
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="inboxTab"
                    className="absolute inset-0 rounded-lg bg-blue-500/20 border border-blue-500/30"
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-2">
                  {tab}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      isActive ? "bg-blue-500/30 text-blue-300 border border-blue-500/40" : "bg-white/5 text-white/40 border border-white/10"
                    }`}
                  >
                    {count}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Notes List */}
      <div className="glass-card rounded-2xl border-white/10 bg-[#0a0a0a] overflow-hidden">
        {filteredNotes.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 border border-white/10">
              <Inbox className="h-8 w-8 text-white/20" />
            </div>
            <h3 className="text-lg font-semibold text-white/80">No Notes Found</h3>
            <p className="mt-2 text-white/40 text-sm max-w-sm mx-auto">
              You don&apos;t have any {activeTab.toLowerCase()} payroll notes at the moment.
              When payroll is processed, your encrypted notes will appear here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            <AnimatePresence mode="popLayout">
              {filteredNotes.map((note: any, index: number) => {
                const run = payrollRuns.find((r: any) => r.runId === note.runId)
                const isUnopened = note.status === "Unopened"

                return (
                  <motion.div
                    key={note.noteId}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <Link
                      href={`/employee/inbox/${note.noteId}`}
                      className="flex flex-col sm:flex-row sm:items-center gap-4 px-6 py-5 transition-colors hover:bg-white/5 group relative"
                    >
                      {isUnopened && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 rounded-r-full" />
                      )}

                      <div
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-all ${
                          isUnopened
                            ? "bg-blue-500/10 border border-blue-500/20 group-hover:bg-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.15)] group-hover:shadow-[0_0_20px_rgba(59,130,246,0.25)]"
                            : "bg-white/5 border border-white/10"
                        }`}
                      >
                        {isUnopened ? (
                          <Lock className="h-5 w-5 text-blue-400" />
                        ) : (
                          <Eye className="h-5 w-5 text-white/30" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <p className={`font-semibold ${isUnopened ? "text-white" : "text-white/70"}`}>
                            Payroll Encrypted Note
                          </p>
                          <StatusBadge status={note.status} />
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-white/40">
                          <span className="flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded-md border border-white/5">
                            <Calendar className="h-3.5 w-3.5 text-white/30" />
                            {new Date(note.deliveredAt).toLocaleDateString()}
                          </span>
                          <span className="font-mono text-[10px] uppercase tracking-wider">
                            Tx: {note.runId.slice(-8)}
                          </span>
                        </div>
                      </div>

                      <div className="sm:text-right flex sm:flex-col justify-between sm:justify-start items-center sm:items-end mt-4 sm:mt-0">
                        <p className={`font-mono font-bold tracking-tight text-lg ${isUnopened ? "text-white/40" : "text-white"}`}>
                          {note.status === "Opened" && note.decryptedAmount
                            ? `${note.decryptedAmount} USDC`
                            : note.maskedAmount}
                        </p>
                        <p className={`text-xs mt-1 uppercase tracking-widest font-semibold ${isUnopened ? "text-blue-400" : "text-emerald-400"}`}>
                          {isUnopened ? "Tap to reveal" : "Revealed"}
                        </p>
                      </div>

                      <div className="hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 group-hover:bg-blue-500/10 transition-colors ml-4">
                        <ArrowRight className="h-4 w-4 text-white/20 group-hover:text-blue-400 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </Link>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  )
}
