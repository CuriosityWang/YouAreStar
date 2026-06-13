#!/usr/bin/env bash
# 本地构建 + 把 dist/ 增量上传到服务器。服务器只发静态文件、不编译，
# 所以服务器配置弱也无所谓。
#
# 真实服务器地址放在 gitignored 的 deploy.env（不进仓库，不泄露）：
#   cp deploy.env.example deploy.env     # 然后填好 SSH_TARGET / REMOTE_DIR
#   ssh-copy-id "$(. ./deploy.env; echo "$SSH_TARGET")"   # 配免密
#
# 用法：
#   ./deploy.sh                 # 构建 + 上传
#   ./deploy.sh --no-build      # 只上传现有 dist/（跳过构建）
set -euo pipefail
cd "$(dirname "$0")"

# 本地、被 .gitignore 忽略的配置（IP / 用户 / 路径都在这，不进源码）
[[ -f deploy.env ]] && source ./deploy.env
SSH_TARGET="${SSH_TARGET:-}"
REMOTE_DIR="${REMOTE_DIR:-}"
if [[ -z "$SSH_TARGET" || -z "$REMOTE_DIR" ]]; then
  echo "✗ 缺少配置。先：cp deploy.env.example deploy.env，填好 SSH_TARGET 和 REMOTE_DIR"
  exit 1
fi

if [[ "${1:-}" != "--no-build" ]]; then
  echo "▶ building locally…"
  npm run build
fi
[[ -f dist/index.html ]] || { echo "✗ dist/ 为空，先 npm run build"; exit 1; }

echo "▶ syncing dist/ → ${SSH_TARGET}:${REMOTE_DIR}"
# -a 递归保属性, -z 压缩, --delete 清掉服务器上已废弃的旧文件（含旧 hash 资源）,
# --delay-updates 先传临时名最后一次性就位（近似原子）,
# --exclude 保护宝塔托管文件：SSL 验证目录 .well-known、PHP 配置 .user.ini。
rsync -az --delete --delay-updates \
  --exclude='.well-known' \
  --exclude='.user.ini' \
  dist/ "${SSH_TARGET}:${REMOTE_DIR}/"

echo "✓ deployed"
