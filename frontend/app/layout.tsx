import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meeting Lens — Real-Time AI Meeting Assistant",
  description: "A consent-based meeting assistant for live transcription, summaries, action items, and follow-up questions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
