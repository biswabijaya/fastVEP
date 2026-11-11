import { FieldPath } from "firebase-admin/firestore";
import { database } from "./admin";
import { normalizeWallet, walletView } from "../lib/credits";
import { projectExpiry, type Project } from "../lib/project-policy";
import type { Account } from "./wallet";

/** Project uploads are disabled: these records cannot yet own storage objects.
 * Extend this collector to delete persistent objects before enabling uploads.
 * Access checks reject expiry at the cutoff; physical collection can run later.
 */
export async function cleanupExpiredProjects(now = Date.now()) {
  let cursor: string | undefined;
  let deleted = 0;
  const db = database();
  do {
    let query = db.collection("accounts").orderBy(FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const accounts = await query.get();
    if (accounts.empty) break;
    for (const account of accounts.docs) {
      const data = account.data() as Account;
      if (!data.wallet) continue;
      const free = walletView(normalizeWallet(data.wallet, now), now).plan === "free";
      const projects = await account.ref.collection("projects").get();
      for (const project of projects.docs) {
        const expiry = projectExpiry(project.data() as Project, free);
        if (expiry !== null && expiry <= now) {
          // Expiry is irreversible; retries must not debit or resurrect records.
          await db.recursiveDelete(project.ref);
          deleted++;
        }
      }
    }
    cursor = accounts.docs.at(-1)?.id;
    if (accounts.size < 100) break;
  } while (cursor);
  return { deleted };
}
