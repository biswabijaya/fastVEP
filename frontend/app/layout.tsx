import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title: "fastVEP | Enigma Genomics",
  description: "Variant consequence annotation",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
