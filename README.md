# Little Circle

A responsive, invitation-only website for private one-to-one chats between friends. Accounts are created by you in Supabase; there is no public registration form. Includes email/password login, an account directory, friend search, real-time text messages, earlier-message loading, and mobile layouts.

## What is free?

| Service | Use | Free-tier notes |
| --- | --- | --- |
| GitHub Pages | Hosts the static website over HTTPS | Free with a public repository. Site source and frontend settings are public. No backend server runs on GitHub Pages. |
| Supabase | Hosted PostgreSQL database, authentication, and Realtime | Free plan currently includes 500 MB database space, 50,000 monthly active users, and two active free projects. Projects can pause after a week of inactivity. Realtime and bandwidth have quotas too. |

This combination is suitable for a small personal friend group, within free quotas. It is not a guarantee of unlimited usage or permanent free pricing. Check [Supabase pricing](https://supabase.com/pricing) and [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) before launching. Firebase Spark is another free-tier option, but this project is built for Supabase; do not create a second database.

## 1. Create your free cloud database

1. Sign in at [supabase.com](https://supabase.com/) and create a **Free** organization/project.
2. Pick a region near your friends. Generate a strong **database password** and save it privately in your password manager. It does NOT go in this website.
3. Wait until the project is ready.
4. Open **SQL Editor**, create a new query, paste all of [supabase/schema.sql](./supabase/schema.sql), and click **Run**. Run this once on a new project; the transaction prevents partial setup if something fails. It creates profiles, messages, access rules, account-creation triggers, and Realtime publication.
5. In **Authentication → Sign In / Providers** (dashboard wording may vary), keep Email enabled and turn **Allow new users to sign up OFF**. Keep anonymous sign-ins OFF. This setting is essential: hiding registration in the website does not stop API registrations.
6. In the project's **Connect** dialog or **Settings → API Keys**, copy the project URL and **publishable** key (`sb_publishable_...`). A legacy `anon` key also works. These two values are public frontend settings.

**Never use the secret key, `service_role` key, database password, or a database connection string in frontend code, GitHub variables, or commits.** Access to messages is enforced by database row-level security, not by hiding the public key.

## 2. Create accounts for your friends

1. Open **Authentication → Users → Add user → Create new user**.
2. Enter each friend's email and a unique strong password; enable **Auto Confirm User** for accounts you have verified personally. This avoids dependence on email delivery for initial sign-in.
3. Repeat for your own account. Do not share one login between people.
4. In **Table Editor → profiles**, edit each generated `display_name` to their name. Keep names distinct so friends can identify the correct recipient. Do not change the `id`.
5. Share the website URL and each person's initial credentials **privately**, never in the public repository. Everyone in this invited circle can see other members' display names, but not their emails or other people's conversations.

Users added before the SQL setup are also given profiles. New users receive profiles automatically. For a forgotten password, the project owner must verify the requester and use Supabase's supported administrator password-reset/user-management tools. A public recovery flow and email delivery are not configured in this starter. If you later enable reset/invite emails, configure your own SMTP provider, appropriate rate limits, and allowed redirect URLs first.

## 3. Run locally

Install Node.js 22.12+ (or a supported newer LTS).

```sh
cd /Users/BN82045/Desktop/friend-chat
npm install
cp .env.example .env
```

Edit `.env`:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_public_key
```

```sh
npm run dev
```

Open the local URL printed by Vite. Restart the dev server after changing `.env`. Without settings, the website displays setup instructions and disables login. This is not a fake demo: live chat needs your Supabase project.

```sh
npm test
npm run build
```

Tests execute the actual schema in an embedded PostgreSQL engine with simulated Supabase auth roles. They check participant-only reads, sender impersonation prevention, anonymous access denial, immutable messages/profiles, and message limits. Realtime networking and hosted authentication still need a live-project smoke test.

## 4. Publish using GitHub Pages

Use a **new personal repository**, not the company mobile-app repository. Do not upload `.env` or `node_modules`.

1. Use the personal repository [ArjunC322/Frinedly-chat](https://github.com/ArjunC322/Frinedly-chat). Keep it **public** for free GitHub Pages hosting.
2. For the first upload from a fresh local copy, run:

   ```sh
   git init -b main
   git add .
   git commit -m "Create Little Circle chat website"
   git remote add origin https://github.com/ArjunC322/Frinedly-chat.git
   git push -u origin main
   ```

3. In GitHub **Settings → Secrets and variables → Actions → Variables**, add repository variables:
   - `VITE_SUPABASE_URL`: your project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: your public publishable key
4. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**.
5. Open **Actions → Deploy Little Circle → Run workflow** on `main`. Future pushes to `main` deploy automatically. The build intentionally fails if public connection settings are missing or unsafe.
6. Wait for the workflow to succeed. Your site will be `https://arjunc322.github.io/Frinedly-chat/`.
7. In Supabase **Authentication → URL Configuration**, set **Site URL** to that complete HTTPS URL. This app uses direct password sign-in (no OAuth/email redirect). If you later add redirect-based auth, add explicit allowed callback URLs too.

The workflow configures the correct `/Frinedly-chat/` asset base automatically. Preserve the repository name's spelling and capitalization. For a user-site repository or a custom domain serving at `/`, change the workflow build option to `--base=/`.

Supabase project creation, account creation, repository variables, and enabling GitHub Pages require your own Supabase/GitHub access. Uploading the code alone does not make live chat available.

## 5. Verify with two accounts

1. Open the deployed site in two separate browser profiles (or normal + private mode).
2. Sign in as two different friends; select each other.
3. Send messages both ways; they should appear without reloading. Refresh to confirm persistence.
4. Try multiline text, friend search, mobile view, signing out, and more than 50 messages to test history loading.
5. Sign in as a third friend: they must not see the first pair's conversation. The included database tests check this restriction independently of the UI.
6. If messages do not update live, verify `messages` is enabled in the `supabase_realtime` publication and check the visible connection/error status. The app also checks messages every 15 seconds while visible.

## Privacy, limits, and ownership

- Messages go over HTTPS directly to Supabase, not to a GitHub backend.
- **Not end-to-end encrypted**: project administrators and the database provider can access stored messages. Do not use this starter for highly sensitive conversations.
- All invited users can message any other invited user. There are no friend requests, blocking, attachments, group chats, read receipts, or push notifications.
- Session tokens persist in browser storage. Sign out on shared devices. Unsaved drafts exist only in memory and disappear at sign-out or refresh.
- Messages are immutable through the client. Only the project administrator can delete/moderate them. Deleting a Supabase user deletes their profile and related messages.
- This starter has no per-user anti-spam throttling or automated backups. Invite trusted friends only. Monitor Supabase usage, manage retention, export backups privately, and review quotas before opening access more broadly.
- External Google Fonts requests are used for typography, with local system-font fallbacks.
- Free Supabase projects may pause during inactivity; restore a paused project in the dashboard. No uptime guarantee is provided.
