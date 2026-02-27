"use client";

import { AnimatedBackground } from "@/components/animated-background";
import { AppSidebar } from "@/components/app-sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen">
      <AnimatedBackground />
      <div className="relative z-10 flex min-h-screen">
      <AppSidebar />
      <main className="flex-1 pl-[220px]">
        <div className="mx-auto w-full max-w-7xl px-6 py-6">{children}</div>
      </main>
      </div>
    </div>
  );
}
