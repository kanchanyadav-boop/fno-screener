import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NSE F&O Breakdown Screener",
  description: "Detect HH+HL uptrend to lower low breakdown in NSE F&O stocks",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
