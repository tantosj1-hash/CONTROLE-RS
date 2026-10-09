#!/usr/bin/env bash
# Cria e publica o projeto Firebase do Controle RS.
# Uso:  npx firebase login   (uma vez, com a conta Google dona do projeto)
#       bash scripts/criar-projeto-firebase.sh [id-do-projeto]
set -euo pipefail

PROJETO="${1:-controle-rs-$(date +%y%m%d)}"
FB="npx --yes firebase-tools@13"

echo ">> Criando o projeto $PROJETO"
$FB projects:create "$PROJETO" --display-name "Controle RS" || echo "(projeto já existe, seguindo)"

echo ">> Registrando o app web"
$FB apps:create web "Controle RS" --project "$PROJETO" || echo "(app web já existe, seguindo)"

echo ">> Criando o banco Firestore em São Paulo"
$FB firestore:databases:create "(default)" --location southamerica-east1 --project "$PROJETO" || echo "(banco já existe, seguindo)"

echo ">> Ativando login por e-mail e senha"
if command -v gcloud >/dev/null 2>&1; then
  TOKEN="$(gcloud auth print-access-token 2>/dev/null || true)"
  if [ -n "$TOKEN" ]; then
    curl -sf -X POST -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJETO" \
      "https://identitytoolkit.googleapis.com/v2/projects/$PROJETO/identityPlatform:initializeAuth" >/dev/null || true
    curl -sf -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "x-goog-user-project: $PROJETO" \
      "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJETO/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired" \
      -d '{"signIn":{"email":{"enabled":true,"passwordRequired":true}}}' >/dev/null \
      && echo "   login por e-mail ativado" || echo "   !! ative manualmente: Console Firebase > Authentication > Método de login > E-mail/senha"
  else
    echo "   !! ative manualmente: Console Firebase > Authentication > Método de login > E-mail/senha"
  fi
else
  echo "   !! ative manualmente: Console Firebase > Authentication > Método de login > E-mail/senha"
fi

echo ">> Compilando e publicando"
npm ci
npm run build
$FB deploy --only hosting,firestore --project "$PROJETO"

echo
echo "Pronto! Site: https://$PROJETO.web.app"
