"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useMockStore } from "@/lib/mock-store"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"
import { ArrowLeft, Lock, Eye, Key, CheckCircle2, Copy, ExternalLink, AlertTriangle } from "lucide-react"

interface NoteDetailProps {
  noteId: string
}

export function NoteDetail({ noteId }: NoteDetailProps) {
  const router = useRouter()
  const { notes, updateNote, payrollRuns } = useMockStore()
  const [isRevealing, setIsRevealing] = useState(false)
  const [showCopied, setShowCopied] = useState(false)

  const note = notes.find((n: any) => n.noteId === noteId)
  const run = note ? payrollRuns.find((r: any) => r.runId === note.runId) : null

  if (!note) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="mx-auto h-12 w-12 text-muted-foreground/50" />
        <p className="mt-4 text-muted-foreground">Note not found</p>
        <Link href="/employee/inbox">
          <Button variant="outline" className="mt-4 bg-transparent">
            Back to Inbox
          </Button>
        </Link>
      </div>
    )
  }

  const handleReveal = async () => {
    setIsRevealing(true)

    // Simulate decryption delay
    await new Promise((resolve) => setTimeout(resolve, 1500))

    // Decode the "ciphertext" (simulated)
    try {
      const decoded = JSON.parse(atob(note.ciphertext))
      updateNote(noteId, {
        status: "Opened",
        decryptedAmount: decoded.amount.toString(),
        memo: decoded.memo,
      })
    } catch {
      // Fallback for any encoding issues
      updateNote(noteId, {
        status: "Opened",
        decryptedAmount: "1200.00",
        memo: "Payroll payment",
      })
    }

    setIsRevealing(false)
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setShowCopied(true)
    setTimeout(() => setShowCopied(false), 2000)
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8 flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payroll Note</h1>
          <p className="text-muted-foreground">{noteId}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Main Card */}
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-6 py-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-foreground">Note Details</h2>
              <StatusBadge status={note.status} />
            </div>
          </div>
          <div className="p-6">
            {note.status === "Unopened" ? (
              <div className="text-center py-8">
                <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
                  <Lock className="h-10 w-10 text-primary" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-foreground">Encrypted Note</h3>
                <p className="mb-6 text-muted-foreground">Use your private key to reveal the payment amount</p>
                <Button size="lg" onClick={handleReveal} disabled={isRevealing} className="gap-2">
                  {isRevealing ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Decrypting...
                    </>
                  ) : (
                    <>
                      <Key className="h-4 w-4" />
                      Reveal with Private Key
                    </>
                  )}
                </Button>
                <p className="mt-4 text-xs text-muted-foreground">(Simulated - uses demo key)</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="text-center py-4">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent/20">
                    <CheckCircle2 className="h-8 w-8 text-accent" />
                  </div>
                  <p className="text-sm text-muted-foreground">Amount Received</p>
                  <p className="text-4xl font-bold text-foreground">{note.decryptedAmount} ZEC</p>
                  {note.memo && <p className="mt-2 text-sm text-muted-foreground">{note.memo}</p>}
                </div>

                <div className="rounded-lg border border-border bg-muted/50 p-4">
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Status</span>
                      <span className="font-medium text-accent">Decrypted</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Delivered</span>
                      <span className="text-foreground">{new Date(note.deliveredAt).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Run ID</span>
                      <span className="text-foreground">{note.runId}</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 gap-2 bg-transparent"
                    onClick={() => handleCopy(note.decryptedAmount || "")}
                  >
                    <Copy className="h-4 w-4" />
                    {showCopied ? "Copied!" : "Copy Amount"}
                  </Button>
                  <Link href="/employee/claims" className="flex-1">
                    <Button className="w-full gap-2">
                      <ExternalLink className="h-4 w-4" />
                      Claim Funds
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Crypto Details */}
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-6 py-4">
              <h2 className="font-semibold text-foreground">Cryptographic Proof</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Note ID</label>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted px-3 py-2 text-xs text-foreground">{note.noteId}</code>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleCopy(note.noteId)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Payroll Root</label>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted px-3 py-2 text-xs text-foreground truncate">
                    {run?.payrollRoot || "N/A"}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleCopy(run?.payrollRoot || "")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Proof Hash</label>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted px-3 py-2 text-xs text-foreground truncate">
                    {run?.proofHash || "N/A"}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleCopy(run?.proofHash || "")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Info Box */}
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-6">
            <div className="flex gap-4">
              <Eye className="h-5 w-5 text-primary flex-shrink-0" />
              <div>
                <h3 className="font-medium text-foreground">Privacy Preserved</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Only you can decrypt this note using your private key. The employer cannot see your individual payment
                  amount.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
