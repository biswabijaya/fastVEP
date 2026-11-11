import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./style.css";
import { Session } from "../src/components/Session";
import { Shell } from "../src/components/Shell";
export const metadata: Metadata = {
  title: "VEP | Enigma Genomics",
  description: "Variant consequence annotation with transparent usage credits",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Session>
          <Shell>{children}</Shell>
        </Session>
      </body>
    </html>
  );
}
