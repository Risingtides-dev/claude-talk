"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Conversation } from "@/components/Conversation";

type Session = {
  sessionId: string;
  cwd?: string;
  summary?: string;
  firstPrompt?: string;
  lastModified?: number;
};

export default function Page() {
  const [active, setActive] = useState<Session | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Render nothing during SSR + first client paint to dodge hydration
    // mismatches from localStorage-driven state.
    return <div className="app" suppressHydrationWarning />;
  }

  return (
    <div className="app">
      <div className="sidebar-wrap">
        <Sidebar
          activeSessionId={active?.sessionId}
          onSelect={(s) => {
            setActive(s);
            setPickerOpen(false);
          }}
        />
      </div>

      {/* Mobile-only top bar with current session + picker toggle */}
      <button
        className="mobile-topbar"
        onClick={() => setPickerOpen((v) => !v)}
        aria-label="Switch session"
      >
        <span className="mobile-title">
          {active?.summary ?? active?.firstPrompt ?? "Pick a session"}
        </span>
        <span className="chev">{pickerOpen ? "▴" : "▾"}</span>
      </button>

      {pickerOpen && (
        <div
          className="mobile-picker"
          onClick={(e) => e.target === e.currentTarget && setPickerOpen(false)}
        >
          <div className="mobile-picker-inner">
            <Sidebar
              activeSessionId={active?.sessionId}
              onSelect={(s) => {
                setActive(s);
                setPickerOpen(false);
              }}
            />
          </div>
        </div>
      )}

      <Conversation
        session={active}
        onSessionResolved={(id) => {
          if (active && id !== active.sessionId) {
            setActive({ ...active, sessionId: id });
          }
        }}
      />

      <style jsx>{`
        .app {
          display: flex;
          height: 100dvh;
          overflow: hidden;
        }
        .mobile-topbar,
        .mobile-picker {
          display: none;
        }

        @media (max-width: 760px) {
          .sidebar-wrap {
            display: none;
          }
          .mobile-topbar {
            display: flex;
            align-items: center;
            gap: 8px;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            /* Reserve space for the iOS status bar in PWA standalone mode */
            height: calc(48px + env(safe-area-inset-top, 0px));
            padding: env(safe-area-inset-top, 0px) 14px 0 14px;
            z-index: 30;
            background: hsl(var(--bg-100));
            border-bottom: 1px solid hsl(var(--border-300) / 0.12);
            color: hsl(var(--text-200));
            font-size: 13px;
            text-align: left;
          }
          .mobile-title {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-weight: 500;
          }
          .chev {
            color: hsl(var(--text-400));
            font-size: 11px;
          }
          .mobile-picker {
            display: block;
            position: fixed;
            top: calc(48px + env(safe-area-inset-top, 0px));
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 25;
            background: rgba(0, 0, 0, 0.6);
          }
          .mobile-picker-inner {
            background: hsl(var(--bg-200));
            max-height: 70dvh;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
            overscroll-behavior: contain;
          }
          .mobile-picker-inner :global(aside.sidebar) {
            height: auto;
            max-height: 70dvh;
          }
          .mobile-picker-inner :global(.sidebar-list) {
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
          }
        }
      `}</style>
    </div>
  );
}
