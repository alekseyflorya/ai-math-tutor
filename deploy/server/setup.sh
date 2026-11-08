#!/usr/bin/env bash
# One-time hardening + Docker setup for a fresh Ubuntu VPS. Run as root:
#
#   scp deploy/server/setup.sh root@SERVER:/root/
#   ssh root@SERVER 'bash /root/setup.sh "ssh-ed25519 AAAA...CI-public-key..."'
#
# The optional argument is the PUBLIC key GitHub Actions will use to deploy.
# Safe to re-run. Password login is disabled only at the very end, and only after
# confirming that key-based login is configured — so you cannot lock yourself out.
set -euo pipefail

DEPLOY_USER=deploy
APP_DIR=/opt/ai-math-tutor
CI_PUBKEY="${1:-}"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "Run as root."; exit 1; }
[[ -s /root/.ssh/authorized_keys ]] || {
  echo "root has no SSH key yet. From your computer run: ssh-copy-id -i ~/.ssh/florik_vps.pub root@SERVER"
  exit 1
}

log "System update"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl gnupg ufw fail2ban unattended-upgrades

log "Docker"
if ! command -v docker >/dev/null; then
  codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
  install -m 0755 -d /etc/apt/keyrings
  # Prefer Docker's official repo; fall back to Ubuntu's packages if this release isn't published there yet.
  if curl -fsI "https://download.docker.com/linux/ubuntu/dists/${codename}/Release" >/dev/null; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codename} stable" \
      >/etc/apt/sources.list.d/docker.list
    apt-get update -q
    apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    echo "Docker repo has no '${codename}' yet — using Ubuntu packages."
    apt-get install -yq docker.io docker-compose-v2
  fi
fi
mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
EOF
systemctl enable docker >/dev/null
systemctl restart docker
docker compose version

log "Deploy user '${DEPLOY_USER}'"
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/${DEPLOY_USER}/.ssh"
keys="/home/${DEPLOY_USER}/.ssh/authorized_keys"
touch "$keys"
# Your own key (same as root's) + the CI key, without duplicates.
{
  cat "$keys" /root/.ssh/authorized_keys
  if [[ -n "$CI_PUBKEY" ]]; then echo "$CI_PUBKEY"; fi
} | sed '/^$/d' | sort -u >"${keys}.new"
mv "${keys}.new" "$keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$keys"
chmod 600 "$keys"
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"

log "Firewall (SSH, HTTP, HTTPS only)"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable
# Note: Docker publishes ports past ufw. Only 80/443 are published; Postgres is never exposed.

log "fail2ban for SSH"
cat >/etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF
systemctl enable fail2ban >/dev/null
systemctl restart fail2ban

log "Automatic security updates"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

log "Memory"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi
echo 'vm.swappiness=10' >/etc/sysctl.d/99-swappiness.conf
sysctl -q --system

log "SSH hardening"
# 00- so it wins over cloud-init's 50-*.conf (sshd uses the FIRST value it reads).
cat >/etc/ssh/sshd_config.d/00-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
MaxAuthTries 4
EOF
sshd -t
systemctl reload ssh || systemctl reload sshd

log "Done"
cat <<EOF
Next:
  1. In a NEW terminal (keep this one open) check:  ssh ${DEPLOY_USER}@$(hostname -I | awk '{print $1}')
  2. Create ${APP_DIR}/.env (see .env.example in the repo) as ${DEPLOY_USER}.
  3. Add GitHub secrets SSH_HOST, SSH_USER=${DEPLOY_USER}, SSH_KEY and push to main.
EOF
