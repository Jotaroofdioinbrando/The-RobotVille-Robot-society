#!/data/data/com.termux/files/usr/bin/bash
# Script temporário: dá tick na simulação a cada 30 segundos.
# Rodar em primeiro plano no Termux (deixa o app aberto/com wake-lock ativo).

URL="https://the-robot-ville-robot-society.vercel.app/api/tick"
SECRET="r0B0Tv1Ll32026xyz"
INTERVALO=30

echo "Iniciando tick automático a cada ${INTERVALO}s em $URL"
echo "Pra parar: Ctrl+C"
echo ""

while true; do
  RESPOSTA=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$URL" -H "x-tick-secret: $SECRET")
  echo "$(date '+%H:%M:%S') - status HTTP: $RESPOSTA"
  sleep "$INTERVALO"
done
