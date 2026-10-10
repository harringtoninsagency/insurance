"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import brightwayLogo from "@/assets/branding/brightway-harrington-horizontal-deep-blue.png";
import { SignOutButton } from "./SignOutButton";

interface NavLink {
  href: string;
  label: string;
}

interface Props {
  navLinks: NavLink[];
  name: string;
  roleLabel: string;
}

/** The sidebar's mobile equivalent: a top bar with a hamburger toggle, shown only below md. */
export function MobileNav({ navLinks, name, roleLabel }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-slate-200 bg-white md:hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <Image src={brightwayLogo} alt="Brightway Insurance | The Harrington Agency" className="h-8 w-auto" priority />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="rounded border border-slate-300 p-2 text-[#003049]"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" /> : <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />}
          </svg>
        </button>
      </div>
      <div className="h-[3px] w-full bg-[#F0FF00]" />
      {open && (
        <div className="border-t border-slate-200 px-4 py-3">
          <ul className="space-y-1 text-sm">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded px-3 py-2 font-medium text-[#003049] hover:bg-[#003049]/5"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
            <div className="text-xs">
              <div className="truncate font-medium text-slate-800">{name}</div>
              <div className="text-slate-500">{roleLabel}</div>
            </div>
            <Link
              href="/account"
              onClick={() => setOpen(false)}
              className="block rounded border border-slate-300 px-3 py-1.5 text-center text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              My account
            </Link>
            <SignOutButton />
          </div>
        </div>
      )}
    </div>
  );
}
