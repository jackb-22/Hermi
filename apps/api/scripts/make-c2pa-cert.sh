#!/usr/bin/env bash
# Demo C2PA signer: a private root CA and an ES256 leaf (digitalSignature, emailProtection), as c2pa-rs requires.
# Viewers show it as "untrusted signer" since the root is ours; the manifest still validates.
# Writes .c2pa/ (gitignored) and prints the two env lines for .env or the App Platform secrets.
set -euo pipefail
dir="${1:-.c2pa}"
mkdir -p "$dir"
cd "$dir"
openssl ecparam -name prime256v1 -genkey -noout -out ca.key
openssl req -x509 -new -key ca.key -sha256 -days 3650 \
  -subj "/CN=Incentivize the Physical Demo Root CA/O=Incentivize the Physical" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -out ca.pem
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out signer.key
openssl req -new -key signer.key -subj "/CN=Verified IRL Signer/O=Incentivize the Physical" -out signer.csr
printf "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=emailProtection\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n" > leaf.ext
openssl x509 -req -in signer.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 825 -sha256 -extfile leaf.ext -out signer.pem 2>/dev/null
cat signer.pem ca.pem > chain.pem
flat() { awk 'BEGIN{ORS="\\n"} {print}' "$1"; }
echo "C2PA_CERT_PEM=$(flat chain.pem)"
echo "C2PA_KEY_PEM=$(flat signer.key)"
