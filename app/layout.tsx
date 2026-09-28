import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Transcript – audio & video to text",
  description: "Upload a recording and get a clean, accurate transcript.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
