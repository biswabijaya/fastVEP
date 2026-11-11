"use client";
import { useState } from "react";
import Link from "next/link";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
} from "firebase/auth";
import { clientAuth, useSession } from "../../src/components/Session";
export default function Login() {
  const { user, loading } = useSession();
  const [register, setRegister] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch {
      setMessage(
        "Unable to complete sign-in. Check your details and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <p role="status">Loading your account…</p>;
  if (user)
    return (
      <section className="panel auth">
        <span className="eyebrow">YOUR ACCOUNT</span>
        <h1>{user.emailVerified ? "You’re signed in" : "Verify your email"}</h1>
        <p>{user.email}</p>
        {user.emailVerified ? (
          <Link className="button primary" href="/">
            Start annotating →
          </Link>
        ) : (
          <>
            <p>
              Open the verification link in your inbox before using annotation
              credits.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await sendEmailVerification(user);
                  setMessage("Verification email sent.");
                })
              }
            >
              Resend email
            </button>
            <button
              className="quiet"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await user.reload();
                  await user.getIdToken(true);
                  window.location.assign("/");
                })
              }
            >
              I’ve verified my email
            </button>
          </>
        )}
        {message && <p role="status">{message}</p>}
      </section>
    );
  return (
    <section className="panel auth">
      <span className="eyebrow">WELCOME TO VEP</span>
      <h1>{register ? "Create your account" : "Sign in to annotate"}</h1>
      <p>
        300 free credits every day. Your results and usage belong to your
        account.
      </p>
      <button
        className="google"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await signInWithPopup(clientAuth(), new GoogleAuthProvider());
            window.location.assign("/");
          })
        }
      >
        Continue with Google
      </button>
      <div className="divider">or use email</div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            if (register) {
              const c = await createUserWithEmailAndPassword(
                clientAuth(),
                email,
                password,
              );
              await sendEmailVerification(c.user);
              setMessage("Verification email sent.");
            } else {
              await signInWithEmailAndPassword(clientAuth(), email, password);
              window.location.assign("/");
            }
          });
        }}
      >
        <label>
          Email address
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            minLength={8}
            autoComplete={register ? "new-password" : "current-password"}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
        </button>
      </form>
      <button
        className="quiet"
        disabled={busy}
        onClick={() => setRegister(!register)}
      >
        {register
          ? "Already have an account? Sign in"
          : "New here? Create an account"}
      </button>
      <button
        className="quiet"
        disabled={busy || !email}
        onClick={() =>
          run(async () => {
            await sendPasswordResetEmail(clientAuth(), email);
            setMessage(
              "If this email has an account, a password reset link will be sent.",
            );
          })
        }
      >
        Reset password
      </button>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
