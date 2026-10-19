import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Practice Room — AI Interview Preparation",
  description: "Practice interview questions with role-aware answers, transcripts, and coaching notes.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
