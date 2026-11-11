"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { clientAuth, useSession } from "./Session";
export function Shell({ children }: { children: React.ReactNode }) {
  const { user, account } = useSession();
  const path = usePathname();
  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/">
          <img src="/enigma-e.svg" width="30" height="30" alt="" />
          <span>
            VEP<small>ENIGMA GENOMICS</small>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          {[
            ["/", "Annotate"],
            ["/projects", "Projects"],
            ["/pricing", "Pricing"],
            ["/account", "Usage"],
          ].map(([href, label]) => (
            <Link
              className={path === href ? "active" : ""}
              href={href}
              key={href}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="session-nav">
          {account && (
            <Link className="balance" href="/account">
              {account.totalCredits.toLocaleString()} credits
            </Link>
          )}
          {user ? (
            <button className="quiet" onClick={() => signOut(clientAuth())}>
              Sign out
            </button>
          ) : (
            <Link className="button primary small" href="/login">
              Sign in
            </Link>
          )}
        </div>
      </header>
      <main key={user?.uid || "guest"}>{children}</main>
      <footer>
        <span>VEP · Enigma Genomics</span>
        <span>GRCh38 · Ensembl 115 · ClinVar</span>
      </footer>
    </>
  );
}
