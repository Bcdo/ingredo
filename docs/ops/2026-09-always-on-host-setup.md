# Moving the Ingredo backend to the always-on Omarchy machine

Handoff for Claude Code running **on the new always-on machine**. Read the
whole file first, then work top to bottom. Everything you need about the
stack itself is in `backend/README.md` under **Production**; this file is the
migration-specific glue around it.

Decision already made by the operator: **start with a fresh, empty database**
(no restore from the laptop's dumps). Consequences and the tester-facing
follow-up are in the last section. If the operator changes their mind, the
"Alternative: restore the laptop's data" section replaces Step 5.

## What you are building

- A checkout of this repo at `~/srv/ingredo`, tracking `master`. This is the
  production server. Nothing is edited here; `backend/deploy.sh` pulls and
  rebuilds.
- The Docker Compose stack `ingredo-prod`: Postgres 17, the .NET API, and a
  `cloudflared` connector that publishes the API as
  `https://api.kodesmien.no`. TLS and DNS are Cloudflare's; nothing on this
  machine listens on a public port.
- A `systemd --user` timer that dumps the database nightly.
- A machine that never sleeps.

## Step 0: things the operator does on the laptop first

Ask the operator to confirm these are done before you touch anything. Do
not proceed until both are true.

1. **Stop the laptop's production stack.** Two `cloudflared` connectors on
   the same tunnel token round-robin traffic; with different databases behind
   them, testers would see data flicker between two worlds.

   ```bash
   cd ~/srv/ingredo/backend
   docker compose -p ingredo-prod -f docker-compose.yml -f docker-compose.prod.yml stop
   systemctl --user disable --now ingredo-backup.timer
   ```

   `stop`, not `down`: the laptop keeps its data volume as a safety net until
   the new machine has run for a while.

2. **Copy the production `.env` to this machine.** Only the tunnel token is
   strictly needed, but copying the file is simplest. From the laptop:

   ```bash
   scp ~/srv/ingredo/backend/.env <this-machine>:~/ingredo-prod.env
   ```

   If the operator prefers not to copy secrets between machines, they can
   instead paste the `TUNNEL_TOKEN` value from the Cloudflare dashboard
   (Zero Trust → Networks → Tunnels → `ingredo` → token). The other two
   values get regenerated in Step 3 anyway.

## Step 1: verify the machine

Omarchy normally ships Docker with the user already in the `docker` group.
Check rather than assume:

```bash
docker --version && docker compose version
docker ps            # must work without sudo
systemctl is-enabled docker
```

If any of those fail: `sudo pacman -S --needed docker docker-compose`,
`sudo systemctl enable --now docker`, `sudo usermod -aG docker "$USER"`,
then log out and back in. `git` and `curl` must be present too (they are on
Omarchy).

## Step 2: clone the production checkout

```bash
mkdir -p ~/srv
git clone git@github.com:Bcdo/ingredo.git ~/srv/ingredo
cd ~/srv/ingredo && git checkout master
```

If the SSH clone fails because this machine has no GitHub key, either use
the HTTPS URL `https://github.com/Bcdo/ingredo.git` (works if the repo is
public or the operator signs in with `gh auth login`), or generate a key
with `ssh-keygen -t ed25519` and have the operator add the public key on
GitHub. `deploy.sh` runs `git pull` later, so whichever method you pick must
work non-interactively.

## Step 3: secrets

```bash
cd ~/srv/ingredo/backend
mv ~/ingredo-prod.env .env        # or: cp .env.example .env
chmod 600 .env
```

Because the database is fresh, regenerate the two secrets that are not
tied to Cloudflare. Fresh values mean every old session token from the
laptop era fails signature verification, so phones are cleanly signed out
instead of hitting confusing "user not found" errors.

```bash
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
sed -i "s|^JWT_KEY=.*|JWT_KEY=$(openssl rand -base64 48 | tr -d '\n')|" .env
grep -c '^TUNNEL_TOKEN=ey' .env    # must print 1; the token is a long JWT-looking string
```

Never print the full `.env` into the conversation.

## Step 4: first deploy

```bash
~/srv/ingredo/backend/deploy.sh
```

This builds the API image (a few minutes the first time), starts Postgres,
lets the API run its own EF migrations against the empty database, and
starts the tunnel connector. Then verify:

```bash
cd ~/srv/ingredo/backend
docker compose -p ingredo-prod -f docker-compose.yml -f docker-compose.prod.yml ps
docker logs ingredo-prod-api-1 --tail 40            # expect migration lines, then "Now listening"
docker logs ingredo-prod-cloudflared-1 --tail 20    # expect "Registered tunnel connection"
curl -fsS https://api.kodesmien.no/health && echo   # expect: Healthy
```

If `/health` fails but the containers are up, the usual cause is the
laptop's connector still being registered. Ask the operator to re-check
Step 0.

## Step 5: fresh database follow-up

The database is empty: no users, no households, no invite codes. Mint a
batch of invite codes for the testers now, one per tester:

```bash
~/srv/ingredo/backend/deploy/mint-invites.sh 15
```

Give the printed codes to the operator. They hand them out, and testers
register again. See the last section for what testers must do on their
phones.

### Alternative: restore the laptop's data

Only if the operator asks for it. On the laptop, run
`~/srv/ingredo/backend/deploy/backup.sh` (the stack's Postgres container
must be running for that; `start postgres` if it was stopped), `scp` the
newest `~/srv/ingredo/backups/ingredo-*.dump` to
`~/srv/ingredo/backups/` here, then follow **Restore** in
`backend/README.md` exactly. In that case keep the laptop's original
`JWT_KEY` instead of regenerating it in Step 3, so testers stay signed in.

## Step 6: nightly backups

```bash
mkdir -p ~/.config/systemd/user
ln -s ~/srv/ingredo/backend/deploy/ingredo-backup.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now ingredo-backup.timer
loginctl enable-linger "$USER"
systemctl --user list-timers | grep ingredo
~/srv/ingredo/backend/deploy/backup.sh && ls -la ~/srv/ingredo/backups/
```

The last line proves a dump works before the first 03:30 run. Linger is
what lets user timers fire when nobody is logged in. Dumps stay on this
disk only; there is no off-machine copy yet.

## Step 7: never sleep

This machine is the server; if it suspends, the API is down. Omarchy runs
`hypridle`, which by default locks and eventually suspends. Check for an
Omarchy helper first:

```bash
ls /usr/bin/omarchy-* ~/.local/share/omarchy/bin 2>/dev/null | grep -i idle
```

If one toggles idle handling, use it. Otherwise edit
`~/.config/hypr/hypridle.conf` and remove or comment out the listener
whose `on-timeout` runs `systemctl suspend`, then restart hypridle.

Belt and braces, so a future config reset cannot bring suspend back:

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

Also make sure the Docker service starts on boot (`systemctl is-enabled
docker` prints `enabled`); the containers are `restart: unless-stopped`, so
a reboot brings the stack back by itself.

## Step 8: hand back

Report to the operator:

- `/health` output and the `docker compose ps` table.
- The invite codes from Step 5.
- Confirmation that the backup timer is listed and a manual dump exists.
- How suspend was disabled.

Then remind them of the laptop cleanup below.

## Laptop cleanup (operator, later)

After the new machine has served traffic for a day or two, on the laptop:

```bash
cd ~/srv/ingredo/backend
docker compose -p ingredo-prod -f docker-compose.yml -f docker-compose.prod.yml down   # add -v to drop the old data volume
rm -f ~/.config/systemd/user/ingredo-backup.{service,timer}; systemctl --user daemon-reload
```

The `~/srv/ingredo` checkout on the laptop can then be deleted. Development
continues in `~/Work/Programming/ingredo` as before, and deploying becomes
`ssh <this-machine> ~/srv/ingredo/backend/deploy.sh` after merging to master.

## What a fresh database means for testers

This is the part the operator must communicate. The app is offline-first:
every phone holds a local SQLite copy of its household's recipes, plan, and
shopping list, and every row is tagged with the household id it belongs to.

- **Accounts and households are gone.** Every tester registers again with a
  new invite code, and household members re-join each other with a new join
  code.
- **Existing data on the phones will not carry over by itself.** The sync
  engine only adopts rows that were created *before* any sign-in (rows with
  no household). Rows tagged with an old household id are never touched and
  never shown under the new household. To a tester, their recipes simply
  vanish after re-registering, while still occupying storage.
- **The clean fix is to reset the app's local data before signing in
  again.** Android: uninstall and reinstall the beta APK, or Settings → Apps
  → Ingredo → Storage → Clear storage. iPhone: in Expo Go, remove the
  project's data (long-press the project entry and clear it, or delete and
  reinstall Expo Go), then reopen the project link.

If the operator would rather testers keep their recipes, that is exactly
what the "restore the laptop's data" alternative gives them, at the cost of
one `scp`. Raise this once, clearly, before Step 3, and then do what they
decide.
