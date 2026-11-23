# Sourced by the dev scripts: loads .env then dev/default.env, never overriding a variable already set
# (the environment wins over .env, which wins over the defaults).
for f in .env dev/default.env; do
  [ -f "$f" ] || continue
  while IFS='=' read -r k v || [ -n "$k" ]; do
    [[ $k =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    [ -z "${!k+x}" ] && export "$k=$v"
  done < "$f"
done
