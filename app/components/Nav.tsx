"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Breakdown Screen" },
  { href: "/dow-uptrend", label: "Dow Theory Trends" },
];

export function Nav() {
  const path = usePathname();

  return (
    <nav className="sticky top-0 z-50 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800">
      <div className="max-w-2xl mx-auto px-4 py-2.5 flex items-center gap-1.5">
        <span className="text-[11px] font-bold text-gray-400 mr-2 uppercase tracking-widest">
          NSE F&amp;O
        </span>
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              path === l.href
                ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
