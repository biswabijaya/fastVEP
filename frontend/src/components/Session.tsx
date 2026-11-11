"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  connectAuthEmulator,
  type User,
} from "firebase/auth";
const config = {
  apiKey: "AIzaSyDm8LXwz1QABPkDH-qzmi3oUJa7Brq2PRo",
  authDomain: "enigmagenomics.firebaseapp.com",
  projectId: "enigmagenomics",
  appId: "1:903636395933:web:96ecc917f62476f569f174",
};
const emulatorMode = process.env.NEXT_PUBLIC_FASTVEP_EMULATORS === "true";
export function clientAuth() {
  const existing = getApps().find((a) => a.name === "fastvep-client");
  if (existing) return getAuth(existing);
  const app = initializeApp(
    emulatorMode
      ? {
          apiKey: "fake",
          projectId: "demo-fastvep",
          authDomain: "localhost",
          appId: "demo-fastvep",
        }
      : config,
    "fastvep-client",
  );
  const auth = getAuth(app);
  if (emulatorMode) {
    if (
      typeof window !== "undefined" &&
      !["localhost", "127.0.0.1"].includes(window.location.hostname)
    )
      throw new Error("Demo authentication is restricted to localhost.");
    connectAuthEmulator(auth, "http://127.0.0.1:9098");
  }
  return auth;
}
export type Account = {
  dailyCredits: number;
  subscriptionCredits: number;
  totalCredits: number;
  dailyRefreshAt: number;
  subscriptionCreditsExpireAt: number | null;
  plan: string;
  planId: string | null;
  monthlyCreditAllocation: number;
  includedServices: { clinical: boolean; reporting: boolean; ai: boolean };
  cadence: string | null;
  paidThrough: number | null;
  email: string;
  activeJob: string | null;
};
const Context = createContext<{
  user: User | null;
  loading: boolean;
  account: Account | null;
  error: string;
  refresh: () => Promise<void>;
  api: (url: string, init?: RequestInit) => Promise<Response>;
}>({
  user: null,
  loading: true,
  account: null,
  error: "",
  refresh: async () => {},
  api: async () => {
    throw new Error("Sign in to continue.");
  },
});
export function Session({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [account, setAccount] = useState<Account | null>(null),
    [error, setError] = useState("");
  useEffect(
    () =>
      onAuthStateChanged(clientAuth(), (u) => {
        setUser(u);
        setAccount(null);
        setError("");
        setLoading(false);
      }),
    [],
  );
  const api = useCallback(async (url: string, init: RequestInit = {}) => {
    const u = clientAuth().currentUser;
    if (!u) throw new Error("Sign in to continue.");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await u.getIdToken()}`);
    return fetch(url, { ...init, headers, cache: "no-store" });
  }, []);
  const refresh = useCallback(async () => {
    if (!clientAuth().currentUser?.emailVerified) return;
    try {
      const r = await api("/api/account");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setAccount(d.account);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load credits.");
    }
  }, [api]);
  useEffect(() => {
    if (user?.emailVerified) void refresh();
  }, [user, refresh]);
  useEffect(() => {
    if (!user?.emailVerified) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60000);
    return () => clearInterval(timer);
  }, [user, refresh]);
  return (
    <Context.Provider value={{ user, loading, account, error, refresh, api }}>
      {children}
    </Context.Provider>
  );
}
export const useSession = () => useContext(Context);
